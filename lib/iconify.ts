// Icons from Iconify (https://iconify.design), stored as "set:name", e.g.
// "material-symbols:pets". Admin and app both draw it from the same public SVG
// URL (iconUrl), so nothing is uploaded and both always show the same icon.

export const ICON_SETS = [
  { prefix: "material-symbols", label: "Material Symbols" },
  { prefix: "ph", label: "Phosphor" },
  { prefix: "tabler", label: "Tabler" },
] as const;

export type IconSetPrefix = (typeof ICON_SETS)[number]["prefix"];

// Each set repeats most icons in other styles. Only its main style is offered,
// so every sub-category icon looks alike.
const VARIANT: Record<IconSetPrefix, RegExp> = {
  "material-symbols": /-(outline|rounded|sharp)$/,
  ph: /-(bold|fill|duotone|light|thin)$/,
  tabler: /-filled$/,
};

const ICON_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export const isIconName = (v: unknown): v is string => typeof v === "string" && ICON_RE.test(v);

/** "material-symbols:pets" → https://api.iconify.design/material-symbols/pets.svg */
export function iconUrl(icon: string): string {
  const m = ICON_RE.exec(icon);
  return m ? `https://api.iconify.design/${m[1]}/${m[2]}.svg` : "";
}

export const iconLabel = (icon: string) => icon.split(":")[1]?.replace(/-/g, " ") ?? icon;

const STOP = new Set(["and", "the", "for", "with", "services", "service"]);

async function search(query: string, prefix: IconSetPrefix, signal?: AbortSignal): Promise<string[]> {
  const url = `https://api.iconify.design/search?query=${encodeURIComponent(query)}&prefix=${prefix}&limit=200`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Icon search failed (${res.status})`);
  const data = (await res.json()) as { icons?: unknown };
  return (Array.isArray(data.icons) ? data.icons : []).filter(isIconName).filter((i) => !VARIANT[prefix].test(i));
}

/**
 * Icons in one set matching the text. A multi-word name ("House Cleaning")
 * often matches nothing as a whole, so each word is also searched and the
 * results merged, whole-phrase matches first.
 */
export async function searchIcons(text: string, prefix: IconSetPrefix, signal?: AbortSignal): Promise<string[]> {
  const q = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return [];
  const words = q.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  const queries = [q, ...(words.length > 1 ? words : [])];
  const results = await Promise.all(queries.map((x) => search(x, prefix, signal)));
  return [...new Set(results.flat())];
}
