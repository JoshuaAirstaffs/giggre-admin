// Server-side checks shared by the bulk Open Gig routes (create and edit):
// the word filter, the unverified-account limit and geocoding, the same
// rules the app applies when a host posts or edits a gig.
import { adminDb } from "@/lib/firebase-admin";
import type { ResolvedLocation } from "@/lib/bulkGigs";
import type { SheetGig } from "@/lib/gigSheet";

/** The address / coordinates a location is resolved from. */
export interface LocationInput {
  address: string;
  lat: string;
  lng: string;
}

export const EXPERIENCE = ["entry", "intermediate", "expert"];
const UA = "GiggreAdmin/1.0 (bulk gig upload)";

// ── Small caches (a sheet is processed as many back-to-back requests) ────────

const TTL_MS = 5 * 60 * 1000;
let skillsCache: { at: number; byName: Map<string, string> } | null = null;
let filterCache: { at: number; enabled: boolean; terms: string[] } | null = null;

export async function skillsByName(): Promise<Map<string, string>> {
  if (skillsCache && Date.now() - skillsCache.at < TTL_MS) return skillsCache.byName;
  const snap = await adminDb.collection("skills").get();
  const byName = new Map<string, string>();
  for (const d of snap.docs) {
    const name = String(d.data().name ?? "").trim();
    if (name) byName.set(name.toLowerCase(), name);
  }
  skillsCache = { at: Date.now(), byName };
  return byName;
}

// Same rule as functions/src/wordFilter.ts: blocked term as a whole word.
export async function hasBlockedTerm(...texts: string[]): Promise<boolean> {
  if (!filterCache || Date.now() - filterCache.at >= TTL_MS) {
    const d = (await adminDb.doc("app_content/word_filter").get()).data();
    filterCache = {
      at: Date.now(),
      enabled: d?.enabled === true,
      terms: ((d?.blockedTerms as string[] | undefined) ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
    };
  }
  if (!filterCache.enabled) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return texts.some((t) =>
    filterCache!.terms.some((term) => new RegExp(`(?<![a-z0-9])${esc(term)}(?![a-z0-9])`).test(t.toLowerCase())),
  );
}

// ── Unverified-account limit (functions/src/unverifiedLimits.ts + fx.ts) ────

const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const pad = (n: number) => String(n).padStart(2, "0");

function periodKey(resetPeriod: string, resetEpoch: number): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000); // Asia/Manila wall clock via getUTC*
  const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
  let bucket: string;
  switch (resetPeriod) {
    case "daily": bucket = `${y}-${pad(m)}-${pad(d)}`; break;
    case "weekly": {
      const mon = new Date(Date.UTC(y, m - 1, d - ((t.getUTCDay() + 6) % 7)));
      bucket = `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;
      break;
    }
    case "monthly": bucket = `${y}-${pad(m)}`; break;
    case "yearly": bucket = `${y}`; break;
    default: bucket = "all";
  }
  return `${Math.round(resetEpoch)}|${resetPeriod}|${bucket}`;
}

/** Null when the gig fits, otherwise the reason (same wording as the app). */
export async function unverifiedLimitError(hostId: string, isVerified: unknown, amount: number, ccy: string): Promise<string | null> {
  if (isVerified === "verified") return null;
  const cfg = (await adminDb.doc("general_config/unverified_limits").get()).data();
  const maxUsd = pos(cfg?.maxUsd);
  if (!cfg || cfg.enabled !== true || !maxUsd) return null;

  const periods = ["never", "daily", "weekly", "monthly", "yearly"];
  const period = periods.includes(cfg.resetPeriod) ? cfg.resetPeriod : "never";
  const key = periodKey(period, pos(cfg.resetEpoch) ?? 0);

  const fxDoc = (await adminDb.doc("general_config/fx_rates").get()).data() ?? {};
  const php = pos(fxDoc.override?.PHP) ?? pos(fxDoc.rates?.PHP);
  const rates: Record<string, number> = { USD: 1, ...(php ? { PHP: php } : {}) };
  const toUsd = (v: number, c: string) => (c === "USD" ? v : rates[c] ? v / rates[c] : null);

  const totals = (await adminDb.doc(`transaction_totals/${hostId}`).get()).data();
  let usedUsd = 0;
  if (totals && (totals.periodKey ?? "0|never|all") === key) {
    for (const map of [totals.worker, totals.host]) {
      for (const [c, v] of Object.entries((map ?? {}) as Record<string, unknown>)) {
        const usd = typeof v === "number" && v > 0 ? toUsd(v, c) : null;
        if (usd) usedUsd += usd;
      }
    }
  }
  const newUsd = toUsd(amount, ccy);
  if (newUsd == null) return `The ${ccy} exchange rate isn't available right now, so the unverified limit can't be checked. Try again later.`;
  if (usedUsd + newUsd <= maxUsd + 0.005) return null;
  return usedUsd >= maxUsd - 0.005
    ? `Host isn't verified and has already reached the $${maxUsd} limit unverified accounts can spend on gigs.`
    : `Host isn't verified; this gig (${ccy} ${amount.toLocaleString()}) would take them over the $${maxUsd} unverified limit ($${(maxUsd - usedUsd).toFixed(2)} left).`;
}

// ── Geocoding (Nominatim, as the app does in country_check.dart) ─────────────

const PLACE_KEYS: Record<string, string[]> = {
  country: ["country"],
  region: ["region"],
  state: ["state"],
  province: ["province"],
  county: ["county", "state_district"],
  city: ["city", "town", "municipality", "village"],
  postcode: ["postcode"],
};

function placeFrom(addr: Record<string, unknown> | undefined): Record<string, string> | null {
  if (!addr) return null;
  const parts: Record<string, string> = {};
  for (const [key, sources] of Object.entries(PLACE_KEYS)) {
    for (const s of sources) {
      const v = typeof addr[s] === "string" ? (addr[s] as string).trim() : "";
      if (v) { parts[key] = v; break; }
    }
  }
  const code = typeof addr.country_code === "string" ? addr.country_code.toUpperCase() : "";
  if (code) parts.countryCode = code;
  return Object.keys(parts).length ? parts : null;
}

async function nominatim(path: string, params: Record<string, string>): Promise<any> {
  const url = `https://nominatim.openstreetmap.org/${path}?${new URLSearchParams({
    format: "json", addressdetails: "1", "accept-language": "en", ...params,
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}).`);
  return res.json();
}

