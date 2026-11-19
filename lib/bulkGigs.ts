// Bulk Open Gig upload: the spreadsheet columns, a template with dropdowns
// (Skill comes from the skills library), a minimal .xlsx reader
// (jszip is already a dependency, so no spreadsheet library is needed) and
// the template download. Rows are checked and created one at a time by
// /api/admin/bulk-gigs, which applies the same checks the app does.

import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PICTURE_COLS, downloadGigSheet, parseGigTable } from "@/lib/gigSheet";

/** One spreadsheet row, as sent to /api/admin/bulk-gigs. */
export interface BulkGigRow {
  host: string;
  title: string;
  description: string;
  skill: string;
  experience: string;
  payType: string;
  amount: string;
  workers: string;
  hours: string;
  /** ISO timestamp in the uploader's timezone, "" = Flexible, "invalid" = unreadable date/time. */
  scheduledAt: string;
  /** What the sheet said, for the preview ("2026-11-20 14:00" / "Flexible"). */
  scheduleText: string;
  address: string;
  lat: string;
  lng: string;
  /** Photo file names, as typed (comma / new line separated). */
  pictures: string;
}

/** Same limit as the app (GigImagesController.maxImages). */
export const MAX_PICTURES = 5;

/** File names listed in a row's Pictures cell (any folder part dropped). */
export function pictureNames(cell: string): string[] {
  return cell.split(/[,;\n]+/).map((s) => s.trim().split(/[\\/]/).pop()!.trim()).filter(Boolean);
}

/** Location the server resolved during the check; sent back on create so it isn't geocoded twice. */
export interface ResolvedLocation {
  lat: number;
  lng: number;
  address: string;
  place: Record<string, string> | null;
}

export interface BulkGigPreview {
  hostId: string;
  hostName: string;
  skill: string;
  currencyCode: string;
  amount: number;
  workers: number;
  payType: "flat" | "hourly";
  experience: string;
  scheduledAt: string | null;
  location: ResolvedLocation;
}

