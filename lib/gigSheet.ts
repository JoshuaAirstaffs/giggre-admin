// One workbook format for Bulk Open Gigs: Post, Edit and Delete all use the
// same columns (Delete adds an Action column). Laid out like a marketplace
// item template:
//
//   Instructions sheet  title, colour legend of the sections, steps, and a
//                       field guide (one row per column: rules + example)
//   Gigs sheet          row 1  coloured section bands
//                       row 2  column names
//                       row 3  format hints (grey, italic)
//                       row 4+ one gig per row
//
// The reader finds the column-name row, skips the hint row, and still
// accepts files downloaded in the older single-sheet layouts.

import { colName, downloadWorkbook, type BandColor, type SCell, type StyledSheet } from "@/lib/xlsxStyled";

export type SheetKind = "post" | "edit" | "delete";
type Cell = string | number | null;

export type GigCol =
  | "gigId" | "version" | "host" | "title" | "description" | "skill" | "experience" | "payType" | "amount" | "workers"
  | "date" | "time" | "hours" | "address" | "lat" | "lng" | "pictures" | "pic2" | "pic3" | "pic4" | "pic5" | "action";

/** The five photo columns, Picture 1 … Picture 5 (one photo per cell). */
export const PICTURE_COLS: GigCol[] = ["pictures", "pic2", "pic3", "pic4", "pic5"];

/** A gig's current values, for edit / delete downloads. */
export interface SheetGig {
  id: string;
  hostId: string;
  hostEmail: string;
  hostName: string;
  title: string;
  description: string;
  skill: string;
  experience: string;
  payType: "flat" | "hourly";
  amount: number;
  currencyCode: string;
  hours: number | null;
  workers: number;
  /** ms, or null for Flexible. */
  scheduledAt: number | null;
  address: string;
  lat: number | null;
  lng: number | null;
  version: string;
  /** Current photo URLs (gig `images`), shown as "Current photo N" links. */
  images?: string[];
}

/** Text of a cell that keeps the gig's existing photo N (Edit files). */
export const currentPhotoLabel = (n: number) => `Current photo ${n}`;
export const CURRENT_PHOTO_RE = /^current photo\s*(\d)$/i;
/** Name / alt text of an existing photo embedded in an Edit sheet. */
export const currentPhotoPicName = (n: number) => `giggre-current-photo-${n}`;
export const CURRENT_PHOTO_PIC_RE = /giggre-current-photo-(\d)/i;

/** A gig photo shrunk for the sheet. */
export interface SheetPhoto { data: Uint8Array; width: number; height: number }

/** Shown size of a photo inside a Picture cell (px) and the row height that fits it (pt). */
const PHOTO_BOX = 72;
const PHOTO_ROW_PT = 62;

type Need = "Required" | "Optional" | "Don't change" | "Can't change" | "Not used";

interface Section {
  key: string;
  label: string;
  color: BandColor;
  cols: GigCol[];
  need: string;
  desc: string;
  onlyFor?: SheetKind;
}

const SECTIONS: Section[] = [
  {
    key: "identity", label: "Gig identity (filled by Giggre)", color: "grey", cols: ["gigId", "version"], need: "Don't change",
    desc: "Filled in when you download gigs to edit or delete. Leave blank for new gigs. Used to find the gig and to notice if it changed after your download.",
  },
  {
    key: "required", label: "Required to post", color: "blue",
    cols: ["host", "title", "description", "skill", "experience", "payType", "amount", "workers"], need: "Required",
    desc: "Fill in all of these. A missing or invalid value is reported for that row, and that gig isn't posted.",
  },
  {
    key: "schedule", label: "Schedule", color: "navy", cols: ["date", "time", "hours"], need: "Optional",
    desc: "Leave Date blank for a Flexible gig. Times are read in your computer's time zone.",
  },
  {
    key: "location", label: "Location", color: "green", cols: ["address", "lat", "lng"], need: "Required",
    desc: "Address is required and is looked up on the map. Latitude and Longitude (both) pin the exact spot instead.",
  },
  {
    key: "photos", label: "Photos", color: "orange", cols: PICTURE_COLS, need: "Optional",
    desc: "Up to 5 photos per gig, one per cell in Picture 1 … Picture 5 (Insert → Picture/Image → in cell). Or type file names there and add the files on the page.",
  },
  {
    key: "action", label: "Delete", color: "red", cols: ["action"], need: "Delete file only", onlyFor: "delete",
    desc: "Choose delete for each gig to remove. Leave it blank to keep the gig.",
  },
];

