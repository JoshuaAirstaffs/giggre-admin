"use client";

import { useState } from "react";
import { Search, Send, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import {
  REQUEST_TYPES, REQUEST_TYPE_LABEL, adminFindGigPointsUser, adminGigPointsAction, callableError,
  type FoundUser, type RequestType,
} from "@/lib/gigPoints";

const n = (v: number) => v.toLocaleString();

function UserPicker({ label, value, onChange, excludeUid }: {
  label: string; value: FoundUser | null; onChange: (u: FoundUser | null) => void; excludeUid?: string;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const find = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const u = await adminFindGigPointsUser({ query: q.trim() });
      if (excludeUid && u.uid === excludeUid) {
        toast.error("Pick a different user", "The recipient can't be the same as the sender.");
      } else {
        onChange(u);
      }
    } catch (err) {
      toast.error("User not found", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="gp-label">{label}</label>
      {value ? (
        <div className="gp-user">
          {value.photoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="gp-avatar" src={value.photoUrl} alt="" />
            : <span className="gp-avatar">{value.name[0]?.toUpperCase()}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{value.name}</div>
            <div className="gp-sub">{[value.code, value.phone, value.email].filter(Boolean).join(" · ")}</div>
            <div className="gp-stats" style={{ marginTop: 6 }}>
              <span>Available <b>{n(value.balance)}</b></span>
              <span>On hold <b>{n(value.heldPoints)}</b></span>
              <span>Processing <b>{n(value.pendingPoints)}</b></span>
              <span>Lifetime <b>{n(value.lifetimeEarned)}</b></span>
            </div>
          </div>
          <Button size="sm" variant="ghost" icon={X} onClick={() => onChange(null)}>Change</Button>
        </div>
      ) : (
        <div className="gp-search">
          <input className="gp-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Giggre ID (e.g. ABC123456) or phone number"
            onKeyDown={(e) => e.key === "Enter" && find()} disabled={busy} />
          <Button size="sm" variant="secondary" icon={Search} loading={busy} onClick={find} disabled={!q.trim()}>Find</Button>
        </div>
      )}
    </div>
  );
}

export default function ManualTab() {
  const [action, setAction] = useState<RequestType>("deposit");
  const [from, setFrom] = useState<FoundUser | null>(null);
  const [to, setTo] = useState<FoundUser | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const pts = Number(points);
  const validPts = points.trim() !== "" && Number.isInteger(pts) && pts > 0 && pts <= 1_000_000;
  const short = action !== "deposit" && from && validPts && pts > from.balance;
  const ready = !!from && validPts && !short && reason.trim().length >= 3 && (action !== "transfer" || !!to);

  const summary = !from ? "" : action === "deposit"
    ? `Add ${n(pts)} points to ${from.name}. Their balance becomes ${n(from.balance + pts)}.`
    : action === "withdraw"
      ? `Remove ${n(pts)} points from ${from.name}. Their balance becomes ${n(from.balance - pts)}.`
      : `Move ${n(pts)} points from ${from.name} to ${to?.name}.`;

  const run = async () => {
    if (!from) return;
    setBusy(true);
    try {
      const res = await adminGigPointsAction({ action, userId: from.uid, toUserId: to?.uid, points: pts, reason: reason.trim() });
      toast.success(`${REQUEST_TYPE_LABEL[action]} done`, `${from.name}'s balance is now ${n(res.balance)}. They've been notified.`);
      setFrom({ ...from, balance: res.balance });
      if (to && action === "transfer") setTo({ ...to, balance: to.balance + pts });
      setPoints("");
      setReason("");
      setConfirm(false);
    } catch (err) {
      toast.error(`${REQUEST_TYPE_LABEL[action]} failed`, callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gp-card" style={{ maxWidth: 720 }}>
      <div>
        <div className="gp-title">Manual action</div>
        <div className="gp-hint">
          Applies immediately, without a request or limits. Use it for cash settled in person, support corrections, or moving points between accounts.
          The user is notified and it&apos;s recorded in their history and the Activity Logs.
        </div>
      </div>
      <div className="gp-seg" role="radiogroup">
        {REQUEST_TYPES.map((t) => (
          <button key={t} className={action === t ? "active" : ""} onClick={() => setAction(t)} role="radio" aria-checked={action === t}>
            {REQUEST_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <UserPicker label={action === "transfer" ? "From" : "User"} value={from} onChange={setFrom} />
      {action === "transfer" && <UserPicker label="To" value={to} onChange={setTo} excludeUid={from?.uid} />}
      <div>
        <label className="gp-label">Points</label>
        <input className="gp-input" type="number" min={1} step={1} inputMode="numeric" style={{ maxWidth: 220 }}
          value={points} onChange={(e) => setPoints(e.target.value)} />
        {points.trim() !== "" && !validPts && <div className="gp-error" style={{ marginTop: 6 }}>Enter a whole number from 1 to 1,000,000.</div>}
        {short && <div className="gp-error" style={{ marginTop: 6 }}>{from!.name} only has {n(from!.balance)} available points.</div>}
      </div>
      <div>
        <label className="gp-label">Reason (shown to the user)</label>
        <textarea className="gp-textarea" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Cash deposit received at the office, OR #1234" />
      </div>
      <div>
        <Button icon={Send} disabled={!ready} onClick={() => setConfirm(true)}>{REQUEST_TYPE_LABEL[action]} points</Button>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={run}
        title={`${REQUEST_TYPE_LABEL[action]} ${n(pts)} points?`}
        message={`${summary} Reason: “${reason.trim()}”. This can't be undone, only reversed by another action.`}
        confirmLabel={REQUEST_TYPE_LABEL[action]}
        danger={action !== "deposit"}
        loading={busy}
      />
    </div>
  );
}
