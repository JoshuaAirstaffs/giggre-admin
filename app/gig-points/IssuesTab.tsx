"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { CheckCircle2, RotateCw } from "lucide-react";
import { db } from "@/lib/firebase";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";
import { retryGigPointsAwards, callableError } from "@/lib/gigPoints";

interface Issue {
  id: string; code: string; gigType: string | null; detail: string; status: "open" | "resolved";
  occurrences: number; lastSeenAt: Date | null; lastTask: { gigTitle?: string } | null;
}

const CODE_LABEL: Record<string, string> = {
  missing_type_reward: "No reward set for gig type",
  invalid_type_reward: "Invalid gig type reward",
  invalid_task_reward: "Invalid per-task reward",
};

export default function IssuesTab() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, "gig_points_config_issues"), orderBy("lastSeenAt", "desc"), limit(100)),
    (snap) => {
      setIssues(snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id, code: x.code ?? "", gigType: x.gigType ?? null, detail: x.detail ?? "",
          status: x.status === "resolved" ? "resolved" : "open", occurrences: Number(x.occurrences) || 0,
          lastSeenAt: (x.lastSeenAt as Timestamp | undefined)?.toDate?.() ?? null, lastTask: x.lastTask ?? null,
        };
      }));
      setLoading(false);
    },
    (err) => { console.error("[GigPoints] issues", err); setLoading(false); },
  ), []);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const r = await retryGigPointsAwards({ issueId: id });
      toast.success("Retry finished", `${r.awarded} credited · ${r.pending} pending · ${r.stillBlocked} still blocked · ${r.notApplicable} no longer applicable`);
    } catch (err) {
      toast.error("Retry failed", callableError(err));
    } finally {
      setRetrying(null);
    }
  };

  if (loading) return <div className="gp-empty">Loading…</div>;
  const open = issues.filter((i) => i.status === "open");

  return (
    <>
      <div className="gp-note" style={{ marginBottom: 12 }}>
        When a finished task has no valid reward, its points are held back and listed here. Fix the reward on the
        <b> Earning rewards</b> tab (or on the gig), then press <b>Retry</b> to award the held tasks.
      </div>
      {open.length === 0 && (
        <div className="gp-card" style={{ alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 14 }}>
          <CheckCircle2 size={18} color="var(--green)" /> No open issues.
        </div>
      )}
      <div className="gp-table-wrap">
        {issues.length > 0 && (
          <table className="gp-table" style={{ minWidth: 720 }}>
            <thead><tr><th>Issue</th><th>Details</th><th>Seen</th><th>Status</th><th /></tr></thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>{CODE_LABEL[i.code] ?? i.code}<div className="gp-sub">{i.gigType ?? i.id}</div></td>
                  <td style={{ maxWidth: 340 }}>{i.detail}{i.lastTask?.gigTitle && <div className="gp-sub">Last: {i.lastTask.gigTitle}</div>}</td>
                  <td>{i.occurrences}×<div className="gp-sub">{i.lastSeenAt?.toLocaleString() ?? "—"}</div></td>
                  <td><Badge variant={i.status === "open" ? "red" : "green"} dot>{i.status === "open" ? "Open" : "Resolved"}</Badge></td>
                  <td style={{ textAlign: "right" }}>
                    {i.status === "open" && (
                      <Button size="sm" variant="secondary" icon={RotateCw} loading={retrying === i.id} disabled={!!retrying} onClick={() => retry(i.id)}>Retry</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
