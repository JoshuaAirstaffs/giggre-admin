// Bulk edit of Open Gigs (see lib/bulkEdit.ts).
//
//   { action: "list",  hosts: string[] }        → each host (exact email / user ID)
//                                                  and their editable gigs
//   { action: "check", row: EditRow }            → what would change, or why it can't
//   { action: "save",  row: EditRow, resolved? } → re-checks, then saves in a transaction
//
// Same rule as the app's edit screen (edit_gig.dart canEditGig): a gig can only
// be edited while it's open, slots aren't closed, nobody applied, nobody is
// assigned or hired. Checks mirror posting (bulk-gigs/route.ts): required
// fields, future schedule, word filter, unverified limit, gig in the host's
// country. Skill and Workers Needed can't be changed (GSIN codes are derived
// from the skill once). One row per request, like the bulk upload.
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, GeoPoint, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { findHost } from "@/lib/findHost.server";
import { EXPERIENCE, gigVersion, hasBlockedTerm, resolveLocation, sheetGig, unverifiedLimitError } from "@/lib/bulkGigs.server";
import type { ResolvedLocation } from "@/lib/bulkGigs";
import type { EditableGig, EditChange, EditCheck, EditRow, PhotoSlot } from "@/lib/bulkEdit";

export const maxDuration = 60;

const MAX_HOSTS = 20;
/** The app's photo limit per gig. */
const MAX_PICTURES = 5;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function authorize(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }) };
  const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
  const admin = (await adminDb.doc(`admins/${decoded.uid}`).get()).data();
  const allowed =
    admin && admin.isActive !== false && admin.isPending !== true &&
    (admin.role === "super_admin" || (Array.isArray(admin.permissions) && admin.permissions.includes("bulk-gigs")));
  if (!allowed) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { uid: decoded.uid, name: String(admin.name ?? admin.email ?? "Admin") };
}

const millis = (t: unknown) => (t as Timestamp | undefined)?.toMillis?.() ?? null;

const versionOf = gigVersion;

/** Why the gig can't be edited, or null. Same as the app's canEditGig, plus the workers sub-collection. */
function notEditable(g: DocumentData, hasWorkers: boolean): string | null {
  const status = String(g.status ?? "");
  if (status !== "open") return `It's ${status || "not open"} now, so it can't be edited.`;
  if (g.slotsClosed === true) return "Its slots are closed, so it can't be edited.";
  const applicants = Array.isArray(g.applicants) ? g.applicants.length : 0;
  if (applicants > 0) return `${applicants} worker${applicants === 1 ? " has" : "s have"} applied, so it can't be edited.`;
  if (g.assignedWorkerId || g.workerId || Number(g.filledSlotCount ?? 0) > 0 || hasWorkers) return "A worker is already hired, so it can't be edited.";
  return null;
}

