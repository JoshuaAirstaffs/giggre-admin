import { NextResponse } from "next/server";
import { adminDb, adminConfigError } from "@/lib/firebase-admin";

// Public (the login page calls it before sign-in), so it returns only one
// total — no names, no breakdown per type. Cached for a minute so reloading
// the login page can't run up Firestore reads.
const PENDING_COLLECTIONS = ["skill_requests", "verification_requests", "wallet_requests", "gig_points_requests"];
const TTL_MS = 60_000;

let cache: { pending: number; at: number } | null = null;

export async function GET() {
  if (adminConfigError) return NextResponse.json({ pending: null });

  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const counts = await Promise.all(
        PENDING_COLLECTIONS.map(async (name) =>
          (await adminDb.collection(name).where("status", "==", "pending").count().get()).data().count,
        ),
      );
      cache = { pending: counts.reduce((a, b) => a + b, 0), at: Date.now() };
    } catch (err) {
      console.error("[login-summary]", err);
      return NextResponse.json({ pending: null });
    }
  }

  return NextResponse.json(
    { pending: cache.pending },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } },
  );
}
