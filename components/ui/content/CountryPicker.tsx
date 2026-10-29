"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Globe, Search, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { CAROUSEL_COUNTRIES, ENABLED_CAROUSEL_COUNTRIES, countryByCode } from "@/lib/carouselCountries";

const SUMMARY_LIMIT = 3;

// ─── Summary shown in the form ────────────────────────────────────────────────

/**
 * The first few chosen countries as chips, then "+N more" with every name on
 * hover. `compact` (for tables) shows just the flag, with the name on hover.
 */
export function CountrySummary({ codes, compact = false }: { codes: string[]; compact?: boolean }) {
  const chosen = codes.map((c) => countryByCode(c)).filter((c): c is NonNullable<typeof c> => !!c);
  const shown = chosen.slice(0, SUMMARY_LIMIT);
  const rest = chosen.length - shown.length;

  return (
    <div className="cs-row">
      <style>{`
        .cs-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .cs-chip {
          display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; font-size: 12px;
          border-radius: 999px; color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border);
        }
        .cs-more { position: relative; cursor: default; color: var(--blue); border-color: var(--blue); background: var(--blue-dim); font-weight: 600; }
        .cs-tip {
          position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
          min-width: 180px; max-width: 260px; padding: 8px 10px; z-index: 20;
          font-size: 12px; font-weight: 400; line-height: 1.6; color: var(--text-primary);
          background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3); opacity: 0; pointer-events: none; transition: opacity 0.12s;
        }
        .cs-more:hover .cs-tip, .cs-more:focus .cs-tip { opacity: 1; }
        .cs-tip-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); margin-bottom: 4px; }
        .cs-none { font-size: 12px; color: var(--text-muted); }
        .cs-compact { padding: 2px 7px; font-size: 11px; font-family: 'Space Mono', monospace; }
        .cs-flag { position: relative; font-size: 17px; line-height: 1; cursor: default; }
        .cs-flag:hover .cs-tip, .cs-flag:focus .cs-tip { opacity: 1; }
        .cs-tip-sm { min-width: 0; width: max-content; white-space: nowrap; padding: 4px 8px; }
      `}</style>

      {chosen.length === 0 && <span className="cs-none">No countries chosen</span>}
      {shown.map((c) => (
        compact ? (
          <span key={c.code} className="cs-flag" tabIndex={0} aria-label={c.name}>
            {c.flag}
            <span className="cs-tip cs-tip-sm" role="tooltip">{c.name}</span>
          </span>
        ) : (
          <span key={c.code} className="cs-chip">{c.flag} {c.name}</span>
        )
      ))}
      {rest > 0 && (
        <span className={`cs-chip cs-more ${compact ? "cs-compact" : ""}`} tabIndex={0} aria-label={`All countries: ${chosen.map((c) => c.name).join(", ")}`}>
          +{rest}{compact ? "" : " more"}
          <span className="cs-tip" role="tooltip">
            <div className="cs-tip-title">All {chosen.length} countries</div>
            {chosen.map((c) => <div key={c.code}>{c.flag} {c.name}</div>)}
          </span>
        </span>
      )}
    </div>
  );
}

// ─── Picker modal ─────────────────────────────────────────────────────────────

/**
 * Its own modal, opened from the Edit/Add Item modal. Rendered into
 * document.body so it isn't positioned or clipped by the parent modal, and
 * Escape closes only this one.
 */
