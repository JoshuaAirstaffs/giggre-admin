// Compares an uploaded "all" workbook (lib/gigWorkbook.ts) with the live gigs.
//
//   { action: "compare", existing, deletes, newRows } → CompareResult
//
//   existing  rows with a Gig ID: unchanged / changed (which fields) / blocked
//             (changed, but it can't be edited: someone applied, it changed
//             after the download, wrong host) / missing (gig is gone)
//   deletes   rows marked delete: can it be deleted, and whose gig it is
//   newRows   new gigs that look already posted (same host, title, schedule
//             and address as an open gig), e.g. an old file uploaded again
//
// Read only: posting goes through /api/admin/bulk-gigs and deleting through
// /api/admin/bulk-gigs/host-gigs, which re-check everything. A whole file is
// compared in a few requests (gigs are read in batches), so a sheet of 500
// unchanged gigs takes seconds; nothing here geocodes.
import { NextRequest, NextResponse } from "next/server";
import type { DocumentData, GeoPoint } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { findHost } from "@/lib/findHost.server";
import { deleteBlockedReason, editBlockedReason, gigVersion } from "@/lib/bulkGigs.server";
import type {
  CompareDelete, CompareDuplicate, CompareExisting, CompareRequest, CompareResult, WbExistingRow, WbPhoto,
} from "@/lib/gigWorkbook";

export const maxDuration = 60;

/** Rows per request (the page sends a big file in a few requests). */
const MAX_ROWS = 300;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function authorize(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }) };
  const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
  const admin = (await adminDb.doc(`admins/${decoded.uid}`).get()).data();
  const allowed =
    admin && admin.isActive !== false && admin.isPending !== true &&
    (admin.role === "super_admin" || (Array.isArray(admin.permissions) && admin.permissions.includes("bulk-gigs")));
  if (!allowed) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { uid: decoded.uid };
}

const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const millis = (t: unknown) => (t as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null;
/** Excel turns line breaks into \r\n and may add spaces around them. */
const sameText = (a: string, b: string) => a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();
const num = (v: string) => Number(v.replace(/[,₱$\s]/g, ""));

/** Labels of the fields the row changes on gig `g` (same comparison as the Edit route). */
function changedFields(row: WbExistingRow, g: DocumentData): string[] {
  const out: string[] = [];
  if (!sameText(row.title, String(g.title ?? ""))) out.push("Title");
  if (!sameText(row.description, String(g.description ?? ""))) out.push("Description");
  const skill = String((Array.isArray(g.requiredSkills) ? g.requiredSkills[0] : "") ?? "");
  if (row.skill && row.skill.toLowerCase() !== skill.toLowerCase()) out.push("Skill");
  if (row.workers && Number(row.workers) !== Number(g.workerSlots ?? 1)) out.push("Workers Needed");
  const exp = String(g.experienceLevel ?? "entry");
  if (row.experience && row.experience.toLowerCase() !== exp) out.push("Experience");
  const pay = g.payType === "hourly" ? "hourly" : "flat";
  const payRow = row.payType.toLowerCase() === "fixed" ? "flat" : row.payType.toLowerCase();
  if (payRow && payRow !== pay) out.push("Pay Type");
  const amount = Number(g.ratePerSlot ?? g.budget ?? 0);
  if (!row.amount || !(Math.abs(num(row.amount) - amount) < 0.0001)) out.push("Amount");
  const hours = typeof g.workDurationHours === "number" ? g.workDurationHours : null;
  const rowHours = row.hours ? Number(row.hours) : null;
  if (!(rowHours === hours || (rowHours != null && hours != null && Math.abs(rowHours - hours) < 0.0001))) out.push("Est. Hours");
  const when = millis(g.scheduledDate);
  if (row.scheduledAt === "invalid") out.push("Schedule");
  else {
    const rowWhen = row.scheduledAt ? new Date(row.scheduledAt).getTime() : null;
    const same = rowWhen == null ? when == null : when != null && Math.floor(rowWhen / 60000) === Math.floor(when / 60000);
    if (!same) out.push("Schedule");
  }
  if (!sameText(row.address, String(g.address ?? ""))) out.push("Address");
  const loc = g.location as GeoPoint | undefined;
  const lat = row.lat === "" ? null : Number(row.lat), lng = row.lng === "" ? null : Number(row.lng);
  // Blank coordinates keep the pin (the address is what changes it).
  if (lat != null || lng != null) {
    if (!loc || lat == null || lng == null || !(Math.abs(lat - loc.latitude) < 1e-6) || !(Math.abs(lng - loc.longitude) < 1e-6)) out.push("Map pin");
  }
  if (row.photos) {
    const count = Array.isArray(g.images) ? g.images.length : 0;
    const same = row.photos.length === count && row.photos.every((p, i) => "keep" in p && p.keep === i + 1);
    if (!same) out.push("Photos");
  }
  return out;
}

function cleanExisting(raw: unknown): WbExistingRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const row: WbExistingRow = {
    n: Number(r.n) || 0,
    gigId: str(r.gigId, 200), version: str(r.version, 40), host: str(r.host, 300), title: str(r.title), description: str(r.description, 20000),
    skill: str(r.skill), workers: str(r.workers), experience: str(r.experience), payType: str(r.payType), amount: str(r.amount),
    hours: str(r.hours), scheduledAt: str(r.scheduledAt), scheduleText: str(r.scheduleText), address: str(r.address), lat: str(r.lat), lng: str(r.lng),
  };
  if (Array.isArray(r.photos)) {
    row.photos = (r.photos as unknown[]).slice(0, 20).map((p): WbPhoto => {
      const o = (p ?? {}) as Record<string, unknown>;
      return Number.isInteger(o.keep) ? { keep: o.keep as number } : { added: true, idx: Number(o.idx) || 0 };
    });
  }
  return ID_RE.test(row.gigId) ? row : null;
}

