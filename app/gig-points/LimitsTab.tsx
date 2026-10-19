"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AlertCircle, Lock, Save } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import {
  GIG_POINTS_LIMITS_DOC, REQUEST_TYPES, REQUEST_TYPE_LABEL, parseLimits,
  type RequestLimits, type RequestType, type TypeLimits,
} from "@/lib/gigPoints";

const HINTS: Record<RequestType, string> = {
  deposit: "User pays you outside the app, then asks for the points. Nothing is held.",
  withdraw: "User cashes points out; you pay them outside the app. Points are held until you decide.",
  transfer: "User sends points to another user. Points are held until you decide.",
};

type TDraft = { enabled: boolean; min: string; max: string; dailyMax: string };
type Draft = { enabled: boolean } & Record<RequestType, TDraft>;
const s = (v: number | null) => (v == null ? "" : String(v));
const toDraft = (l: RequestLimits): Draft => ({
  enabled: l.enabled,
  ...(Object.fromEntries(REQUEST_TYPES.map((t) => [t, { enabled: l[t].enabled, min: s(l[t].min), max: s(l[t].max), dailyMax: s(l[t].dailyMax) }])) as Record<RequestType, TDraft>),
});
/** "" → null (no limit); positive whole number; else NaN. */
const p = (v: string) => (v.trim() === "" ? null : /^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : NaN);
const fromT = (d: TDraft): TypeLimits => ({ enabled: d.enabled, min: p(d.min), max: p(d.max), dailyMax: p(d.dailyMax) });
const lim = (v: number | null) => (v == null ? "no limit" : v.toLocaleString());

function problems(t: TypeLimits): string | null {
  if ([t.min, t.max, t.dailyMax].some((v) => Number.isNaN(v))) return "Use whole numbers above 0, or leave empty for no limit.";
  if (t.min != null && t.max != null && t.min > t.max) return "Minimum can't be more than the maximum.";
  return null;
}
function warning(t: TypeLimits): string | null {
  if (t.dailyMax != null && t.min != null && t.dailyMax < t.min) return "The daily cap is below the minimum, so no request can be made.";
  if (t.dailyMax != null && t.max != null && t.max > t.dailyMax) return "The per-request maximum is above the daily cap; the daily cap wins.";
  return null;
}

export default function LimitsTab({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const [saved, setSaved] = useState<RequestLimits>(parseLimits(undefined));
  const [exists, setExists] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(saved));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(GIG_POINTS_LIMITS_DOC).then((snap) => {
      const l = parseLimits(snap.data());
      setSaved(l); setDraft(toDraft(l)); setExists(snap.exists());
    }).catch((err) => {
      console.error("[GigPoints] limits load", err);
      toast.error("Couldn't load request limits");
    }).finally(() => setLoading(false));
  }, []);

  const current = useMemo<RequestLimits>(() => ({
    enabled: draft.enabled, deposit: fromT(draft.deposit), withdraw: fromT(draft.withdraw), transfer: fromT(draft.transfer),
  }), [draft]);
  const errs = Object.fromEntries(REQUEST_TYPES.map((t) => [t, problems(current[t])])) as Record<RequestType, string | null>;
  const invalid = REQUEST_TYPES.some((t) => errs[t]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) || !exists;
  const disabled = !canEdit || saving;

  const setT = (t: RequestType, k: keyof TDraft, v: string | boolean) =>
    setDraft((d) => ({ ...d, [t]: { ...d[t], [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(GIG_POINTS_LIMITS_DOC, { ...current, updatedAt: serverTimestamp(), updatedBy: user.uid });
      const describe = (l: RequestLimits) => REQUEST_TYPES.map((t) =>
        `${REQUEST_TYPE_LABEL[t]} ${l[t].enabled ? `on (min ${lim(l[t].min)}, max ${lim(l[t].max)}, daily ${lim(l[t].dailyMax)})` : "off"}`).join(" · ");
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "gig_points", action: "gig_points_settings_updated",
        description: `Updated Gig Points request limits — ${current.enabled ? describe(current) : "all requests paused"}`,
        targetId: "general_config/gig_points_requests", targetName: "Gig Points request limits",
        affectedFiles: ["general_config/gig_points_requests"],
        meta: { from: exists ? saved : null, to: current },
      });
      setSaved(current); setDraft(toDraft(current)); setExists(true);
      toast.success("Request limits saved", "They apply to new requests right away.");
    } catch (err) {
      console.error("[GigPoints] limits save", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied" ? "Only super admins can change limits." : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="gp-empty">Loading request limits…</div>;

  return (
    <>
      {!canEdit && <div className="gp-readonly"><Lock size={13} /> Only super admins can change request limits.</div>}
      <div className="gp-card" style={{ marginBottom: 16 }}>
        <div className="gp-head">
          <div>
            <div className="gp-title">Requests from the app</div>
            <div className="gp-hint">Master switch. When off, users can see their points but can&apos;t make deposit, withdraw or transfer requests. Pending requests can still be decided.</div>
          </div>
          <label className="gp-switch">
            <input type="checkbox" checked={draft.enabled} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            {draft.enabled ? "Open" : "Paused"}
          </label>
        </div>
      </div>

      <div className="gp-grid" style={{ opacity: draft.enabled ? 1 : 0.6 }}>
        {REQUEST_TYPES.map((t) => {
          const d = draft[t];
          const w = warning(current[t]);
          return (
            <div key={t} className={`gp-card ${errs[t] ? "err" : ""}`}>
              <div className="gp-head">
                <div><div className="gp-title">{REQUEST_TYPE_LABEL[t]}</div><div className="gp-hint">{HINTS[t]}</div></div>
                <label className="gp-switch">
                  <input type="checkbox" checked={d.enabled} disabled={disabled} onChange={(e) => setT(t, "enabled", e.target.checked)} />
                  {d.enabled ? "On" : "Off"}
                </label>
              </div>
              <div className="gp-row">
                {(["min", "max", "dailyMax"] as const).map((k) => (
                  <div key={k}>
                    <label className="gp-label">{k === "min" ? "Min / request" : k === "max" ? "Max / request" : "Daily cap / user"}</label>
                    <input className="gp-input" type="number" min={1} step={1} inputMode="numeric" placeholder="No limit"
                      value={d[k]} disabled={disabled || !d.enabled} onChange={(e) => setT(t, k, e.target.value)} />
                  </div>
                ))}
              </div>
              {errs[t] && <div className="gp-error"><AlertCircle size={14} />{errs[t]}</div>}
              {!errs[t] && w && <div className="gp-warn"><AlertCircle size={14} />{w}</div>}
            </div>
          );
        })}
      </div>

      <div className="gp-note" style={{ marginBottom: 14 }}>
        The daily cap counts everything a user requested of that type on the same day (Philippine time), whether pending or approved.
        Rejected and cancelled requests don&apos;t count. Each user can have only one request waiting for review at a time, of any type.
        {!exists && " These limits haven't been saved yet, so requests are closed until you save."}
      </div>

      {canEdit && (
        <div className="gp-bar">
          <span className="gp-bar-text">{invalid ? "Fix the highlighted limits." : dirty ? "You have unsaved changes." : "All changes saved."}</span>
          <span className="gp-bar-actions">
            <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(saved))} disabled={!dirty || saving || !exists}>Discard</Button>
            <Button size="sm" icon={Save} loading={saving} disabled={!dirty || invalid || saving} onClick={save}>Save changes</Button>
          </span>
        </div>
      )}
    </>
  );
}
