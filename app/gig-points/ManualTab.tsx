"use client";

import { useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { adminFindGigPointsUser, adjustGigPoints, callableError, fmtMoney, type FoundUser } from "@/lib/gigPoints";

const n = (v: number) => v.toLocaleString();
type Mode = "add" | "remove";

/** Support tool: add or remove a user's points directly (adjustGigPoints). */
export default function ManualTab() {
  const [q, setQ] = useState("");
  const [finding, setFinding] = useState(false);
  const [user, setUser] = useState<FoundUser | null>(null);
  const [mode, setMode] = useState<Mode>("add");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    if (!q.trim()) return;
    setFinding(true);
    try {
      setUser(await adminFindGigPointsUser({ query: q.trim() }));
    } catch (err) {
      toast.error("User not found", callableError(err));
    } finally {
      setFinding(false);
    }
  };

  const pts = Number(points);
  const validPts = points.trim() !== "" && Number.isInteger(pts) && pts > 0 && pts <= 100_000;
  const short = mode === "remove" && user && validPts && pts > user.balance;
  const ready = !!user && validPts && !short && reason.trim().length >= 3;

  const run = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await adjustGigPoints({ userId: user.uid, points: mode === "add" ? pts : -pts, reason: reason.trim() });
      toast.success(mode === "add" ? "Points added" : "Points removed", `${user.name}'s balance is now ${n(res.balance)}.`);
      setUser({ ...user, balance: res.balance });
      setPoints("");
      setReason("");
      setConfirm(false);
    } catch (err) {
      toast.error("Adjustment failed", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gp-card" style={{ maxWidth: 720 }}>
      <div>
        <div className="gp-title">Adjust a user&apos;s points</div>
        <div className="gp-hint">
          For support corrections and goodwill credits. Applies immediately, is shown in the user&apos;s history as an adjustment with your
          reason, and is recorded in the Activity Logs. Conversions to and from GigCash go through the Requests tab instead.
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
                <span>Available <b>{n(user.balance)}</b></span>
                <span>On hold <b>{n(user.heldPoints)}</b></span>
                <span>Processing <b>{n(user.pendingPoints)}</b></span>
                <span>GigCash <b>{fmtMoney(user.walletBalance, user.currencyCode)}</b></span>
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
        <button className={mode === "add" ? "active" : ""} onClick={() => setMode("add")} role="radio" aria-checked={mode === "add"}>Add points</button>
        <button className={mode === "remove" ? "active" : ""} onClick={() => setMode("remove")} role="radio" aria-checked={mode === "remove"}>Remove points</button>
      </div>

      <div>
        <label className="gp-label">Points</label>
        <input className="gp-input" type="number" min={1} step={1} inputMode="numeric" style={{ maxWidth: 220 }}
          value={points} onChange={(e) => setPoints(e.target.value)} />
        {points.trim() !== "" && !validPts && <div className="gp-error" style={{ marginTop: 6 }}>Enter a whole number from 1 to 100,000.</div>}
        {short && <div className="gp-error" style={{ marginTop: 6 }}>{user!.name} only has {n(user!.balance)} available points.</div>}
      </div>
      <div>
        <label className="gp-label">Reason (shown to the user)</label>
        <textarea className="gp-textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Points for a gig that wasn't recorded" />
      </div>
      <div>
        <Button icon={mode === "add" ? Plus : Minus} variant={mode === "add" ? "primary" : "danger"} disabled={!ready} onClick={() => setConfirm(true)}>
          {mode === "add" ? "Add points" : "Remove points"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={run}
        title={`${mode === "add" ? "Add" : "Remove"} ${n(pts)} points?`}
        message={user ? `${user.name}'s balance goes from ${n(user.balance)} to ${n(user.balance + (mode === "add" ? pts : -pts))}. Reason: “${reason.trim()}”.` : ""}
        confirmLabel={mode === "add" ? "Add points" : "Remove points"}
        danger={mode === "remove"}
        loading={busy}
      />
    </div>
  );
}