/** Skill names from the skills library (the app's skill picker), A→Z. */
export async function loadSkillNames(): Promise<string[]> {
  const snap = await getDocs(collection(db, "skills"));
  const names = new Set<string>();
  snap.forEach((d) => {
    const n = String(d.data().name ?? "").trim();
    if (n) names.add(n);
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** The Post template (same workbook format as the Edit / Delete files; see lib/gigSheet.ts). */
export async function downloadTemplate(skills: string[]) {
  return downloadGigSheet("post", [], { skills });
}

// ── .xlsx reading ─────────────────────────────────────────────────────────────

export type Cell = string | number | null;

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A worksheet of an .xlsx file as rows of cells (numbers stay numbers): the
 * sheet named `preferName` if there is one (e.g. "Gigs" in a workbook that
 * starts with an Instructions sheet), otherwise the first one.
 */
export async function readFirstSheet(file: File, preferName?: string): Promise<Cell[][]> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("This isn't an .xlsx file. Save it as Excel Workbook (.xlsx) and try again.");
  }
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

  // The first sheet in workbook order (not necessarily sheet1.xml).
  const workbook = parse((await zip.file("xl/workbook.xml")?.async("string")) ?? "");
  const rels = parse((await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "");
  const sheetEls = Array.from(workbook.getElementsByTagName("sheet"));
  const wanted = preferName ? sheetEls.find((el) => (el.getAttribute("name") ?? "").trim().toLowerCase() === preferName.toLowerCase()) : undefined;
  const firstRid = (wanted ?? sheetEls[0])?.getAttribute("r:id");
  let target = "worksheets/sheet1.xml";
  for (const r of Array.from(rels.getElementsByTagName("Relationship"))) {
    if (r.getAttribute("Id") === firstRid) target = r.getAttribute("Target") ?? target;
  }
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetXml = await zip.file(sheetPath)?.async("string");
  if (!sheetXml) throw new Error("Couldn't find a worksheet in this file.");

  const shared: string[] = [];
  const sst = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (sst) {
    for (const si of Array.from(parse(sst).getElementsByTagName("si"))) {
      shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    }
  }

  const rows: Cell[][] = [];
  for (const row of Array.from(parse(sheetXml).getElementsByTagName("row"))) {
    const out: Cell[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const idx = colIndex(c.getAttribute("r") ?? "A1");
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? null;
      let value: Cell = null;
      if (type === "s") value = v != null ? shared[Number(v)] ?? "" : "";
      else if (type === "inlineStr") value = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("");
      else if (type === "str" || type === "b" || type === "e") value = v ?? "";
      else if (v != null) value = Number.isFinite(Number(v)) ? Number(v) : v;
      out[idx] = value;
    }
    rows.push(out);
  }
  return rows;
}

const text = (v: Cell | undefined) => (v == null ? "" : String(v).trim());

/** Excel stores dates as days since 1899-12-30 and times as a fraction of a day. */
function excelDate(serial: number): { y: number; m: number; d: number } {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function parseDate(v: Cell | undefined): { y: number; m: number; d: number } | null | "invalid" {
  if (v == null || text(v) === "") return null;
  if (typeof v === "number") return v >= 1 ? excelDate(Math.floor(v)) : "invalid";
  const m = text(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? text(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "invalid";
  // YYYY-MM-DD, or MM/DD/YYYY (Excel's US display format).
  return m[1].length === 4
    ? { y: +m[1], m: +m[2], d: +m[3] }
    : { y: +m[3], m: +m[1], d: +m[2] };
}

function parseTime(v: Cell | undefined): { h: number; min: number } | null | "invalid" {
  if (v == null || text(v) === "") return null;
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 24 * 60);
    return { h: Math.floor(mins / 60) % 24, min: mins % 60 };
  }
  const m = text(v).match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return "invalid";
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h > 23 || +m[2] > 59 ? "invalid" : { h, min: +m[2] };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Date + Time cells → ISO timestamp in this computer's timezone.
 * "" = Flexible (both blank), "invalid" = unreadable or a time without a date.
 */
export function parseSchedule(dateCell: Cell | undefined, timeCell: Cell | undefined): { scheduledAt: string; scheduleText: string } {
  const date = parseDate(dateCell);
  const time = parseTime(timeCell);
  if (date === "invalid" || time === "invalid") {
    return { scheduledAt: "invalid", scheduleText: [text(dateCell), text(timeCell)].filter(Boolean).join(" ") };
  }
  if (date) {
    // Same default as the app: 8:00 AM when no time is picked.
    const t = time ?? { h: 8, min: 0 };
    return {
      scheduledAt: new Date(date.y, date.m - 1, date.d, t.h, t.min).toISOString(),
      scheduleText: `${date.y}-${pad(date.m)}-${pad(date.d)} ${pad(t.h)}:${pad(t.min)}`,
    };
  }
  if (time) return { scheduledAt: "invalid", scheduleText: `${text(timeCell)} (no date)` };
  return { scheduledAt: "", scheduleText: "Flexible" };
}

/**
 * Reads the upload into rows (and each row's Excel row number, to match
 * pictures inserted in the sheet). Throws a readable Error for unusable files.
 */
export async function readBulkGigFile(file: File): Promise<{ rows: BulkGigRow[]; sheetRows: number[] }> {
  const sheet = await readFirstSheet(file, "Gigs");
  const table = parseGigTable(sheet, ["host", "title", "description", "skill", "amount", "address"], 3);

  // An Edit / Delete file lists existing gigs; posting it would duplicate them.
  const existing = table.rows.filter((r) => r.text("gigId"));
  if (existing.length) {
    const nums = existing.slice(0, 5).map((r) => r.n).join(", ");
    throw new Error(`Row${existing.length > 1 ? "s" : ""} ${nums}${existing.length > 5 ? "…" : ""} already ${existing.length > 1 ? "have" : "has"} a Gig ID, so ${existing.length > 1 ? "they are" : "it's an"} existing gig${existing.length > 1 ? "s" : ""}. Use Edit gigs to change them, or clear Gig ID and Version to post copies as new gigs.`);
  }

  const rows: BulkGigRow[] = table.rows.map((r) => {
    const { scheduledAt, scheduleText } = parseSchedule(r.get("date"), r.get("time"));
    return {
      host: r.text("host"),
      title: r.text("title"),
      description: r.text("description"),
      skill: r.text("skill"),
      experience: r.text("experience"),
      payType: r.text("payType"),
      amount: r.text("amount"),
      workers: r.text("workers"),
      hours: r.text("hours"),
      scheduledAt,
      scheduleText,
      address: r.text("address"),
      lat: r.text("lat"),
      lng: r.text("lng"),
      // A picture placed in the cell reads as a placeholder value
      // (#VALUE! in Excel, =DISPIMG("ID_…") in WPS); the picture itself is read separately.
      pictures: PICTURE_COLS.map((k) => r.text(k))
        .filter((t) => t && !/^#[A-Z0-9/!?]+$/i.test(t) && !/DISPIMG\(/i.test(t))
        .join(", "),
    };
  });
  const sheetRows = table.rows.map((r) => r.n);
  if (rows.length === 0) throw new Error("No gigs found under the header row.");
  return { rows, sheetRows };
}
