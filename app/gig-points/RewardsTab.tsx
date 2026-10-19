"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AlertCircle, Lock, Save } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import { GIG_POINTS_CONFIG_DOC, GIG_TYPES, parseRewardConfig, type GigTypeKey, type RewardConfig } from "@/lib/gigPoints";

type Draft = { enabled: boolean; byType: Record<GigTypeKey, string>; cap: string };
const toDraft = (c: RewardConfig): Draft => ({
  enabled: c.enabled,
  byType: Object.fromEntries(GIG_TYPES.map((t) => [t.key, c.pointsByGigType[t.key] == null ? "" : String(c.pointsByGigType[t.key])])) as Draft["byType"],
  cap: c.maxPointsPerGig == null ? "" : String(c.maxPointsPerGig),
});
/** "" → null (not set). Otherwise must be a whole number ≥ 0, else NaN (invalid). */
const parse = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
const show = (v: number | null | undefined) => (v == null ? "not set" : `${v} pts`);

export default function RewardsTab({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const [saved, setSaved] = useState<RewardConfig>(parseRewardConfig(undefined));
  const [exists, setExists] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(saved));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(GIG_POINTS_CONFIG_DOC).then((snap) => {
      const c = parseRewardConfig(snap.data());
      setSaved(c); setDraft(toDraft(c)); setExists(snap.exists());
    }).catch((err) => {
      console.error("[GigPoints] reward config load", err);
      toast.error("Couldn't load reward settings");
    }).finally(() => setLoading(false));
  }, []);

  const values = useMemo(() => Object.fromEntries(GIG_TYPES.map((t) => [t.key, parse(draft.byType[t.key])])) as Record<GigTypeKey, number | null>, [draft]);
  const cap = parse(draft.cap);
  const invalid = GIG_TYPES.some((t) => Number.isNaN(values[t.key])) || Number.isNaN(cap);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) || !exists;
  const missing = GIG_TYPES.filter((t) => values[t.key] == null);

  const save = async () => {
    setSaving(true);
    const next: RewardConfig = {
      enabled: draft.enabled,
      pointsByGigType: Object.fromEntries(GIG_TYPES.filter((t) => values[t.key] != null).map((t) => [t.key, values[t.key]!])),
      maxPointsPerGig: cap,
    };
    try {
      await setDoc(GIG_POINTS_CONFIG_DOC, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
      const changes = [
        ...GIG_TYPES.filter((t) => saved.pointsByGigType[t.key] !== next.pointsByGigType[t.key])
          .map((t) => `${t.label} ${show(saved.pointsByGigType[t.key])} → ${show(next.pointsByGigType[t.key])}`),
        ...(saved.maxPointsPerGig !== next.maxPointsPerGig ? [`cap ${show(saved.maxPointsPerGig)} → ${show(next.maxPointsPerGig)}`] : []),
        ...(saved.enabled !== next.enabled ? [next.enabled ? "turned rewards on" : "turned rewards off"] : []),
      ];
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "gig_points", action: "gig_points_settings_updated",
        description: `Updated Gig Points earning rewards — ${changes.join(" · ") || "no changes"}`,
        targetId: "general_config/gig_points", targetName: "Gig Points rewards",
        affectedFiles: ["general_config/gig_points"],
        meta: { from: exists ? saved : null, to: next },
      });
      setSaved(next); setDraft(toDraft(next)); setExists(true);
      toast.success("Earning rewards saved", "New approvals use them within about a minute.");
    } catch (err) {
      console.error("[GigPoints] reward config save", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied" ? "Only super admins can change rewards." : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="gp-empty">Loading reward settings…</div>;
  const disabled = !canEdit || saving;

  return (
    <>
      {!canEdit && <div className="gp-readonly"><Lock size={13} /> Only super admins can change earning rewards.</div>}
      <div className="gp-grid">
        {GIG_TYPES.map((t) => {
          const v = values[t.key];
          const capped = v != null && cap != null && !Number.isNaN(cap) && v > cap;
          return (
            <div key={t.key} className={`gp-card ${Number.isNaN(v) ? "err" : ""}`}>
              <div className="gp-head">
                <div><div className="gp-title">{t.label}</div><div className="gp-hint">{t.hint}</div></div>
                <div className="gp-big">{v == null || Number.isNaN(v) ? "—" : capped ? cap : v}<small>pts per task</small></div>
              </div>
              <div>
                <label className="gp-label">Points earned for finishing one task</label>
                <input className="gp-input" type="number" min={0} step={1} inputMode="numeric" placeholder="Not set"
                  value={draft.byType[t.key]} disabled={disabled}
                  onChange={(e) => setDraft((d) => ({ ...d, byType: { ...d.byType, [t.key]: e.target.value } }))} />
              </div>
              {Number.isNaN(v) && <div className="gp-error"><AlertCircle size={14} />Whole numbers only (0 or more).</div>}
              {v == null && <div className="gp-warn"><AlertCircle size={14} />Not set — finished {t.label.toLowerCase()}s earn nothing and raise a config issue.</div>}
              {capped && <div className="gp-note">Capped to {cap} by the per-gig maximum.</div>}
              {v === 0 && <div className="gp-note">0 means these tasks pay no points.</div>}
            </div>
          );
        })}
      </div>

      <div className="gp-grid">
        <div className="gp-card">
          <div><div className="gp-title">Per-gig maximum</div><div className="gp-hint">Optional safety cap. Applies to the type rewards above and to any per-task reward set on a single gig.</div></div>
          <input className="gp-input" type="number" min={0} step={1} inputMode="numeric" placeholder="No cap" style={{ maxWidth: 220 }}
            value={draft.cap} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, cap: e.target.value }))} />
          {Number.isNaN(cap) && <div className="gp-error"><AlertCircle size={14} />Whole numbers only.</div>}
        </div>
        <div className="gp-card">
          <div><div className="gp-title">Rewards on/off</div><div className="gp-hint">Turning this off stops new points from being awarded for finished gigs. Points already credited stay.</div></div>
          <label className="gp-switch">
            <input type="checkbox" checked={draft.enabled} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            {draft.enabled ? "Workers earn points" : "Rewards paused"}
          </label>
        </div>
      </div>

      <div className="gp-note" style={{ marginBottom: 14 }}>
        A worker&apos;s reward is locked in when the host approves the work and credited when the gig is completed. Changing these values never
        changes rewards already approved or credited.{!exists && " These settings haven't been saved yet — no gig earns points until you save."}
      </div>

      {canEdit && (
        <div className="gp-bar">
          <span className="gp-bar-text">
            {invalid ? "Fix the highlighted values." : missing.length ? `Not set: ${missing.map((t) => t.label).join(", ")}.` : dirty ? "You have unsaved changes." : "All changes saved."}
          </span>
          <span className="gp-bar-actions">
            <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(saved))} disabled={!dirty || saving || !exists}>Discard</Button>
            <Button size="sm" icon={Save} loading={saving} disabled={!dirty || invalid || saving} onClick={save}>Save changes</Button>
          </span>
        </div>
      )}
    </>
  );
}
