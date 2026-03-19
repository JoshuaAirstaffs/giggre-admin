import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_KEY in .env.local");
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY
);

if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

const adminApp =
  getApps().find((a) => a.name === "admin") ??
  initializeApp({ credential: cert(serviceAccount) }, "admin");

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);