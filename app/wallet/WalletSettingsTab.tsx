"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AlertCircle, Lock, Plus, Save, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
import {
  WALLET_CONFIG_DOC, WALLET_TYPES, WALLET_TYPE_LABEL, parseWalletConfig, fmtMoney, DEPOSIT_KINDS, DEPOSIT_FIELDS,
  type AmountLimits, type DepositAccount, type DepositKind, type WalletConfig, type WalletType,
} from "@/lib/wallet";

const HINTS: Record<WalletType, string> = {
  deposit: "User pays one of the top-up methods below (e-wallet, cash at the office or a remittance center), then submits the reference / receipt / control number and an optional photo. Nothing is held.",
  transfer: "Verified users send GigCash to another user. The amount is taken from the sender when requested and refunded if you reject it.",
};

type LDraft = { enabled: boolean; min: string; max: string; dailyMax: string };
type Draft = { enabled: boolean; deposit: LDraft; transfer: LDraft; accounts: DepositAccount[]; note: string };
const s = (v: number | null) => (v == null ? "" : String(v));
const toDraft = (c: WalletConfig): Draft => ({
  enabled: c.enabled,
  deposit: { enabled: c.deposit.enabled, min: s(c.deposit.min), max: s(c.deposit.max), dailyMax: s(c.deposit.dailyMax) },
  transfer: { enabled: c.transfer.enabled, min: s(c.transfer.min), max: s(c.transfer.max), dailyMax: s(c.transfer.dailyMax) },
  accounts: c.depositAccounts,
  note: c.depositNote,
});
/** "" → null; positive amount with ≤ 2 decimals; else NaN. */
const amt = (v: string) => (v.trim() === "" ? null : /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) > 0 ? Number(v) : NaN);
const lim = (v: number | null) => (v == null ? "no limit" : fmtMoney(v));

