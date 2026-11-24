// One Excel file for posting, editing and deleting Open Gigs (the "all"
// workbook, lib/gigSheet.ts). The admin downloads the chosen hosts' open gigs
// (or a blank template), works in it, and uploads it back. Each row is then:
//
//   no Gig ID                → a new gig to post
//   Gig ID + Action "delete" → a gig to delete
//   Gig ID, cells changed    → an edit (old → new shown before saving)
//   Gig ID, nothing changed  → skipped
//   Action "Deleted"         → deleted by an earlier upload, skipped
//
// Rows with only notes (nothing in the gig columns) are ignored. After the
// upload, the admin's own file comes back with the new Gig IDs filled in
// (lib/xlsxPatch.ts), so the same gigs aren't posted twice.

import { bulkRowFrom, readFirstSheet, type BulkGigRow } from "@/lib/bulkGigs";
import {
  CURRENT_PHOTO_PIC_RE, CURRENT_PHOTO_RE, PICTURE_COLS, downloadGigSheet, parseGigTable,
  type GigCol, type SheetGig, type SheetPhoto,
} from "@/lib/gigSheet";
import { readSheetPictures, type SheetPicture } from "@/lib/xlsxImages";

/** The app's photo limit per gig. */
const MAX_PICTURES = 5;
/** Placeholder a picture in a cell reads as (#VALUE! in Excel, =DISPIMG(…) in WPS). */
const isPlaceholder = (t: string) => /^#[A-Z0-9/!?]+$/i.test(t) || /DISPIMG\(/i.test(t);

// ── Types (shared with /api/admin/bulk-gigs/workbook) ────────────────────────

/** A photo of an existing gig after the admin's changes: keep its photo N, or new picture `idx` of the row's files. */
export type WbPhoto = { keep: number } | { added: true; idx: number };

/**
 * Fingerprint of a picture's bytes (short SHA-256). The download writes the
 * fingerprints of each gig's embedded photos in the Photo IDs column, so on
 * upload a picture is recognised as the gig's photo N wherever it sits, in
 * Excel, WPS or Google Sheets, and after the updated file is saved again.
 */
