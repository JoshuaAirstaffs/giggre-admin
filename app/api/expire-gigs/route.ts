import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp, FieldValue, WriteBatch } from "firebase-admin/firestore";

const COLLECTIONS = ["open_gigs", "quick_gigs", "offered_gigs"];
const EXPIRE_AFTER_DAYS = 20;
const BATCH_LIMIT = 499;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRE_AFTER_DAYS);
  const cutoffTimestamp = Timestamp.fromDate(cutoff);

  let expiredCount = 0;
  const affectedFiles: string[] = [];

  // Collect all updates first, then commit in batches of 499
  const updates: { ref: FirebaseFirestore.DocumentReference }[] = [];

  for (const collectionName of COLLECTIONS) {
    const snapshot = await adminDb
      .collection(collectionName)
      .where("createdAt", "<=", cutoffTimestamp)
      .get();

    for (const docSnap of snapshot.docs) {
      const status = docSnap.data().status?.toLowerCase();
      if (status === "completed" || status === "expired") continue;

      updates.push({ ref: docSnap.ref });
      affectedFiles.push(`${collectionName}/${docSnap.id}`);
    }
  }

  // Commit in batches
  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch: WriteBatch = adminDb.batch();
    const chunk = updates.slice(i, i + BATCH_LIMIT);
    for (const { ref } of chunk) {
      batch.update(ref, {
        status: "expired",
        expiredAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    expiredCount += chunk.length;
  }

  if (expiredCount > 0) {
    await adminDb.collection("activityLogs").add({
      actorId: "system",
      actorName: "System (Cron)",
      actorEmail: null,
      module: "gig_management",
      action: "gig_updated",
      description: `Auto-expired ${expiredCount} gig${expiredCount !== 1 ? "s" : ""} inactive for ${EXPIRE_AFTER_DAYS}+ days`,
      targetSection: null,
      targetId: null,
      targetName: null,
      affectedFiles,
      meta: {
        from: null,
        to: "expired",
        other: { count: expiredCount, collections: COLLECTIONS },
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return NextResponse.json({ expired: expiredCount });
}
