// Bulk edit of Open Gigs with Excel: download the chosen hosts' editable gigs
// with their current values, change cells, upload it back. Each row is then
// checked and saved by /api/admin/bulk-gigs/edit with the same rules as the
// app's edit screen (edit_gig.dart): only while nobody applied or was hired.
//
// The sheet is self-contained (Gig ID, Host email, Version), so it can be
// uploaded later, after a reload or signing in again. Version is the gig's
// last edit time: a gig changed after the download is reported, not
// overwritten.

import { parseSchedule, readFirstSheet, type ResolvedLocation } from "@/lib/bulkGigs";
import { CURRENT_PHOTO_PIC_RE, CURRENT_PHOTO_RE, PICTURE_COLS, downloadGigSheet, parseGigTable, type SheetGig, type SheetPhoto } from "@/lib/gigSheet";
import { readSheetPictures, type SheetPicture } from "@/lib/xlsxImages";

/** A gig that can be edited, with its current values (for the download). */
export type EditableGig = SheetGig;

/** One uploaded row, as sent to the edit route. */
export interface EditRow {
  /** Excel row number, for messages. */
  row: number;
  gigId: string;
  host: string;
  version: string;
  title: string;
  description: string;
  skill: string;
  workers: string;
  experience: string;
  payType: string;
  amount: string;
  hours: string;
  /** ISO, "" = Flexible, "invalid" = unreadable. */
  scheduledAt: string;
  scheduleText: string;
  address: string;
  lat: string;
  lng: string;
  /**
   * The gig's photos after the edit, in order (Picture 1 … 5, then any other
   * pictures on the row). Undefined when the file has no Picture columns
   * (an older file): photos are then left as they are.
   */
  photos?: PhotoSlot[];
  /** A Picture cell that's neither a picture, "Current photo N" nor blank. */
  photoError?: string;
}

/**
 * One photo of the edited gig: keep the gig's existing photo N (1-based),
 * a new picture from the file (index into that row's files; checks only),
 * or a new picture already stored (save).
 */
export type PhotoSlot = { keep: number } | { newIdx: number } | { url: string };

export interface EditChange {
  label: string;
  from: string;
  to: string;
}

/** Result of checking (or saving) one row. */
export interface EditCheck {
  gigId: string;
  title: string;
  hostName: string;
  errors: string[];
  changes: EditChange[];
  /** Location looked up during the check; sent back on save so it isn't geocoded twice. */
  resolved?: ResolvedLocation | null;
  saved?: boolean;
  /** The gig's host (new photos are stored in their folder). */
  hostId?: string;
  /** After a save: the gig's new Version (its edit time). */
  version?: string;
}

/**
 * Downloads the Edit file with each gig's current photos embedded in Picture 1–5.
 * `loadPhoto` fetches one photo (null if it can't, then a link is shown instead).
 */
export async function downloadEditSheet(
  gigs: EditableGig[],
  loadPhoto?: (url: string) => Promise<SheetPhoto | null>,
  onProgress?: (done: number, total: number) => void,
) {
  const photos = new Map<string, (SheetPhoto | null)[]>();
  if (loadPhoto) {
    const jobs = gigs.flatMap((g) => (g.images ?? []).slice(0, PICTURE_COLS.length).map((url, i) => ({ g, url, i })));
    let done = 0;
    onProgress?.(0, jobs.length);
    // A few at a time.
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const thumb = await loadPhoto(job.url);
        const list = photos.get(job.g.id) ?? [];
        list[job.i] = thumb;
        photos.set(job.g.id, list);
        onProgress?.(++done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
  return downloadGigSheet("edit", gigs, { photos });
}

/**
 * Reads an edited sheet: the rows, and the new pictures placed on each row
 * (by Excel row number). Throws a readable Error for unusable files.
 */
export async function readEditFile(file: File): Promise<{ rows: EditRow[]; files: Map<number, File[]> }> {
  const sheet = await readFirstSheet(file, "Gigs");
  const table = parseGigTable(sheet, ["gigId", "host", "version"]);
  const { pictures } = await readSheetPictures(file, "Gigs").catch(() => ({ pictures: [] as SheetPicture[], skipped: 0 }));
  const picCols = PICTURE_COLS.map((k) => table.colOf(k));
  const files = new Map<number, File[]>();

  const rows: EditRow[] = table.rows.map((r) => {
    const { scheduledAt, scheduleText } = parseSchedule(r.get("date"), r.get("time"));
    const row: EditRow = {
      row: r.n,
      gigId: r.text("gigId"),
      host: r.text("host"),
      version: r.text("version"),
      title: r.text("title"),
      description: r.text("description"),
      skill: r.text("skill"),
      workers: r.text("workers"),
      experience: r.text("experience"),
      payType: r.text("payType"),
      amount: r.text("amount"),
      hours: r.text("hours"),
      scheduledAt,
      scheduleText,
      address: r.text("address"),
      lat: r.text("lat"),
      lng: r.text("lng"),
    };

    if (table.has("pictures")) {
      // Each Picture cell: a picture in it = new (replaces what was there),
      // "Current photo N" = keep, blank = nothing. Pictures elsewhere on the row are added after.
      const onRow = pictures.filter((p) => p.row === r.n);
      const used = new Set<SheetPicture>();
      const mine: File[] = [];
      const slots: PhotoSlot[] = [];
      // An existing photo embedded by the download keeps its name; anything else is new.
      const slotFor = (p: SheetPicture): PhotoSlot => {
        const keep = p.label?.match(CURRENT_PHOTO_PIC_RE);
        if (keep) return { keep: Number(keep[1]) };
        mine.push(p.file);
        return { newIdx: mine.length - 1 };
      };
      PICTURE_COLS.forEach((k, i) => {
        const col = picCols[i];
        if (col == null) return;
        const inCell = onRow.filter((p) => p.col === col);
        if (inCell.length) {
          for (const p of inCell) { used.add(p); slots.push(slotFor(p)); }
          return;
        }
        const t = r.text(k);
        const keep = t.match(CURRENT_PHOTO_RE);
        if (keep) slots.push({ keep: Number(keep[1]) });
        else if (t && !/^#[A-Z0-9/!?]+$/i.test(t) && !/DISPIMG\(/i.test(t)) {
          row.photoError = `${PICTURE_COLS.length > 1 ? `Picture ${i + 1}` : "Picture"} has "${t}". Put the picture itself in the cell, keep "Current photo N", or leave it blank.`;
        }
      });
      for (const p of onRow) if (!used.has(p)) slots.push(slotFor(p));
      row.photos = slots;
      if (mine.length) files.set(r.n, mine);
    }
    return row;
  });
  const noId = rows.filter((r) => !r.gigId);
  if (noId.length) {
    throw new Error(`Row${noId.length > 1 ? "s" : ""} ${noId.slice(0, 5).map((r) => r.row).join(", ")} ha${noId.length > 1 ? "ve" : "s"} no Gig ID. New gigs go on the Post gigs tab; edit only gigs downloaded here.`);
  }
  if (rows.length === 0) throw new Error("No gigs found under the column names.");
  return { rows, files };
}
