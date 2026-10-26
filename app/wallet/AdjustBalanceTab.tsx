"use client";

import { useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { callableError } from "@/lib/gigPoints";
import { currencySymbol } from "@/lib/gigPoints";
import { adminAdjustWallet, adminFindWalletUser, fmtMoney, newRequestId, type FoundWalletUser } from "@/lib/wallet";

type Mode = "add" | "remove";

/** Manually add or remove GigCash (adminAdjustWallet in wallet.ts). */
export default function AdjustBalanceTab() {
  const [q, setQ] = useState("");
  const [finding, setFinding] = useState(false);
  const [user, setUser] = useState<FoundWalletUser | null>(null);
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // One id per confirmed action so a double click can't apply it twice.
  const [requestId, setRequestId] = useState(newRequestId);

  const find = async () => {
    if (!q.trim()) return;
    setFinding(true);
    try {
      setUser(await adminFindWalletUser({ query: q.trim() }));
    } catch (err) {
      toast.error("User not found", callableError(err));
    } finally {
      setFinding(false);
    }
  };

  const amt = Number(amount);
  const validAmt = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && amt > 0 && amt <= 100_000;
  const short = mode === "remove" && user && validAmt && amt > user.walletBalance;
  const ready = !!user && validAmt && !short && reason.trim().length >= 3;
  const ccy = user?.currencyCode ?? "USD";

  const run = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await adminAdjustWallet({ uid: user.uid, amount: mode === "add" ? amt : -amt, reason: reason.trim(), requestId });
      toast.success(mode === "add" ? "GigCash added" : "GigCash removed", `${user.name}'s balance is now ${fmtMoney(res.balance, ccy)}. They've been notified.`);
      setUser({ ...user, walletBalance: res.balance });
      setAmount("");
      setReason("");
      setConfirm(false);
      setRequestId(newRequestId());
    } catch (err) {
      toast.error("Adjustment failed", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gp-card" style={{ maxWidth: 720 }}>
      <div>
        <div className="gp-title">Adjust a user&apos;s GigCash</div>
        <div className="gp-hint">
          Put a balance on a user&apos;s Gig Wallet, or take one off, without a request. Use it for cash received in person, refunds and
          corrections. Applies immediately, shows in the user&apos;s wallet history with your reason, and is recorded in the Activity Logs.
        </div>
      </div>

      <div>
        <label className="gp-label">User</label>
        {user ? (
          <div className="gp-user">
            {user.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="gp-avatar" src={user.photoUrl} alt="" />
              : <span className="gp-avatar">{user.name[0]?.toUpperCase()}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{user.name}</div>
              <div className="gp-sub">{[user.code, user.phone, user.email].filter(Boolean).join(" · ")}</div>
              <div className="gp-stats" style={{ marginTop: 6 }}>
                <span>GigCash <b>{fmtMoney(user.walletBalance, ccy)}</b></span>
                <span>Status <b>{user.isVerified ?? "unverified"}</b></span>
              </div>
            </div>
            <Button size="sm" variant="ghost" icon={X} onClick={() => setUser(null)}>Change</Button>
          </div>
        ) : (
          <div className="gp-search">
            <input className="gp-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Giggre ID (e.g. ABC123456) or phone number"
              onKeyDown={(e) => e.key === "Enter" && find()} disabled={finding} />
            <Button size="sm" variant="secondary" icon={Search} loading={finding} onClick={find} disabled={!q.trim()}>Find</Button>
          </div>
        )}
      </div>

      <div className="gp-seg" role="radiogroup">
        <button className={mode === "add" ? "active" : ""} onClick={() => setMode("add")} role="radio" aria-checked={mode === "add"}>Add GigCash</button>
        <button className={mode === "remove" ? "active" : ""} onClick={() => setMode("remove")} role="radio" aria-checked={mode === "remove"}>Remove GigCash</button>
      </div>

      <div>
        <label className="gp-label">Amount ({currencySymbol(ccy)}){user ? ` — ${user.name}'s wallet is in ${ccy}` : ""}</label>
        <input className="gp-input" type="number" min={0.01} step="0.01" inputMode="decimal" style={{ maxWidth: 220 }}
          value={amount} onChange={(e) => setAmount(e.target.value)} />
        {amount.trim() !== "" && !validAmt && <div className="gp-error" style={{ marginTop: 6 }}>Enter an amount from {fmtMoney(0.01, ccy)} to {fmtMoney(100000, ccy)} (up to 2 decimals).</div>}
        {short && <div className="gp-error" style={{ marginTop: 6 }}>{user!.name} only has {fmtMoney(user!.walletBalance, ccy)}.</div>}
      </div>
      <div>
        <label className="gp-label">Reason (shown to the user)</label>
        <textarea className="gp-textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Cash top up received at the office, OR #1234" />
      </div>
      <div>
        <Button icon={mode === "add" ? Plus : Minus} variant={mode === "add" ? "primary" : "danger"} disabled={!ready} onClick={() => setConfirm(true)}>
          {mode === "add" ? "Add GigCash" : "Remove GigCash"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={run}
        title={`${mode === "add" ? "Add" : "Remove"} ${validAmt ? fmtMoney(amt, ccy) : ""}?`}
        message={user ? `${user.name}'s GigCash goes from ${fmtMoney(user.walletBalance, ccy)} to ${fmtMoney(user.walletBalance + (mode === "add" ? amt : -amt), ccy)}. Reason: “${reason.trim()}”.` : ""}
        confirmLabel={mode === "add" ? "Add GigCash" : "Remove GigCash"}
        danger={mode === "remove"}
        loading={busy}
      />
    </div>
  );
}
