import { adminDb } from "@/lib/firebase-admin";

/**
 * A user by exact email (as typed, then lowercased), document id, or the
 * app's public userId. Exact matches only: never a partial or fuzzy search,
 * so it can't pick up someone else's account.
 */
export async function findHost(value: string) {
  const users = adminDb.collection("users");
  if (value.includes("@")) {
    for (const email of new Set([value, value.toLowerCase()])) {
      const q = await users.where("email", "==", email).limit(1).get();
      if (!q.empty) return q.docs[0];
    }
    return null;
  }
  if (!value.includes("/")) {
    const byId = await users.doc(value).get();
    if (byId.exists) return byId;
  }
  const q = await users.where("userId", "==", value).limit(1).get();
  return q.empty ? null : q.docs[0];
}
