// Gig photos for Bulk Open Gigs.
//
//   POST   ?hostId=…   body: the image bytes (Content-Type image/*)
//          → stores it where the app puts gig photos (gig_images/{hostId}/…,
//            storage.rules: images only, 8 MB) and returns its download URL
//   DELETE ?path=…     → removes a photo this route stored (used when the gig
//                        then couldn't be created, so no orphan files stay)
//   GET    ?src=<url>  → the bytes of an existing gig photo (a gig_images/…
//                        download URL in this project's bucket), so the Edit
//                        sheet can show the gig's current photos
//
// The browser shrinks photos before sending them, so a request stays well
// under the hosting body limit.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";

export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Only files this route created: gig_images/{hostId}/bulk_… */
const OWN_PATH = /^gig_images\/[A-Za-z0-9_-]{1,128}\/bulk_[A-Za-z0-9_.-]{1,120}$/;

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

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;

    const hostId = req.nextUrl.searchParams.get("hostId") ?? "";
    if (!ID_RE.test(hostId)) return NextResponse.json({ error: "Missing host." }, { status: 400 });
    if (!(await adminDb.doc(`users/${hostId}`).get()).exists) return NextResponse.json({ error: "Host not found." }, { status: 404 });

    const type = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return NextResponse.json({ error: "Photos must be JPG, PNG or WebP." }, { status: 400 });
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) return NextResponse.json({ error: "Empty photo." }, { status: 400 });
    if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Photo is larger than 8 MB." }, { status: 400 });

    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `gig_images/${hostId}/bulk_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
    const token = randomUUID();
    const bucket = adminStorage.bucket();
    await bucket.file(path).save(bytes, {
      resumable: false,
      metadata: {
        contentType: type,
        // Same kind of URL getDownloadURL() gives the app.
        metadata: { firebaseStorageDownloadTokens: token, uploadedBy: `admin:${auth.uid}` },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return NextResponse.json({ ok: true, url, path });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Upload failed." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;
    const path = req.nextUrl.searchParams.get("path") ?? "";
    if (!OWN_PATH.test(path)) return NextResponse.json({ error: "Not a bulk gig photo." }, { status: 400 });
    await adminStorage.bucket().file(path).delete({ ignoreNotFound: true });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Delete failed." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;
    const src = req.nextUrl.searchParams.get("src") ?? "";
    const bucket = adminStorage.bucket();
    const prefix = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;
    if (!src.startsWith(prefix)) return NextResponse.json({ error: "Not a photo in this project." }, { status: 400 });
    const path = decodeURIComponent(src.slice(prefix.length).split("?")[0]);
    if (!/^gig_images\/[A-Za-z0-9_-]{1,128}\/[^/]{1,200}$/.test(path)) return NextResponse.json({ error: "Not a gig photo." }, { status: 400 });
    const file = bucket.file(path);
    const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
    const type = String(meta.contentType ?? "image/jpeg");
    if (!type.startsWith("image/")) return NextResponse.json({ error: "Not an image." }, { status: 400 });
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" } });
  } catch (err: any) {
    const code = err?.code === 404 ? 404 : 500;
    return NextResponse.json({ error: code === 404 ? "Photo not found." : err?.message ?? "Couldn't load the photo." }, { status: code });
  }
}