interface ColSpec {
  header: string;
  /** Other header spellings accepted when reading (normalised). */
  aliases?: string[];
  width: number;
  hint: string;
  rules: string;
  example: string | number;
}

const COL: Record<GigCol, ColSpec> = {
  gigId:       { header: "Gig ID", width: 22, hint: "Filled by Giggre. Blank for new gigs.", rules: "Filled in by Giggre for existing gigs. Leave blank to post a new gig. Never change it.", example: "" },
  version:     { header: "Version", width: 15, hint: "Filled by Giggre. Don't change.", rules: "When the gig was last changed. Lets Giggre spot a gig that changed after your download.", example: "" },
  host:        { header: "Host", aliases: ["hostemail", "hostemailoruserid"], width: 28, hint: "Host's exact email or user ID.", rules: "The account that posts the gig: their exact email or user ID.", example: "host@example.com" },
  title:       { header: "Title", width: 30, hint: "Short title workers see.", rules: "Required. Checked against the word filter.", example: "House cleaning" },
  description: { header: "Description", width: 44, hint: "What the worker will do.", rules: "Required. Checked against the word filter.", example: "Clean a 2-bedroom condo, supplies provided." },
  skill:       { header: "Skill", width: 22, hint: "Pick from the list.", rules: "Required. Must be a skill from the skills library (use the dropdown). Can't be changed once posted.", example: "Cleaning" },
  experience:  { header: "Experience", width: 14, hint: "entry, intermediate or expert.", rules: "entry, intermediate or expert (dropdown). Blank = entry.", example: "entry" },
  payType:     { header: "Pay Type", width: 11, hint: "flat or hourly.", rules: "flat (one amount per worker) or hourly (dropdown). Blank = flat.", example: "flat" },
  amount:      { header: "Amount", aliases: ["amountperworker"], width: 11, hint: "Number, per worker (hourly rate if hourly).", rules: "Required. Per worker; the hourly rate for hourly gigs. Currency follows the gig's country.", example: 800 },
  workers:     { header: "Workers Needed", width: 11, hint: "Whole number 1–50. Blank = 1.", rules: "1 to 50. Blank = 1. Can't be changed once posted.", example: 1 },
  date:        { header: "Date", width: 13, hint: "YYYY-MM-DD. Blank = Flexible.", rules: "A future date like 2026-12-20, or blank for a Flexible gig.", example: "2026-12-20" },
  time:        { header: "Time", width: 9, hint: "HH:MM, 24-hour.", rules: "Like 14:30. Blank = 08:00. Needs a Date.", example: "09:00" },
  hours:       { header: "Est. Hours", width: 10, hint: "Optional, e.g. 3", rules: "Optional estimate of how long the gig takes.", example: 3 },
  address:     { header: "Address", width: 38, hint: "Street, city. Looked up on the map.", rules: "Required (unless Latitude/Longitude are given). Must be in the host's country.", example: "Ayala Avenue, Makati, Metro Manila" },
  lat:         { header: "Latitude", width: 12, hint: "Optional. Both or neither.", rules: "Optional. With Longitude, pins the exact spot.", example: "" },
  lng:         { header: "Longitude", width: 12, hint: "Optional. Both or neither.", rules: "Optional. With Latitude, pins the exact spot.", example: "" },
  pictures:    { header: "Picture 1", aliases: ["pictures"], width: 16, hint: "Photo in this cell, or a file name.", rules: "Main photo (JPG, PNG, GIF or WebP). Put the picture in the cell: Excel Insert → Pictures → Place in Cell; WPS Insert → Picture → Embed in Cell; Google Sheets Insert → Image → Insert image in cell. Or type its file name (clean1.jpg) and add the file on the page.", example: "clean1.jpg" },
  pic2:        { header: "Picture 2", width: 16, hint: "Optional 2nd photo.", rules: "Optional extra photo, same as Picture 1.", example: "clean2.jpg" },
  pic3:        { header: "Picture 3", width: 16, hint: "Optional 3rd photo.", rules: "Optional extra photo, same as Picture 1.", example: "" },
  pic4:        { header: "Picture 4", width: 16, hint: "Optional 4th photo.", rules: "Optional extra photo, same as Picture 1.", example: "" },
  pic5:        { header: "Picture 5", width: 16, hint: "Optional 5th photo.", rules: "Optional extra photo, same as Picture 1.", example: "" },
  action:      { header: "Action", width: 12, hint: "delete, or blank to keep.", rules: "delete removes the gig; blank keeps it.", example: "delete" },
};

