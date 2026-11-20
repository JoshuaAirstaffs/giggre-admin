// Gig photos from the admin: shrink in the browser, store through
// /api/admin/bulk-gigs/photo (gig_images/{hostId}/…, like the app).
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";

const PHOTO_MAX_SIDE = 1600;

/** Shrinks a photo to at most 1600px on its longest side, as JPEG (keeps uploads small). */
export async function shrinkPhoto(file: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} couldn't be opened. Use JPG, PNG or WebP photos.`);
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error(`${file.name} couldn't be converted.`);
  return blob;
}

export async function photoApi(method: "POST" | "DELETE", query: string, body?: Blob): Promise<{ url?: string; path?: string }> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/admin/bulk-gigs/photo?${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": body.type } : {}) },
    body,
  });
  const data = await readApiJson<{ url?: string; path?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? `Photo upload failed (HTTP ${res.status}).`);
  return data;
}


/** Stores one photo for a host's gig; returns its download URL and storage path. */
export async function uploadGigPhoto(hostId: string, file: File): Promise<{ url: string; path: string }> {
  const r = await photoApi("POST", `hostId=${encodeURIComponent(hostId)}`, await shrinkPhoto(file));
  if (!r.url || !r.path) throw new Error("Photo upload failed.");
  return { url: r.url, path: r.path };
}

/** Removes photos stored by uploadGigPhoto (best effort, e.g. after a failed save). */
export function deleteGigPhotos(paths: string[]) {
  return Promise.all(paths.map((p) => photoApi("DELETE", `path=${encodeURIComponent(p)}`).catch(() => {})));
}

/** A small JPEG of an existing gig photo, for showing it inside the Edit sheet. */
export interface PhotoThumb { data: Uint8Array; width: number; height: number }

/** Loads an existing gig photo (through the admin route) and shrinks it to fit a `box`px square. */
export async function loadPhotoThumb(url: string, box = 220): Promise<PhotoThumb | null> {
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch(`/api/admin/bulk-gigs/photo?src=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const scale = Math.min(1, box / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}
