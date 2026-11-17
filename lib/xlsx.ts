// Minimal .xlsx writer (one sheet, text/number cells, bold frozen header).
// Built on jszip, which is already a dependency, so no spreadsheet library
// is needed. Cells are written as inline strings / numbers.

type Cell = string | number | null | undefined;

const esc = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // chars invalid in XML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i: number): string {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function cellXml(v: Cell, ref: string, style: number): string {
  const s = style ? ` s="${style}"` : "";
  if (v == null || v === "") return `<c r="${ref}"${s}/>`;
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

/** A dropdown on one column (0-based) of the data sheet, rows 2…1000. */
export interface XlsxDropdown {
  col: number;
  values: string[];
}

/**
 * Builds an .xlsx file and starts a browser download. With `dropdowns`, the
 * listed columns only accept a value from their list; the lists live on a
 * hidden "Lists" sheet (a list typed into the rule itself is capped at 255
 * characters, too short for e.g. the skills library).
 */
export async function downloadXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: Cell[][],
  opts: { dropdowns?: XlsxDropdown[] } = {},
) {
  const { default: JSZip } = await import("jszip");

  const widths = headers.map((h, c) =>
    Math.min(60, Math.max(h.length, ...rows.map((r) => String(r[c] ?? "").length)) + 2),
  );
  const allRows = [headers, ...rows];
  const sheetData = allRows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cellXml(v, `${colName(c)}${i + 1}`, i === 0 ? 1 : 0)).join("")}</row>`)
    .join("");

  const dropdowns = (opts.dropdowns ?? []).filter((d) => d.values.length > 0);
  const validations = dropdowns.length
    ? `<dataValidations count="${dropdowns.length}">` +
      dropdowns
        .map((d, i) => {
          const col = colName(d.col);
          const src = `Lists!$${colName(i)}$1:$${colName(i)}$${d.values.length}`;
          return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Not in the list" error="Pick a value from the dropdown." sqref="${col}2:${col}1000"><formula1>${src}</formula1></dataValidation>`;
        })
        .join("") +
      `</dataValidations>`
    : "";
  const listRows = Math.max(0, ...dropdowns.map((d) => d.values.length));
  const listSheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    Array.from({ length: listRows }, (_, r) =>
      `<row r="${r + 1}">${dropdowns.map((d, i) => (r < d.values.length ? cellXml(d.values[r], `${colName(i)}${r + 1}`, 0) : "")).join("")}</row>`,
    ).join("") +
    `</sheetData></worksheet>`;

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${sheetData}</sheetData>${validations}</worksheet>`;

  const zip = new JSZip();
  const add = (name: string, xml: string) => zip.file(name, xml, { createFolders: false });
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      (dropdowns.length ? `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` : "") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${esc(sheetName.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet1")}" sheetId="1" r:id="rId1"/>` +
      (dropdowns.length ? `<sheet name="Lists" sheetId="2" state="hidden" r:id="rId3"/>` : "") +
      `</sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      (dropdowns.length ? `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` : "") +
      `</Relationships>`,
  );
  add(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`,
  );
  add("xl/worksheets/sheet1.xml", sheet);
  if (dropdowns.length) add("xl/worksheets/sheet2.xml", listSheet);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
