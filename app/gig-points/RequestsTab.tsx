"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Check, X, ArrowRight, Inbox } from "lucide-react";
import { db } from "@/lib/firebase";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import type { AdminUser } from "@/context/AuthContext";
import {
  REQUEST_TYPES, REQUEST_TYPE_LABEL, parseRequest, decideGigPointsRequest, callableError,
  type PointsRequest, type RequestStatus, type RequestType,
} from "@/lib/gigPoints";

const STATUS_FILTERS: { key: RequestStatus | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];
const STATUS_BADGE: Record<RequestStatus, "amber" | "green" | "red" | "gray"> = {
  pending: "amber", approved: "green", rejected: "red", cancelled: "gray",
};
const TYPE_BADGE: Record<RequestType, "green" | "orange" | "blue"> = {
  deposit: "green", withdraw: "orange", transfer: "blue",
};
const dt = (d: Date | null) =>
  d ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const n = (v: number) => v.toLocaleString();

/** What approving actually does, spelled out for the admin. */
const APPROVE_EFFECT: Record<RequestType, (r: PointsRequest) => string> = {
  deposit: (r) => `${n(r.points)} points will be added to ${r.userName}'s balance. Only approve once you've received their payment.`,
  withdraw: (r) => `The ${n(r.points)} held points will be removed for good. Only approve once you've paid ${r.userName} out.`,
  transfer: (r) => `The ${n(r.points)} held points will move from ${r.userName} to ${r.recipientName ?? "the recipient"}.`,
};

