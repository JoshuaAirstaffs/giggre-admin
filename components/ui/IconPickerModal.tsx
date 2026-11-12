"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { ICON_SETS, iconLabel, iconUrl, searchIcons, type IconSetPrefix } from "@/lib/iconify";

/**
 * Draws an Iconify icon in the current text color (a CSS mask, so it follows
 * light / dark mode). Falls back to an empty box when there's no icon.
 */
export function IconGlyph({ icon, size = 18, title }: { icon: string | null | undefined; size?: number; title?: string }) {
  const url = icon ? iconUrl(icon) : "";
  return (
    <span
      aria-hidden={!title}
      role={title ? "img" : undefined}
      aria-label={title}
      title={title}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        ...(url
          ? { backgroundColor: "currentColor", WebkitMask: `url("${url}") center / contain no-repeat`, mask: `url("${url}") center / contain no-repeat` }
          : { border: "1px dashed var(--border)", borderRadius: 4 }),
      }}
    />
  );
}

const setOf = (icon: string | null): IconSetPrefix => {
  const p = icon?.split(":")[0];
  return (ICON_SETS.find((s) => s.prefix === p)?.prefix ?? ICON_SETS[0].prefix) as IconSetPrefix;
};

export function IconPickerModal({ title, initialQuery, value, onClose, onSave }: {
  title: string;
  initialQuery: string;
  value: string | null;
  onClose: () => void;
  onSave: (icon: string | null) => Promise<void>;
}) {
  const [set, setSet] = useState<IconSetPrefix>(setOf(value));
  const [query, setQuery] = useState(initialQuery);
  const [icons, setIcons] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setIcons(null);
    setError(null);
    const t = setTimeout(() => {
      searchIcons(query, set, ctrl.signal)
        .then(setIcons)
        .catch((e) => { if (!ctrl.signal.aborted) { setError(e instanceof Error ? e.message : "Icon search failed"); setIcons([]); } });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, set]);

  const save = async (icon: string | null) => {
    setBusy(true);
    try { await onSave(icon); onClose(); } catch { /* onSave shows the error; keep the picker open */ } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} size="lg" title={title}
      footer={<>
        {value && <Button variant="ghost" onClick={() => save(null)} disabled={busy} style={{ marginRight: "auto" }}>Remove icon</Button>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => save(picked)} loading={busy} disabled={busy || !picked || picked === value}>Save icon</Button>
      </>}>
      <style>{`
        .ip-sets { display: inline-flex; gap: 2px; padding: 3px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .ip-set { padding: 5px 12px; font-size: 12px; font-weight: 600; font-family: inherit; border: none; border-radius: 6px; background: none; color: var(--text-muted); cursor: pointer; }
        .ip-set.active { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .ip-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }
        .ip-search input { flex: 1; background: none; border: none; outline: none; padding: 9px 0; font-size: 13px; color: var(--text-primary); font-family: inherit; }
        .ip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; max-height: 340px; overflow-y: auto; padding: 2px; }
        .ip-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; font-family: inherit; }
        .ip-cell:hover { color: var(--text-primary); border-color: var(--text-muted); }
        .ip-cell.on { color: var(--blue); border-color: var(--blue); background: var(--blue-dim); }
        .ip-cell span.ip-name { font-size: 9.5px; line-height: 1.2; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ip-msg { padding: 24px; text-align: center; font-size: 12.5px; color: var(--text-muted); }
        .ip-current { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-secondary); }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div className="ip-sets" role="tablist" aria-label="Icon set">
            {ICON_SETS.map((s) => (
              <button key={s.prefix} type="button" role="tab" aria-selected={set === s.prefix}
                className={`ip-set${set === s.prefix ? " active" : ""}`} onClick={() => setSet(s.prefix)}>{s.label}</button>
            ))}
          </div>
          <div className="ip-current">
            {picked ? <><IconGlyph icon={picked} size={26} /> <span>{iconLabel(picked)} <span style={{ color: "var(--text-muted)" }}>({picked.split(":")[0]})</span></span></> : "No icon picked"}
          </div>
        </div>
        <div className="ip-search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons, e.g. broom, dog, baby…" autoFocus />
        </div>
        {error ? <div className="ip-msg" style={{ color: "var(--red)" }}>{error}</div>
          : icons == null ? <div className="ip-msg">Searching…</div>
          : icons.length === 0 ? <div className="ip-msg">No icons for &quot;{query.trim()}&quot; in this set. Try a simpler word (e.g. &quot;broom&quot; instead of &quot;House Cleaning&quot;) or another set.</div>
          : (
            <div className="ip-grid">
              {icons.map((i) => (
                <button key={i} type="button" className={`ip-cell${picked === i ? " on" : ""}`} title={iconLabel(i)} onClick={() => setPicked(i)}>
                  <IconGlyph icon={i} size={26} />
                  <span className="ip-name">{iconLabel(i)}</span>
                </button>
              ))}
            </div>
          )}
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          Tip: pick all sub-category icons from the same set so they look alike in the app.
        </div>
      </div>
    </Modal>
  );
}
