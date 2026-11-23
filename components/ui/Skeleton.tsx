import type { CSSProperties } from "react";

// Skeleton loading: grey placeholder shapes in the layout of what's coming,
// with a shimmer (globals.css .sk). Use instead of a spinner or "Loading…"
// text for pages, tables and panels; keep spinners for button actions.

export function Skeleton({ width, height = 12, radius = 6, inline, style }: {
  width?: number | string; height?: number | string; radius?: number; inline?: boolean; style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={inline ? "sk sk-inline" : "sk"}
      style={{ width: width ?? "100%", height, borderRadius: radius, ...style }}
    />
  );
}

/** Rows with an avatar and two lines — tables, lists, panels. */
export function SkeletonRows({ count = 4, avatar = true, style }: { count?: number; avatar?: boolean; style?: CSSProperties }) {
  const widths = ["42%", "55%", "36%", "48%", "60%", "40%"];
  return (
    <div role="status" aria-label="Loading" className="sk-rows" style={style}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-row">
          {avatar && <Skeleton width={34} height={34} radius={17} />}
          <div className="sk-row-text">
            <Skeleton width={widths[i % widths.length]} height={12} />
            <Skeleton width="82%" height={10} />
          </div>
          <Skeleton width={56} height={10} />
        </div>
      ))}
    </div>
  );
}

/** Chat bubbles, alternating sides. */
export function SkeletonBubbles({ count = 5 }: { count?: number }) {
  const widths = ["60%", "35%", "50%", "28%", "45%"];
  return (
    <div role="status" aria-label="Loading messages" className="sk-bubbles">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", justifyContent: i % 2 ? "flex-end" : "flex-start" }}>
          <Skeleton width={widths[i % widths.length]} height={i % 3 === 2 ? 52 : 34} radius={14} />
        </div>
      ))}
    </div>
  );
}

/** A big block (map, chart, settings panel). */
export function SkeletonBlock({ height = 240, radius = 12 }: { height?: number | string; radius?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ padding: 0 }}>
      <Skeleton height={height} radius={radius} />
    </div>
  );
}
