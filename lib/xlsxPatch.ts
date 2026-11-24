// Writes a few cells into an existing .xlsx, keeping everything else as the
// admin left it: their notes and extra columns, comments, colours, pictures,
// other sheets. Only the touched cells' contents change (their formatting is
// kept). Used for the "updated file" after a Bulk Open Gigs upload, which
// fills in the new gigs' Gig ID and Version.

export interface CellEdit {
  /** Excel row number (1-based). */
  row: number;
  /** Column (0-based). */
  col: number;
  value: string;
}

function colName(i: number): string {
  let s = "";
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const byLocal = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS("*", name));

/** Path of the worksheet named `sheetName` (else the first one) inside the zip. */
type Zip = Awaited<ReturnType<typeof import("jszip")["loadAsync"]>>;

async function sheetPath(zip: Zip, sheetName: string): Promise<string> {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  const workbook = parse((await zip.file("xl/workbook.xml")?.async("string")) ?? "");
  const rels = parse((await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "");
  const sheets = byLocal(workbook, "sheet");
  const wanted = sheets.find((el) => (el.getAttribute("name") ?? "").trim().toLowerCase() === sheetName.toLowerCase()) ?? sheets[0];
  const rid = wanted?.getAttribute("r:id") ?? wanted?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  let target = "worksheets/sheet1.xml";
  for (const r of byLocal(rels, "Relationship")) if (r.getAttribute("Id") === rid) target = r.getAttribute("Target") ?? target;
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

/** The file with `edits` written into the sheet `sheetName`. */
export async function patchCells(file: Blob, sheetName: string, edits: CellEdit[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const path = await sheetPath(zip, sheetName);
  const xml = await zip.file(path)?.async("string");
  if (!xml) throw new Error("Couldn't find the Gigs sheet in the file.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (byLocal(doc, "parsererror").length) throw new Error("Couldn't read the Gigs sheet in the file.");
  const sheetData = byLocal(doc, "sheetData")[0];
  if (!sheetData) throw new Error("Couldn't read the Gigs sheet in the file.");
  const ns = sheetData.namespaceURI;
  const qn = (local: string) => (sheetData.prefix ? `${sheetData.prefix}:${local}` : local);
  const make = (local: string) => doc.createElementNS(ns, qn(local));

  const rowEls = new Map<number, Element>();
  for (const r of byLocal(sheetData, "row")) rowEls.set(Number(r.getAttribute("r")), r);

  const rowFor = (n: number): Element => {
    const hit = rowEls.get(n);
    if (hit) return hit;
    const el = make("row");
    el.setAttribute("r", String(n));
    // Rows stay in order.
    const after = [...rowEls.entries()].filter(([k]) => k > n).sort((a, b) => a[0] - b[0])[0]?.[1];
    sheetData.insertBefore(el, after ?? null);
    rowEls.set(n, el);
    return el;
  };

  for (const e of edits) {
    const row = rowFor(e.row);
    const ref = `${colName(e.col)}${e.row}`;
    const cells = Array.from(row.children).filter((c) => c.localName === "c");
    let cell = cells.find((c) => c.getAttribute("r") === ref);
    if (!cell) {
      cell = make("c");
      cell.setAttribute("r", ref);
      // Cells stay in column order.
      const after = cells.find((c) => colIndex(c.getAttribute("r") ?? "A1") > e.col);
      row.insertBefore(cell, after ?? null);
    }
    // Replace the contents, keep the style (s).
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    for (const a of ["t", "cm", "vm", "ph"]) cell.removeAttribute(a);
    if (e.value === "") continue;
    cell.setAttribute("t", "inlineStr");
    const is = make("is");
    const t = make("t");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    t.textContent = e.value;
    is.appendChild(t);
    cell.appendChild(is);
  }

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith("<?xml")) out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`;
  zip.file(path, out);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** "gigs.xlsx" → "gigs (updated).xlsx" (no "(updated) (updated)"). */
export function updatedName(name: string): string {
  const base = name.replace(/\.xlsx$/i, "").replace(/\s*\(updated\)$/i, "");
  return `${base} (updated).xlsx`;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
