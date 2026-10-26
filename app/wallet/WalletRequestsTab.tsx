"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ArrowRight, Check, ExternalLink, Inbox, X } from "lucide-react";
import { db } from "@/lib/firebase";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { callableError } from "@/lib/gigPoints";
import {
  WALLET_TYPES, WALLET_TYPE_LABEL, parseWalletRequest, decideWalletRequest, fmtMoney, refLabel,
  type WalletRequest, type WalletStatus, type WalletType,
} from "@/lib/wallet";

const STATUS_FILTERS: { key: WalletStatus | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];
const STATUS_BADGE: Record<WalletStatus, "amber" | "green" | "red" | "gray"> = {
  pending: "amber", approved: "green", rejected: "red", cancelled: "gray",
};
const TYPE_BADGE: Record<WalletType, "green" | "blue"> = { deposit: "green", transfer: "blue" };
const dt = (d: Date | null) =>
  d ? d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default function WalletRequestsTab() {
  const [status, setStatus] = useState<WalletStatus | "all">("pending");
  const [type, setType] = useState<WalletType | "all">("all");
  const [rows, setRows] = useState<WalletRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<{ req: WalletRequest; decision: "approve" | "reject" } | null>(null);

  useEffect(() => {
    setLoading(true);
    const base = collection(db, "wallet_requests");
    const q = status === "all"
      ? query(base, orderBy("createdAt", "desc"), limit(200))
      : query(base, where("status", "==", status), orderBy("createdAt", "desc"), limit(200));
    return onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => parseWalletRequest(d.id, d.data())));
      setError(null);
      setLoading(false);
    }, (err) => {
      console.error("[Wallet] requests listener", err);
      setError(err.code === "failed-precondition"
        ? "This view needs a Firestore index. Deploy firestore.indexes.json from giggre_app, then reload."
        : err.code === "permission-denied"
          ? "Firestore rules don't allow reading wallet_requests yet. Deploy firestore.rules from giggre_app, then reload."
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
        <select className="gp-select" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value as WalletType | "all")}>
          <option value="all">All types</option>
          {WALLET_TYPES.map((t) => <option key={t} value={t}>{WALLET_TYPE_LABEL[t]}</option>)}
        </select>
      </div>

      <div className="gp-table-wrap">
        {loading ? <div className="gp-empty">Loading requests…</div>
          : error ? <div className="gp-empty" style={{ color: "var(--red)" }}>{error}</div>
          : visible.length === 0 ? (
            <div className="gp-empty">
              <Inbox size={22} style={{ marginBottom: 6, opacity: 0.6 }} /><br />
              {status === "pending" ? "No wallet requests waiting for review." : "No requests here."}
            </div>
          ) : (
            <table className="gp-table">
              <thead>
                <tr>
                  <th>Requested</th><th>User</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th>
                  <th>Details</th><th>Status</th><th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{dt(r.createdAt)}</td>
                    <td>{r.userName}<div className="gp-sub">{r.userCode ?? r.userId}</div></td>
                    <td><Badge variant={TYPE_BADGE[r.type]}>{WALLET_TYPE_LABEL[r.type]}</Badge></td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`gp-pts ${r.type === "deposit" ? "plus" : "minus"}`}>{fmtMoney(r.amount, r.currencyCode)}</span>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      {r.type === "deposit" && (
                        <div>
                          {r.method ?? "Manual"} · {refLabel(r.methodKind)} <b>{r.reference ?? "—"}</b>
                          {r.proofUrl && (
                            <a href={r.proofUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "var(--blue)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              Proof <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      )}
                      {r.type === "transfer" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <ArrowRight size={12} /> {r.recipientName} <span className="gp-sub">{r.recipientCode}</span>
                          {r.recipientCurrency && r.recipientCurrency !== r.currencyCode && r.recipientAmount != null && (
                            <span className="gp-sub">· gets {fmtMoney(r.recipientAmount, r.recipientCurrency)}</span>
                          )}
                        </div>
                      )}
                      {r.note && <div className="gp-sub" style={{ whiteSpace: "pre-wrap" }}>“{r.note}”</div>}
                      {r.status !== "pending" && (
                        <div className="gp-sub" style={{ marginTop: 4 }}>
                          {r.status === "cancelled" ? "Cancelled by user" : `${r.decidedByName ?? "Admin"}, ${dt(r.decidedAt)}`}
                          {r.decisionNote ? ` — ${r.decisionNote}` : ""}
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

      {acting && <DecisionModal key={acting.req.id} {...acting} onClose={() => setActing(null)} />}
    </>
  );
}

function DecisionModal({ req, decision, onClose }: { req: WalletRequest; decision: "approve" | "reject"; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState<number | null>(null);
  const approve = decision === "approve";
  const amt = fmtMoney(req.amount, req.currencyCode);

  useEffect(() => {
    getDoc(doc(db, "wallets", req.userId)).then((s) => setBal(Number(s.data()?.balance) || 0)).catch(() => setBal(null));
  }, [req.userId]);

  const submit = async () => {
    setBusy(true);
    try {
      await decideWalletRequest({ requestId: req.id, decision, note: note.trim() || undefined });
      toast.success(approve ? `${WALLET_TYPE_LABEL[req.type]} approved` : "Request rejected", "The user has been notified.");
      onClose();
    } catch (err) {
      toast.error(approve ? "Couldn't approve" : "Couldn't reject", callableError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} size="sm"
      title={approve ? `Approve ${WALLET_TYPE_LABEL[req.type].toLowerCase()}?` : `Reject ${WALLET_TYPE_LABEL[req.type].toLowerCase()}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={approve ? "success" : "danger"} icon={approve ? Check : X} loading={busy}
            disabled={busy || (!approve && note.trim().length < 3)} onClick={submit}>
            {approve ? "Approve" : "Reject"}
          </Button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <dl className="gp-summary">
          <dt>User</dt><dd>{req.userName} {req.userCode && <span className="gp-sub">({req.userCode})</span>}</dd>
          <dt>Type</dt><dd>{WALLET_TYPE_LABEL[req.type]}</dd>
          <dt>Amount</dt><dd className="gp-pts">{amt}</dd>
          {req.type === "deposit" && <><dt>Paid via</dt><dd>{req.method ?? "Manual"}</dd><dt>{refLabel(req.methodKind)}</dt><dd>{req.reference ?? "—"}</dd></>}
          {req.proofUrl && <><dt>Proof</dt><dd><a href={req.proofUrl} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>Open screenshot</a></dd></>}
          {req.type === "transfer" && <><dt>To</dt><dd>{req.recipientName} {req.recipientCode && <span className="gp-sub">({req.recipientCode})</span>}</dd></>}
          {req.type === "transfer" && req.recipientCurrency && req.recipientCurrency !== req.currencyCode && req.recipientAmount != null && (
            <><dt>They get</dt><dd className="gp-pts">{fmtMoney(req.recipientAmount, req.recipientCurrency)} <span className="gp-sub">(converted at request)</span></dd></>
          )}
          {req.note && <><dt>User note</dt><dd style={{ whiteSpace: "pre-wrap" }}>{req.note}</dd></>}
          <dt>GigCash</dt><dd>{bal == null ? "…" : fmtMoney(bal, req.currencyCode)}</dd>
        </dl>
        <div className="gp-note">
          {approve
            ? req.type === "deposit"
              ? `${amt} will be added to ${req.userName}'s Gig Wallet. ${req.methodKind === "office" ? `Only approve after checking the cash was received with ${refLabel(req.methodKind)} ${req.reference ?? "—"}.` : req.methodKind === "remittance" ? `Only approve after you've claimed the remittance with ${refLabel(req.methodKind)} ${req.reference ?? "—"}.` : `Only approve after you've confirmed the payment with reference ${req.reference ?? "—"} arrived.`}`
              : `The ${amt} already on hold will be sent to ${req.recipientName ?? "the recipient"}.`
            : `${req.userName} will be told why.${req.type === "transfer" ? ` ${amt} is refunded to their Gig Wallet.` : ""}`}
        </div>
        <div>
          <label className="gp-label">{approve ? "Note (optional, internal)" : "Reason (shown to the user)"}</label>
          <textarea className="gp-textarea" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}
            placeholder={approve ? "" : "e.g. Payment not received"} />
        </div>
      </div>
    </Modal>
  );
}
