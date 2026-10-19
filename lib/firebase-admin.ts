import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import type { App } from "firebase-admin/app";

// The service-account key is required for the server-side routes (creating
// admins / app users, scheduled jobs). If it's missing or malformed we don't
// throw at import time — that crashes the whole route and Next.js answers with
// an HTML error page, which the admin UI can only report as
// "Unexpected token '<'". Instead every use throws this clear message, which
// the routes' own error handling returns as JSON.
export const adminConfigError: string | null = (() => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return "The server is missing FIREBASE_SERVICE_ACCOUNT_KEY. Add the Firebase service-account key to .env.local (or the hosting environment) and restart the server.";
  try {
    JSON.parse(raw);
    return null;
  } catch {
    return "FIREBASE_SERVICE_ACCOUNT_KEY isn't valid JSON. Paste the whole service-account JSON file as one line.";
  }
})();

function createAdminApp(): App | null {
  if (adminConfigError) return null;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
  return (
    getApps().find((a) => a.name === "admin") ??
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    }, "admin")
  );
}

const adminApp = createAdminApp();

/** Stands in for an SDK service when the app couldn't be configured. */
function unavailable<T extends object>(): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(adminConfigError ?? "Firebase Admin is not configured.");
    },
  });
}

export const adminAuth = adminApp ? getAuth(adminApp) : unavailable<ReturnType<typeof getAuth>>();
export const adminDb = adminApp ? getFirestore(adminApp) : unavailable<ReturnType<typeof getFirestore>>();
export const adminStorage = adminApp ? getStorage(adminApp) : unavailable<ReturnType<typeof getStorage>>();