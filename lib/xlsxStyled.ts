// Styled .xlsx writer (several sheets, coloured bands, merged cells, hint
// rows, dropdowns). Built on jszip like lib/xlsx.ts; used for the Bulk Open
// Gigs workbooks, which follow a marketplace-template look (instructions
// sheet with a colour legend, data sheet with section bands).

export type Cell = string | number | null | undefined;

/** Named cell styles (see STYLES below). */
export type StyleName =
  | "default" | "title" | "subtitle" | "bold" | "text" | "textWrap"
  | "colHead" | "hint" | "data" | "dataSystem" | "example"
  | `band:${BandColor}` | `chip:${BandColor}`;

export type BandColor = "blue" | "grey" | "green" | "orange" | "red" | "navy" | "purple";

export interface SCell { v: Cell; s?: StyleName }

export interface StyledSheet {
  name: string;
  hidden?: boolean;
  rows: { cells: (SCell | Cell)[]; height?: number }[];
  /** Column widths in characters. */
  widths?: number[];
  /** e.g. "A1:C1" */
  merges?: string[];
  /** Freeze rows above / columns left of this cell (1-based row/col of the first unfrozen cell). */
  freeze?: { row: number; col: number };
  /** Dropdowns: a range on this sheet and the allowed values. */
  dropdowns?: { range: string; values: string[] }[];
  tabColor?: string;
}

const BAND: Record<BandColor, string> = {
  blue: "FF2E7BE0", grey: "FF6B7280", green: "FF2E9E5B", orange: "FFE8833A", red: "FFC0392B", navy: "FF1F3A5F", purple: "FF5B4A8B",
};
/** Light tint of each band colour, for the "chip" cells in the legend. */
const TINT: Record<BandColor, string> = {
  blue: "FFDCEBFB", grey: "FFE5E7EB", green: "FFD9F2E4", orange: "FFFCE6D6", red: "FFF6DAD7", navy: "FFD6DEE8", purple: "FFE4E0EF",
};

// ── Style table ────────────────────────────────────────────────────────────

const FONTS = [
  `<font><sz val="11"/><name val="Calibri"/></font>`,                                  // 0 normal
  `<font><b/><sz val="11"/><name val="Calibri"/></font>`,                              // 1 bold
  `<font><b/><sz val="16"/><color rgb="FF1F2937"/><name val="Calibri"/></font>`,       // 2 title
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,       // 3 white bold
  `<font><i/><sz val="9"/><color rgb="FF7F7F7F"/><name val="Calibri"/></font>`,        // 4 hint
  `<font><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/></font>`,           // 5 grey
  `<font><sz val="11"/><color rgb="FF4B5563"/><name val="Calibri"/></font>`,           // 6 subtitle
];

const fill = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const COLORS = Object.keys(BAND) as BandColor[];
const FILLS = [
  `<fill><patternFill patternType="none"/></fill>`,
  `<fill><patternFill patternType="gray125"/></fill>`,
  fill("FFF2F2F2"), // 2 column head
  fill("FFFAFAFA"), // 3 hint
  fill("FFF3F4F6"), // 4 system data
  fill("FFFFF8E1"), // 5 example
  ...COLORS.map((c) => fill(BAND[c])),  // 6.. band
  ...COLORS.map((c) => fill(TINT[c])),  // 6+n.. chip
];
const bandFill = (c: BandColor) => 6 + COLORS.indexOf(c);
const chipFill = (c: BandColor) => 6 + COLORS.length + COLORS.indexOf(c);

const BORDERS = [
  `<border><left/><right/><top/><bottom/><diagonal/></border>`,
  `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>`,
];

interface Xf { font: number; fill: number; border: number; h?: "left" | "center"; v?: "top" | "center"; wrap?: boolean }
const XF: Record<string, Xf> = {
  default:    { font: 0, fill: 0, border: 0 },
  title:      { font: 2, fill: 0, border: 0, v: "center" },
  subtitle:   { font: 6, fill: 0, border: 0, v: "top", wrap: true },
  bold:       { font: 1, fill: 0, border: 0, v: "center" },
  text:       { font: 0, fill: 0, border: 1, v: "center" },
  textWrap:   { font: 0, fill: 0, border: 1, v: "top", wrap: true },
  colHead:    { font: 1, fill: 2, border: 1, h: "center", v: "center", wrap: true },
  hint:       { font: 4, fill: 3, border: 1, v: "top", wrap: true },
  data:       { font: 0, fill: 0, border: 1, v: "top" },
  dataSystem: { font: 5, fill: 4, border: 1, v: "top" },
  example:    { font: 0, fill: 5, border: 1, v: "top", wrap: true },
};
for (const c of COLORS) {
  XF[`band:${c}`] = { font: 3, fill: bandFill(c), border: 1, h: "left", v: "center" };
  XF[`chip:${c}`] = { font: 1, fill: chipFill(c), border: 1, h: "left", v: "center", wrap: true };
}
const STYLE_NAMES = Object.keys(XF);
const styleIndex = (s: StyleName | undefined) => Math.max(0, STYLE_NAMES.indexOf(s ?? "default"));