const fmtMoney = (ccy: string, n: number) => `${ccy} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmtWhen = (ms: number | null, tz?: string) =>
  ms == null ? "Flexible" : new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz || undefined });

interface Evaluated {
  check: EditCheck;
  update: Record<string, unknown>;
}

/** Works out the update for one row and everything that's wrong with it. */
async function evaluate(row: EditRow, g: DocumentData, gigId: string, hasWorkers: boolean, tz: string | undefined, given?: ResolvedLocation | null, saving = false): Promise<Evaluated> {
  const errors: string[] = [];
  const changes: EditChange[] = [];
  const update: Record<string, unknown> = {};
  const check: EditCheck = { gigId, title: String(g.title ?? ""), hostName: String(g.hostName ?? ""), errors, changes, hostId: String(g.hostId ?? "") };

  const blocked = notEditable(g, hasWorkers);
  if (blocked) { errors.push(blocked); return { check, update }; }
  // Changed since the download? Only a problem if this row would change something
  // (a row saved earlier from the same file then just shows as unchanged).
  const stale = row.version !== versionOf(g);
  const host = row.host ? await findHost(row.host) : null;
  if (!host || host.id !== g.hostId) {
    errors.push("Host email doesn't match this gig's host. Don't change the Gig ID or Host email columns.");
    return { check, update };
  }

  // Title / description
  const title = row.title, description = row.description;
  if (!title) errors.push("Title is required.");
  if (!description) errors.push("Description is required.");
  const titleChanged = title !== String(g.title ?? "");
  const descChanged = description !== String(g.description ?? "");
  if ((titleChanged || descChanged) && title && description && (await hasBlockedTerm(title, description))) {
    errors.push("Title or description contains a blocked word (word filter).");
  }
  if (titleChanged) { update.title = title; changes.push({ label: "Title", from: String(g.title ?? ""), to: title }); }
  if (descChanged) { update.description = description; changes.push({ label: "Description", from: String(g.description ?? ""), to: description }); }

  // Skill can't change
  const skill = String((Array.isArray(g.requiredSkills) ? g.requiredSkills[0] : "") ?? "");
  if (row.skill && row.skill.toLowerCase() !== skill.toLowerCase()) {
    errors.push(`Skill can't be changed in bulk edit (it's "${skill}"). Post a new gig for a different skill.`);
  }

  // Workers Needed can't change either
  const curWorkers = Number(g.workerSlots ?? 1);
  if (row.workers && Number(row.workers) !== curWorkers) {
    errors.push(`Workers Needed can't be changed in bulk edit (it's ${curWorkers}).`);
  }

  // Experience
  const curExp = String(g.experienceLevel ?? "entry");
  const experience = (row.experience || curExp).toLowerCase();
  if (!EXPERIENCE.includes(experience)) errors.push("Experience must be entry, intermediate or expert.");
  else if (experience !== curExp) { update.experienceLevel = experience; changes.push({ label: "Experience", from: curExp, to: experience }); }

  // Pay
  const curPay = g.payType === "hourly" ? "hourly" : "flat";
  const payRaw = (row.payType || curPay).toLowerCase();
  const payType = payRaw === "fixed" ? "flat" : payRaw;
  if (payType !== "flat" && payType !== "hourly") errors.push("Pay Type must be flat or hourly.");
  const curAmount = Number(g.ratePerSlot ?? g.budget ?? 0);
  const amount = Number(row.amount.replace(/[,₱$\s]/g, ""));
  if (!row.amount || !Number.isFinite(amount) || amount <= 0) errors.push("Amount must be a number greater than 0.");
  const amountChanged = Number.isFinite(amount) && Math.abs(amount - curAmount) > 0.0001;
  const payChanged = payType !== curPay;

  // Hours
  const curHours = typeof g.workDurationHours === "number" ? g.workDurationHours : null;
  let hours: number | null = null;
  if (row.hours) {
    hours = Number(row.hours);
    if (!Number.isFinite(hours) || hours <= 0) errors.push("Est. Hours must be a number greater than 0 (or blank).");
  }
  if (hours !== curHours && !(hours != null && curHours != null && Math.abs(hours - curHours) < 0.0001)) {
    update.workDurationHours = hours ?? FieldValue.delete();
    changes.push({ label: "Est. hours", from: curHours == null ? "—" : String(curHours), to: hours == null ? "—" : String(hours) });
  }

  // Schedule (compared to the minute)
  const curWhen = millis(g.scheduledDate);
  if (row.scheduledAt === "invalid") {
    errors.push(`Date/Time "${row.scheduleText}" couldn't be read. Use a date like 2026-11-20 and a time like 14:30, or leave both blank for Flexible.`);
  } else {
    const when = row.scheduledAt ? new Date(row.scheduledAt).getTime() : null;
    const same = when == null ? curWhen == null : curWhen != null && Math.floor(when / 60000) === Math.floor(curWhen / 60000);
    if (!same) {
      if (when != null && (Number.isNaN(when) || when <= Date.now())) errors.push("The new date and time has already passed. Pick a future time, or leave it blank for Flexible.");
      update.scheduledDate = when != null ? Timestamp.fromMillis(when) : FieldValue.delete();
      changes.push({ label: "Schedule", from: fmtWhen(curWhen, tz), to: fmtWhen(when, tz) });
    }
  }

  // Location: new coordinates win; a new address (with the old coordinates) is looked up.
  const loc = g.location as GeoPoint | undefined;
  const curAddress = String(g.address ?? "");
  const lat = row.lat === "" ? NaN : Number(row.lat), lng = row.lng === "" ? NaN : Number(row.lng);
  const coordsChanged = !loc || !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat - loc.latitude) > 1e-6 || Math.abs(lng - loc.longitude) > 1e-6;
  const addressChanged = row.address !== curAddress;
  let currencyCode = String(g.currencyCode ?? "PHP");
  if (coordsChanged || addressChanged) {
    const coordsGiven = row.lat !== "" || row.lng !== "";
    let resolved: ResolvedLocation | string;
    if (given && Number.isFinite(given.lat) && Number.isFinite(given.lng)) resolved = given;
    else if (coordsChanged && coordsGiven) resolved = await resolveLocation({ address: row.address, lat: row.lat, lng: row.lng });
    else resolved = await resolveLocation({ address: row.address, lat: "", lng: "" });
    if (typeof resolved === "string") errors.push(resolved);
    else {
      check.resolved = resolved;
      const h = (await adminDb.doc(`users/${g.hostId}`).get()).data() ?? {};
      const gigCountry = resolved.place?.countryCode ?? null;
      const hostCountry = typeof h.countryCode === "string" ? h.countryCode.toUpperCase() : null;
      if (gigCountry && hostCountry && gigCountry !== hostCountry) {
        errors.push(`The new location is in ${gigCountry} but the host is in ${hostCountry}. Hosts can only post gigs in their own country.`);
      }
      currencyCode = (gigCountry ?? hostCountry) === "PH" ? "PHP" : "USD";
      update.location = new GeoPoint(resolved.lat, resolved.lng);
      update.address = resolved.address;
      if (resolved.place) update.place = resolved.place;
      if (currencyCode !== g.currencyCode) update.currencyCode = currencyCode;
      changes.push({ label: "Location", from: curAddress || "—", to: resolved.address });
    }
  }

  // Photos (only when the file has Picture columns).
  if (row.photoError) errors.push(row.photoError);
  if (row.photos) {
    const current: string[] = Array.isArray(g.images) ? g.images.filter((u: unknown): u is string => typeof u === "string") : [];
    const slots = row.photos;
    const unchanged = slots.length === current.length && slots.every((sl, i) => "keep" in sl && sl.keep === i + 1);
    if (!unchanged) {
      if (slots.length > MAX_PICTURES) errors.push(`At most ${MAX_PICTURES} photos per gig (this row has ${slots.length}).`);
      const kept = new Set<number>();
      for (const sl of slots) {
        if ("keep" in sl) {
          if (sl.keep < 1 || sl.keep > current.length) errors.push(`"Current photo ${sl.keep}" doesn't exist on this gig any more. Download a fresh copy.`);
          else if (kept.has(sl.keep)) errors.push(`"Current photo ${sl.keep}" is listed twice.`);
          kept.add(sl.keep);
        }
      }
      const added = slots.filter((sl) => !("keep" in sl)).length;
      const removed = current.length - kept.size;
      const plural = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;
      const detail = [added && `${added} new`, removed > 0 && `${removed} removed`].filter(Boolean).join(", ");
      changes.push({ label: "Photos", from: current.length ? plural(current.length) : "No photos", to: `${slots.length ? plural(slots.length) : "No photos"}${detail ? ` (${detail})` : " (reordered)"}` });

      if (saving) {
        // New photos were stored by /api/admin/bulk-gigs/photo in this host's folder.
        const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
        const prefix = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`gig_images/${g.hostId}/`)}`;
        const images: string[] = [];
        for (const sl of slots) {
          if ("keep" in sl) { if (current[sl.keep - 1]) images.push(current[sl.keep - 1]); }
          else if ("url" in sl && sl.url.startsWith(prefix)) images.push(sl.url);
          else errors.push("A new photo wasn't uploaded. Try saving again.");
        }
        update.images = images.length ? images : FieldValue.delete();
      }
    }
  }

  if (amountChanged || payChanged || update.currencyCode) {
    update.budget = amount;
    update.ratePerSlot = amount;
    update.payType = payType;
    update.hourlyRate = payType === "hourly" ? amount : FieldValue.delete();
    if (amountChanged || update.currencyCode) {
      changes.push({ label: payType === "hourly" ? "Rate per hour" : "Pay per worker", from: fmtMoney(String(g.currencyCode ?? ""), curAmount), to: fmtMoney(currencyCode, amount) });
    }
    if (payChanged) changes.push({ label: "Pay type", from: curPay, to: payType });
    if (amountChanged && errors.length === 0) {
      const h = (await adminDb.doc(`users/${g.hostId}`).get()).data() ?? {};
      const workers = Number(g.workerSlots ?? 1) || 1;
      const limit = await unverifiedLimitError(g.hostId, h.isVerified, amount * workers, currencyCode);
      if (limit) errors.push(limit);
    }
  }

  if (stale && changes.length > 0) {
    errors.length = 0;
    errors.push("This gig was changed after you downloaded the file (by the host or another admin). Download a fresh copy and edit that.");
  }
  return { check, update };
}

async function loadGig(gigId: string) {
  const ref = adminDb.collection("open_gigs").doc(gigId);
  const [snap, workers] = await Promise.all([ref.get(), ref.collection("workers").limit(1).get()]);
  return { ref, snap, hasWorkers: !workers.empty };
}

function cleanRow(raw: unknown): EditRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const row: EditRow = {
    row: Number(r.row) || 0,
    gigId: s("gigId"), host: s("host"), version: s("version"), title: s("title"), description: s("description"),
    skill: s("skill"), workers: s("workers"), experience: s("experience"), payType: s("payType"), amount: s("amount"), hours: s("hours"),
    scheduledAt: s("scheduledAt"), scheduleText: s("scheduleText"), address: s("address"), lat: s("lat"), lng: s("lng"),
  };
  if (Array.isArray(r.photos)) {
    const slots: PhotoSlot[] = [];
    for (const x of (r.photos as unknown[]).slice(0, 20)) {
      const o = (x ?? {}) as Record<string, unknown>;
      if (Number.isInteger(o.keep)) slots.push({ keep: o.keep as number });
      else if (Number.isInteger(o.newIdx)) slots.push({ newIdx: o.newIdx as number });
      else if (typeof o.url === "string") slots.push({ url: o.url });
    }
    row.photos = slots;
  }
  if (typeof r.photoError === "string" && r.photoError) row.photoError = r.photoError.slice(0, 300);
  return ID_RE.test(row.gigId) ? row : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    if ("error" in auth) return auth.error;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const tz = typeof body?.timeZone === "string" ? body.timeZone : undefined;

    if (action === "list") {
      const queries: string[] = Array.isArray(body?.hosts)
        ? [...new Set<string>(body.hosts.filter((x: unknown): x is string => typeof x === "string").map((x: string) => x.trim()).filter(Boolean))]
        : [];
      if (queries.length === 0) return NextResponse.json({ error: "Enter at least one host email or user ID." }, { status: 400 });
      if (queries.length > MAX_HOSTS) return NextResponse.json({ error: `Search at most ${MAX_HOSTS} hosts at a time.` }, { status: 400 });

      const seen = new Set<string>();
      const hosts: { query: string; host: { id: string; name: string; email: string } | null; editable: number; locked: number }[] = [];
      const gigs: EditableGig[] = [];
      for (const q of queries) {
        const doc = await findHost(q);
        if (!doc) { hosts.push({ query: q, host: null, editable: 0, locked: 0 }); continue; }
        const h = doc.data() ?? {};
        const host = { id: doc.id, name: String(h.name ?? ""), email: String(h.email ?? "") };
        if (seen.has(doc.id)) { hosts.push({ query: q, host, editable: 0, locked: 0 }); continue; }
        seen.add(doc.id);
        const snap = await adminDb.collection("open_gigs").where("hostId", "==", doc.id).get();
        const mine = (await Promise.all(snap.docs.map(async (d) => {
          const g = d.data();
          if (notEditable(g, false)) return null;
          if (!(await d.ref.collection("workers").limit(1).get()).empty) return null;
          const gig: EditableGig = sheetGig(d.id, g, host);
          return gig;
        }))).filter((g): g is EditableGig => g !== null);
        mine.sort((a, b) => a.title.localeCompare(b.title));
        gigs.push(...mine);
        hosts.push({ query: q, host, editable: mine.length, locked: snap.size - mine.length });
      }
      return NextResponse.json({ ok: true, hosts, gigs });
    }

    if (action === "check" || action === "save") {
      const row = cleanRow(body?.row);
      if (!row) return NextResponse.json({ error: "Missing or invalid Gig ID." }, { status: 400 });
      const { ref, snap, hasWorkers } = await loadGig(row.gigId);
      if (!snap.exists) {
        const check: EditCheck = { gigId: row.gigId, title: row.title, hostName: "", errors: ["Gig not found. It may have been deleted."], changes: [] };
        return NextResponse.json({ ok: true, check });
      }
      const given = action === "save" ? (body?.resolved as ResolvedLocation | null | undefined) : undefined;
      const { check, update } = await evaluate(row, snap.data()!, row.gigId, hasWorkers, tz, given, action === "save");
      if (action === "check" || check.errors.length > 0 || check.changes.length === 0) {
        return NextResponse.json({ ok: true, check });
      }

      // Save: re-check inside a transaction so an application landing now isn't overwritten.
      // editedAt is set here (not serverTimestamp) so the new Version can be returned.
      const editedAt = Timestamp.now();
      try {
        await adminDb.runTransaction(async (tx) => {
          const cur = await tx.get(ref);
          const workers = await tx.get(ref.collection("workers").limit(1));
          const g = cur.data();
          if (!g) throw new Error("Gig not found. It may have been deleted.");
          const blocked = notEditable(g, !workers.empty);
          if (blocked) throw new Error(blocked);
          if (versionOf(g) !== row.version) throw new Error("This gig was changed a moment ago. Download a fresh copy and edit that.");
          tx.update(ref, {
            ...update,
            editedAt,
            bulkEdit: { adminId: auth.uid, adminName: auth.name, at: FieldValue.serverTimestamp() },
          });
        });
        check.saved = true;
        check.version = String(editedAt.toMillis());
      } catch (e: any) {
        check.errors.push(e?.message ?? "Save failed.");
      }
      return NextResponse.json({ ok: true, check });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error." }, { status: 500 });
  }
}
