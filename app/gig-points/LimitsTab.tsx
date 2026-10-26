"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AlertCircle, ArrowRight, Lock, Save } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import { useFx } from "@/lib/fx";
import {
  GIG_POINTS_LIMITS_DOC, REQUEST_TYPES, REQUEST_TYPE_LABEL, DIRECTION_KEY, parseConversion, fmtMoney,
  type ConversionConfig, type RequestType, type TypeLimits,
} from "@/lib/gigPoints";

const HINTS: Record<RequestType, string> = {
  to_cash: "User turns points into GigCash in their Gig Wallet. The points are held until you decide.",
  to_points: "User spends GigCash to get points. The GigCash is taken from the wallet when requested and refunded if you reject it.",
};
/** Rates are points per US$1; PH users are converted at the live rate. */
const RATE_HINT: Record<RequestType, (r: number, php: number | null) => string> = {
  to_cash: (r, php) =>
    `${r.toLocaleString()} points → ${fmtMoney(1)}${php ? ` (${fmtMoney(php, "PHP")})` : ""}  ·  ` +
    `1,000 points → ${fmtMoney(Math.floor((1000 / r) * 100) / 100)}${php ? ` (${fmtMoney(Math.floor((1000 / r) * php * 100) / 100, "PHP")})` : ""}`,
  to_points: (r, php) =>
    `${fmtMoney(1)}${php ? ` (${fmtMoney(php, "PHP")})` : ""} → ${r.toLocaleString()} points` +
    (php ? `  ·  ${fmtMoney(100, "PHP")} → ${Math.floor((100 / php) * r).toLocaleString()} points` : ""),
};

type TDraft = { enabled: boolean; rate: string; min: string; max: string; dailyMax: string };
type Draft = { enabled: boolean } & Record<RequestType, TDraft>;
const s = (v: number | null) => (v == null ? "" : String(v));
const toDraft = (c: ConversionConfig): Draft => ({
  enabled: c.enabled,
  ...(Object.fromEntries(REQUEST_TYPES.map((t) => {
    const k = DIRECTION_KEY[t];
    return [t, { enabled: c[k].enabled, rate: s(c.rates[k]), min: s(c[k].min), max: s(c[k].max), dailyMax: s(c[k].dailyMax) }];
  })) as Record<RequestType, TDraft>),
});
/** "" → null; positive whole number; else NaN. */
const p = (v: string) => (v.trim() === "" ? null : /^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : NaN);
const lim = (v: number | null) => (v == null ? "no limit" : v.toLocaleString());

