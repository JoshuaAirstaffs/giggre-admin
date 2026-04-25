import { adminDb } from "@/lib/firebase-admin";
import { Timestamp, FieldValue, WriteBatch } from "firebase-admin/firestore";

const COLLECTIONS = ["open_gigs", "quick_gigs", "offered_gigs"];
const DEFAULT_EXPIRE_AFTER_HOURS = 480;
const BATCH_LIMIT = 499;

type CollectionExpiry = Record<string, number>;

export type ExpiredGig = {
  id: string;
  title: string;
  gigType: string;
  collection: string;
  expireAfterHours: number;
};

export type ExpiryResult = {
  expired: number;
  gigs: ExpiredGig[];
};

async function getExpiryConfig(): Promise<CollectionExpiry> {
  const doc = await adminDb.doc("general_config/gigExpiry").get();
  if (!doc.exists) return {};
  return (doc.data() as CollectionExpiry) ?? {};
}

export async function runExpiry(actorId: string, actorName: string, actorEmail: string | null): Promise<ExpiryResult> {
  const expiryConfig = await getExpiryConfig();

  type GigEntry = {
    ref: FirebaseFirestore.DocumentReference;
    id: string;
    title: string;
    gigType: string;
    collection: string;
    expireAfterHours: number;
  };

  const updates: GigEntry[] = [];
  const affectedFiles: string[] = [];

  for (const collectionName of COLLECTIONS) {
    const expireAfterHours = expiryConfig[collectionName] ?? DEFAULT_EXPIRE_AFTER_HOURS;
    const cutoff = new Date();
    cutoff.setTime(cutoff.getTime() - expireAfterHours * 60 * 60 * 1000);
    const cutoffTimestamp = Timestamp.fromDate(cutoff);

    const snapshot = await adminDb
      .collection(collectionName)
      .where("createdAt", "<=", cutoffTimestamp)
      .get();

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const status = data.status?.toLowerCase();
      if (status !== "no_worker" && status !== "open") continue;

      updates.push({
        ref: docSnap.ref,
        id: docSnap.id,
        title: data.title ?? "Untitled",
        gigType: data.gigType ?? collectionName,
        collection: collectionName,
        expireAfterHours,
      });
      affectedFiles.push(`${collectionName}/${docSnap.id}`);
    }
  }

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
  }

  const expiredCount = updates.length;

  if (expiredCount > 0) {
    const ticketList = updates
      .map((g) => `• [${g.gigType}] "${g.title}" (ID: ${g.id})`)
      .join("\n");

    await adminDb.collection("activityLogs").add({
      actorId,
      actorName,
      actorEmail,
      module: "gig_management",
      action: "gig_updated",
      description: `Auto-expired ${expiredCount} gig${expiredCount !== 1 ? "s" : ""} based on per-collection expiry config:\n${ticketList}`,
      targetSection: null,
      targetId: null,
      targetName: null,
      affectedFiles,
      meta: {
        from: null,
        to: "expired",
        other: {
          count: expiredCount,
          tickets: updates.map((g) => ({ id: g.id, title: g.title, gigType: g.gigType, collection: g.collection })),
        },
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    expired: expiredCount,
    gigs: updates.map(({ id, title, gigType, collection, expireAfterHours }) => ({
      id, title, gigType, collection, expireAfterHours,
    })),
  };
}
