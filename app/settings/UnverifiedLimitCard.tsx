"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { RefreshCw, RotateCcw, Save, Search, ShieldAlert } from "lucide-react";
import app, { db } from "@/lib/firebase";
import { toast } from "@/components/ui/Toaster";
import { ConfirmDialog } from "@/components/ui/Modal";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import { useFx, phpHint } from "@/lib/fx";
import { FUNCTIONS_REGION, fmtMoney } from "@/lib/gigPoints";

// general_config/unverified_limits — see giggre_app/functions/src/unverifiedLimits.ts.
//   { enabled, maxUsd, resetPeriod: never|daily|weekly|monthly|yearly, resetEpoch }
// Unverified users can transact (as worker: paid; as host: paid out) up to
// maxUsd per period; then the app blocks applying for, accepting or posting
// gigs until they verify. Periods follow Philippine time (weeks start Monday).
// "Reset everyone now" bumps resetEpoch; "Reset this user" uses the
// adminUnverifiedUsage callable.
const LIMIT_DOC = doc(db, "general_config", "unverified_limits");

const PERIODS = [
  { value: "never", label: "Never (total while unverified)" },
  { value: "daily", label: "Daily — every midnight" },
  { value: "weekly", label: "Weekly — every Monday" },
  { value: "monthly", label: "Monthly — on the 1st" },
  { value: "yearly", label: "Yearly — every January 1" },
] as const;
type Period = (typeof PERIODS)[number]["value"];
const isPeriod = (v: unknown): v is Period => PERIODS.some((p) => p.value === v);

interface Saved { enabled: boolean; maxUsd: number | null; resetPeriod: Period; resetEpoch: number | null }
interface Usage {
  uid: string; name: string; code: string | null; isVerified: string;
  usedUsd: number; workerUsd: number; hostUsd: number; gigs: number; maxUsd: number | null;
}

const usageCall = (data: { query: string; reset?: boolean }) =>
  httpsCallable<typeof data, Usage>(getFunctions(app, FUNCTIONS_REGION), "adminUnverifiedUsage")(data).then((r) => r.data);

const errMsg = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/not-found" && !e.message?.includes("user")) return "Deploy functions from giggre_app first.";
  return e?.message || "Please try again";
};

