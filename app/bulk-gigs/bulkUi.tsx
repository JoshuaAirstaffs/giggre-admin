"use client";

// Shared pieces of the Bulk Open Gigs tabs: the step styles, the multi-host
// picker (exact email or user ID, one chip per host), the row check / post
// call and the Latitude/Longitude form for addresses the map can't find.

import { useState } from "react";
import { MapPin, Search, UserX, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import type { BulkGigPreview } from "@/lib/bulkGigs";

/** Keep in sync with MAX_HOSTS in the host-gigs route. Searched in batches of HOST_BATCH. */
export const MAX_HOSTS = 300;
/** Hosts per search request (the host-gigs route takes up to 50). */
export const HOST_BATCH = 50;

export const hostKey = (q: string) => q.trim().toLowerCase();

/** Styles for the dh-* classes used by the Delete and Edit tabs. Render once. */
export function BulkStyles() {
  return <style>{`
        .dh { display: flex; flex-direction: column; gap: 14px; }
        .dh-step { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); padding: 18px; }
        .dh-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .dh-num { width: 24px; height: 24px; border-radius: 999px; background: var(--blue-dim); color: var(--blue); font-size: 12px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
        .dh-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .dh-head p { margin: 3px 0 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; }
        .dh-head .txt { flex: 1; min-width: 220px; }
        .dh-search { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
        .dh-box { flex: 1; min-width: 240px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--bg-elevated); color: var(--text-muted); cursor: text; min-height: 38px; max-height: 170px; overflow-y: auto; }
        .dh-box:focus-within { border-color: var(--blue); }
        .dh-box input { flex: 1; min-width: 160px; border: none; background: none; outline: none; padding: 3px 0; font: inherit; font-size: 13px; color: var(--text-primary); }
        .dh-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 4px 3px 9px; border-radius: 999px; background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary); max-width: 100%; overflow-wrap: anywhere; }
        .dh-pill.ok { border-color: var(--green); }
        .dh-pill.bad { border-color: var(--red); color: var(--red); background: var(--red-dim); }
        .dh-pill button { display: inline-flex; padding: 2px; border-radius: 999px; color: inherit; opacity: .7; cursor: pointer; }
        .dh-pill button:hover { opacity: 1; background: var(--bg-hover); }
        .dh-tip { font-size: 11.5px; color: var(--text-muted); margin-top: 8px; }

        .dh-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--bg-elevated); border: 1px solid var(--border); }
        .dh-seg button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); cursor: pointer; border: none; background: none; }
        .dh-seg button.on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.18); }

        .dh-tools { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12.5px; color: var(--text-secondary); }
        .dh-link { color: var(--blue); font-weight: 600; cursor: pointer; background: none; border: none; padding: 0; font-size: 12.5px; }
        .dh-link:disabled { color: var(--text-muted); cursor: default; }
        .dh-hosts { display: flex; flex-direction: column; gap: 8px; }
        .dh-host { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); cursor: pointer; transition: border-color .12s, background .12s; }
        .dh-host:hover { background: var(--bg-hover); }
        .dh-host.on { border-color: var(--red); background: var(--red-dim); }
        .dh-host.empty { cursor: default; opacity: .65; }
        .dh-host.empty:hover { background: none; }
        .dh-host.missing { border-style: dashed; border-color: var(--red); cursor: default; }
        .dh-host input { accent-color: var(--red); width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; }
        .dh-av { width: 34px; height: 34px; border-radius: 999px; background: var(--bg-elevated); display: grid; place-items: center; font-weight: 700; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
        .dh-who { flex: 1; min-width: 0; }
        .dh-who b { display: block; font-size: 13.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dh-who span { display: block; font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dh-count { text-align: right; flex-shrink: 0; }
        .dh-count b { font-size: 18px; color: var(--text-primary); line-height: 1.1; }
        .dh-count .lbl { font-size: 11.5px; color: var(--text-secondary); }
        .dh-count .kept { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        .dh-xl { display: grid; gap: 10px; }
        .dh-xl-step { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); flex-wrap: wrap; }
        .dh-xl-step .txt { flex: 1; min-width: 200px; font-size: 13px; color: var(--text-primary); }
        .dh-xl-step .txt small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 2px; }
        .dh-drop { border: 1.5px dashed var(--border); border-radius: var(--radius-md, 10px); padding: 22px; text-align: center; font-size: 13px; color: var(--text-secondary); cursor: pointer; transition: border-color .12s, background .12s; }
        .dh-drop:hover, .dh-drop.over { border-color: var(--blue); background: var(--blue-dim); }
        .dh-file { border: 1px solid var(--border); border-radius: var(--radius-md, 10px); padding: 12px 14px; font-size: 12.5px; color: var(--text-secondary); }
        .dh-file-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .dh-file-top .name { font-weight: 700; color: var(--text-primary); margin-right: auto; display: inline-flex; gap: 6px; align-items: center; }
        .dh-mini { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
        .dh-mini td { padding: 6px 0; border-top: 1px solid var(--border); color: var(--text-primary); }
        .dh-mini td:last-child { text-align: right; white-space: nowrap; }
        .dh-issues { margin: 10px 0 0; padding: 0; list-style: none; max-height: 150px; overflow-y: auto; display: grid; gap: 4px; }

        .dh-foot { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-radius: var(--radius-lg, 12px); border: 1px solid var(--border); background: var(--bg-surface); box-shadow: 0 10px 28px rgba(0,0,0,.25); }
        .dh-foot .sum { flex: 1; min-width: 200px; font-size: 13px; color: var(--text-primary); }
        .dh-foot .sum small { display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
        .dh-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); }
        .dh-err { color: var(--red); font-size: 12px; display: flex; gap: 5px; align-items: flex-start; }
        .bg-ll { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; max-width: 260px; }
        .bg-ll-row { display: flex; gap: 6px; }
        .bg-ll input { flex: 1; min-width: 0; padding: 6px 8px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 12.5px; font-family: inherit; }
        .bg-ll input:focus { outline: none; border-color: var(--blue); }
        .bg-ll input.bad { border-color: var(--red); }
        .bg-sug { display: flex; gap: 6px; align-items: flex-start; text-align: left; padding: 7px 9px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-family: inherit; cursor: pointer; transition: border-color .15s; }
        .bg-sug:hover:not(:disabled) { border-color: var(--blue); }
        .bg-sug:disabled { opacity: .6; cursor: default; }
        .bg-ll a { font-size: 11.5px; color: var(--blue); }
        .dh-list { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--text-secondary); max-height: 180px; overflow-y: auto; }
      `}</style>;
}

interface HostPickerProps {
  entries: string[];
  onChange: (entries: string[]) => void;
  onRemove: (entry: string) => void;
  /** ok = found, bad = no such account, undefined = not searched yet. */
  statusOf: (entry: string) => "ok" | "bad" | undefined;
  /** Called with the full list (including anything still typed). */
  onSearch: (entries: string[]) => void;
  searching: boolean;
  buttonLabel?: string;
}

/** Type or paste host emails / user IDs; each becomes a chip. */
export function HostPicker({ entries, onChange, onRemove, statusOf, onSearch, searching, buttonLabel = "Find gigs" }: HostPickerProps) {
  const [draft, setDraft] = useState("");

  /** Adds typed / pasted values (split on commas, semicolons, spaces, new lines). */
  const add = (raw: string): string[] => {
    const next = [...entries];
    for (const part of raw.split(/[\s,;]+/)) {
      const v = part.trim();
      if (!v || next.some((e) => hostKey(e) === hostKey(v))) continue;
      if (next.length >= MAX_HOSTS) {
        toast.warning(`At most ${MAX_HOSTS} hosts`, "Remove some to add more.");
        break;
      }
      next.push(v);
    }
    onChange(next);
    setDraft("");
    return next;
  };

  return (
    <form className="dh-search" onSubmit={(e) => { e.preventDefault(); if (!searching) onSearch(draft.trim() ? add(draft) : entries); }}>
      <label className="dh-box">
        <Search size={14} />
        {entries.map((e) => {
          const st = statusOf(e);
          return (
            <span key={e} className={`dh-pill ${st ?? ""}`}>
              {st === "bad" && <UserX size={12} />}
              {e}
              <button type="button" aria-label={`Remove ${e}`} onClick={(ev) => { ev.preventDefault(); onRemove(e); }}><X size={11} /></button>
            </span>
          );
        })}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "," || e.key === ";") && draft.trim()) { e.preventDefault(); add(draft); }
            if (e.key === "Backspace" && !draft && entries.length) onRemove(entries[entries.length - 1]);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[\s,;]/.test(t.trim())) { e.preventDefault(); add(draft + " " + t); }
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
          placeholder={entries.length ? "Add another email…" : "host@example.com"}
          aria-label="Host emails or user IDs"
        />
      </label>
      <Button type="submit" variant="primary" size="sm" icon={Search} loading={searching} disabled={(!entries.length && !draft.trim()) || searching}>
        {buttonLabel}
      </Button>
    </form>
  );
}