function stylesXml(): string {
  const xfs = STYLE_NAMES.map((k) => {
    const x = XF[k];
    const align = x.h || x.v || x.wrap
      ? `<alignment${x.h ? ` horizontal="${x.h}"` : ""}${x.v ? ` vertical="${x.v}"` : ""}${x.wrap ? ` wrapText="1"` : ""}/>`
      : "";
    return `<xf numFmtId="0" fontId="${x.font}" fillId="${x.fill}" borderId="${x.border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="${FONTS.length}">${FONTS.join("")}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.join("")}</fills>` +
    `<borders count="${BORDERS.length}">${BORDERS.join("")}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    `</styleSheet>`;
}

// ── Cells ──────────────────────────────────────────────────────────────────

const esc = (v: string) =>
  v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function colName(i: number): string {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function cellXml(c: SCell | Cell, ref: string): string {
  const cell: SCell = c !== null && typeof c === "object" ? c : { v: c };
  const st = styleIndex(cell.s);
  const s = st ? ` s="${st}"` : "";
  const v = cell.v;
  if (v == null || v === "") return st ? `<c r="${ref}"${s}/>` : "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

const safeName = (n: string) => n.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet";

function sheetXml(sh: StyledSheet, listRefs: string[]): string {
  const f = sh.freeze;
  const pane = f && (f.row > 1 || f.col > 1)
    ? `<pane${f.col > 1 ? ` xSplit="${f.col - 1}"` : ""}${f.row > 1 ? ` ySplit="${f.row - 1}"` : ""} topLeftCell="${colName(f.col - 1)}${f.row}" activePane="${f.row > 1 && f.col > 1 ? "bottomRight" : f.row > 1 ? "bottomLeft" : "topRight"}" state="frozen"/>`
    : "";
  const rows = sh.rows.map((r, i) =>
    `<row r="${i + 1}"${r.height ? ` ht="${r.height}" customHeight="1"` : ""}>${r.cells.map((c, j) => cellXml(c, `${colName(j)}${i + 1}`)).join("")}</row>`,
  ).join("");
  const cols = sh.widths?.length
    ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  const dv = sh.dropdowns?.length
    ? `<dataValidations count="${sh.dropdowns.length}">` +
      sh.dropdowns.map((d, i) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not in the list" error="Pick a value from the dropdown." sqref="${d.range}"><formula1>${listRefs[i]}</formula1></dataValidation>`,
      ).join("") + `</dataValidations>`
    : "";
  const tab = sh.tabColor ? `<sheetPr><tabColor rgb="${sh.tabColor}"/></sheetPr>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${tab}` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `${cols}<sheetData>${rows}</sheetData>${merges}${dv}</worksheet>`;
}

/** Builds the workbook and starts a browser download. Dropdown values live on a hidden "Lists" sheet. */
export async function downloadWorkbook(filename: string, sheets: StyledSheet[]) {
  const { default: JSZip } = await import("jszip");

  // All dropdown lists go on one hidden sheet, one column each.
  const lists: string[][] = [];
  const refsPerSheet = sheets.map((sh) => (sh.dropdowns ?? []).map((d) => {
    const i = lists.push(d.values.length ? d.values : [""]) - 1;
    return `Lists!$${colName(i)}$1:$${colName(i)}$${Math.max(1, d.values.length)}`;
  }));
  const all: StyledSheet[] = [...sheets];
  if (lists.length) {
    const height = Math.max(...lists.map((l) => l.length));
    all.push({
      name: "Lists",
      hidden: true,
      rows: Array.from({ length: height }, (_, r) => ({ cells: lists.map((l) => l[r] ?? null) })),
    });
  }

  const zip = new JSZip();
  const add = (name: string, xml: string) => zip.file(name, xml, { createFolders: false });
  add("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    all.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`);
  add("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`);
  const firstVisible = Math.max(0, all.findIndex((s) => !s.hidden));
  add("xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView activeTab="${firstVisible}"/></bookViews>` +
    `<sheets>${all.map((s, i) => `<sheet name="${esc(safeName(s.name))}" sheetId="${i + 1}"${s.hidden ? ` state="hidden"` : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `</workbook>`);
  add("xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    all.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${all.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`);
  add("xl/styles.xml", stylesXml());
  all.forEach((sh, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, refsPerSheet[i] ?? [])));

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
