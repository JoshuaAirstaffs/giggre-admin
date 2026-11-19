// Pictures inside an .xlsx sheet, grouped by the row they're on:
//
//   • Placed in a cell (Excel 365: Insert → Pictures → Place in Cell, or the
//     IMAGE-in-cell feature): the cell has vm="N", resolved through
//     xl/metadata.xml → xl/richData/* → xl/media/…
//   • WPS Spreadsheets "picture in cell": the cell holds a formula
//     =DISPIMG("ID_…",1) and the pictures live in xl/cellimages.xml.
//   • Floating over cells (Insert → Pictures → Place over Cells, paste, drag
//     a photo onto the sheet; Excel and WPS): an anchor in
//     xl/drawings/drawingN.xml; the picture belongs to the row its top-left
//     corner is in.
//
// Built on jszip like the rest of the spreadsheet code; no extra library.

export interface SheetPicture {
  /** Excel row number (1-based). */
  row: number;
  /** Column (0-based), to keep a row's pictures in left-to-right order. */
  col: number;
  file: File;
}

const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
};

/** Resolves a relationship Target relative to the part that owns it. */
function resolve(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const relsPathOf = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

const byLocal = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS("*", name));
const rAttr = (el: Element, name: string) => el.getAttributeNS(NS_R, name) ?? el.getAttribute(`r:${name}`);

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Pictures on the sheet named `preferName` (else the first sheet).
 * `skipped` counts pictures in formats a browser can't show (e.g. EMF).
 */
