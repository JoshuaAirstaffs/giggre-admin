"use client";

import { useState } from "react";
import { Search, Trash2, UserRound } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { writeLog } from "@/lib/activitylog";
import { useAuth } from "@/context/AuthContext";
import type { HostGig, HostGigsResult } from "@/app/api/admin/bulk-gigs/host-gigs/route";

async function call<T extends object>(body: object): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/admin/bulk-gigs/host-gigs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<T>(res);
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data;
}

const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

type DeleteResult = {
  deleted: { id: string; title: string }[];
  skipped: { id: string; title: string; reason: string }[];
  failed: { id: string; title: string; error: string }[];
};

/**
 * Find one host by exact email / user ID, tick their gigs, delete them.
 * Only that host's gigs are ever shown, so other accounts can't be hit.
 */
export default function DeleteHostGigs() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<HostGigsResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const search = async (value = query) => {
    const v = value.trim();
    if (!v || searching) return;
    setSearching(true);
    try {
      const r = await call<HostGigsResult>({ action: "search", host: v });
      setResult(r);
      setSelected(new Set());
    } catch (e: any) {
      setResult(null);
      setSelected(new Set());
      toast.error("Host not found", e.message);
    } finally {
      setSearching(false);
    }
  };

  const gigs = result?.gigs ?? [];
  const deletable = gigs.filter((g) => !g.blocked);
  const chosen = deletable.filter((g) => selected.has(g.id));
  const allOn = deletable.length > 0 && chosen.length === deletable.length;

  const toggle = (g: HostGig) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(g.id)) n.delete(g.id); else n.add(g.id);
      return n;
    });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(deletable.map((g) => g.id)));

  const runDelete = async () => {
    if (!result || chosen.length === 0 || deleting) return;
    setDeleting(true);
    try {
      const r = await call<DeleteResult>({ action: "delete", hostId: result.host.id, gigIds: chosen.map((g) => g.id) });
      const n = r.deleted.length;
      if (n > 0) {
        toast.success(`${n} gig${n === 1 ? "" : "s"} deleted`, r.skipped.length ? `${r.skipped.length} kept because someone acted on them meanwhile.` : undefined);
        if (user) {
          await writeLog({
            actorId: user.uid,
            actorName: user.displayName ?? user.email ?? "Admin",
            actorEmail: user.email ?? undefined,
            module: "gig_management",
            action: "gig_deleted",
            description: `Deleted ${n} Open Gig${n === 1 ? "" : "s"} of ${result.host.name || result.host.email || result.host.id}`,
            targetId: result.host.id,
            targetName: result.host.email || result.host.name || result.host.id,
            meta: { other: { hostId: result.host.id, deleted: r.deleted, skipped: r.skipped, failed: r.failed } },
          }).catch(() => {});
        }
      } else {
        toast.error("Nothing deleted", r.skipped[0]?.reason ? `Kept: ${r.skipped[0].reason}` : undefined);
      }
      if (r.failed.length) toast.error(`${r.failed.length} couldn't be deleted`, r.failed[0].error);
      setConfirmOpen(false);
      await search(result.host.email || result.host.id);
    } catch (e: any) {
      toast.error("Delete failed", e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-card">
      <style>{`
        .dh-title { font-size: 14px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 7px; }
        .dh-search { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .dh-input { flex: 1; min-width: 220px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--bg-elevated); color: var(--text-muted); }
        .dh-input:focus-within { border-color: var(--blue); }
        .dh-input input { flex: 1; border: none; background: none; outline: none; padding: 8px 0; font: inherit; font-size: 13px; color: var(--text-primary); }
        .dh-host { display: flex; align-items: center; gap: 10px; margin: 16px 0 10px; flex-wrap: wrap; }
        .dh-host-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px; margin-right: auto; }
        .dh-table tr.off td { color: var(--text-muted); }
        .dh-table td:first-child, .dh-table th:first-child { width: 28px; }
        .dh-table input[type=checkbox] { accent-color: var(--blue); width: 15px; height: 15px; cursor: pointer; }
        .dh-table input[type=checkbox]:disabled { cursor: not-allowed; }
        .dh-list { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--text-secondary); max-height: 180px; overflow-y: auto; }
      `}</style>

      <div className="dh-title"><Trash2 size={15} /> Delete a host&apos;s gigs</div>
      <p className="bg-hint" style={{ marginTop: 6 }}>
        Enter the host&apos;s <b>exact email</b> or user ID. Only that account&apos;s Open Gigs are shown, so no one else&apos;s gigs can be deleted.
        Gigs that already have applicants or workers can&apos;t be deleted here. Cancel those from Live Gigs.
      </p>
      <form className="dh-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <label className="dh-input">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="host@example.com" aria-label="Host email or user ID" />
        </label>
        <Button type="submit" variant="secondary" size="sm" loading={searching} disabled={!query.trim() || searching}>Search</Button>
      </form>

      {result && (
        <>
          <div className="dh-host">
            <span className="dh-host-name">
              <UserRound size={15} /> {result.host.name || "(no name)"}
              <span className="bg-sub" style={{ marginTop: 0, fontWeight: 400 }}>{result.host.email || result.host.id}</span>
            </span>
            <span className="bg-chip">{gigs.length} gig{gigs.length === 1 ? "" : "s"}</span>
            {gigs.length - deletable.length > 0 && <span className="bg-chip">{gigs.length - deletable.length} in use</span>}
            <Button variant="danger" size="sm" icon={Trash2} disabled={chosen.length === 0 || deleting} onClick={() => setConfirmOpen(true)}>
              Delete {chosen.length || ""} selected
            </Button>
          </div>

          {gigs.length === 0 ? <div className="bg-sub">This host has no Open Gigs.</div> : (
            <div className="bg-scroll">
              <table className="bg-table dh-table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" checked={allOn} disabled={deletable.length === 0} onChange={toggleAll}
                        aria-label="Select all gigs that can be deleted" title="Select all that can be deleted" />
                    </th>
                    <th>Gig</th><th>Posted</th><th>Schedule</th><th>Location</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {gigs.map((g) => (
                    <tr key={g.id} className={g.blocked ? "off" : ""}>
                      <td>
                        <input type="checkbox" checked={selected.has(g.id)} disabled={!!g.blocked} onChange={() => toggle(g)}
                          aria-label={`Select ${g.title || "gig"}`} />
                      </td>
                      <td>
                        {g.title || "(no title)"}
                        {g.bulk && <span className="bg-tag">Bulk</span>}
                        <div className="bg-sub">{g.workers} worker{g.workers === 1 ? "" : "s"}</div>
                      </td>
                      <td>{when(g.createdAt)}</td>
                      <td>{g.scheduledAt ? when(g.scheduledAt) : "Flexible"}</td>
                      <td style={{ maxWidth: 240 }}>{g.address}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {g.blocked ? <span className="bg-muted">Kept: {g.blocked}</span> : <span className="bg-ok">Can be deleted</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        onConfirm={runDelete}
        loading={deleting}
        danger
        title={`Delete ${chosen.length} gig${chosen.length === 1 ? "" : "s"}?`}
        confirmLabel={`Delete ${chosen.length} gig${chosen.length === 1 ? "" : "s"}`}
        message={result ? `This permanently deletes these Open Gigs of ${result.host.name || result.host.email}. Workers will no longer see them. This can't be undone.` : ""}
      >
        <ul className="dh-list">
          {chosen.map((g) => <li key={g.id}>{g.title || "(no title)"}</li>)}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