export async function photoKey(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A row with a Gig ID, compared with the live gig. */
export interface WbExistingRow {
  n: number;
  gigId: string;
  version: string;
  host: string;
  title: string;
  description: string;
  skill: string;
  workers: string;
  experience: string;
  payType: string;
  amount: string;
  hours: string;
  scheduledAt: string;
  scheduleText: string;
  address: string;
  lat: string;
  lng: string;
  /** Undefined when the file has no Picture columns. */
  photos?: WbPhoto[];
}

export interface WbDeleteRow {
  n: number;
  gigId: string;
  host: string;
  title: string;
}

export interface WbNewRow {
  n: number;
  row: BulkGigRow;
  /** Pictures on the row, in order. */
  files: File[];
  /** Something wrong with the row's pictures (it isn't posted until fixed). */
  photoError?: string;
}

export interface WbIssue { n: number; message: string }

export interface ReadWorkbook {
  newRows: WbNewRow[];
  existing: WbExistingRow[];
  deletes: WbDeleteRow[];
  issues: WbIssue[];
  /** Rows marked Deleted by an earlier upload. */
  alreadyDeleted: number;
  /** Where Gig ID / Version / Photo IDs / Action are, for writing them back (0-based). */
  cols: { gigId: number; version?: number; photoKeys?: number; action?: number };
  /** New pictures on an existing gig's row (WbPhoto added.idx points here). */
  addedFiles: Map<number, File[]>;
  /**
   * Fingerprints of the row's photos in their new order (existing gigs), or of
   * its pictures (new gigs): written to Photo IDs once the row is saved.
   */
  photoKeys: Map<number, string[]>;
}

export interface CompareRequest {
  existing: WbExistingRow[];
  deletes: WbDeleteRow[];
  /** New rows, to spot ones that look already posted. */
  newRows: { n: number; host: string; title: string; scheduledAt: string; address: string }[];
}

export interface CompareExisting {
  n: number;
  gigId: string;
  /** missing = the gig is gone; blocked = changed, but it can't be edited (reason says why). */
  status: "unchanged" | "changed" | "blocked" | "missing";
  /** Labels of the changed fields ("Title", "Amount"…). */
  changes: string[];
  reason?: string;
  title?: string;
}

export interface CompareDelete {
  n: number;
  gigId: string;
  ok: boolean;
  /** The gig no longer exists (deleted by an earlier upload whose file wasn't updated). */
  gone?: boolean;
  reason?: string;
  hostId?: string;
  hostLabel?: string;
  title?: string;
}

export interface CompareDuplicate {
  n: number;
  gigId: string;
  title: string;
  createdAt: number | null;
}

export interface CompareResult {
  existing: CompareExisting[];
  deletes: CompareDelete[];
  duplicates: CompareDuplicate[];
}

// ── Download ─────────────────────────────────────────────────────────────────

/**
 * Downloads the workbook: the gigs (with their current photos embedded, when
 * `loadPhoto` is given) plus room for new ones, or a blank template.
 */
export async function downloadAllSheet(
  gigs: SheetGig[],
  skills: string[],
  loadPhoto?: (url: string) => Promise<SheetPhoto | null>,
  onProgress?: (done: number, total: number) => void,
) {
  const photos = new Map<string, (SheetPhoto | null)[]>();
  if (loadPhoto) {
    const queue = gigs.flatMap((g) => (g.images ?? []).slice(0, PICTURE_COLS.length).map((url, i) => ({ g, url, i })));
    const total = queue.length;
    let done = 0;
    onProgress?.(0, total);
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const thumb = await loadPhoto(job.url).catch(() => null);
        const list = photos.get(job.g.id) ?? [];
        list[job.i] = thumb;
        photos.set(job.g.id, list);
        onProgress?.(++done, total);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
  // Fingerprints of the embedded photos (a photo shown as a link has none).
  const withKeys = await Promise.all(gigs.map(async (g) => {
    const list = photos.get(g.id);
    if (!list?.length) return g;
    const keys = await Promise.all((g.images ?? []).slice(0, PICTURE_COLS.length).map((_, i) => (list[i] ? photoKey(list[i]!.data) : "")));
    return { ...g, photoKeys: keys.join(",") };
  }));
  await downloadGigSheet("all", withKeys, { skills, photos });
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Gig columns (not Notes / Action): a row with none of these filled is only notes. */
const GIG_COLS: GigCol[] = [
  "gigId", "version", "host", "title", "description", "skill", "experience", "payType", "amount", "workers",
  "date", "time", "hours", "address", "lat", "lng", ...PICTURE_COLS,
];

/** Reads an uploaded workbook (or a Post template, or an Edit / Delete file). */
export async function readWorkbook(file: File): Promise<ReadWorkbook> {
  const sheet = await readFirstSheet(file, "Gigs");
  const table = parseGigTable(sheet, ["gigId", "host", "title"], 3);
  const { pictures } = await readSheetPictures(file, "Gigs").catch(() => ({ pictures: [] as SheetPicture[], skipped: 0 }));
  const picCols = PICTURE_COLS.map((k) => table.colOf(k));
  const keyOf = new Map<SheetPicture, string>();
  await Promise.all(pictures.map(async (p) => keyOf.set(p, await photoKey(await p.file.arrayBuffer()))));
  const addedFiles = new Map<number, File[]>();
  const photoKeys = new Map<number, string[]>();

  const newRows: WbNewRow[] = [];
  const existing: WbExistingRow[] = [];
  const deletes: WbDeleteRow[] = [];
  const issues: WbIssue[] = [];
  let alreadyDeleted = 0;

  // A Gig ID on two rows (a row copied without clearing it): neither is used.
  const idRows = new Map<string, number[]>();
  for (const r of table.rows) {
    const id = r.text("gigId");
    if (id) idRows.set(id, [...(idRows.get(id) ?? []), r.n]);
  }

  for (const r of table.rows) {
    const onRow = pictures.filter((p) => p.row === r.n);
    const action = r.text("action").toLowerCase();
    const id = r.text("gigId");
    if (!GIG_COLS.some((k) => r.text(k) !== "") && onRow.length === 0) {
      if (action && action !== "deleted") issues.push({ n: r.n, message: `Action "${r.text("action")}" is on a row with no gig.` });
      continue; // only notes
    }
    if (action === "deleted") { alreadyDeleted++; continue; }
    if (action && action !== "delete") {
      issues.push({ n: r.n, message: `Action must be blank or "delete" (found "${r.text("action")}").` });
      continue;
    }
    const twins = id ? idRows.get(id) ?? [] : [];
    if (twins.length > 1) {
      const others = twins.filter((x) => x !== r.n).join(", ");
      issues.push({ n: r.n, message: `Gig ID ${id} is also on row ${others}. If one of them is a new gig, clear its Gig ID and Version.` });
      continue;
    }

    if (action === "delete") {
      if (!id) { issues.push({ n: r.n, message: "Action is delete, but the row has no Gig ID (it isn't a posted gig)." }); continue; }
      deletes.push({ n: r.n, gigId: id, host: r.text("host"), title: r.text("title") });
      continue;
    }

    if (!id) {
      // New gig: every picture on the row is one of its photos (a copied row's photos too).
      const files: File[] = [];
      let photoError: string | undefined;
      PICTURE_COLS.forEach((k, i) => {
        const col = picCols[i];
        const inCell = col == null ? [] : onRow.filter((p) => p.col === col);
        const t = r.text(k);
        if (!inCell.length && t && !isPlaceholder(t)) {
          photoError = CURRENT_PHOTO_RE.test(t)
            ? `Picture ${i + 1} says "${t}" (copied from another gig). Put the picture itself in the cell, or leave it blank.`
            : `Picture ${i + 1} has "${t}". Put the picture itself in the cell, or leave it blank.`;
        }
      });
      const ordered = [...onRow].sort((a, b) => a.col - b.col);
      for (const p of ordered) files.push(p.file);
      photoKeys.set(r.n, ordered.map((p) => keyOf.get(p) ?? ""));
      if (files.length > MAX_PICTURES) photoError = `Up to ${MAX_PICTURES} photos per gig (this row has ${files.length}).`;
      const row = bulkRowFrom(r);
      row.pictures = files.map((f) => f.name).join(", ");
      newRows.push({ n: r.n, row, files, photoError });
      continue;
    }

    // Existing gig: compare with the live one.
    const base = bulkRowFrom(r);
    const item: WbExistingRow = {
      n: r.n, gigId: id, version: r.text("version"), host: base.host, title: base.title, description: base.description,
      skill: base.skill, workers: base.workers, experience: base.experience, payType: base.payType, amount: base.amount,
      hours: base.hours, scheduledAt: base.scheduledAt, scheduleText: base.scheduleText, address: base.address, lat: base.lat, lng: base.lng,
    };
    if (table.has("pictures")) {
      // The gig's photo N is recognised by its fingerprint (Photo IDs), else by the
      // name the download gave it; any other picture is new.
      const known = r.text("photoKeys").split(",").map((k) => k.trim());
      const slots: WbPhoto[] = [];
      const keys: string[] = [];
      const added: File[] = [];
      const used = new Set<SheetPicture>();
      const slotFor = (p: SheetPicture): WbPhoto => {
        const key = keyOf.get(p) ?? "";
        keys.push(key);
        const at = key ? known.indexOf(key) : -1;
        if (at >= 0) return { keep: at + 1 };
        const label = p.label?.match(CURRENT_PHOTO_PIC_RE);
        if (label) return { keep: Number(label[1]) };
        added.push(p.file);
        return { added: true, idx: added.length - 1 };
      };
      PICTURE_COLS.forEach((k, i) => {
        const col = picCols[i];
        const inCell = col == null ? [] : onRow.filter((p) => p.col === col);
        if (inCell.length) { for (const p of inCell) { used.add(p); slots.push(slotFor(p)); } return; }
        const keep = r.text(k).match(CURRENT_PHOTO_RE);
        if (keep) { slots.push({ keep: Number(keep[1]) }); keys.push(known[Number(keep[1]) - 1] ?? ""); }
      });
      for (const p of onRow) if (!used.has(p)) slots.push(slotFor(p));
      item.photos = slots;
      photoKeys.set(r.n, keys);
      if (added.length) addedFiles.set(r.n, added);
    }
    existing.push(item);
  }

  if (!newRows.length && !existing.length && !deletes.length && !issues.length && !alreadyDeleted) {
    throw new Error("No gigs found under the column names.");
  }
  return {
    newRows, existing, deletes, issues, alreadyDeleted, addedFiles, photoKeys,
    cols: { gigId: table.colOf("gigId")!, version: table.colOf("version"), photoKeys: table.colOf("photoKeys"), action: table.colOf("action") },
  };
}