export function CountryPickerModal({
  open,
  value,
  onClose,
  onApply,
}: {
  open: boolean;
  value: string[];
  onClose: () => void;
  onApply: (codes: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(value);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(value);
      setSearch("");
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep the parent modal's own Escape handler from closing it too
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? CAROUSEL_COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      : CAROUSEL_COUNTRIES;
  }, [search]);

  if (!open || typeof document === "undefined") return null;

  const toggle = (code: string) =>
    setDraft((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  // Keep the list order, not click order
  const ordered = CAROUSEL_COUNTRIES.map((c) => c.code).filter((c) => draft.includes(c));
  const allEnabledChosen = ENABLED_CAROUSEL_COUNTRIES.every((c) => draft.includes(c.code));

  return createPortal(
    <div className="cpk-overlay" onClick={onClose}>
      <style>{`
        .cpk-overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); }
        .cpk-box { width: 440px; max-width: 100%; max-height: 85vh; display: flex; flex-direction: column; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: 0 32px 80px rgba(0,0,0,0.5); }
        .cpk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; }
        .cpk-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .cpk-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
        .cpk-x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; display: flex; }
        .cpk-tools { display: flex; gap: 8px; align-items: center; padding: 0 20px 10px; }
        .cpk-search { flex: 1; position: relative; }
        .cpk-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
        .cpk-search input { width: 100%; box-sizing: border-box; padding: 8px 10px 8px 30px; font-size: 13px; font-family: inherit; color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); outline: none; }
        .cpk-search input:focus { border-color: var(--blue); }
        .cpk-link { font-size: 12px; font-weight: 600; color: var(--blue); background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; white-space: nowrap; }
        .cpk-list { overflow-y: auto; padding: 0 12px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .cpk-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 8px; font-size: 13px; font-family: inherit; text-align: left; color: var(--text-primary); background: none; border: none; border-bottom: 1px solid var(--border-muted); cursor: pointer; }
        .cpk-item:last-child { border-bottom: none; }
        .cpk-item:hover:not(:disabled) { background: var(--bg-elevated); }
        .cpk-item:disabled { cursor: not-allowed; color: var(--text-muted); }
        .cpk-box-check { width: 17px; height: 17px; border-radius: 4px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--border); background: var(--bg-elevated); color: #fff; }
        .cpk-item.on .cpk-box-check { background: var(--blue); border-color: var(--blue); }
        .cpk-name { flex: 1; }
        .cpk-code { font-size: 11px; color: var(--text-muted); font-family: 'Space Mono', monospace; }
        .cpk-soon { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.3px; }
        .cpk-empty { padding: 20px; text-align: center; font-size: 13px; color: var(--text-muted); }
        .cpk-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px 16px; }
        .cpk-count { font-size: 12px; color: var(--text-muted); }
        .cpk-count.err { color: var(--red); }
        .cpk-actions { display: flex; gap: 8px; }
      `}</style>

      <div className="cpk-box" role="dialog" aria-modal="true" aria-label="Choose countries" onClick={(e) => e.stopPropagation()}>
        <div className="cpk-head">
          <div>
            <div className="cpk-title"><Globe size={16} /> Choose countries</div>
            <div className="cpk-sub">The slide only shows to app users in these countries.</div>
          </div>
          <button className="cpk-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="cpk-tools">
          <div className="cpk-search">
            <Search size={13} />
            <input autoFocus placeholder="Search countries…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button
            className="cpk-link"
            onClick={() => setDraft(allEnabledChosen ? [] : ENABLED_CAROUSEL_COUNTRIES.map((c) => c.code))}
          >
            {allEnabledChosen ? "Clear all" : "Select all available"}
          </button>
        </div>

        <div className="cpk-list">
          {filtered.length === 0 && <div className="cpk-empty">No countries match &ldquo;{search}&rdquo;</div>}
          {filtered.map((c) => {
            const on = draft.includes(c.code);
            // A country that's no longer available can still be unticked on
            // slides that already have it — it just can't be added again
            const locked = !c.enabled && !on;
            return (
              <button
                key={c.code}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-disabled={locked}
                disabled={locked}
                className={`cpk-item ${on ? "on" : ""}`}
                onClick={() => toggle(c.code)}
                title={c.enabled ? undefined : on ? `${c.name} isn't available any more — untick to remove it` : `${c.name} isn't available yet`}
              >
                <span className="cpk-box-check">{on && <Check size={11} strokeWidth={3} />}</span>
                <span className="cpk-name">{c.flag} {c.name}</span>
                {c.enabled ? <span className="cpk-code">{c.code}</span> : <span className="cpk-soon">Coming soon</span>}
              </button>
            );
          })}
        </div>

        <div className="cpk-foot">
          <span className={`cpk-count ${ordered.length === 0 ? "err" : ""}`}>
            {ordered.length === 0 ? "Pick at least one country" : `${ordered.length} selected`}
          </span>
          <span className="cpk-actions">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={ordered.length === 0} onClick={() => { onApply(ordered); onClose(); }}>
              Done
            </Button>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
