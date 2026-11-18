// Delete a host's Open Gigs in bulk.
//
//   { action: "search", host }          → the host (exact email or user ID) and
//                                         all their Open Gigs, newest first
//   { action: "delete", hostId, gigIds } → permanently deletes the chosen gigs
//
// Only that one host's gigs are ever listed or deleted: every gig is checked
// to belong to hostId before it's deleted. A gig is only deleted while it is
// untouched: status "open", no applicants, no filled slots and nothing in its
// workers sub-collection. That is re-checked inside a transaction per gig, so
// a worker applying at the same moment stops the delete. Gigs in use are
// skipped and reported — cancel those from Live Gigs instead.
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import type { DocumentData, Timestamp } from "firebase-admin/firestore";
import { findHost } from "@/lib/findHost.server";

export const maxDuration = 60;

const MAX_DELETE = 500;

export interface HostGig {
  id: string;
  title: string;
  status: string;
  applicants: number;
  workers: number;
  createdAt: number | null;
  scheduledAt: number | null;
  address: string;
  /** Posted from Bulk Open Gigs. */
  bulk: boolean;
  /** Why it can't be deleted; null when it can. */
  blocked: string | null;
}

export interface HostGigsResult {
  host: { id: string; name: string; email: string };
  gigs: HostGig[];
}

/** Why this gig can't be deleted any more, or null if nobody has touched it. */
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

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "search") {
      const value = typeof body?.host === "string" ? body.host.trim() : "";
      if (!value) return NextResponse.json({ error: "Enter the host's email or user ID." }, { status: 400 });
      const host = await findHost(value);
      if (!host) return NextResponse.json({ error: `No user found for "${value}".` }, { status: 404 });
      const h = host.data() ?? {};

      const snap = await adminDb.collection("open_gigs").where("hostId", "==", host.id).get();
      const gigs: HostGig[] = await Promise.all(snap.docs.map(async (d) => {
        const g = d.data();
        // Only open, applicant-free gigs need the sub-collection check.
        const quick = blockedReason(g, false);
        const hasWorkers = quick ? false : !(await d.ref.collection("workers").limit(1).get()).empty;
        return {
          id: d.id,
          title: String(g.title ?? ""),
          status: String(g.status ?? ""),
          applicants: Array.isArray(g.applicants) ? g.applicants.length : 0,
          workers: Number(g.workerSlots ?? 1),
          createdAt: millis(g.createdAt),
          scheduledAt: millis(g.scheduledDate),
          address: String(g.address ?? ""),
          bulk: !!g.bulkUpload,
          blocked: quick ?? blockedReason(g, hasWorkers),
        };
      }));
      gigs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const result: HostGigsResult = {
        host: { id: host.id, name: String(h.name ?? ""), email: String(h.email ?? "") },
        gigs,
      };
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "delete") {
      const hostId = typeof body?.hostId === "string" ? body.hostId : "";
      const ids: string[] = Array.isArray(body?.gigIds)
        ? [...new Set<string>(body.gigIds.filter((x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x)))]
        : [];
      if (!hostId) return NextResponse.json({ error: "Missing host." }, { status: 400 });
      if (ids.length === 0) return NextResponse.json({ error: "No gigs selected." }, { status: 400 });
      if (ids.length > MAX_DELETE) return NextResponse.json({ error: `Delete at most ${MAX_DELETE} gigs at a time.` }, { status: 400 });

      const deleted: { id: string; title: string }[] = [];
      const skipped: { id: string; title: string; reason: string }[] = [];
      const failed: { id: string; title: string; error: string }[] = [];

      for (const id of ids) {
        const ref = adminDb.collection("open_gigs").doc(id);
        let title = "";
        try {
          // Re-read inside a transaction: an application landing meanwhile keeps this gig.
          const reason = await adminDb.runTransaction(async (tx) => {
            const cur = await tx.get(ref);
            if (!cur.exists) return "Already deleted";
            const g = cur.data()!;
            title = String(g.title ?? "");
            if (g.hostId !== hostId) return "Belongs to another host";
            const workers = await tx.get(ref.collection("workers").limit(1));
            const why = blockedReason(g, !workers.empty);
            if (why) return why;
            tx.delete(ref);
            return null;
          });
          if (reason) skipped.push({ id, title, reason });
          else deleted.push({ id, title });
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