export async function readSheetPictures(file: File, preferName?: string): Promise<{ pictures: SheetPicture[]; skipped: number }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = async (path: string) => {
    const s = await zip.file(path)?.async("string");
    return s ? new DOMParser().parseFromString(s, "application/xml") : null;
  };
  const relsOf = async (part: string) => {
    const doc = await xml(relsPathOf(part));
    const map = new Map<string, { target: string; type: string }>();
    for (const r of doc ? byLocal(doc, "Relationship") : []) {
      map.set(r.getAttribute("Id") ?? "", { target: resolve(part, r.getAttribute("Target") ?? ""), type: r.getAttribute("Type") ?? "" });
    }
    return map;
  };

  // Which worksheet part.
  const workbook = await xml("xl/workbook.xml");
  if (!workbook) return { pictures: [], skipped: 0 };
  const sheets = byLocal(workbook, "sheet");
  const wanted = (preferName && sheets.find((s) => (s.getAttribute("name") ?? "").trim().toLowerCase() === preferName.toLowerCase())) || sheets[0];
  const wbRels = await relsOf("xl/workbook.xml");
  const sheetPath = wbRels.get(wanted ? rAttr(wanted, "id") ?? "" : "")?.target ?? "xl/worksheets/sheet1.xml";

  const pictures: SheetPicture[] = [];
  let skipped = 0;
  let n = 0;
  const media = async (path: string, row: number, col: number) => {
    const ext = (path.split(".").pop() ?? "").toLowerCase();
    const type = MIME[ext];
    const data = await zip.file(path)?.async("blob");
    if (!data) return;
    if (!type) { skipped++; return; }
    n++;
    pictures.push({ row, col, file: new File([data], `excel-row${row}-${n}.${ext === "jpeg" ? "jpg" : ext}`, { type }) });
  };

  // 1) Floating pictures (drawing anchors).
  const sheetRels = await relsOf(sheetPath);
  for (const rel of sheetRels.values()) {
    if (!rel.type.endsWith("/drawing")) continue;
    const drawing = await xml(rel.target);
    if (!drawing) continue;
    const drawingRels = await relsOf(rel.target);
    for (const anchor of [...byLocal(drawing, "twoCellAnchor"), ...byLocal(drawing, "oneCellAnchor")]) {
      const from = byLocal(anchor, "from")[0];
      const row = Number(from ? byLocal(from, "row")[0]?.textContent : NaN);
      const col = Number(from ? byLocal(from, "col")[0]?.textContent : 0) || 0;
      if (!Number.isFinite(row)) continue;
      for (const blip of byLocal(anchor, "blip")) {
        const target = drawingRels.get(rAttr(blip, "embed") ?? "")?.target;
        if (target) await media(target, row + 1, col);
      }
    }
  }

  // 2) Pictures placed in cells (rich values).
  const sheet = await xml(sheetPath);
  const cells = sheet ? byLocal(sheet, "c").filter((c) => c.getAttribute("vm")) : [];
  if (cells.length) {
    // vm (1-based) → valueMetadata block → futureMetadata block → rich value index.
    const metadata = await xml("xl/metadata.xml");
    const valueBlocks = metadata ? byLocal(byLocal(metadata, "valueMetadata")[0] ?? metadata, "bk") : [];
    const future = metadata ? byLocal(metadata, "futureMetadata").find((f) => f.getAttribute("name") === "XLRICHVALUE") : undefined;
    const futureBlocks = future ? byLocal(future, "bk") : [];
    const richIndex = (vm: number): number => {
      const rc = valueBlocks[vm - 1] ? byLocal(valueBlocks[vm - 1], "rc")[0] : undefined;
      const fb = rc ? futureBlocks[Number(rc.getAttribute("v"))] : undefined;
      const rvb = fb ? byLocal(fb, "rvb")[0] : undefined;
      return rvb ? Number(rvb.getAttribute("i")) : vm - 1;
    };

    // Rich value → image relation index (the _rvRel:LocalImageIdentifier key).
    const values = await xml("xl/richData/rdrichvalue.xml");
    const structures = await xml("xl/richData/rdrichvaluestructure.xml");
    const structs = structures ? byLocal(structures, "s").map((s) => byLocal(s, "k").map((k) => k.getAttribute("n") ?? "")) : [];
    const rvs = values ? byLocal(values, "rv") : [];
    const relIndex = (i: number): number | null => {
      const rv = rvs[i];
      if (!rv) return null;
      const keys = structs[Number(rv.getAttribute("s"))] ?? [];
      const at = Math.max(0, keys.indexOf("_rvRel:LocalImageIdentifier"));
      const v = byLocal(rv, "v")[at]?.textContent;
      return v != null && v !== "" ? Number(v) : null;
    };

    // Relation index → media file.
    const relPart = "xl/richData/richValueRel.xml";
    const relDoc = await xml(relPart);
    const relIds = relDoc ? byLocal(relDoc, "rel").map((r) => rAttr(r, "id") ?? "") : [];
    const relTargets = await relsOf(relPart);

    for (const c of cells) {
      const ref = c.getAttribute("r") ?? "";
      const row = Number(ref.replace(/[A-Z]/g, ""));
      const ri = relIndex(richIndex(Number(c.getAttribute("vm"))));
      const target = ri != null ? relTargets.get(relIds[ri] ?? "")?.target : undefined;
      if (row && target) await media(target, row, colIndex(ref));
    }
  }

  // 3) WPS in-cell pictures: =DISPIMG("ID_…") → xl/cellimages.xml.
  const dispCells = sheet
    ? byLocal(sheet, "c").map((c) => {
        const formula = `${byLocal(c, "f")[0]?.textContent ?? ""} ${byLocal(c, "v")[0]?.textContent ?? ""}`;
        const id = formula.match(/DISPIMG\(\s*"([^"]+)"/i)?.[1];
        return id ? { ref: c.getAttribute("r") ?? "", id } : null;
      }).filter((x): x is { ref: string; id: string } => !!x)
    : [];
  if (dispCells.length) {
    const cellImagesPart =
      [...wbRels.values()].find((r) => /cellimage/i.test(r.type) || /cellimages\.xml$/i.test(r.target))?.target ?? "xl/cellimages.xml";
    const doc = await xml(cellImagesPart);
    const imgRels = await relsOf(cellImagesPart);
    const byId = new Map<string, string>();
    for (const ci of doc ? byLocal(doc, "cellImage") : []) {
      const name = byLocal(ci, "cNvPr")[0]?.getAttribute("name") ?? "";
      const target = imgRels.get(rAttr(byLocal(ci, "blip")[0] ?? ci, "embed") ?? "")?.target;
      if (name && target) byId.set(name, target);
    }
    for (const { ref, id } of dispCells) {
      const target = byId.get(id);
      const row = Number(ref.replace(/[A-Z]/g, ""));
      if (row && target) await media(target, row, colIndex(ref));
    }
  }

  pictures.sort((a, b) => a.row - b.row || a.col - b.col);
  return { pictures, skipped };
}