export default function UnverifiedLimitCard({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const fx = useFx();
  const [enabled, setEnabled] = useState(false);
  const [max, setMax] = useState("");
  const [period, setPeriod] = useState<Period>("never");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [looking, setLooking] = useState(false);
  const [confirmUser, setConfirmUser] = useState(false);
  const [resettingUser, setResettingUser] = useState(false);

  useEffect(() => {
    getDoc(LIMIT_DOC).then((snap) => {
      const d = snap.data() ?? {};
      const m = typeof d.maxUsd === "number" && d.maxUsd > 0 ? d.maxUsd : null;
      const p = isPeriod(d.resetPeriod) ? d.resetPeriod : "never";
      setEnabled(d.enabled === true);
      setMax(m == null ? "" : String(m));
      setPeriod(p);
      setSaved({ enabled: d.enabled === true, maxUsd: m, resetPeriod: p, resetEpoch: typeof d.resetEpoch === "number" ? d.resetEpoch : null });
    }).catch(() => setSaved({ enabled: false, maxUsd: null, resetPeriod: "never", resetEpoch: null }));
  }, []);

  const value = max.trim() === "" ? null : /^\d+(\.\d{1,2})?$/.test(max.trim()) && Number(max) > 0 ? Number(max) : NaN;
  const invalid = Number.isNaN(value) || (enabled && value == null);
  const dirty = !!saved && (saved.enabled !== enabled || saved.maxUsd !== value || saved.resetPeriod !== period);

  const log = (description: string, from: unknown, to: unknown) =>
    writeLog({
      actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
      module: "settings", action: "settings_updated", description,
      targetId: "general_config/unverified_limits", targetName: "Unverified account limit",
      meta: { from, to },
    });

  const denied = (err: unknown) =>
    toast.error("Save failed", (err as { code?: string })?.code === "permission-denied"
      ? "Only super admins can change this (deploy firestore.rules from giggre_app if you are one)."
      : "Please try again");

  const save = async () => {
    if (!saved || invalid || value === undefined) return;
    setSaving(true);
    const next: Saved = { enabled, maxUsd: Number.isNaN(value) ? null : value, resetPeriod: period, resetEpoch: saved.resetEpoch };
    try {
      await setDoc(LIMIT_DOC, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
      const label = PERIODS.find((p) => p.value === period)!.label.split(" — ")[0].toLowerCase();
      await log(next.enabled
        ? `Set the unverified account limit to ${fmtMoney(next.maxUsd ?? 0)}, resets: ${label}`
        : "Turned off the unverified account limit", saved, next);
      setSaved(next);
      toast.success("Saved", "Unverified account limit updated");
    } catch (err) {
      denied(err);
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (!saved) return;
    setResettingAll(true);
    const epoch = Date.now();
    try {
      await setDoc(LIMIT_DOC, { resetEpoch: epoch, lastResetAt: serverTimestamp(), lastResetBy: user.uid, updatedAt: serverTimestamp() }, { merge: true });
      await log("Reset the unverified account limit usage of all users", { resetEpoch: saved.resetEpoch }, { resetEpoch: epoch });
      setSaved({ ...saved, resetEpoch: epoch });
      if (usage) setUsage({ ...usage, usedUsd: 0, workerUsd: 0, hostUsd: 0, gigs: 0 });
      toast.success("Reset", "Every user's usage now starts from zero");
      setConfirmAll(false);
    } catch (err) {
      denied(err);
    } finally {
      setResettingAll(false);
    }
  };

  const lookUp = async () => {
    if (!query.trim()) return;
    setLooking(true);
    try {
      setUsage(await usageCall({ query: query.trim() }));
    } catch (err) {
      setUsage(null);
      toast.error("Lookup failed", errMsg(err));
    } finally {
      setLooking(false);
    }
  };

  const resetUser = async () => {
    if (!usage) return;
    setResettingUser(true);
    try {
      setUsage(await usageCall({ query: usage.code ?? query.trim(), reset: true }));
      toast.success("Reset", `${usage.name}'s usage now starts from zero`);
      setConfirmUser(false);
    } catch (err) {
      toast.error("Reset failed", errMsg(err));
    } finally {
      setResettingUser(false);
    }
  };

  const row: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "11px 0", borderBottom: "1px solid var(--border-muted)" };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" };
  const sub: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 };
  const input: React.CSSProperties = { padding: "6px 9px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit" };
  const ghostBtn = (disabled: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap" });
  const usd = (n: number) => `${fmtMoney(n)}${fx.php ? ` (${phpHint(n, fx)})` : ""}`;

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ color: "var(--amber)", display: "flex" }}><ShieldAlert size={15} /></span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)", letterSpacing: 0.2 }}>Unverified Account Limit</span>
      </div>
      <div style={{ padding: 18 }}>
        {!saved ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Loading…</div>
        ) : (
          <>
            <div style={row}>
              <div>
                <div style={label}>Limit unverified accounts</div>
                <div style={sub}>Applies to everything a user does on gigs — what they earn as a Gig Worker and what they pay as a Gig Host.</div>
              </div>
              <button type="button" disabled={!canEdit} onClick={() => setEnabled(!enabled)}
                style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: canEdit ? "pointer" : "not-allowed", background: enabled ? "var(--green)" : "var(--bg-elevated)", outline: "2px solid " + (enabled ? "var(--green)" : "var(--border)"), outlineOffset: -2, position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 3, left: enabled ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", display: "block" }} />
              </button>
            </div>
            <div style={row}>
              <div>
                <div style={label}>Maximum (USD)</div>
                <div style={sub}>
                  Once a user reaches this, they can&apos;t apply for, accept or post gigs until they verify (or the limit resets).
                  Users in the Philippines get it in pesos at the live rate{value && !Number.isNaN(value) && fx.php ? ` (${phpHint(value, fx)})` : ""}.
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>$</span>
                <input type="number" min={0.01} step="0.01" inputMode="decimal" value={max} disabled={!canEdit}
                  onChange={(e) => setMax(e.target.value)} placeholder="e.g. 100"
                  style={{ ...input, width: 110, textAlign: "right", borderColor: Number.isNaN(value) ? "var(--red)" : "var(--border)" }} />
              </div>
            </div>
            <div style={{ ...row, borderBottom: "none" }}>
              <div>
                <div style={label}>Reset automatically</div>
                <div style={sub}>Usage starts again from zero at the start of each period (Philippine time). Changing this also starts everyone from zero.</div>
              </div>
              <select value={period} disabled={!canEdit} onChange={(e) => setPeriod(e.target.value as Period)} style={{ ...input, flexShrink: 0, cursor: canEdit ? "pointer" : "not-allowed" }}>
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {invalid && <div style={{ fontSize: 12, color: "var(--red)" }}>{enabled && value == null ? "Enter the maximum to turn the limit on." : "Use an amount above $0 with up to 2 decimals."}</div>}
            {!canEdit && <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "10px 0 0" }}>Only super admins can change this.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={save} disabled={saving || invalid || !dirty || !canEdit}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 18px", background: "var(--blue)", border: "none", borderRadius: "var(--radius-sm)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: saving || invalid || !dirty ? "not-allowed" : "pointer", opacity: saving || invalid || !dirty ? 0.6 : 1 }}>
                {saving ? <RefreshCw size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <Save size={13} />}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>

            {/* ── Manual reset ── */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ ...label, marginBottom: 2 }}>Reset manually</div>
              <div style={{ ...sub, marginBottom: 12 }}>
                Start usage over from zero now — for everyone, or for one user.
                {saved.resetEpoch ? ` Last reset for everyone: ${new Date(saved.resetEpoch).toLocaleString()}.` : ""}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>All unverified users</span>
                <button type="button" disabled={!canEdit} onClick={() => setConfirmAll(true)} style={ghostBtn(!canEdit)}>
                  <RotateCcw size={13} /> Reset everyone now
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookUp()}
                  placeholder="Giggre ID or phone number" disabled={!canEdit} style={{ ...input, flex: 1, minWidth: 0 }} />
                <button type="button" onClick={lookUp} disabled={!canEdit || looking || !query.trim()} style={ghostBtn(!canEdit || looking || !query.trim())}>
                  {looking ? <RefreshCw size={13} style={{ animation: "spin 0.8s linear infinite" }} /> : <Search size={13} />} Look up
                </button>
              </div>
              {usage && (
                <div style={{ marginTop: 12, padding: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div>
                      <div style={label}>{usage.name}{usage.code ? <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {usage.code}</span> : null}</div>
                      <div style={{ ...sub, color: usage.isVerified === "verified" ? "var(--green)" : "var(--amber)" }}>
                        {usage.isVerified === "verified" ? "Verified — the limit doesn't apply" : "Not verified"}
                      </div>
                    </div>
                    <button type="button" disabled={!canEdit} onClick={() => setConfirmUser(true)} style={ghostBtn(!canEdit)}>
                      <RotateCcw size={13} /> Reset this user
                    </button>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.7 }}>
                    Used this period: <b>{usd(usage.usedUsd)}</b>{usage.maxUsd ? <> of {fmtMoney(usage.maxUsd)}</> : " (no limit set)"}<br />
                    Earned as worker: {usd(usage.workerUsd)} · Paid as host: {usd(usage.hostUsd)} · {usage.gigs} completed gig{usage.gigs === 1 ? "" : "s"}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} onConfirm={resetAll} loading={resettingAll} danger
        title="Reset everyone's usage?" confirmLabel="Reset everyone"
        message="Every unverified user's usage goes back to zero now, so anyone blocked by the limit can take and post gigs again. This can't be undone." />
      <ConfirmDialog open={confirmUser} onClose={() => setConfirmUser(false)} onConfirm={resetUser} loading={resettingUser} danger
        title={`Reset ${usage?.name ?? "this user"}'s usage?`} confirmLabel="Reset user"
        message="Their usage goes back to zero now. This can't be undone." />
    </div>
  );
}
