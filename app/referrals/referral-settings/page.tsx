"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ArrowLeft, RefreshCw, RotateCcw, Save, CalendarClock, AlertCircle, Wallet } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useRateClock } from "@/hooks/useRateClock";
import { useCurrency } from "@/context/CurrencyContext";
import { writeLog } from "@/lib/activitylog";
import {
  REFERRAL_REWARDS_DOC, DEFAULT_REWARDS, DEFAULT_SETTINGS, LEVEL_LABELS,
  parseSettings, validateRewards, promoState, effectiveRate, serializeRewards, formatInstant,
  describeSettingsChanges, describeSettings,
  type LevelReward, type ReferralRewards, type ReferralSettings,
} from "@/lib/referralRewards";

const LEVEL_HINTS = [
  "People who signed up with the user's own referral code",
  "People invited by the user's direct referrals",
  "People invited by level 2",
];

/** epoch ms ↔ the "YYYY-MM-DDTHH:mm" local value a datetime-local input uses */
const toLocalInput = (ms: number | null) => {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return isFinite(ms) ? ms : null;
};

/** Number inputs: "" while empty so the field can be cleared; parsed on save. */
type Draft = {
  defaultRate: string;
  promoRate: string;
  promoFrom: string;
  promoUntil: string;
  maxEarn: string;
}[];

const toDraft = (r: ReferralRewards): Draft =>
  r.map((l) => ({
    defaultRate: String(l.defaultRate),
    promoRate: l.promoRate == null ? "" : String(l.promoRate),
    promoFrom: toLocalInput(l.promoFrom),
    promoUntil: toLocalInput(l.promoUntil),
    maxEarn: l.maxEarn ? String(l.maxEarn) : "",
  }));

const fromDraft = (d: Draft): ReferralRewards =>
  d.map((l): LevelReward => {
    const n = (s: string) => (s.trim() === "" ? null : Math.max(0, Number(s)));
    return {
      defaultRate: n(l.defaultRate) ?? 0,
      promoRate: n(l.promoRate),
      promoFrom: fromLocalInput(l.promoFrom),
      promoUntil: fromLocalInput(l.promoUntil),
      maxEarn: n(l.maxEarn) ?? 0,
    };
  }) as ReferralRewards;