export default function WalletSettingsTab({ user, canEdit }: { user: AdminUser; canEdit: boolean }) {
  const [saved, setSaved] = useState<WalletConfig>(parseWalletConfig(undefined));
  const [exists, setExists] = useState(false);
  const [draft, setDraft] = useState<Draft>(toDraft(saved));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(WALLET_CONFIG_DOC).then((snap) => {
      const c = parseWalletConfig(snap.data());
      setSaved(c); setDraft(toDraft(c)); setExists(snap.exists());
    }).catch((err) => {
      console.error("[Wallet] settings load", err);
      toast.error("Couldn't load wallet settings");
    }).finally(() => setLoading(false));
  }, []);

  const parsed = useMemo(() => Object.fromEntries(WALLET_TYPES.map((t) => {
    const d = draft[t];
    return [t, { enabled: d.enabled, min: amt(d.min), max: amt(d.max), dailyMax: amt(d.dailyMax) }];
  })) as Record<WalletType, AmountLimits>, [draft]);
  const errs = Object.fromEntries(WALLET_TYPES.map((t) => {
    const x = parsed[t];
    let e: string | null = null;
    if ([x.min, x.max, x.dailyMax].some((v) => Number.isNaN(v))) e = "Use amounts above ₱0 with up to 2 decimals, or leave empty for no limit.";
    else if (x.min != null && x.max != null && x.min > x.max) e = "Minimum can't be more than the maximum.";
    return [t, e];
  })) as Record<WalletType, string | null>;
  const accountsOk = draft.accounts.every((a) => a.method.trim() && a.accountName.trim() && a.accountNumber.trim());
  const depositNoAccounts = parsed.deposit.enabled && draft.accounts.length === 0;
  const invalid = WALLET_TYPES.some((t) => errs[t]) || !accountsOk || depositNoAccounts;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) || !exists;
  const disabled = !canEdit || saving;

  const setT = (t: WalletType, k: keyof LDraft, v: string | boolean) => setDraft((d) => ({ ...d, [t]: { ...d[t], [k]: v } }));
  const setA = (i: number, k: keyof DepositAccount, v: string) =>
    setDraft((d) => ({ ...d, accounts: d.accounts.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));

  const save = async () => {
    const next = {
      enabled: draft.enabled,
      deposit: parsed.deposit,
      transfer: parsed.transfer,
      withdraw: { enabled: false, min: null, max: null, dailyMax: null },
      depositAccounts: draft.accounts.map((a) => ({
        kind: a.kind, method: a.method.trim(), accountName: a.accountName.trim(),
        accountNumber: a.accountNumber.trim(), details: a.details.trim(),
      })),
      depositNote: draft.note.trim(),
    };
    setSaving(true);
    try {
      await setDoc(WALLET_CONFIG_DOC, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
      const describe = WALLET_TYPES.map((t) => `${WALLET_TYPE_LABEL[t]} ${next[t].enabled ? `on (min ${lim(next[t].min)}, max ${lim(next[t].max)}, daily ${lim(next[t].dailyMax)})` : "off"}`).join(" · ");
      await writeLog({
        actorId: user.uid, actorName: user.displayName ?? user.email ?? "Unknown", actorEmail: user.email ?? undefined,
        module: "wallet", action: "wallet_settings_updated",
        description: `Updated Gig Wallet settings — ${next.enabled ? describe : "requests paused"} · ${next.depositAccounts.length} top-up account(s)`,
        targetId: "general_config/wallet_requests", targetName: "Gig Wallet settings",
        affectedFiles: ["general_config/wallet_requests"],
        meta: { from: exists ? saved : null, to: next },
      });
      const c = parseWalletConfig(next as unknown as Record<string, unknown>);
      setSaved(c); setDraft(toDraft(c)); setExists(true);
      toast.success("Wallet settings saved", "They apply to new requests right away.");
    } catch (err) {
      console.error("[Wallet] settings save", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied"
        ? "Firestore refused the save. If you are a super admin, deploy firestore.rules from giggre_app (firebase.cmd deploy --only firestore:rules --project dev)."
        : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="gp-empty">Loading wallet settings…</div>;

  return (
    <>
      {!canEdit && <div className="gp-readonly"><Lock size={13} /> Only super admins can change wallet settings.</div>}
      <div className="gp-card" style={{ marginBottom: 16 }}>
        <div className="gp-head">
          <div>
            <div className="gp-title">Wallet requests from the app</div>
            <div className="gp-hint">Master switch for Top Up and Send. Withdraw shows &quot;Coming soon&quot; in the app. Pending requests can still be decided when paused.</div>
          </div>
          <label className="gp-switch">
            <input type="checkbox" checked={draft.enabled} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            {draft.enabled ? "Open" : "Paused"}
          </label>
        </div>
      </div>

      <div className="gp-grid" style={{ opacity: draft.enabled ? 1 : 0.6 }}>
        {WALLET_TYPES.map((t) => {
          const d = draft[t];
          return (
            <div key={t} className={`gp-card ${errs[t] ? "err" : ""}`}>
              <div className="gp-head">
                <div><div className="gp-title">{WALLET_TYPE_LABEL[t]}</div><div className="gp-hint">{HINTS[t]}</div></div>
                <label className="gp-switch">
                  <input type="checkbox" checked={d.enabled} disabled={disabled} onChange={(e) => setT(t, "enabled", e.target.checked)} />
                  {d.enabled ? "On" : "Off"}
                </label>
              </div>
              <div className="gp-row">
                {(["min", "max", "dailyMax"] as const).map((k) => (
                  <div key={k}>
                    <label className="gp-label">{k === "min" ? "Min (₱)" : k === "max" ? "Max (₱)" : "Daily cap / user (₱)"}</label>
                    <input className="gp-input" type="number" min={0.01} step="0.01" inputMode="decimal" placeholder="No limit"
                      value={d[k]} disabled={disabled} onChange={(e) => setT(t, k, e.target.value)} />
                  </div>
                ))}
              </div>
              {errs[t] && <div className="gp-error"><AlertCircle size={14} />{errs[t]}</div>}
            </div>
          );
        })}
      </div>

      <div className="gp-card" style={{ marginBottom: 16 }}>
        <div>
          <div className="gp-title">Top-up methods</div>
          <div className="gp-hint">
            Shown to users when they top up. They pay using one of these, then send you the reference number (e-wallet), the
            official receipt number (cash at office) or the control number (remittance). Up to 5.
          </div>
        </div>
        {draft.accounts.map((a, i) => {
          const f = DEPOSIT_FIELDS[a.kind];
          return (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="gp-row" style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
                <div>
                  <label className="gp-label">Type</label>
                  <select className="gp-select" value={a.kind} disabled={disabled}
                    onChange={(e) => {
                      const kind = e.target.value as DepositKind;
                      setDraft((d) => ({ ...d, accounts: d.accounts.map((x, j) => (j === i
                        ? { ...x, kind, method: kind === "ewallet" ? (x.kind === "ewallet" ? x.method : "GCash") : DEPOSIT_FIELDS[kind].methodHint }
                        : x)) }));
                    }}>
                    {DEPOSIT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="gp-label">{f.method}</label>
                  <input className="gp-input" placeholder={f.methodHint} value={a.method} disabled={disabled} onChange={(e) => setA(i, "method", e.target.value)} maxLength={40} />
                </div>
                <Button size="sm" variant="ghost" icon={Trash2} disabled={disabled}
                  onClick={() => setDraft((d) => ({ ...d, accounts: d.accounts.filter((_, j) => j !== i) }))}>Remove</Button>
              </div>
              <div className="gp-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="gp-label">{f.name}</label>
                  <input className="gp-input" placeholder={f.nameHint} value={a.accountName} disabled={disabled} onChange={(e) => setA(i, "accountName", e.target.value)} maxLength={80} />
                </div>
                <div>
                  <label className="gp-label">{f.number}</label>
                  <input className="gp-input" placeholder={f.numberHint} value={a.accountNumber} disabled={disabled} onChange={(e) => setA(i, "accountNumber", e.target.value)} maxLength={120} />
                </div>
              </div>
              <div>
                <label className="gp-label">{f.details}</label>
                <input className="gp-input" placeholder={f.detailsHint} value={a.details} disabled={disabled} onChange={(e) => setA(i, "details", e.target.value)} maxLength={200} />
              </div>
            </div>
          );
        })}
        {draft.accounts.length < 5 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DEPOSIT_KINDS.map((k) => (
              <Button key={k.key} size="sm" variant="secondary" icon={Plus} disabled={disabled}
                onClick={() => setDraft((d) => ({ ...d, accounts: [...d.accounts, {
                  kind: k.key, method: k.key === "ewallet" ? "GCash" : DEPOSIT_FIELDS[k.key].methodHint,
                  accountName: "", accountNumber: "", details: "",
                }] }))}>
                Add {k.label.toLowerCase()}
              </Button>
            ))}
          </div>
        )}
        {!accountsOk && <div className="gp-error"><AlertCircle size={14} />Fill in the label, name and number / address for every method.</div>}
        {depositNoAccounts && <div className="gp-error"><AlertCircle size={14} />Add at least one top-up method while Top up is on.</div>}
        <div>
          <label className="gp-label">Instructions for users (optional)</label>
          <textarea className="gp-textarea" maxLength={500} value={draft.note} disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="e.g. Use your Giggre ID as the payment message. Top ups are confirmed within 24 hours." />
        </div>
      </div>

      <div className="gp-note" style={{ marginBottom: 14 }}>
        Each user can have only one wallet request waiting for review at a time. The daily cap counts everything a user requested of that
        type on the same day (Philippine time), whether pending or approved. Only verified accounts can Send.
        {!exists && " These settings haven't been saved yet, so wallet requests are closed until you save."}
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