/** A place Google Maps found for an address the map lookup couldn't. */
export interface Suggestion { address: string; lat: number; lng: number }

/** Checks (create: false) or posts (create: true) one row via /api/admin/bulk-gigs. */
export async function callRow(body: object) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/admin/bulk-gigs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ ok?: boolean; errors?: string[]; skillNotFound?: boolean; locationNotFound?: boolean; suggestions?: Suggestion[]; preview?: BulkGigPreview; gigId?: string; version?: string }>(res);
  if (!res.ok) return { ok: false, errors: [data.error ?? `Request failed (HTTP ${res.status}).`] };
  return data;
}

export const money = (p: BulkGigPreview) =>
  `${p.currencyCode === "PHP" ? "₱" : "$"}${p.amount.toLocaleString()}${p.payType === "hourly" ? "/hr" : ""}`;

/** Two numbers from text like "14.5995, 120.9842" (what Google Maps copies). */
function splitCoords(text: string): [string, string] | null {
  const m = text.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  return m ? [m[1], m[2]] : null;
}

const validLat = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 90;
const validLng = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Math.abs(Number(v)) <= 180;

/** Latitude/Longitude for a row whose address couldn't be found on the map. */
export function LatLngForm({ suggestions, address, lat: lat0, lng: lng0, disabled, onSubmit }: {
  suggestions: Suggestion[]; address: string; lat: string; lng: string; disabled: boolean; onSubmit: (lat: string, lng: string) => void;
}) {
  const [lat, setLat] = useState(lat0);
  const [lng, setLng] = useState(lng0);
  const [tried, setTried] = useState(false);
  const ok = validLat(lat) && validLng(lng);
  // Pasting "lat, lng" into either box fills both.
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pair = splitCoords(e.clipboardData.getData("text"));
    if (!pair) return;
    e.preventDefault();
    setLat(pair[0]);
    setLng(pair[1]);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ok && !disabled) onSubmit(lat.trim(), lng.trim());
  };
  const search = address ? `https://www.google.com/maps/search/${encodeURIComponent(address)}` : "https://www.google.com/maps";
  return (
    <form className="bg-ll" onSubmit={submit}>
      {suggestions.length > 0 && (
        <>
          <span className="bg-sub" style={{ marginTop: 0 }}>Google Maps found {suggestions.length === 1 ? "this place" : "these places"}. Check it&apos;s the right one:</span>
          {suggestions.map((sg, i) => (
            <button key={i} type="button" className="bg-sug" disabled={disabled} onClick={() => onSubmit(String(sg.lat), String(sg.lng))}>
              <MapPin size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {sg.address}
                <span className="bg-sub" style={{ display: "block" }}>{sg.lat.toFixed(6)}, {sg.lng.toFixed(6)} · Use this</span>
              </span>
            </button>
          ))}
          <span className="bg-sub" style={{ marginTop: 2 }}>Or type the coordinates:</span>
        </>
      )}
      <div className="bg-ll-row">
        <input aria-label="Latitude" placeholder="Latitude" inputMode="decimal" value={lat} disabled={disabled}
          className={tried && !validLat(lat) ? "bad" : ""} onChange={(e) => setLat(e.target.value)} onPaste={onPaste} />
        <input aria-label="Longitude" placeholder="Longitude" inputMode="decimal" value={lng} disabled={disabled}
          className={tried && !validLng(lng) ? "bad" : ""} onChange={(e) => setLng(e.target.value)} onPaste={onPaste} />
        <Button type="submit" variant="secondary" size="sm" disabled={disabled}>Use</Button>
      </div>
      <a href={search} target="_blank" rel="noreferrer">
        Find it on Google Maps
      </a>
      <span className="bg-sub" style={{ marginTop: 0 }}>Right-click the spot → click the numbers to copy them, then paste here.</span>
    </form>
  );
}