// Digits are kept so "Picture 1" … "Picture 5" stay apart.
const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
const text = (v: Cell | undefined) => (v == null ? "" : String(v).trim());
const pad = (n: number) => String(n).padStart(2, "0");

/** Normalised header → column. */
const HEADER_KEYS = new Map<string, GigCol>();
for (const [key, c] of Object.entries(COL) as [GigCol, ColSpec][]) {
  HEADER_KEYS.set(norm(c.header), key);
  for (const a of c.aliases ?? []) HEADER_KEYS.set(a, key);
}

const sectionsFor = (kind: SheetKind) => SECTIONS.filter((s) => !s.onlyFor || s.onlyFor === kind);
export const columnsFor = (kind: SheetKind): GigCol[] => sectionsFor(kind).flatMap((s) => s.cols);

/** How a column is used in each kind of file. */
function needFor(kind: SheetKind, key: GigCol, section: Section): Need | string {
  if (section.key === "identity") return kind === "post" ? "Leave blank" : "Don't change";
  if (kind === "delete") return key === "action" ? "Required" : key === "host" ? "Don't change" : "Reference only";
  if (kind === "edit") {
    if (key === "skill" || key === "workers") return "Can't change";
    if (PICTURE_COLS.includes(key)) return "Optional";
  }
  if (section.key === "location") return key === "address" ? "Required" : "Optional";
  return section.need;
}

// ── Download ─────────────────────────────────────────────────────────────────

const TITLES: Record<SheetKind, string> = { post: "Post new gigs", edit: "Edit gigs", delete: "Delete gigs" };
const TAB: Record<SheetKind, string> = { post: "Post gigs", edit: "Edit gigs", delete: "Delete gigs" };

const STEPS: Record<SheetKind, string[]> = {
  post: [
    "On the Gigs sheet, fill in one gig per row, starting under the grey hint row. Leave Gig ID and Version blank.",
    "For photos, put one picture per cell in Picture 1 … Picture 5 on the gig's row (Excel: Insert → Pictures → Place in Cell; WPS: Insert → Picture → Embed in Cell; Google Sheets: Insert → Image → Insert image in cell). You can also type file names instead.",
    "Save the file as .xlsx and upload it on Bulk Open Gigs → Post gigs, together with the photo files. Every row is checked before anything is posted.",
    "Rows with errors aren't posted. Fix them here and upload again, after removing the rows that were already posted.",
  ],
  edit: [
    "On the Gigs sheet, change only the cells you want. Don't change Gig ID, Host or Version.",
    "Skill and Workers Needed can't be changed.",
    "Photos: Picture 1 … Picture 5 show the gig's current photos. Leave a photo to keep it. To remove one, click it and press Delete. To replace one, delete it and put a new picture in that cell. Empty Picture cells can take new photos (up to 5).",
    "Upload the file on Bulk Open Gigs → Edit gigs. You'll see every change (old → new) before anything is saved.",
    "A gig someone applied to, or that changed after you downloaded this file, isn't changed. Download a fresh copy for those.",
  ],
  delete: [
    "On the Gigs sheet, choose delete in the Action column for each gig to remove. Leave it blank to keep the gig.",
    "Don't change Gig ID or Host. The other columns are only there so you can see which gig is which.",
    "Upload the file on Bulk Open Gigs → Delete gigs, check the counts, then confirm.",
    "Gigs that someone has applied to are never deleted.",
  ],
};

function gigValues(g: SheetGig): Partial<Record<GigCol, Cell>> {
  const d = g.scheduledAt ? new Date(g.scheduledAt) : null;
  return {
    gigId: g.id, version: g.version, host: g.hostEmail || g.hostId, title: g.title, description: g.description,
    skill: g.skill, experience: g.experience, payType: g.payType, amount: g.amount, workers: g.workers,
    date: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "",
    time: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "",
    hours: g.hours ?? "", address: g.address, lat: g.lat ?? "", lng: g.lng ?? "", pictures: "", pic2: "", pic3: "", pic4: "", pic5: "", action: "",
  };
}