/** Resolves the row's location: lat/lng if given, otherwise the address. */
export async function resolveLocation(row: LocationInput): Promise<ResolvedLocation | string> {
  const hasLat = row.lat !== "", hasLng = row.lng !== "";
  if (hasLat || hasLng) {
    const lat = Number(row.lat), lng = Number(row.lng);
    if (!hasLat || !hasLng || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return "Latitude/Longitude must both be valid numbers (or both blank to use the address).";
    }
    // Like the app, a failed lookup doesn't block the gig; it just has no `place`.
    let place: Record<string, string> | null = null;
    let display = "";
    try {
      const r = await nominatim("reverse", { lat: String(lat), lon: String(lng) });
      place = placeFrom(r?.address);
      display = typeof r?.display_name === "string" ? r.display_name : "";
    } catch { /* fail open */ }
    return { lat, lng, address: row.address || display || `${lat}, ${lng}`, place };
  }
  if (!row.address) return "Address is required (or give Latitude and Longitude).";
  let hits: any[];
  try {
    hits = await nominatim("search", { q: row.address, limit: "1" });
  } catch {
    return "Couldn't look up the address right now. Try again, or add Latitude/Longitude.";
  }
  const hit = hits?.[0];
  const lat = Number(hit?.lat), lng = Number(hit?.lon);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return `Couldn't find "${row.address}" on the map. Make the address more specific, or add Latitude/Longitude.`;
  }
  return { lat, lng, address: row.address, place: placeFrom(hit.address) };
}

// ── Gig → sheet row (Edit / Delete downloads) ───────────────────────────────

const toMillis = (t: unknown) => (t as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;

/** Changes whenever the gig is edited (by the host, the website or the admin). */
export const gigVersion = (g: FirebaseFirestore.DocumentData) => String(toMillis(g.editedAt) ?? toMillis(g.createdAt) ?? 0);

/** A gig's current values in the shared workbook format (lib/gigSheet.ts). */
export function sheetGig(
  id: string,
  g: FirebaseFirestore.DocumentData,
  host: { id: string; name: string; email: string },
): SheetGig {
  const loc = g.location as { latitude: number; longitude: number } | undefined;
  return {
    id,
    hostId: host.id,
    hostEmail: host.email,
    hostName: host.name,
    title: String(g.title ?? ""),
    description: String(g.description ?? ""),
    skill: String((Array.isArray(g.requiredSkills) ? g.requiredSkills[0] : "") ?? ""),
    experience: String(g.experienceLevel ?? "entry"),
    payType: g.payType === "hourly" ? "hourly" : "flat",
    amount: Number(g.ratePerSlot ?? g.budget ?? 0),
    currencyCode: String(g.currencyCode ?? ""),
    hours: typeof g.workDurationHours === "number" ? g.workDurationHours : null,
    workers: Number(g.workerSlots ?? 1),
    scheduledAt: toMillis(g.scheduledDate),
    address: String(g.address ?? ""),
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
    version: gigVersion(g),
  };
}