export default function RequestsTab({ user }: { user: AdminUser }) {
  const [status, setStatus] = useState<RequestStatus | "all">("pending");
  const [type, setType] = useState<RequestType | "all">("all");
  const [rows, setRows] = useState<PointsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ req: PointsRequest; decision: "approve" | "reject" } | null>(null);

  useEffect(() => {
    setLoading(true);
    const base = collection(db, "gig_points_requests");
    const q = status === "all"
      ? query(base, orderBy("createdAt", "desc"), limit(200))
      : query(base, where("status", "==", status), orderBy("createdAt", "desc"), limit(200));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => parseRequest(d.id, d.data())));
      setError(null);
      setLoading(false);
    }, (err) => {
      console.error("[GigPoints] requests listener", err);
      setError(err.code === "failed-precondition"
        ? "This view needs a Firestore index. Deploy firestore.indexes.json from giggre_app (or open the link in the browser console to create it), then reload."
        : err.code === "permission-denied"
          ? "Firestore rules don't allow reading gig_points_requests yet. Deploy firestore.rules from giggre_app, then reload."
          : `Couldn't load requests (${err.code ?? "unknown error"}).`);
      setLoading(false);
    });
  }, [status]);

  const visible = useMemo(() => (type === "all" ? rows : rows.filter((r) => r.type === type)), [rows, type]);

  return (
    <>
      <div className="gp-toolbar">
        {STATUS_FILTERS.map((f) => (
          <button key={f.key} className={`gp-chip ${status === f.key ? "active" : ""}`} onClick={() => setStatus(f.key)}>{f.label}</button>
        ))}
        <span className="gp-spacer" />
        <select className="gp-select" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value as RequestType | "all")}>
          <option value="all">All types</option>
          {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="gp-table-wrap">
        {loading ? <div className="gp-empty">Loading requests…</div>
          : error ? <div className="gp-empty" style={{ color: "var(--red)" }}>{error}</div>
          : visible.length === 0 ? (
            <div className="gp-empty">
              <Inbox size={22} style={{ marginBottom: 6, opacity: 0.6 }} /><br />
              {status === "pending" ? "No requests waiting for review." : "No requests here."}
            </div>
          ) : (
            <table className="gp-table">
              <thead>
                <tr>
                  <th>Requested</th><th>User</th><th>Type</th><th style={{ textAlign: "right" }}>Points</th>
                  <th>Details</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{dt(r.createdAt)}{r.source === "admin" && <div className="gp-sub">By admin</div>}</td>
                    <td>{r.userName}<div className="gp-sub">{r.userCode ?? r.userId}</div></td>
                    <td><Badge variant={TYPE_BADGE[r.type]}>{REQUEST_TYPE_LABEL[r.type]}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`gp-pts ${r.type === "deposit" ? "plus" : "minus"}`}>
                        {r.type === "deposit" ? "+" : "−"}{n(r.points)}
                      </span>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {r.type === "transfer" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <ArrowRight size={12} /> {r.recipientName}
                          <span className="gp-sub">{r.recipientCode}</span>
                        </div>
                      )}
                      {r.note && <div className="gp-sub" style={{ whiteSpace: "pre-wrap" }}>“{r.note}”</div>}
                      {r.status !== "pending" && (r.decisionNote || r.reference || r.decidedByName) && (
                        <div className="gp-sub" style={{ marginTop: 4 }}>
                          {r.status === "cancelled" ? "Cancelled by user" : `${r.decidedByName ?? "Admin"}, ${dt(r.decidedAt)}`}
                          {r.decisionNote && r.source !== "admin" ? ` — ${r.decisionNote}` : ""}
                          {r.reference ? ` · Ref ${r.reference}` : ""}
                        </div>
                      )}
                    </td>
                    <td><Badge variant={STATUS_BADGE[r.status] ?? "gray"} dot>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge></td>
                    <td>
                      {r.status === "pending" && (
                        <div className="gp-actions">
                          <Button size="sm" variant="success" icon={Check} onClick={() => setActing({ req: r, decision: "approve" })}>Approve</Button>
                          <Button size="sm" variant="ghost" icon={X} onClick={() => setActing({ req: r, decision: "reject" })}>Reject</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {visible.length >= 200 && <div className="gp-note" style={{ marginTop: 8 }}>Showing the newest 200.</div>}

      {acting && <DecisionModal key={acting.req.id} {...acting} user={user} onClose={() => setActing(null)} />}
    </>
  );
}

function DecisionModal({ req, decision, onClose }: { req: PointsRequest; decision: "approve" | "reject"; user: AdminUser; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<{ balance: number; held: number } | null>(null);
  const approve = decision === "approve";
  const label = REQUEST_TYPE_LABEL[req.type].toLowerCase();

  useEffect(() => {
    getDoc(doc(db, "gig_points", req.userId)).then((s) => {
      const d = s.data() ?? {};
      setBal({ balance: Number(d.balance) || 0, held: Number(d.heldPoints) || 0 });
    }).catch(() => setBal(null));
  }, [req.userId]);

  const canSubmit = !busy && (approve || note.trim().length >= 3);

  const submit = async () => {
    setBusy(true);
    try {
      await decideGigPointsRequest({
        requestId: req.id, decision,
        note: note.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      toast.success(approve ? `${REQUEST_TYPE_LABEL[req.type]} approved` : "Request rejected",
        approve ? "The user has been notified." : "The user has been notified and any held points returned.");
      onClose();
    } catch (err) {
      toast.error(approve ? "Couldn't approve" : "Couldn't reject", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} size="sm"
      title={approve ? `Approve ${label}?` : `Reject ${label}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={approve ? "success" : "danger"} icon={approve ? Check : X} loading={busy} disabled={!canSubmit} onClick={submit}>
            {approve ? "Approve" : "Reject"}
          </Button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <dl className="gp-summary">
          <dt>User</dt><dd>{req.userName} {req.userCode && <span className="gp-sub">({req.userCode})</span>}</dd>
          <dt>Type</dt><dd>{REQUEST_TYPE_LABEL[req.type]}</dd>
          <dt>Points</dt><dd className="gp-pts">{n(req.points)}</dd>
          {req.type === "transfer" && <><dt>To</dt><dd>{req.recipientName} {req.recipientCode && <span className="gp-sub">({req.recipientCode})</span>}</dd></>}
          {req.note && <><dt>User note</dt><dd style={{ whiteSpace: "pre-wrap" }}>{req.note}</dd></>}
          <dt>Balance</dt><dd>{bal ? `${n(bal.balance)} available · ${n(bal.held)} on hold` : "…"}</dd>
        </dl>
        <div className="gp-note">
          {approve ? APPROVE_EFFECT[req.type](req)
            : `${req.userName} will be told why.${req.type !== "deposit" ? ` The ${n(req.points)} held points go back to their balance.` : ""}`}
        </div>
        {approve && req.type !== "transfer" && (
          <div>
            <label className="gp-label">{req.type === "deposit" ? "Payment reference (optional)" : "Payout reference (optional)"}</label>
            <input className="gp-input" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. GCash ref no." disabled={busy} />
          </div>
        )}
        <div>
          <label className="gp-label">{approve ? "Note (optional, internal)" : "Reason (shown to the user)"}</label>
          <textarea className="gp-textarea" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
            placeholder={approve ? "" : "e.g. Payment not received"} />
        </div>
      </div>
    </Modal>
  );
}
