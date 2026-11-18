// Bulk Open Gig upload — checks (create: false) or creates (create: true)
// ONE spreadsheet row per request, so a long sheet never hits the function
// timeout and the page can show progress row by row.
//
// The checks mirror what the app runs before posting an Open Gig
// (post_open_gig_screen.dart _submit): required fields, a future schedule
// or Flexible, the word filter, the unverified-account limit, and a gig
// location in the host's own country. Currency and the searchable `place`
// come from the gig's location, exactly as in the app. The skill must be in
// the skills library. The gig document has the same shape as
// OpenGigModel.toMap() plus `place`.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import type { BulkGigRow, BulkGigPreview, ResolvedLocation } from "@/lib/bulkGigs";
import { findHost } from "@/lib/findHost.server";

export const maxDuration = 30;

const EXPERIENCE = ["entry", "intermediate", "expert"];
const MAX_WORKERS = 50;
const UA = "GiggreAdmin/1.0 (bulk gig upload)";

// ── Small caches (a sheet is processed as many back-to-back requests) ────────

const TTL_MS = 5 * 60 * 1000;
let skillsCache: { at: number; byName: Map<string, string> } | null = null;
let filterCache: { at: number; enabled: boolean; terms: string[] } | null = null;

async function skillsByName(): Promise<Map<string, string>> {
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
async function hasBlockedTerm(...texts: string[]): Promise<boolean> {
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
async function unverifiedLimitError(hostId: string, isVerified: unknown, amount: number, ccy: string): Promise<string | null> {
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
async function resolveLocation(row: BulkGigRow): Promise<ResolvedLocation | string> {
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

// ── Host lookup ──────────────────────────────────────────────────────────────


// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
    const admin = (await adminDb.doc(`admins/${decoded.uid}`).get()).data();
    const allowed =
      admin && admin.isActive !== false && admin.isPending !== true &&
      (admin.role === "super_admin" || (Array.isArray(admin.permissions) && admin.permissions.includes("bulk-gigs")));
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const row = body?.row as BulkGigRow | undefined;
    const create = body?.create === true;
    if (!row || typeof row !== "object") return NextResponse.json({ error: "Missing row." }, { status: 400 });
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    for (const k of Object.keys(row) as (keyof BulkGigRow)[]) row[k] = s(row[k]);

    const errors: string[] = [];

    // Fields
    if (!row.title) errors.push("Title is required.");
    if (!row.description) errors.push("Description is required.");
    if (!row.skill) errors.push("Skill is required.");

    const experience = (row.experience || "entry").toLowerCase();
    if (!EXPERIENCE.includes(experience)) errors.push("Experience must be entry, intermediate or expert.");

    const payRaw = (row.payType || "flat").toLowerCase();
    const payType = payRaw === "fixed" ? "flat" : payRaw;
    if (payType !== "flat" && payType !== "hourly") errors.push("Pay Type must be flat or hourly.");

    const amount = Number(row.amount.replace(/[,₱$\s]/g, ""));
    if (!row.amount || !Number.isFinite(amount) || amount <= 0) errors.push("Amount must be a number greater than 0.");

    const workers = row.workers ? Number(row.workers) : 1;
    if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) errors.push(`Workers Needed must be a whole number from 1 to ${MAX_WORKERS}.`);

    let hours: number | null = null;
    if (row.hours) {
      hours = Number(row.hours);
      if (!Number.isFinite(hours) || hours <= 0) errors.push("Est. Hours must be a number greater than 0 (or blank).");
    }

    let scheduledAt: Date | null = null;
    if (row.scheduledAt === "invalid") {
      errors.push("Date/Time couldn't be read. Use a date like 2026-11-20 and a time like 14:30, or leave both blank for Flexible.");
    } else if (row.scheduledAt) {
      scheduledAt = new Date(row.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) errors.push("Date/Time couldn't be read.");
      else if (scheduledAt <= new Date()) errors.push("That date and time has already passed. Pick a future time, or leave it blank for Flexible.");
    }

    if ((row.title || row.description) && (await hasBlockedTerm(row.title, row.description))) {
      errors.push("Title or description contains a blocked word (word filter).");
    }

    // Skill must come from the skills library (the template's dropdown);
    // matched case-insensitively and saved with the library's spelling.
    const library = row.skill ? await skillsByName() : new Map<string, string>();
    const skill = library.get(row.skill.toLowerCase()) ?? "";
    const skillNotFound = !!row.skill && !skill;
    if (skillNotFound) errors.push(`Skill "${row.skill}" isn't in the skills library. Pick one from the list.`);

    // Host
    let host: FirebaseFirestore.DocumentSnapshot | null = null;
    if (!row.host) errors.push("Host is required.");
    else {
      host = await findHost(row.host);
      if (!host) errors.push(`No user found for host "${row.host}".`);
    }
    const h = host?.data() ?? {};
    if (host) {
      if (h.isBanned === true) errors.push("Host account is banned.");
      if (h.pendingDeletion === true) errors.push("Host account is scheduled for deletion.");
      const until = h.suspended_until instanceof Timestamp ? h.suspended_until.toDate() : null;
      if (until && until > new Date()) errors.push(`Host account is suspended until ${until.toLocaleString()}.`);
    }

    // Location (reuse what the check resolved, so a create doesn't geocode again)
    const given = body?.resolved as ResolvedLocation | undefined;
    const location: ResolvedLocation | string =
      create && given && Number.isFinite(given.lat) && Number.isFinite(given.lng)
        ? { lat: given.lat, lng: given.lng, address: s(given.address) || row.address, place: given.place ?? null }
        : await resolveLocation(row);
    if (typeof location === "string") errors.push(location);

    const gigCountry = typeof location === "string" ? null : location.place?.countryCode ?? null;
    const hostCountry = typeof h.countryCode === "string" ? h.countryCode.toUpperCase() : null;
    // Same rule as the app's country check, which fails open when a country is unknown.
    if (gigCountry && hostCountry && gigCountry !== hostCountry) {
      errors.push(`Gig location is in ${gigCountry} but the host is in ${hostCountry}. Hosts can only post gigs in their own country.`);
    }
    const currencyCode = (gigCountry ?? hostCountry) === "PH" ? "PHP" : "USD";

    if (host && errors.length === 0) {
      const limitError = await unverifiedLimitError(host.id, h.isVerified, amount * workers, currencyCode);
      if (limitError) errors.push(limitError);
    }

    if (errors.length > 0 || !host || typeof location === "string") {
      return NextResponse.json({ ok: false, errors, skillNotFound });
    }

    const preview: BulkGigPreview = {
      hostId: host.id,
      hostName: String(h.name ?? ""),
      skill,
      currencyCode,
      amount,
      workers,
      payType: payType as "flat" | "hourly",
      experience,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      location,
    };
    if (!create) return NextResponse.json({ ok: true, preview });

    // Same shape as OpenGigModel.toMap() + the extras post_open_gig_screen adds.
    const ref = await adminDb.collection("open_gigs").add({
      hostId: host.id,
      hostName: preview.hostName,
      title: row.title,
      description: row.description,
      requiredSkills: [skill],
      experienceLevel: experience,
      budget: amount,
      currencyCode,
      payType,
      ...(payType === "hourly" ? { hourlyRate: amount } : {}),
      ...(hours != null ? { workDurationHours: hours } : {}),
      location: new GeoPoint(location.lat, location.lng),
      address: location.address,
      status: "open",
      gigType: "open",
      createdAt: Timestamp.now(),
      ...(scheduledAt ? { scheduledDate: Timestamp.fromDate(scheduledAt) } : {}),
      workerSlots: workers,
      ratePerSlot: amount,
      filledSlotCount: 0,
      slotsCompleted: 0,
      ...(location.place ? { place: location.place } : {}),
      // Traceability: which admin bulk-posted it, and in which upload.
      bulkUpload: {
        adminId: decoded.uid,
        adminName: String(admin.name ?? admin.email ?? "Admin"),
        batchId: s(body?.batchId) || null,
      },
    });
    return NextResponse.json({ ok: true, preview, gigId: ref.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error." }, { status: 500 });
  }
}
