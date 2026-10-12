import { ref, deleteObject } from "firebase/storage";
import { storage } from "@/lib/firebase";

// Only files the admin uploads itself are ever deleted — pasted external URLs
// and anything outside this folder (e.g. users' verification documents) are
// left alone even if a URL pointing at them ends up in a form.
const OWNED_PREFIX = "app_content/";

/** Storage path for a Firebase Storage download URL, or null if it isn't one. */
function storagePath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "firebasestorage.googleapis.com") return null;
    const match = u.pathname.match(/\/o\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of an image this admin uploaded. Never throws — a failed
 * cleanup only leaves an unused file behind, so it shouldn't fail a save.
 */
export async function deleteOwnedImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const path = storagePath(url);
  if (!path || !path.startsWith(OWNED_PREFIX)) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    if ((err as { code?: string })?.code === "storage/object-not-found") return;
    console.warn("[storageCleanup] could not delete", path, err);
  }
}
