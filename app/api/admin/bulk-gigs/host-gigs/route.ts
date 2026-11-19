// Delete chosen hosts' Open Gigs in bulk.
//
//   { action: "search", hosts: string[] }  → each host (exact email or user ID)
//                                             and their deletable Open Gigs
//   { action: "delete", hostIds, gigIds }  → permanently deletes the chosen gigs
//
// Hosts are only ever found by exact email / user ID, so other accounts can't
// be picked up. Only untouched gigs are listed: status "open", no applicants,
// no filled slots and nothing in the workers sub-collection. On delete each gig
// is re-checked inside a transaction (belongs to one of hostIds, still
// untouched), so a worker applying meanwhile keeps the gig.
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import type { DocumentData, Timestamp } from "firebase-admin/firestore";
import { findHost } from "@/lib/findHost.server";

export const maxDuration = 60;

const MAX_HOSTS = 20;
const MAX_DELETE = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface HostGig {
  id: string;
  hostId: string;
  title: string;
  workers: number;
  createdAt: number | null;
  scheduledAt: number | null;
  address: string;
  /** Posted from Bulk Open Gigs. */
  bulk: boolean;
}

export interface HostLookup {
  /** What the admin typed. */
  query: string;
  host: { id: string; name: string; email: string } | null;
  /** Deletable gigs listed for this host. */
  deletable: number;
  /** Open Gigs left out because they're in use (or not open). */
  inUse: number;
}

export interface HostGigsResult {
  hosts: HostLookup[];
  gigs: HostGig[];
}

/** Why this gig can't be deleted, or null if nobody has touched it. */
function blockedReason(g: DocumentData, hasWorkers: boolean): string | null {
  const status = String(g.status ?? "");
  if (status !== "open") return `Status is ${status || "unknown"}`;
  const applicants = Array.isArray(g.applicants) ? g.applicants.length : 0;
  if (applicants > 0) return `${applicants} applicant${applicants === 1 ? "" : "s"}`;
  if (Number(g.filledSlotCount ?? 0) > 0) return "Has hired workers";
  if (hasWorkers) return "Has workers assigned";
  return null;
}

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

const millis = (t: unknown) => (t as Timestamp | undefined)?.toMillis?.() ?? null;

async function searchHost(query: string, seen: Set<string>): Promise<{ lookup: HostLookup; gigs: HostGig[] }> {
  const doc = await findHost(query);
  if (!doc) return { lookup: { query, host: null, deletable: 0, inUse: 0 }, gigs: [] };
  const h = doc.data() ?? {};
  const host = { id: doc.id, name: String(h.name ?? ""), email: String(h.email ?? "") };
  // Same account typed twice (e.g. email and user ID): list its gigs once.
  if (seen.has(doc.id)) return { lookup: { query, host, deletable: 0, inUse: 0 }, gigs: [] };
  seen.add(doc.id);

  const snap = await adminDb.collection("open_gigs").where("hostId", "==", doc.id).get();
  const checked = await Promise.all(snap.docs.map(async (d) => {
    const g = d.data();
    if (blockedReason(g, false)) return null;
    const hasWorkers = !(await d.ref.collection("workers").limit(1).get()).empty;
    if (hasWorkers) return null;
    const gig: HostGig = {
      id: d.id,
      hostId: doc.id,
      title: String(g.title ?? ""),
      workers: Number(g.workerSlots ?? 1),
      createdAt: millis(g.createdAt),
      scheduledAt: millis(g.scheduledDate),
      address: String(g.address ?? ""),
      bulk: !!g.bulkUpload,
    };
    return gig;
  }));
  const gigs = checked.filter((g): g is HostGig => g !== null);
  return { lookup: { query, host, deletable: gigs.length, inUse: snap.size - gigs.length }, gigs };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "search") {
      const queries: string[] = Array.isArray(body?.hosts)
        ? [...new Set<string>(body.hosts.filter((x: unknown): x is string => typeof x === "string").map((x: string) => x.trim()).filter(Boolean))]
        : [];
      if (queries.length === 0) return NextResponse.json({ error: "Enter at least one host email or user ID." }, { status: 400 });
      if (queries.length > MAX_HOSTS) return NextResponse.json({ error: `Search at most ${MAX_HOSTS} hosts at a time.` }, { status: 400 });

      // One at a time so a repeated account is recognised in order.
      const seen = new Set<string>();
      const hosts: HostLookup[] = [];
      const gigs: HostGig[] = [];
      for (const q of queries) {
        const r = await searchHost(q, seen);
        hosts.push(r.lookup);
        gigs.push(...r.gigs);
      }
      gigs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const result: HostGigsResult = { hosts, gigs };
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "delete") {
      const hostIds = new Set<string>(
        Array.isArray(body?.hostIds) ? body.hostIds.filter((x: unknown): x is string => typeof x === "string" && x.length > 0) : [],
      );
      const ids: string[] = Array.isArray(body?.gigIds)
        ? [...new Set<string>(body.gigIds.filter((x: unknown): x is string => typeof x === "string" && ID_RE.test(x)))]
        : [];
      if (hostIds.size === 0) return NextResponse.json({ error: "Missing hosts." }, { status: 400 });
      if (hostIds.size > MAX_HOSTS) return NextResponse.json({ error: `At most ${MAX_HOSTS} hosts at a time.` }, { status: 400 });
      if (ids.length === 0) return NextResponse.json({ error: "No gigs selected." }, { status: 400 });
      if (ids.length > MAX_DELETE) return NextResponse.json({ error: `Delete at most ${MAX_DELETE} gigs at a time.` }, { status: 400 });

      const deleted: { id: string; title: string; hostId: string }[] = [];
      const skipped: { id: string; title: string; reason: string }[] = [];
      const failed: { id: string; title: string; error: string }[] = [];

      for (const id of ids) {
        const ref = adminDb.collection("open_gigs").doc(id);
        let title = "";
        let hostId = "";
        try {
          // Re-read inside a transaction: an application landing meanwhile keeps this gig.
          const reason = await adminDb.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            if (!cur.exists) return "Already deleted";
            const g = cur.data()!;
            title = String(g.title ?? "");
            hostId = String(g.hostId ?? "");
            if (!hostIds.has(hostId)) return "Belongs to a host that isn't chosen";
            const workers = await tx.get(ref.collection("workers").limit(1));
            const why = blockedReason(g, !workers.empty);
            if (why) return why;
            tx.delete(ref);
            return null;
          });
          if (reason) skipped.push({ id, title, reason });
          else deleted.push({ id, title, hostId });
        } catch (e: any) {
          failed.push({ id, title, error: e?.message ?? "Delete failed." });
        }
      }
      return NextResponse.json({ ok: true, deleted, skipped, failed });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error." }, { status: 500 });
  }
}