function instructionsSheet(kind: SheetKind): StyledSheet {
  const rows: StyledSheet["rows"] = [];
  const merges: string[] = [];
  const push = (cells: (SCell | Cell)[], height?: number) => rows.push({ cells, height });
  const mergeRow = (from: number, to: number) => merges.push(`${colName(from)}${rows.length}:${colName(to)}${rows.length}`);

  push([{ v: `Giggre · Bulk Open Gigs · ${TITLES[kind]}`, s: "title" }], 30);
  push([{ v: `This file has an Instructions sheet (this one) and a Gigs sheet with one gig per row. Upload it on the Bulk Open Gigs page, ${TAB[kind]} tab. Post, Edit and Delete files all use the same columns${kind === "delete" ? "; this Delete file adds an Action column" : ""}.`, s: "subtitle" }], 34);
  mergeRow(0, 3);
  push([]);

  push([{ v: "Colour legend", s: "bold" }], 20);
  for (const sec of sectionsFor(kind)) {
    const need = sec.key === "identity" ? (kind === "post" ? "Leave blank" : "Don't change") : kind === "delete" && sec.key !== "action" ? "Reference only" : sec.need;
    push([{ v: sec.label, s: `band:${sec.color}` }, { v: need, s: "text" }, { v: sec.desc, s: "textWrap" }, { v: null, s: "textWrap" }], 32);
    mergeRow(2, 3);
  }
  push([]);

  push([{ v: "How to use this file", s: "bold" }], 20);
  STEPS[kind].forEach((step, i) => {
    push([{ v: `${i + 1}. ${step}`, s: "textWrap" }, { v: null, s: "textWrap" }, { v: null, s: "textWrap" }, { v: null, s: "textWrap" }], 30);
    mergeRow(0, 3);
  });
  push([]);

  push([{ v: "Field guide", s: "bold" }], 20);
  push([{ v: "Column", s: "colHead" }, { v: "In this file", s: "colHead" }, { v: "Format and rules", s: "colHead" }, { v: "Example", s: "colHead" }], 22);
  for (const sec of sectionsFor(kind)) {
    for (const key of sec.cols) {
      const c = COL[key];
      push([
        { v: c.header, s: `chip:${sec.color}` },
        { v: needFor(kind, key, sec), s: "text" },
        { v: c.rules, s: "textWrap" },
        { v: c.example, s: "example" },
      ], 30);
    }
  }

  return { name: "Instructions", rows, merges, widths: [30, 16, 70, 34], tabColor: "FF2E7BE0" };
}

