// Bulk Open Gig upload — checks (create: false) or creates (create: true)
// ONE spreadsheet row per request, so a long sheet never hits the function
// timeout and the page can show progress row by row.
//
// The checks mirror what the app runs before posting an Open Gig
// (post_open_gig_screen.dart _submit): required fields, a future schedule
// or Flexible, the word filter, the unverified-account limit, and a gig
// location in the host's own country. Currency and the searchable `place`
// come from the gig's location, exactly as in the app. The skill must be in
// the skills library. The gig document has the same shape as
// OpenGigModel.toMap() plus `place`.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import type { BulkGigRow, BulkGigPreview, ResolvedLocation } from "@/lib/bulkGigs";
import { findHost } from "@/lib/findHost.server";
import { EXPERIENCE, hasBlockedTerm, resolveLocation, skillsByName, suggestLocations, unverifiedLimitError } from "@/lib/bulkGigs.server";

export const maxDuration = 30;

const MAX_WORKERS = 50;
/** Same as MAX_PICTURES in lib/bulkGigs.ts (the app's 5-photo limit). */
const MAX_PICTURES = 5;

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
    const admin = (await adminDb.doc(`admins/${decoded.uid}`).get()).data();
    const allowed =
      admin && admin.isActive !== false && admin.isPending !== true &&
      (admin.role === "super_admin" || (Array.isArray(admin.permissions) && admin.permissions.includes("bulk-gigs")));
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const row = body?.row as BulkGigRow | undefined;
    const create = body?.create === true;
    if (!row || typeof row !== "object") return NextResponse.json({ error: "Missing row." }, { status: 400 });
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    for (const k of Object.keys(row) as (keyof BulkGigRow)[]) row[k] = s(row[k]);

    const errors: string[] = [];

    // Fields
    if (!row.title) errors.push("Title is required.");
    if (!row.description) errors.push("Description is required.");
    if (!row.skill) errors.push("Skill is required.");

    const experience = (row.experience || "entry").toLowerCase();
    if (!EXPERIENCE.includes(experience)) errors.push("Experience must be entry, intermediate or expert.");

    const payRaw = (row.payType || "flat").toLowerCase();
    const payType = payRaw === "fixed" ? "flat" : payRaw;
    if (payType !== "flat" && payType !== "hourly") errors.push("Pay Type must be flat or hourly.");

    const amount = Number(row.amount.replace(/[,₱$\s]/g, ""));
    if (!row.amount || !Number.isFinite(amount) || amount <= 0) errors.push("Amount must be a number greater than 0.");

    const workers = row.workers ? Number(row.workers) : 1;
    if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) errors.push(`Workers Needed must be a whole number from 1 to ${MAX_WORKERS}.`);

    let hours: number | null = null;
    if (row.hours) {
      hours = Number(row.hours);
      if (!Number.isFinite(hours) || hours <= 0) errors.push("Est. Hours must be a number greater than 0 (or blank).");
    }

    let scheduledAt: Date | null = null;
    if (row.scheduledAt === "invalid") {
      errors.push("Date/Time couldn't be read. Use a date like 2026-11-20 and a time like 14:30, or leave both blank for Flexible.");
    } else if (row.scheduledAt) {
      scheduledAt = new Date(row.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) errors.push("Date/Time couldn't be read.");
      else if (scheduledAt <= new Date()) errors.push("That date and time has already passed. Pick a future time, or leave it blank for Flexible.");
    }

    if ((row.title || row.description) && (await hasBlockedTerm(row.title, row.description))) {
      errors.push("Title or description contains a blocked word (word filter).");
    }

    // Skill must come from the skills library (the template's dropdown);
    // matched case-insensitively and saved with the library's spelling.
    const library = row.skill ? await skillsByName() : new Map<string, string>();
    const skill = library.get(row.skill.toLowerCase()) ?? "";
    const skillNotFound = !!row.skill && !skill;
    if (skillNotFound) errors.push(`Skill "${row.skill}" isn't in the skills library. Pick one from the list.`);

    // Host
    let host: FirebaseFirestore.DocumentSnapshot | null = null;
    if (!row.host) errors.push("Host is required.");
    else {
      host = await findHost(row.host);
      if (!host) errors.push(`No user found for host "${row.host}".`);
    }
    const h = host?.data() ?? {};
    if (host) {
      if (h.isBanned === true) errors.push("Host account is banned.");
      if (h.pendingDeletion === true) errors.push("Host account is scheduled for deletion.");
      const until = h.suspended_until instanceof Timestamp ? h.suspended_until.toDate() : null;
      if (until && until > new Date()) errors.push(`Host account is suspended until ${until.toLocaleString()}.`);
    }

    // Location (reuse what the check resolved, so a create doesn't geocode again)
    const given = body?.resolved as ResolvedLocation | undefined;
    const location: ResolvedLocation | string =
      create && given && Number.isFinite(given.lat) && Number.isFinite(given.lng)
        ? { lat: given.lat, lng: given.lng, address: s(given.address) || row.address, place: given.place ?? null }
        : await resolveLocation(row);
    if (typeof location === "string") errors.push(location);

    // No country from the address lookup (e.g. a Google-suggested spot):
    // fall back to the map position, so a gig in the Philippines isn't
    // priced in USD and shown to US workers.
    const phByCoords = (lat: number, lng: number) =>
      lat >= 4.2 && lat <= 21.5 && lng >= 116 && lng <= 127 && !(lat < 7.4 && lng < 119.3);
    const gigCountry =
      typeof location === "string"
        ? null
        : location.place?.countryCode ?? (phByCoords(location.lat, location.lng) ? "PH" : null);
    const hostCountry = typeof h.countryCode === "string" ? h.countryCode.toUpperCase() : null;
    // Same rule as the app's country check, which fails open when a country is unknown.
    if (gigCountry && hostCountry && gigCountry !== hostCountry) {
      errors.push(`Gig location is in ${gigCountry} but the host is in ${hostCountry}. Hosts can only post gigs in their own country.`);
    }
    const currencyCode = (gigCountry ?? hostCountry) === "PH" ? "PHP" : "USD";

    if (host && errors.length === 0) {
      const limitError = await unverifiedLimitError(host.id, h.isVerified, amount * workers, currencyCode);
      if (limitError) errors.push(limitError);
    }

    // Photos: links to files /api/admin/bulk-gigs/photo stored for this host.
    const images: string[] = [];
    if (create && Array.isArray(body?.images)) {
      const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
      const prefix = host ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`gig_images/${host.id}/`)}` : "";
      for (const u of body.images as unknown[]) {
        if (typeof u === "string" && prefix && u.startsWith(prefix)) images.push(u);
        else errors.push("A photo link isn't valid. Upload the photos again.");
      }
      if (images.length > MAX_PICTURES) errors.push(`At most ${MAX_PICTURES} photos per gig.`);
    }

    if (errors.length > 0 || !host || typeof location === "string") {
      // The page then offers a Latitude/Longitude form for that row.
      const locationNotFound = typeof location === "string";
      // Address not found on the map: suggest the places Google Maps finds for it.
      const suggestions = locationNotFound && row.address && !row.lat && !row.lng
        ? await suggestLocations(row.address, hostCountry)
        : [];
      return NextResponse.json({ ok: false, errors, skillNotFound, locationNotFound, suggestions });
    }

    const preview: BulkGigPreview = {
      hostId: host.id,
      hostName: String(h.name ?? ""),
      skill,
      currencyCode,
      amount,
      workers,
      payType: payType as "flat" | "hourly",
      experience,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      location,
    };
    if (!create) return NextResponse.json({ ok: true, preview });

    // Same shape as OpenGigModel.toMap() + the extras post_open_gig_screen adds.
    const createdAt = Timestamp.now();
    const ref = await adminDb.collection("open_gigs").add({
      hostId: host.id,
      hostName: preview.hostName,
      title: row.title,
      description: row.description,
      requiredSkills: [skill],
      experienceLevel: experience,
      budget: amount,
      currencyCode,
      payType,
      ...(payType === "hourly" ? { hourlyRate: amount } : {}),
      ...(hours != null ? { workDurationHours: hours } : {}),
      location: new GeoPoint(location.lat, location.lng),
      address: location.address,
      status: "open",
      gigType: "open",
      createdAt,
      ...(scheduledAt ? { scheduledDate: Timestamp.fromDate(scheduledAt) } : {}),
      workerSlots: workers,
      ratePerSlot: amount,
      filledSlotCount: 0,
      slotsCompleted: 0,
      ...(location.place ? { place: location.place } : {}),
      ...(images.length ? { images } : {}),
      // Traceability: which admin bulk-posted it, and in which upload.
      bulkUpload: {
        adminId: decoded.uid,
        adminName: String(admin.name ?? admin.email ?? "Admin"),
        batchId: s(body?.batchId) || null,
      },
    });
    // version = what gigVersion() gives a gig never edited (written back into the workbook).
    return NextResponse.json({ ok: true, preview, gigId: ref.id, version: String(createdAt.toMillis()) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error." }, { status: 500 });
  }
}
