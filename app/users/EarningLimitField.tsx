"use client";

import { useFx, phpHint } from "@/lib/fx";
import { fmtMoney } from "@/lib/gigPoints";
import { RESET_LABEL, useUnverifiedLimit } from "@/lib/unverifiedLimit";

// "Earning Limit" field in the Users tab's expanded row: how much of the
// unverified-account limit (Settings → Unverified Account Limit) this user
// has used in the current period. Same colours as the app:
// green < 50%, yellow 50–79%, red 80%+.
export default function EarningLimitField({ uid, isVerified }: { uid: string; isVerified: string | null }) {
  const fx = useFx();
  const u = useUnverifiedLimit(uid);

  const wrap = (body: React.ReactNode) => (
    <div className="exp-field" style={{ gridColumn: "span 2", minWidth: 0 }}>
      <span className="exp-label">Earning Limit</span>
      {body}
    </div>
  );

  if (u.loading) return wrap(<span className="exp-value" style={{ color: "var(--text-muted)" }}>Loading…</span>);
  if (isVerified === "verified") return wrap(<span className="exp-value" style={{ color: "var(--green)" }}>Verified — no limit</span>);
  const max = u.config?.enabled ? u.config.maxUsd : null;
  if (!max) return wrap(<span className="exp-value" style={{ color: "var(--text-muted)" }}>Off — no limit set</span>);

  const pct = Math.min(u.usedUsd / max, 1);
  const reached = u.usedUsd >= max - 0.005;
  const color = pct >= 0.8 ? "#E5484D" : pct >= 0.5 ? "#F5C518" : "#2BB673";
  const php = phpHint(u.usedUsd, fx);
  const reset = u.config ? RESET_LABEL[u.config.resetPeriod] : null;

  return wrap(
    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 420 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
        <span className="exp-value" style={{ fontWeight: 600 }}>
          {fmtMoney(u.usedUsd)} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/ {fmtMoney(max)}{php ? ` · ${php}` : ""}</span>
        </span>
        <span style={{ color, fontWeight: 700, fontSize: 12 }}>{reached ? "Limit reached" : `${Math.floor(pct * 100)}%`}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: `${color}26`, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Worker {fmtMoney(u.workerUsd)} · Host {fmtMoney(u.hostUsd)} · {u.gigs} gig{u.gigs === 1 ? "" : "s"}{reset ? ` · ${reset}` : ""}
      </span>
    </div>,
  );
}