function gigsSheet(kind: SheetKind, gigs: SheetGig[], skills: string[] | undefined, photos?: Map<string, (SheetPhoto | null)[]>): StyledSheet {
  const cols = columnsFor(kind);
  const idx = (k: GigCol) => cols.indexOf(k);
  const merges: string[] = [];

  // Row 1: section bands.
  const bands: SCell[] = cols.map(() => ({ v: null, s: "band:grey" }));
  for (const sec of sectionsFor(kind)) {
    const first = idx(sec.cols[0]), last = idx(sec.cols[sec.cols.length - 1]);
    for (let i = first; i <= last; i++) bands[i] = { v: i === first ? sec.label : null, s: `band:${sec.color}` };
    if (last > first) merges.push(`${colName(first)}1:${colName(last)}1`);
  }
  const heads: SCell[] = cols.map((k) => ({ v: COL[k].header, s: "colHead" }));
  const hints: SCell[] = cols.map((k) => ({ v: COL[k].hint, s: "hint" }));
  const system = new Set<GigCol>(["gigId", "version"]);
  const images: NonNullable<StyledSheet["images"]> = [];
  const data = gigs.map((g, gi) => {
    const v = gigValues(g);
    const sheetRow = gi + 4;
    let hasPhoto = false;
    const cells = cols.map((k) => {
      const p = PICTURE_COLS.indexOf(k);
      const url = p >= 0 ? g.images?.[p] : undefined;
      if (url) {
        // The photo itself sits in the cell; its name tells the upload to keep it.
        const thumb = photos?.get(g.id)?.[p];
        if (thumb) {
          const scale = Math.min(1, PHOTO_BOX / Math.max(thumb.width, thumb.height));
          images.push({
            row: sheetRow, col: cols.indexOf(k), data: thumb.data, ext: "jpeg",
            width: Math.round(thumb.width * scale), height: Math.round(thumb.height * scale),
            name: currentPhotoPicName(p + 1),
          });
          hasPhoto = true;
          return { v: null, s: "data" } as SCell;
        }
        // Couldn't load it: a link instead, which also means "keep".
        if (!url.includes('"')) return { v: currentPhotoLabel(p + 1), f: `HYPERLINK("${url}","${currentPhotoLabel(p + 1)}")`, s: "link" } as SCell;
      }
      return { v: v[k] ?? null, s: system.has(k) ? "dataSystem" : "data" } as SCell;
    });
    return { cells, height: hasPhoto ? PHOTO_ROW_PT : undefined };
  });

  const range = (k: GigCol) => `${colName(idx(k))}4:${colName(idx(k))}2000`;
  const dropdowns: NonNullable<StyledSheet["dropdowns"]> = [
    { range: range("experience"), values: ["entry", "intermediate", "expert"] },
    { range: range("payType"), values: ["flat", "hourly"] },
  ];
  if (skills?.length && kind === "post") dropdowns.push({ range: range("skill"), values: skills });
  if (kind === "delete") dropdowns.push({ range: range("action"), values: ["delete"] });

  return {
    name: "Gigs",
    rows: [{ cells: bands, height: 22 }, { cells: heads, height: 30 }, { cells: hints, height: 44 }, ...data],
    merges,
    widths: cols.map((k) => COL[k].width),
    freeze: { row: 4, col: idx("title") + 2 },
    dropdowns,
    tabColor: kind === "delete" ? "FFC0392B" : "FF2E9E5B",
    images,
  };
}

/** Downloads the Post template (no gigs) or an Edit / Delete file of `gigs`. */
export function downloadGigSheet(kind: SheetKind, gigs: SheetGig[] = [], opts: { skills?: string[]; photos?: Map<string, (SheetPhoto | null)[]> } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const name = kind === "post" ? "giggre-bulk-post-gigs-template.xlsx" : `giggre-${kind}-gigs-${day}.xlsx`;
  return downloadWorkbook(name, [instructionsSheet(kind), gigsSheet(kind, gigs, opts.skills, opts.photos)]);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export interface SheetRow {
  /** Excel row number, for messages. */
  n: number;
  get: (key: GigCol) => Cell | undefined;
  text: (key: GigCol) => string;
}

/**
 * Finds the column-name row (the first with at least `minCols` known columns),
 * skips the grey hint row and blank rows, and returns the gig rows.
 * Throws a readable Error when `required` columns are missing.
 */
export function parseGigTable(sheet: Cell[][], required: GigCol[], minCols = 2): { rows: SheetRow[]; has: (k: GigCol) => boolean; colOf: (k: GigCol) => number | undefined } {
  let headerAt = -1;
  const keyAt = new Map<GigCol, number>();
  for (let r = 0; r < Math.min(sheet.length, 30) && headerAt < 0; r++) {
    const found = new Map<GigCol, number>();
    (sheet[r] ?? []).forEach((h, i) => {
      const key = HEADER_KEYS.get(norm(text(h)));
      if (key && !found.has(key)) found.set(key, i);
    });
    if (found.size >= minCols) { headerAt = r; found.forEach((v, k) => keyAt.set(k, v)); }
  }
  if (headerAt < 0) throw new Error("Couldn't find the column names. Use a file downloaded from this page.");
  const missing = required.filter((k) => !keyAt.has(k));
  if (missing.length) {
    throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((k) => COL[k].header).join(", ")}. Use a file downloaded from this page.`);
  }

  const isHint = (r: Cell[]) => [...keyAt].some(([k, i]) => text(r[i]) !== "" && text(r[i]) === COL[k].hint);
  const rows: SheetRow[] = [];
  sheet.slice(headerAt + 1).forEach((r, i) => {
    if (!r.some((c) => text(c) !== "") || isHint(r)) return;
    const get = (k: GigCol) => (keyAt.has(k) ? r[keyAt.get(k)!] : undefined);
    rows.push({ n: headerAt + i + 2, get, text: (k) => text(get(k)) });
  });
  return { rows, has: (k) => keyAt.has(k), colOf: (k) => keyAt.get(k) };
}