/** Reads gigs in batches. */
async function loadGigs(ids: string[]) {
  const unique = [...new Set(ids)];
  const gigs = new Map<string, DocumentData>();
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => adminDb.collection("open_gigs").doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const s of snaps) if (s.exists) gigs.set(s.id, s.data()!);
  }
  return gigs;
}

/** Which of these gigs have anyone in their workers sub-collection. */
async function withWorkers(ids: string[]) {
  const hasWorkers = new Set<string>();
  const need = [...new Set(ids)];
  for (let i = 0; i < need.length; i += 50) {
    await Promise.all(need.slice(i, i + 50).map(async (id) => {
      const w = await adminDb.collection("open_gigs").doc(id).collection("workers").limit(1).get();
      if (!w.empty) hasWorkers.add(id);
    }));
  }
  return hasWorkers;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;
    const body = (await req.json().catch(() => ({}))) as Partial<CompareRequest> & { action?: string };
    if (body.action !== "compare") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

    const existing = (Array.isArray(body.existing) ? body.existing : []).map(cleanExisting).filter((r): r is WbExistingRow => !!r);
    const deletes = (Array.isArray(body.deletes) ? body.deletes : [])
      .map((d) => ({ n: Number(d?.n) || 0, gigId: str(d?.gigId, 200), host: str(d?.host, 300), title: str(d?.title) }))
      .filter((d) => ID_RE.test(d.gigId));
    const newRows = (Array.isArray(body.newRows) ? body.newRows : [])
      .map((d) => ({ n: Number(d?.n) || 0, host: str(d?.host, 300), title: str(d?.title), scheduledAt: str(d?.scheduledAt, 40), address: str(d?.address) }));
    if (existing.length + deletes.length + newRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Send at most ${MAX_ROWS} rows per request.` }, { status: 400 });
    }

    // Host lookups, once per distinct value.
    const hostCache = new Map<string, Promise<{ id: string; label: string } | null>>();
    const hostOf = (q: string) => {
      const k = q.trim().toLowerCase();
      if (!hostCache.has(k)) {
        hostCache.set(k, findHost(q.trim()).then((d) => (d ? { id: d.id, label: String(d.data()?.email ?? d.data()?.name ?? d.id) } : null)).catch(() => null));
      }
      return hostCache.get(k)!;
    };

    // The workers sub-collection is only read for changed / delete rows.
    const gigs = await loadGigs([...existing.map((r) => r.gigId), ...deletes.map((d) => d.gigId)]);
    const diffs = new Map(existing.map((r) => [r.n, gigs.has(r.gigId) ? changedFields(r, gigs.get(r.gigId)!) : []]));
    const workers = await withWorkers([
      ...existing.filter((r) => (diffs.get(r.n) ?? []).length > 0).map((r) => r.gigId),
      ...deletes.map((d) => d.gigId),
    ].filter((id) => gigs.has(id)));

    const outExisting: CompareExisting[] = [];
    for (const r of existing) {
      const g = gigs.get(r.gigId);
      if (!g) { outExisting.push({ n: r.n, gigId: r.gigId, status: "missing", changes: [], reason: "This gig no longer exists (deleted?)." }); continue; }
      const changes = diffs.get(r.n) ?? [];
      const title = String(g.title ?? "");
      if (changes.length === 0) { outExisting.push({ n: r.n, gigId: r.gigId, status: "unchanged", changes, title }); continue; }
      let reason: string | null = editBlockedReason(g, workers.has(r.gigId));
      if (!reason && r.version !== gigVersion(g)) reason = "It was changed after you downloaded this file (by the host or another admin).";
      if (!reason && r.host) {
        const h = await hostOf(r.host);
        if (!h || h.id !== g.hostId) reason = "Host doesn't match this gig's host. Don't change the Gig ID or Host of existing gigs.";
      }
      outExisting.push({ n: r.n, gigId: r.gigId, status: reason ? "blocked" : "changed", changes, reason: reason ?? undefined, title });
    }

    const outDeletes: CompareDelete[] = [];
    for (const d of deletes) {
      const g = gigs.get(d.gigId);
      if (!g) { outDeletes.push({ n: d.n, gigId: d.gigId, ok: false, gone: true, reason: "Already deleted." }); continue; }
      const hostId = String(g.hostId ?? "");
      const host = d.host ? await hostOf(d.host) : null;
      const base = { n: d.n, gigId: d.gigId, hostId, title: String(g.title ?? ""), hostLabel: host?.label ?? (String(g.hostName ?? "") || hostId) };
      if (!d.host || !host || host.id !== hostId) {
        outDeletes.push({ ...base, ok: false, reason: "Host doesn't match this gig's host. Don't change the Gig ID or Host of existing gigs." });
        continue;
      }
      const reason = deleteBlockedReason(g, workers.has(d.gigId));
      outDeletes.push(reason ? { ...base, ok: false, reason: `Can't be deleted: ${reason}` } : { ...base, ok: true });
    }

    // New rows that match an open gig of the same host (title, schedule to the minute, address).
    const duplicates: CompareDuplicate[] = [];
    const hostGigs = new Map<string, Promise<{ id: string; g: DocumentData }[]>>();
    for (const r of newRows) {
      if (!r.host || !r.title) continue;
      const h = await hostOf(r.host);
      if (!h) continue;
      if (!hostGigs.has(h.id)) {
        hostGigs.set(h.id, adminDb.collection("open_gigs").where("hostId", "==", h.id).where("status", "==", "open").get()
          .then((s) => s.docs.map((d) => ({ id: d.id, g: d.data() }))).catch(() => []));
      }
      const when = r.scheduledAt && r.scheduledAt !== "invalid" ? Math.floor(new Date(r.scheduledAt).getTime() / 60000) : null;
      const hit = (await hostGigs.get(h.id)!).find(({ g }) => {
        const gWhen = millis(g.scheduledDate);
        return sameText(String(g.title ?? "").toLowerCase(), r.title.toLowerCase()) &&
          (gWhen == null ? when == null : when === Math.floor(gWhen / 60000)) &&
          sameText(String(g.address ?? "").toLowerCase(), r.address.toLowerCase());
      });
      if (hit) duplicates.push({ n: r.n, gigId: hit.id, title: String(hit.g.title ?? ""), createdAt: millis(hit.g.createdAt) });
    }

    const result: CompareResult = { existing: outExisting, deletes: outDeletes, duplicates };
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error." }, { status: 500 });
  }
}
