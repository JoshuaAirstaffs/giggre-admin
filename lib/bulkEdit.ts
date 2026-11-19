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
import { downloadGigSheet, parseGigTable, type SheetGig } from "@/lib/gigSheet";

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
}

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
}

export function downloadEditSheet(gigs: EditableGig[]) {
  return downloadGigSheet("edit", gigs);
}

/** Reads an edited sheet. Throws a readable Error for unusable files. */
export async function readEditFile(file: File): Promise<EditRow[]> {
  const sheet = await readFirstSheet(file, "Gigs");
  const table = parseGigTable(sheet, ["gigId", "host", "version"]);
  const rows: EditRow[] = table.rows.map((r) => {
    const { scheduledAt, scheduleText } = parseSchedule(r.get("date"), r.get("time"));
    return {
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
  });
  const noId = rows.filter((r) => !r.gigId);
  if (noId.length) {
    throw new Error(`Row${noId.length > 1 ? "s" : ""} ${noId.slice(0, 5).map((r) => r.row).join(", ")} ha${noId.length > 1 ? "ve" : "s"} no Gig ID. New gigs go on the Post gigs tab; edit only gigs downloaded here.`);
  }
  if (rows.length === 0) throw new Error("No gigs found under the column names.");
  return rows;
}
