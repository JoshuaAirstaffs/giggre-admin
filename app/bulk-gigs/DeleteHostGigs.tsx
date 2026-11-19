"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Info, ShieldCheck, Trash2, Upload, UserX, Users } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { writeLog } from "@/lib/activitylog";
import { readFirstSheet } from "@/lib/bulkGigs";
import { downloadGigSheet, parseGigTable } from "@/lib/gigSheet";
import { useAuth } from "@/context/AuthContext";
import { HostPicker, MAX_HOSTS } from "./bulkUi";
import type { HostGigsResult, HostLookup } from "@/app/api/admin/bulk-gigs/host-gigs/route";


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

const key = (q: string) => q.trim().toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type DeleteResult = {
  deleted: { id: string; title: string; hostId: string }[];
  skipped: { id: string; title: string; reason: string }[];
  failed: { id: string; title: string; error: string }[];
};

type UploadInfo = { name: string; marked: number; blank: number; issues: string[] };

/**
 * Pick several hosts by exact email / user ID, then delete their untouched
 * Open Gigs: tick them here, or download an Excel sheet, type "delete" in the
 * Action column and upload it. Only the chosen hosts' gigs are ever listed.
 */
export default function DeleteHostGigs() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<HostGigsResult | null>(null);
  /** Ticked hosts (by user id): all their deletable gigs get deleted. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** An uploaded sheet: only the gigs marked "delete" in it get deleted. */
  const [upload, setUpload] = useState<(UploadInfo & { ids: Set<string> }) | null>(null);
  /** "hosts": delete everything deletable of the ticked hosts. "excel": only gigs marked in a sheet. */
  const [mode, setMode] = useState<"hosts" | "excel">("hosts");
  const [dragOver, setDragOver] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const lookupFor = (entry: string): HostLookup | undefined =>
    result?.hosts.find((h) => key(h.query) === key(entry));

  /** Looks the hosts up again and lists their deletable gigs; returns the result (null on error). */
  const search = async (list = entries, opts: { force?: boolean } = {}): Promise<HostGigsResult | null> => {
    if (searching && !opts.force) return null;
    const hosts = list;
    if (hosts.length === 0) return null;
    setSearching(true);
    try {
      const r = await call<HostGigsResult>({ action: "search", hosts });
      setResult(r);
      setSelected(new Set());
      setUpload(null);
      const missing = r.hosts.filter((h) => !h.host).length;
      if (missing) toast.warning(`${missing} host${missing === 1 ? "" : "s"} not found`, "Check the emails marked in red.");
      return r;
    } catch (e: any) {
      toast.error("Search failed", e.message);
      return null;
    } finally {
      setSearching(false);
    }
  };

  const removeEntry = (entry: string) => {
    setEntries((list) => list.filter((e) => e !== entry));
    const hostId = lookupFor(entry)?.host?.id;
    setResult((r) => {
      if (!r) return r;
      const hosts = r.hosts.filter((h) => key(h.query) !== key(entry));
      // Another chip may point at the same account (email + user ID).
      const stillChosen = hosts.some((h) => h.host?.id === hostId);
      return { hosts, gigs: hostId && !stillChosen ? r.gigs.filter((g) => g.hostId !== hostId) : r.gigs };
    });
    if (hostId) setSelected((s) => { const n = new Set(s); n.delete(hostId); return n; });
    setUpload(null);
  };

  const gigs = result?.gigs ?? [];
  const foundHosts = new Map<string, NonNullable<HostLookup["host"]>>();
  for (const h of result?.hosts ?? []) if (h.host) foundHosts.set(h.host.id, h.host);
  const hostLabel = (id: string) => foundHosts.get(id)?.email || foundHosts.get(id)?.name || id;
  /** One row per found host (an account typed twice is listed once). */
  const hostRows = [...foundHosts.values()].map((h) => {
    const lookups = (result?.hosts ?? []).filter((l) => l.host?.id === h.id);
    const own = gigs.filter((g) => g.hostId === h.id);
    return {
      host: h,
      deletable: own.length,
      inUse: lookups.reduce((n, l) => n + l.inUse, 0),
      marked: upload ? own.filter((g) => upload.ids.has(g.id)).length : 0,
    };
  });
  const selectable = hostRows.filter((r) => r.deletable > 0);
  // With a sheet uploaded, only its marked gigs; otherwise every gig of the ticked hosts.
  const chosen = mode === "excel"
    ? (upload ? gigs.filter((g) => upload.ids.has(g.id)) : [])
    : gigs.filter((g) => selected.has(g.hostId));
  const chosenHosts = new Set(chosen.map((g) => g.hostId)).size;
  const notFound = (result?.hosts ?? []).filter((h) => !h.host);
  const kept = hostRows.reduce((n, r) => n + r.inUse, 0);
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.host.id));

  const toggle = (hostId: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(hostId)) n.delete(hostId); else n.add(hostId);
      return n;
    });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.host.id)));

  // ── Excel ────────────────────────────────────────────────────────────────

  const downloadSheet = async () => {
    if (gigs.length === 0) return;
    // Same workbook format as Post / Edit, plus the Action column.
    await downloadGigSheet("delete", gigs);
  };

  /**
   * Reads an edited sheet. The file is self-contained: its Host email column
   * says whose gigs it lists, so after a reload / re-login the hosts are looked
   * up again from the file and the marks still apply (against fresh data, so a
   * gig someone applied to in the meantime is reported, not deleted).
   */
  const readSheet = async (file: File) => {
    setReadingFile(true);
    try {
      const sheet = await readFirstSheet(file, "Gigs");
      const table = parseGigTable(sheet, ["gigId", "action"]);

      // Hosts named in the file (only rows marked delete matter).
      const fileHosts = new Set<string>();
      for (const r of table.rows) {
        const h = r.text("host");
        if (h && r.text("action")) fileHosts.add(h);
      }
      let current = result;
      const knownEmails = new Set([...foundHosts.values()].flatMap((h) => [key(h.email), key(h.id)]).filter(Boolean));
      const newHosts = [...fileHosts].filter((h) => !knownEmails.has(key(h)));
      if (!current || newHosts.length > 0) {
        if (fileHosts.size === 0) {
          throw new Error("Find the hosts first (the file has no Host email column to look them up from).");
        }
        // Merge with what's already typed so nothing the admin added is lost.
        const merged = [...entries];
        for (const h of fileHosts) if (!merged.some((e) => key(e) === key(h))) merged.push(h);
        if (merged.length > MAX_HOSTS) throw new Error(`The file and the search together have more than ${MAX_HOSTS} hosts. Remove some hosts and try again.`);
        setEntries(merged);
        current = await search(merged, { force: true });
        if (!current) return;
        if (!knownEmails.size) toast.info("Hosts loaded from the file", `${plural(fileHosts.size, "host")} looked up again, so you can carry on where you left off.`);
      }
      const freshGigs = current.gigs;

      const byId = new Map(freshGigs.map((g) => [g.id, g]));
      const marked = new Set<string>();
      const issues: string[] = [];
      let blank = 0;
      table.rows.forEach((r) => {
        const row = r.n;
        const id = r.text("gigId");
        const action = r.text("action").toLowerCase();
        if (!id && !action) return;
        if (!action) { blank++; return; }
        if (action !== "delete") { issues.push(`Row ${row}: Action must be blank or "delete" (found "${r.text("action")}").`); return; }
        if (!id) { issues.push(`Row ${row}: Gig ID is missing.`); return; }
        if (!byId.has(id)) {
          issues.push(`Row ${row}: gig ${id} can't be deleted any more (already deleted, someone applied, or another host).`);
          return;
        }
        marked.add(id);
      });

      setMode("excel");
      setUpload({ name: file.name, marked: marked.size, blank, issues, ids: marked });
      if (marked.size === 0) toast.warning("No gigs marked", issues.length ? "See the problems listed." : "Type \"delete\" in the Action column of the gigs to remove.");
      else toast.success(`${marked.size} gig${marked.size === 1 ? "" : "s"} marked in the sheet`, "Check the counts per host, then click Delete.");
    } catch (e: any) {
      toast.error("Couldn't read the file", e.message);
    } finally {
      setReadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────

  const runDelete = async () => {
    if (!result || chosen.length === 0 || deleting) return;
    setDeleting(true);
    try {
      const r = await call<DeleteResult>({
        action: "delete",
        hostIds: [...foundHosts.keys()],
        gigIds: chosen.map((g) => g.id),
      });
      const n = r.deleted.length;
      if (n > 0) {
        toast.success(`${n} gig${n === 1 ? "" : "s"} deleted`, r.skipped.length ? `${r.skipped.length} kept because someone acted on them meanwhile.` : undefined);
        if (user) {
          const hostIds = [...new Set(r.deleted.map((d) => d.hostId))];
          await writeLog({
            actorId: user.uid,
            actorName: user.displayName ?? user.email ?? "Admin",
            actorEmail: user.email ?? undefined,
            module: "gig_management",
            action: "gig_deleted",
            description: `Deleted ${n} Open Gig${n === 1 ? "" : "s"} of ${hostIds.length} host${hostIds.length === 1 ? "" : "s"}: ${hostIds.map(hostLabel).join(", ")}`,
            targetId: hostIds.length === 1 ? hostIds[0] : undefined,
            targetName: hostIds.length === 1 ? hostLabel(hostIds[0]) : `${hostIds.length} hosts`,
            meta: { other: { hostIds, source: upload ? `excel:${upload.name}` : "manual", deleted: r.deleted, skipped: r.skipped, failed: r.failed } },
          }).catch(() => {});
        }
      } else {
        toast.error("Nothing deleted", r.skipped[0]?.reason ? `Kept: ${r.skipped[0].reason}` : undefined);
      }
      if (r.failed.length) toast.error(`${r.failed.length} couldn't be deleted`, r.failed[0].error);
      setConfirmOpen(false);
      await search(entries);
    } catch (e: any) {
      toast.error("Delete failed", e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dh">

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readSheet(f); }} />

      {/* ── Step 1: hosts ─────────────────────────────────────────────── */}
      <section className="dh-step">
        <div className="dh-head">
          <span className="dh-num">1</span>
          <div className="txt">
            <h3>Find the hosts</h3>
            <p>Enter each host&apos;s <b>exact email</b> or user ID. Only these accounts&apos; gigs can be deleted, so no one else is affected.</p>
          </div>
        </div>
        <HostPicker
          entries={entries}
          onChange={setEntries}
          onRemove={removeEntry}
          statusOf={(e) => { const l = lookupFor(e); return l ? (l.host ? "ok" : "bad") : undefined; }}
          onSearch={(list) => search(list)}
          searching={searching}
        />
        <div className="dh-tip" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ marginRight: "auto" }}>Press Enter or comma after each email, or paste a list. Up to {MAX_HOSTS} hosts.</span>
          <button type="button" className="dh-link" disabled={readingFile} onClick={() => fileRef.current?.click()}
            title="Continue with an Excel you downloaded earlier, even after reloading the page or signing in again">
            <Upload size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            {readingFile ? "Reading file…" : "Already have an edited Excel? Upload it"}
          </button>
        </div>
      </section>

      {/* ── Step 2: what to delete ────────────────────────────────────── */}
      {result && (
        <section className="dh-step">
          <div className="dh-head">
            <span className="dh-num">2</span>
            <div className="txt">
              <h3>Choose what to delete</h3>
              <p>
                {plural(gigs.length, "gig")} can be deleted across {plural(hostRows.length, "host")}.
                {kept > 0 && <> {plural(kept, "gig")} with applicants or workers will be kept.</>}
              </p>
            </div>
            <div className="dh-seg" role="tablist" aria-label="How to choose">
              <button type="button" role="tab" aria-selected={mode === "hosts"} className={mode === "hosts" ? "on" : ""} onClick={() => setMode("hosts")}>
                <Users size={13} /> All gigs of a host
              </button>
              <button type="button" role="tab" aria-selected={mode === "excel"} className={mode === "excel" ? "on" : ""} onClick={() => setMode("excel")}>
                <FileSpreadsheet size={13} /> Pick gigs with Excel
              </button>
            </div>
          </div>

          {mode === "hosts" ? (
            <>
              <div className="dh-tools">
                <span>Tick the hosts whose gigs should all be deleted.</span>
                <span style={{ marginLeft: "auto" }} />
                <button type="button" className="dh-link" disabled={selectable.length === 0} onClick={toggleAll}>
                  {allOn ? "Clear selection" : `Select all (${selectable.length})`}
                </button>
              </div>
              <div className="dh-hosts">
                {hostRows.map((r) => {
                  const on = selected.has(r.host.id);
                  const empty = r.deletable === 0;
                  return (
                    <label key={r.host.id} className={`dh-host${on ? " on" : ""}${empty ? " empty" : ""}`}>
                      <input type="checkbox" checked={on} disabled={empty} onChange={() => toggle(r.host.id)} />
                      <span className="dh-av">{(r.host.name || r.host.email || "?").charAt(0).toUpperCase()}</span>
                      <span className="dh-who">
                        <b>{r.host.name || "(no name)"}</b>
                        <span>{r.host.email || r.host.id}</span>
                      </span>
                      <span className="dh-count">
                        <b>{r.deletable}</b> <span className="lbl">{empty ? "nothing to delete" : `gig${r.deletable === 1 ? "" : "s"} to delete`}</span>
                        {r.inUse > 0 && <div className="kept" title="These have applicants or workers (or aren't open), so they stay. Cancel them from Live Gigs.">+ {r.inUse} kept (in progress)</div>}
                      </span>
                    </label>
                  );
                })}
                {notFound.map((h) => (
                  <div key={h.query} className="dh-host missing">
                    <span className="dh-av" style={{ color: "var(--red)" }}><UserX size={16} /></span>
                    <span className="dh-who">
                      <b style={{ color: "var(--red)" }}>{h.query}</b>
                      <span>No account with this email or user ID. Check for typos.</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => removeEntry(entries.find((e) => key(e) === key(h.query)) ?? h.query)}>Remove</Button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="dh-xl">
              <div className="dh-xl-step">
                <span className="dh-num">a</span>
                <div className="txt">Download the list of {plural(gigs.length, "gig")}<small>One row per gig that can be deleted, with its host.</small></div>
                <Button variant="secondary" size="sm" icon={Download} disabled={gigs.length === 0} onClick={downloadSheet}>Download Excel</Button>
              </div>
              <div className="dh-xl-step">
                <span className="dh-num">b</span>
                <div className="txt">In the <b>Action</b> column, choose <b>delete</b> for each gig to remove<small>Leave the others blank. Don&apos;t change the Gig ID or Host email columns. You can upload it later, even after reloading or signing in again.</small></div>
              </div>
              {!upload ? (
                <div
                  className={`dh-drop${dragOver ? " over" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readSheet(f); }}
                >
                  <Upload size={22} style={{ display: "block", margin: "0 auto 6px" }} />
                  <b>c.</b> {readingFile ? "Reading file…" : "Drop the edited file here, or click to upload it"}
                </div>
              ) : (
                <div className="dh-file">
                  <div className="dh-file-top">
                    <span className="name"><FileSpreadsheet size={15} /> {upload.name}</span>
                    <span className="dh-chip">{upload.marked} marked delete</span>
                    <span className="dh-chip">{upload.blank} left blank</span>
                    {upload.issues.length > 0 && <span className="dh-chip" style={{ color: "var(--red)" }}>{plural(upload.issues.length, "problem")}</span>}
                    <Button variant="ghost" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>Replace</Button>
                    <Button variant="ghost" size="sm" onClick={() => setUpload(null)}>Clear</Button>
                  </div>
                  <table className="dh-mini">
                    <tbody>
                      {hostRows.filter((r) => r.marked > 0).map((r) => (
                        <tr key={r.host.id}>
                          <td>{r.host.name || "(no name)"} <span style={{ color: "var(--text-muted)" }}>· {r.host.email || r.host.id}</span></td>
                          <td><b>{r.marked}</b> of {r.deletable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {upload.issues.length > 0 && (
                    <ul className="dh-issues">
                      {upload.issues.map((m, i) => <li key={i} className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />{m}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Summary / action ──────────────────────────────────────────── */}
      {result && (
        <div className="dh-foot">
          <div className="sum">
            {chosen.length > 0 ? (
              <><CheckCircle size={14} style={{ color: "var(--red)", verticalAlign: -2, marginRight: 6 }} />
                <b>{plural(chosen.length, "gig")}</b> from <b>{plural(chosenHosts, "host")}</b> will be deleted</>
            ) : (
              <span style={{ color: "var(--text-secondary)" }}>
                {mode === "hosts" ? "Tick at least one host to continue." : "Upload the edited Excel to continue."}
              </span>
            )}
            <small><ShieldCheck size={12} /> Gigs with applicants or workers are never deleted, even if selected.</small>
          </div>
          <Button variant="danger" icon={Trash2} disabled={chosen.length === 0 || deleting} onClick={() => setConfirmOpen(true)}>
            {chosen.length ? `Delete ${plural(chosen.length, "gig")}` : "Delete"}
          </Button>
        </div>
      )}

      {!result && (
        <p className="dh-tip" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          <Info size={13} /> Find the hosts first. You&apos;ll then see how many of their gigs can be deleted.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        onConfirm={runDelete}
        loading={deleting}
        danger
        title={`Delete ${chosen.length} gig${chosen.length === 1 ? "" : "s"} permanently?`}
        confirmLabel={`Delete ${chosen.length} gig${chosen.length === 1 ? "" : "s"}`}
        message={(() => {
          const hosts = new Set(chosen.map((g) => g.hostId)).size;
          return `This permanently deletes these Open Gigs from ${hosts} host${hosts === 1 ? "" : "s"}. Workers will no longer see them. This can't be undone.`;
        })()}
      >
        <ul className="dh-list">
          {hostRows
            .map((r) => ({ r, n: chosen.filter((g) => g.hostId === r.host.id).length }))
            .filter(({ n }) => n > 0)
            .map(({ r, n }) => (
              <li key={r.host.id}>
                {r.host.email || r.host.name || r.host.id}: <b>{n}</b> gig{n === 1 ? "" : "s"}
              </li>
            ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