export default function ReferralSettingsPage() {
  const { user } = useAuthGuard({ module: "referrals" });
  const router = useRouter();
  const { symbol } = useCurrency();
  const money = (n: number) => `${symbol}${n.toLocaleString()}`;

  const [saved, setSaved] = useState<ReferralRewards>(DEFAULT_REWARDS);
  const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_REWARDS));
  /** Overall limit across all levels; "" = no limit */
  const [savedTotal, setSavedTotal] = useState(0);
  const [totalDraft, setTotalDraft] = useState("");
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const snap = await getDoc(REFERRAL_REWARDS_DOC);
      const parsed = parseSettings(snap.data());
      setExists(snap.exists());
      setSaved(parsed.levels);
      setDraft(toDraft(parsed.levels));
      setSavedTotal(parsed.totalMaxEarn);
      setTotalDraft(parsed.totalMaxEarn ? String(parsed.totalMaxEarn) : "");
    } catch (err) {
      console.error("[ReferralSettings] load failed:", err);
      toast.error("Couldn't load referral settings", "Showing the defaults.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const current = useMemo(() => fromDraft(draft), [draft]);
  const errors = useMemo(() => validateRewards(current), [current]);
  const totalMax = totalDraft.trim() === "" ? 0 : Math.max(0, Number(totalDraft));
  const currentSettings: ReferralSettings = { levels: current, totalMaxEarn: totalMax };
  const savedSettings: ReferralSettings = { levels: saved, totalMaxEarn: savedTotal };
  const invalidNumbers =
    (totalDraft.trim() !== "" && !(Number(totalDraft) >= 0)) ||
    draft.some((l) =>
      [l.defaultRate, l.promoRate, l.maxEarn].some((v) => v.trim() !== "" && !(Number(v) >= 0)) || l.defaultRate.trim() === ""
    );
  // Compared at the inputs' minute precision, so seconds in stored times don't count as edits
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) || totalMax !== savedTotal || !exists;
  /** Sum of the per-level limits, if every level has one */
  const levelLimitsSum = current.every((l) => l.maxEarn > 0) ? current.reduce((s, l) => s + l.maxEarn, 0) : null;
  const canSave = dirty && !invalidNumbers && Object.keys(errors).length === 0 && !saving;
  // Ticks over when a time-limited rate starts or expires
  const now = useRateClock(current);

  const set = (i: number, key: keyof Draft[number], value: string) =>
    setDraft((prev) => prev.map((l, j) => (j === i ? { ...l, [key]: value } : l)));

  const clearPromo = (i: number) =>
    setDraft((prev) => prev.map((l, j) => (j === i ? { ...l, promoRate: "", promoFrom: "", promoUntil: "" } : l)));

  /** Spells out exactly what changed, e.g. "Level 2: default rate ₱5 → ₱8; maximum earnings no limit → ₱200" */
  const logDescription = (next: ReferralSettings, kind: "edit" | "reset") => {
    if (kind === "reset") return `Reset referral settings to defaults — ${describeSettings(next, money)}`;
    if (!exists) return `Set up referral settings — ${describeSettings(next, money)}`;
    const changes = describeSettingsChanges(savedSettings, next, money);
    return changes.length
      ? `Updated referral settings — ${changes.join(" · ")}`
      : "Saved referral settings (no changes)";
  };

  const save = async (next: ReferralSettings, kind: "edit" | "reset") => {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(REFERRAL_REWARDS_DOC, {
        levels: serializeRewards(next.levels),
        totalMaxEarn: next.totalMaxEarn,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeLog({
        actorId: user.uid,
        actorName: user.displayName ?? user.email ?? "Unknown",
        actorEmail: user.email ?? undefined,
        module: "referrals",
        action: "referral_settings_updated",
        description: logDescription(next, kind),
        targetId: "referral_settings/rewards",
        targetName: "Referral settings",
        affectedFiles: ["referral_settings/rewards"],
        meta: {
          from: exists ? savedSettings : null,
          to: next,
          other: { changes: exists ? describeSettingsChanges(savedSettings, next, money) : [] },
        },
      });
      setSaved(next.levels);
      setDraft(toDraft(next.levels));
      setSavedTotal(next.totalMaxEarn);
      setTotalDraft(next.totalMaxEarn ? String(next.totalMaxEarn) : "");
      setExists(true);
      toast.success("Referral settings saved");
    } catch (err) {
      console.error("[ReferralSettings] save failed:", err);
      const denied = (err as { code?: string })?.code === "permission-denied";
      toast.error("Save failed", denied ? "You don't have permission to change referral settings." : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title="Referral settings"
      subtitle="Reward rates, time-limited rates and earning limits for each referral level"
      actions={
        <>
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => router.push("/referrals")}>
            Referrals
          </Button>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} disabled={loading || saving}>
            Reload
          </Button>
        </>
      }
    >
      <style>{`
        .rs-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); margin-bottom: 18px; }
        .rs-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
        .rs-card.err { border-color: var(--red); }
        .rs-total-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .rs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .rs-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .rs-hint { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .rs-now { text-align: right; }
        .rs-now b { display: block; font-size: 20px; font-family: 'Space Mono', monospace; color: var(--green); }
        .rs-now span { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
        .rs-section { border-top: 1px solid var(--border); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
        .rs-section-title { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); }
        .rs-label { font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px; }
        .rs-input-wrap { position: relative; }
        .rs-prefix { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 13px; color: var(--text-muted); pointer-events: none; }
        .rs-input {
          width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; font-family: inherit;
          color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); outline: none;
        }
        .rs-input.money { padding-left: 24px; }
        .rs-input:focus { border-color: var(--blue); }
        .rs-input:disabled { opacity: 0.6; }
        .rs-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rs-row-dt { grid-template-columns: 1fr; }
        .rs-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; text-transform: none; letter-spacing: 0; }
        .rs-status.active { color: var(--green); background: var(--green-dim); }
        .rs-status.upcoming { color: var(--blue); background: var(--blue-dim); }
        .rs-status.expired { color: var(--text-muted); background: var(--bg-elevated); }
        .rs-link { font-size: 11px; color: var(--blue); background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; }
        .rs-note { font-size: 11px; color: var(--text-muted); line-height: 1.5; }
        .rs-error { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: var(--red); }
        .rs-bar {
          position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
          padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
        }
        .rs-bar-text { font-size: 12px; color: var(--text-muted); }
        .rs-bar-actions { display: flex; gap: 8px; }
      `}</style>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading referral settings…</div>
      ) : (
        <>
          <div className="rs-grid">
            {current.map((level, i) => {
              const d = draft[i];
              const state = promoState(level, now);
              const rateNow = effectiveRate(level, now);
              return (
                <div className={`rs-card ${errors[i] ? "err" : ""}`} key={LEVEL_LABELS[i]}>
                  <div className="rs-head">
                    <div>
                      <div className="rs-title">{LEVEL_LABELS[i]}</div>
                      <div className="rs-hint">{LEVEL_HINTS[i]}</div>
                    </div>
                    <div className="rs-now" title="The rate used for earnings today">
                      <b>{money(rateNow)}</b>
                      <span>{state === "active" ? "Time-limited rate" : "Rate today"}</span>
                    </div>
                  </div>

                  {/* Default rate */}
                  <div>
                    <label className="rs-label">Default rate per person</label>
                    <div className="rs-input-wrap">
                      <span className="rs-prefix">{symbol}</span>
                      <input
                        className="rs-input money" type="number" min={0} step="0.01" inputMode="decimal"
                        value={d.defaultRate} onChange={(e) => set(i, "defaultRate", e.target.value)} disabled={saving}
                      />
                    </div>
                  </div>

                  {/* Time-limited rate */}
                  <div className="rs-section">
                    <div className="rs-section-title">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <CalendarClock size={12} /> Time-limited rate
                      </span>
                      {state !== "none" && (
                        <span className={`rs-status ${state}`}>
                          {state === "active" ? `Active until ${formatInstant(level.promoUntil)}`
                            : state === "upcoming" ? `Starts ${formatInstant(level.promoFrom)}`
                            : `Expired ${formatInstant(level.promoUntil)}`}
                        </span>
                      )}
                    </div>
                    <div>
                      <label className="rs-label">Rate per person while active</label>
                      <div className="rs-input-wrap">
                        <span className="rs-prefix">{symbol}</span>
                        <input
                          className="rs-input money" type="number" min={0} step="0.01" inputMode="decimal"
                          placeholder="None — default rate applies"
                          value={d.promoRate} onChange={(e) => set(i, "promoRate", e.target.value)} disabled={saving}
                        />
                      </div>
                    </div>
                    <div className="rs-row rs-row-dt">
                      <div>
                        <label className="rs-label">From (date &amp; time)</label>
                        <input className="rs-input" type="datetime-local" value={d.promoFrom}
                          max={d.promoUntil || undefined}
                          onChange={(e) => set(i, "promoFrom", e.target.value)} disabled={saving} />
                      </div>
                      <div>
                        <label className="rs-label">Until (expires at)</label>
                        <input className="rs-input" type="datetime-local" value={d.promoUntil}
                          min={d.promoFrom || undefined}
                          onChange={(e) => set(i, "promoUntil", e.target.value)} disabled={saving} />
                      </div>
                    </div>
                    {(d.promoRate || d.promoFrom || d.promoUntil) && (
                      <button className="rs-link" style={{ alignSelf: "flex-start" }} onClick={() => clearPromo(i)} disabled={saving}>
                        Remove time-limited rate
                      </button>
                    )}
                  </div>

                  {/* Cap */}
                  <div className="rs-section">
                    <div className="rs-section-title"><span>Maximum earnings</span></div>
                    <div>
                      <label className="rs-label">Most one user can earn from this level</label>
                      <div className="rs-input-wrap">
                        <span className="rs-prefix">{symbol}</span>
                        <input
                          className="rs-input money" type="number" min={0} step="0.01" inputMode="decimal"
                          placeholder="No limit"
                          value={d.maxEarn} onChange={(e) => set(i, "maxEarn", e.target.value)} disabled={saving}
                        />
                      </div>
                    </div>
                    <div className="rs-note">
                      {level.maxEarn > 0
                        ? `Earnings stop at ${money(level.maxEarn)} — about ${Math.ceil(level.maxEarn / Math.max(rateNow, 0.01))} people at today's rate.`
                        : "No limit — every qualifying person earns the rate."}
                    </div>
                  </div>

                  {errors[i] && (
                    <div className="rs-error"><AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{errors[i]}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Total limit — hidden until the business rule is confirmed; uncomment to restore
          <div className="rs-card rs-total">
            <div className="rs-head">
              <div>
                <div className="rs-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Wallet size={15} /> Total limit
                </div>
                <div className="rs-hint">The most one user can earn from referrals overall, across all levels</div>
              </div>
            </div>
            <div className="rs-total-row">
              <div className="rs-input-wrap" style={{ maxWidth: 260, flex: 1 }}>
                <span className="rs-prefix">{symbol}</span>
                <input
                  className="rs-input money" type="number" min={0} step="0.01" inputMode="decimal"
                  placeholder="No limit"
                  value={totalDraft} onChange={(e) => setTotalDraft(e.target.value)} disabled={saving}
                />
              </div>
              <div className="rs-note">
                {totalMax > 0
                  ? `A user's referral earnings stop at ${money(totalMax)} in total, even if their levels add up to more.`
                  : "No total limit — only the per-level maximums apply."}
                {totalMax > 0 && levelLimitsSum != null && levelLimitsSum <= totalMax &&
                  ` The per-level maximums already add up to ${money(levelLimitsSum)}, so this limit won't be reached.`}
              </div>
            </div>
          </div> */}

          <div className="rs-note" style={{ marginBottom: 14, marginTop: 18 }}>
            A person counts toward earnings once they&apos;ve completed at least 1 gig. A time-limited rate replaces
            the default rate from its <b>From</b> date and time until its <b>Until</b> date and time (your local
            time), then the default applies again automatically.{!exists && " These settings haven't been saved yet — the defaults below are in use until you save."}
          </div>

          <div className="rs-bar">
            <span className="rs-bar-text">
              {invalidNumbers ? "Enter valid amounts (0 or more) — the default rate can't be empty."
                : Object.keys(errors).length ? "Fix the highlighted level before saving."
                : dirty ? "You have unsaved changes." : "All changes saved."}
            </span>
            <span className="rs-bar-actions">
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={saving}>
                Reset to defaults
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => { setDraft(toDraft(saved)); setTotalDraft(savedTotal ? String(savedTotal) : ""); }}
                disabled={!dirty || saving || !exists}
              >
                Discard
              </Button>
              <Button size="sm" icon={Save} loading={saving} disabled={!canSave}
                onClick={() => save(currentSettings, "edit")}>
                Save changes
              </Button>
            </span>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          await save(DEFAULT_SETTINGS, "reset");
          setConfirmReset(false);
        }}
        title="Reset referral settings?"
        message={`This restores the default rates (${DEFAULT_REWARDS.map((l, i) => `${LEVEL_LABELS[i]} ${money(l.defaultRate)}`).join(", ")}), removes every time-limited rate, per-level maximum and the total limit, and saves immediately.`}
        confirmLabel="Reset and save"
        loading={saving}
      />
    </AdminLayout>
  );
}