export default function LimitsTab({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const fx = useFx();
  const [saved, setSaved] = useState<ConversionConfig>(parseConversion(undefined));
  const [exists, setExists] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(saved));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(GIG_POINTS_LIMITS_DOC).then((snap) => {
      const c = parseConversion(snap.data());
      setSaved(c); setDraft(toDraft(c)); setExists(snap.exists());
    }).catch((err) => {
      console.error("[GigPoints] conversion load", err);
      toast.error("Couldn't load conversion settings");
    }).finally(() => setLoading(false));
  }, []);

  const parsed = useMemo(() => Object.fromEntries(REQUEST_TYPES.map((t) => {
    const d = draft[t];
    return [t, { enabled: d.enabled, rate: p(d.rate), min: p(d.min), max: p(d.max), dailyMax: p(d.dailyMax) }];
  })) as Record<RequestType, TypeLimits & { rate: number | null }>, [draft]);

  const errs = Object.fromEntries(REQUEST_TYPES.map((t) => {
    const x = parsed[t];
    let e: string | null = null;
    if ([x.rate, x.min, x.max, x.dailyMax].some((v) => Number.isNaN(v))) e = "Use whole numbers above 0, or leave a limit empty for no limit.";
    else if (x.enabled && x.rate == null) e = "Set a rate to turn this direction on.";
    else if (x.min != null && x.max != null && x.min > x.max) e = "Minimum can't be more than the maximum.";
    return [t, e];
  })) as Record<RequestType, string | null>;
  const warn = (t: RequestType) => {
    const x = parsed[t];
    if (x.dailyMax != null && x.min != null && x.dailyMax < x.min) return "The daily cap is below the minimum, so no request can be made.";
    const cash = parsed.to_cash.rate, buy = parsed.to_points.rate;
    if (t === "to_points" && cash && buy && buy > cash) {
      return `Buying gives more points per $1 than cashing out takes (${buy} vs ${cash}), so users can profit by converting back and forth.`;
    }
    return null;
  };
  const invalid = REQUEST_TYPES.some((t) => errs[t]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) || !exists;
  const disabled = !canEdit || saving;

  const setT = (t: RequestType, k: keyof TDraft, v: string | boolean) =>
    setDraft((d) => ({ ...d, [t]: { ...d[t], [k]: v } }));

  const save = async () => {
    const x = parsed;
    const next = {
      enabled: draft.enabled,
      rates: { toCash: x.to_cash.rate, toPoints: x.to_points.rate },
      toCash: { enabled: x.to_cash.enabled, min: x.to_cash.min, max: x.to_cash.max, dailyMax: x.to_cash.dailyMax },
      toPoints: { enabled: x.to_points.enabled, min: x.to_points.min, max: x.to_points.max, dailyMax: x.to_points.dailyMax },
    };
    setSaving(true);
    try {
      await setDoc(GIG_POINTS_LIMITS_DOC, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
      const describe = REQUEST_TYPES.map((t) => {
        const k = DIRECTION_KEY[t];
        return `${REQUEST_TYPE_LABEL[t]} ${next[k].enabled ? `on at ${next.rates[k]} pts/$1 (min ${lim(next[k].min)}, max ${lim(next[k].max)}, daily ${lim(next[k].dailyMax)})` : "off"}`;
      }).join(" · ");
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "gig_points", action: "gig_points_settings_updated",
        description: `Updated Gig Points conversion — ${next.enabled ? describe : "conversion paused"}`,
        targetId: "general_config/gig_points_requests", targetName: "Gig Points conversion",
        affectedFiles: ["general_config/gig_points_requests"],
        meta: { from: exists ? saved : null, to: next },
      });
      const c = parseConversion(next as unknown as Record<string, unknown>);
      setSaved(c); setDraft(toDraft(c)); setExists(true);
      toast.success("Conversion settings saved", "New requests use them right away. Pending requests keep the rate they were made at.");
    } catch (err) {
      console.error("[GigPoints] conversion save", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied" ? "Firestore refused the save. If you are a super admin, the deployed firestore.rules are out of date — deploy them from giggre_app (firebase.cmd deploy --only firestore:rules --project dev)." : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="gp-empty">Loading conversion settings…</div>;

  return (
    <>
      {!canEdit && <div className="gp-readonly"><Lock size={13} /> Only super admins can change conversion settings.</div>}
      <div className="gp-card" style={{ marginBottom: 16 }}>
        <div className="gp-head">
          <div>
            <div className="gp-title">Conversion from the app</div>
            <div className="gp-hint">Master switch. When off, users can see their points but can&apos;t request a conversion. Pending requests can still be decided.</div>
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
          const rate = parsed[t].rate;
          const w = warn(t);
          return (
            <div key={t} className={`gp-card ${errs[t] ? "err" : ""}`}>
              <div className="gp-head">
                <div>
                  <div className="gp-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {t === "to_cash" ? <>Points <ArrowRight size={14} /> GigCash</> : <>GigCash <ArrowRight size={14} /> Points</>}
                  </div>
                  <div className="gp-hint">{HINTS[t]}</div>
                </div>
                <label className="gp-switch">
                  <input type="checkbox" checked={d.enabled} disabled={disabled} onChange={(e) => setT(t, "enabled", e.target.checked)} />
                  {d.enabled ? "On" : "Off"}
                </label>
              </div>
              <div>
                <label className="gp-label">Rate — points per US$1</label>
                <input className="gp-input" type="number" min={1} step={1} inputMode="numeric" placeholder={t === "to_cash" ? "e.g. 100" : "e.g. 80"}
                  value={d.rate} disabled={disabled} onChange={(e) => setT(t, "rate", e.target.value)} style={{ maxWidth: 220 }} />
                {rate != null && !Number.isNaN(rate) && <div className="gp-note" style={{ marginTop: 6 }}>{RATE_HINT[t](rate, fx.php)}</div>}
              </div>
              <div className="gp-row">
                {(["min", "max", "dailyMax"] as const).map((k) => (
                  <div key={k}>
                    <label className="gp-label">{k === "min" ? "Min points" : k === "max" ? "Max points" : "Daily cap / user"}</label>
                    <input className="gp-input" type="number" min={1} step={1} inputMode="numeric" placeholder="No limit"
                      value={d[k]} disabled={disabled} onChange={(e) => setT(t, k, e.target.value)} />
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
        Rates are points per US dollar; users in the Philippines are converted to pesos at the live exchange rate
        {fx.php ? ` (now 1 USD = ${fx.php.toFixed(2)} PHP, set on Gig Wallet → Settings)` : " (Gig Wallet → Settings)"}, and each
        request keeps the rates it was made at. All limits are in points. Cashing out rounds the peso amount down to the centavo; buying rounds the cost up. The rate is locked onto
        each request when it&apos;s made. The daily cap counts everything a user converted in that direction on the same day (Philippine time),
        whether pending or approved; rejected and cancelled requests don&apos;t count. Each user can have only one request waiting for review
        at a time. {!exists && "These settings haven't been saved yet, so conversion is closed until you save."}
      </div>

      {canEdit && (
        <div className="gp-bar">
          <span className="gp-bar-text">{invalid ? "Fix the highlighted settings." : dirty ? "You have unsaved changes." : "All changes saved."}</span>
          <span className="gp-bar-actions">
            <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(saved))} disabled={!dirty || saving || !exists}>Discard</Button>
            <Button size="sm" icon={Save} loading={saving} disabled={!dirty || invalid || saving} onClick={save}>Save changes</Button>
          </span>
        </div>
      )}
    </>
  );
}
