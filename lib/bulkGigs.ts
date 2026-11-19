// Bulk Open Gig upload: the spreadsheet columns, a template with dropdowns
// (Skill comes from the skills library), a minimal .xlsx reader
// (jszip is already a dependency, so no spreadsheet library is needed) and
// the template download. Rows are checked and created one at a time by
// /api/admin/bulk-gigs, which applies the same checks the app does.

import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { downloadXlsx } from "@/lib/xlsx";

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

// key → header shown in the template. Matching ignores case, spaces and
// anything in brackets, so "Amount (per worker)" and "amount" both work.
export const COLUMNS: { key: keyof Omit<BulkGigRow, "scheduledAt" | "scheduleText"> | "date" | "time"; header: string; example: string | number }[] = [
  { key: "host",        header: "Host (email or user ID)",           example: "host@example.com" },
  { key: "title",       header: "Title",                             example: "House cleaning" },
  { key: "description", header: "Description",                       example: "Clean a 2-bedroom condo, supplies provided." },
  { key: "skill",       header: "Skill",                             example: "Cleaning" },
  { key: "experience",  header: "Experience (entry/intermediate/expert)", example: "entry" },
  { key: "payType",     header: "Pay Type (flat/hourly)",            example: "flat" },
  { key: "amount",      header: "Amount (per worker)",               example: 800 },
  { key: "workers",     header: "Workers Needed",                    example: 1 },
  { key: "hours",       header: "Est. Hours (optional)",             example: 3 },
  { key: "date",        header: "Date (YYYY-MM-DD, blank = Flexible)", example: "" },
  { key: "time",        header: "Time (HH:MM, 24h)",                 example: "" },
  { key: "address",     header: "Address",                           example: "Ayala Avenue, Makati, Metro Manila" },
  { key: "lat",         header: "Latitude (optional)",               example: "" },
  { key: "lng",         header: "Longitude (optional)",              example: "" },
];

const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
const HEADER_KEYS = new Map(COLUMNS.map((c) => [norm(c.header), c.key]));

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

/** Template with dropdowns: Skill (from the library), Experience and Pay Type. */
export async function downloadTemplate(skills: string[]) {
  const col = (key: string) => COLUMNS.findIndex((c) => c.key === key);
  const example = COLUMNS.map((c) => (c.key === "skill" ? skills[0] ?? "" : c.example));
  return downloadXlsx(
    "giggre-bulk-open-gigs-template.xlsx",
    "Open Gigs",
    COLUMNS.map((c) => c.header),
    [example],
    {
      dropdowns: [
        { col: col("skill"), values: skills },
        { col: col("experience"), values: ["entry", "intermediate", "expert"] },
        { col: col("payType"), values: ["flat", "hourly"] },
      ],
    },
  );
}

// ── .xlsx reading ─────────────────────────────────────────────────────────────

export type Cell = string | number | null;

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet of an .xlsx file as rows of cells (numbers stay numbers). */
export async function readFirstSheet(file: File): Promise<Cell[][]> {
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
  const firstRid = workbook.getElementsByTagName("sheet")[0]?.getAttribute("r:id");
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

/** Reads the upload into rows. Throws a readable Error for unusable files. */
export async function readBulkGigFile(file: File): Promise<BulkGigRow[]> {
  const sheet = await readFirstSheet(file);
  const headerAt = sheet.findIndex((r) => r.some((c) => text(c) !== ""));
  if (headerAt < 0) throw new Error("The sheet is empty.");

  const keyAt = new Map<string, number>();
  sheet[headerAt].forEach((h, i) => {
    const key = HEADER_KEYS.get(norm(text(h)));
    if (key && !keyAt.has(key)) keyAt.set(key, i);
  });
  const missing = ["host", "title", "description", "skill", "amount", "address"].filter((k) => !keyAt.has(k));
  if (missing.length) {
    const names = missing.map((k) => COLUMNS.find((c) => c.key === k)!.header);
    throw new Error(`Missing column${names.length > 1 ? "s" : ""}: ${names.join(", ")}. Download the template to see the expected columns.`);
  }

  const get = (r: Cell[], key: string) => (keyAt.has(key) ? r[keyAt.get(key)!] : undefined);
  const rows: BulkGigRow[] = [];
  for (const r of sheet.slice(headerAt + 1)) {
    if (!r.some((c) => text(c) !== "")) continue; // blank line

    const date = parseDate(get(r, "date"));
    const time = parseTime(get(r, "time"));
    let scheduledAt = "";
    let scheduleText = "Flexible";
    if (date === "invalid" || time === "invalid") {
      scheduledAt = "invalid";
      scheduleText = [text(get(r, "date")), text(get(r, "time"))].filter(Boolean).join(" ");
    } else if (date) {
      // Same default as the app: 8:00 AM when no time is picked.
      const t = time ?? { h: 8, min: 0 };
      scheduledAt = new Date(date.y, date.m - 1, date.d, t.h, t.min).toISOString();
      scheduleText = `${date.y}-${pad(date.m)}-${pad(date.d)} ${pad(t.h)}:${pad(t.min)}`;
    } else if (time) {
      scheduledAt = "invalid";
      scheduleText = `${text(get(r, "time"))} (no date)`;
    }

    rows.push({
      host: text(get(r, "host")),
      title: text(get(r, "title")),
      description: text(get(r, "description")),
      skill: text(get(r, "skill")),
      experience: text(get(r, "experience")),
      payType: text(get(r, "payType")),
      amount: text(get(r, "amount")),
      workers: text(get(r, "workers")),
      hours: text(get(r, "hours")),
      scheduledAt,
      scheduleText,
      address: text(get(r, "address")),
      lat: text(get(r, "lat")),
      lng: text(get(r, "lng")),
    });
  }
  if (rows.length === 0) throw new Error("No gigs found under the header row.");
  return rows;
}
