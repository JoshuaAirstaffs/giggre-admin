"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Info, Search, ShieldCheck, Trash2, Upload, UserX, Users, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { writeLog } from "@/lib/activitylog";
import { downloadXlsx } from "@/lib/xlsx";
import { readFirstSheet, type Cell } from "@/lib/bulkGigs";
import { useAuth } from "@/context/AuthContext";
import type { HostGigsResult, HostLookup } from "@/app/api/admin/bulk-gigs/host-gigs/route";

/** Keep in sync with MAX_HOSTS in the host-gigs route. */
const MAX_HOSTS = 20;

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
const text = (v: Cell | undefined) => (v == null ? "" : String(v).trim());
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
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
  const [draft, setDraft] = useState("");
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

  /** Adds typed / pasted emails (split on commas, semicolons, spaces, new lines). */
  const addEntries = (raw: string, base = entries): string[] => {
    const next = [...base];
    for (const part of raw.split(/[\s,;]+/)) {
      const v = part.trim();
      if (!v || next.some((e) => key(e) === key(v))) continue;
      if (next.length >= MAX_HOSTS) {
        toast.warning(`At most ${MAX_HOSTS} hosts`, "Remove some to add more.");
        break;
      }
      next.push(v);
    }
    setEntries(next);
    setDraft("");
    return next;
  };

  const lookupFor = (entry: string): HostLookup | undefined =>
    result?.hosts.find((h) => key(h.query) === key(entry));

  /** Looks the hosts up again and lists their deletable gigs; returns the result (null on error). */
  const search = async (list = entries, opts: { force?: boolean } = {}): Promise<HostGigsResult | null> => {
    if (searching && !opts.force) return null;
    let hosts = list;
    if (draft.trim()) hosts = addEntries(draft, list);
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
    const day = new Date().toISOString().slice(0, 10);
    await downloadXlsx(
      `delete-gigs-${day}.xlsx`,
      "Gigs",
      ["Gig ID", "Host email", "Host name", "Title", "Posted", "Schedule", "Location", "Action"],
      gigs.map((g) => [
        // Host email (or user ID if the account has none) lets the file be used after a reload.
        g.id, foundHosts.get(g.hostId)?.email || g.hostId, foundHosts.get(g.hostId)?.name ?? "", g.title,
        when(g.createdAt), g.scheduledAt ? when(g.scheduledAt) : "Flexible", g.address, "",
      ]),
      { dropdowns: [{ col: 7, values: ["delete"] }] },
    );
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
      const sheet = await readFirstSheet(file);
      const headerAt = sheet.findIndex((r) => r.some((c) => text(c) !== ""));
      if (headerAt < 0) throw new Error("The sheet is empty.");
      const header = sheet[headerAt].map((h) => norm(text(h)));
      const idCol = header.indexOf("gigid");
      const actionCol = header.indexOf("action");
      const hostCol = header.indexOf("hostemail");
      if (idCol < 0 || actionCol < 0) {
        throw new Error("The sheet needs the \"Gig ID\" and \"Action\" columns. Use Download Excel to get the right sheet.");
      }

      // Hosts named in the file (only rows marked delete matter).
      const fileHosts = new Set<string>();
      if (hostCol >= 0) {
        for (const r of sheet.slice(headerAt + 1)) {
          const h = text(r[hostCol]);
          if (h && text(r[actionCol])) fileHosts.add(h);
        }
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
      sheet.slice(headerAt + 1).forEach((r, i) => {
        const row = headerAt + i + 2; // Excel row number
        const id = text(r[idCol]);
        const action = text(r[actionCol]).toLowerCase();
        if (!id && !action) return;
        if (!action) { blank++; return; }
        if (action !== "delete") { issues.push(`Row ${row}: Action must be blank or "delete" (found "${text(r[actionCol])}").`); return; }
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
      <style>{`
        .dh { display: flex; flex-direction: column; gap: 14px; }
        .dh-step { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); padding: 18px; }
        .dh-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .dh-num { width: 24px; height: 24px; border-radius: 999px; background: var(--blue-dim); color: var(--blue); font-size: 12px; font-weight: 700; display: grid; place-items: center; flex-shrink: 0; }
        .dh-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .dh-head p { margin: 3px 0 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; }
        .dh-head .txt { flex: 1; min-width: 220px; }
        .dh-search { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; }
        .dh-box { flex: 1; min-width: 240px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); background: var(--bg-elevated); color: var(--text-muted); cursor: text; min-height: 38px; }
        .dh-box:focus-within { border-color: var(--blue); }
        .dh-box input { flex: 1; min-width: 160px; border: none; background: none; outline: none; padding: 3px 0; font: inherit; font-size: 13px; color: var(--text-primary); }
        .dh-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 4px 3px 9px; border-radius: 999px; background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary); max-width: 100%; overflow-wrap: anywhere; }
        .dh-pill.ok { border-color: var(--green); }
        .dh-pill.bad { border-color: var(--red); color: var(--red); background: var(--red-dim); }
        .dh-pill button { display: inline-flex; padding: 2px; border-radius: 999px; color: inherit; opacity: .7; cursor: pointer; }
        .dh-pill button:hover { opacity: 1; background: var(--bg-hover); }
        .dh-tip { font-size: 11.5px; color: var(--text-muted); margin-top: 8px; }

        .dh-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--bg-elevated); border: 1px solid var(--border); }
        .dh-seg button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); cursor: pointer; border: none; background: none; }
        .dh-seg button.on { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.18); }

        .dh-tools { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12.5px; color: var(--text-secondary); }
        .dh-link { color: var(--blue); font-weight: 600; cursor: pointer; background: none; border: none; padding: 0; font-size: 12.5px; }
        .dh-link:disabled { color: var(--text-muted); cursor: default; }
        .dh-hosts { display: flex; flex-direction: column; gap: 8px; }
        .dh-host { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); cursor: pointer; transition: border-color .12s, background .12s; }
        .dh-host:hover { background: var(--bg-hover); }
        .dh-host.on { border-color: var(--red); background: var(--red-dim); }
        .dh-host.empty { cursor: default; opacity: .65; }
        .dh-host.empty:hover { background: none; }
        .dh-host.missing { border-style: dashed; border-color: var(--red); cursor: default; }
        .dh-host input { accent-color: var(--red); width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; }
        .dh-av { width: 34px; height: 34px; border-radius: 999px; background: var(--bg-elevated); display: grid; place-items: center; font-weight: 700; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
        .dh-who { flex: 1; min-width: 0; }
        .dh-who b { display: block; font-size: 13.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dh-who span { display: block; font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dh-count { text-align: right; flex-shrink: 0; }
        .dh-count b { font-size: 18px; color: var(--text-primary); line-height: 1.1; }
        .dh-count .lbl { font-size: 11.5px; color: var(--text-secondary); }
        .dh-count .kept { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        .dh-xl { display: grid; gap: 10px; }
        .dh-xl-step { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); flex-wrap: wrap; }
        .dh-xl-step .txt { flex: 1; min-width: 200px; font-size: 13px; color: var(--text-primary); }
        .dh-xl-step .txt small { display: block; color: var(--text-muted); font-size: 12px; margin-top: 2px; }
        .dh-drop { border: 1.5px dashed var(--border); border-radius: var(--radius-md, 10px); padding: 22px; text-align: center; font-size: 13px; color: var(--text-secondary); cursor: pointer; transition: border-color .12s, background .12s; }
        .dh-drop:hover, .dh-drop.over { border-color: var(--blue); background: var(--blue-dim); }
        .dh-file { border: 1px solid var(--border); border-radius: var(--radius-md, 10px); padding: 12px 14px; font-size: 12.5px; color: var(--text-secondary); }
        .dh-file-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .dh-file-top .name { font-weight: 700; color: var(--text-primary); margin-right: auto; display: inline-flex; gap: 6px; align-items: center; }
        .dh-mini { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12.5px; }
        .dh-mini td { padding: 6px 0; border-top: 1px solid var(--border); color: var(--text-primary); }
        .dh-mini td:last-child { text-align: right; white-space: nowrap; }
        .dh-issues { margin: 10px 0 0; padding: 0; list-style: none; max-height: 150px; overflow-y: auto; display: grid; gap: 4px; }

        .dh-foot { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-radius: var(--radius-lg, 12px); border: 1px solid var(--border); background: var(--bg-surface); box-shadow: 0 10px 28px rgba(0,0,0,.25); }
        .dh-foot .sum { flex: 1; min-width: 200px; font-size: 13px; color: var(--text-primary); }
        .dh-foot .sum small { display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
        .dh-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); }
        .dh-err { color: var(--red); font-size: 12px; display: flex; gap: 5px; align-items: flex-start; }
        .dh-list { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--text-secondary); max-height: 180px; overflow-y: auto; }
      `}</style>

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
        <form className="dh-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <label className="dh-box">
            <Search size={14} />
            {entries.map((e) => {
              const l = lookupFor(e);
              const cls = l ? (l.host ? "ok" : "bad") : "";
              return (
                <span key={e} className={`dh-pill ${cls}`}>
                  {l && !l.host && <UserX size={12} />}
                  {e}
                  <button type="button" aria-label={`Remove ${e}`} onClick={(ev) => { ev.preventDefault(); removeEntry(e); }}><X size={11} /></button>
                </span>
              );
            })}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "," || e.key === ";") && draft.trim()) { e.preventDefault(); addEntries(draft); }
                if (e.key === "Backspace" && !draft && entries.length) removeEntry(entries[entries.length - 1]);
              }}
              onPaste={(e) => {
                const t = e.clipboardData.getData("text");
                if (/[\s,;]/.test(t.trim())) { e.preventDefault(); addEntries(draft + " " + t); }
              }}
              onBlur={() => { if (draft.trim()) addEntries(draft); }}
              placeholder={entries.length ? "Add another email…" : "host@example.com"}
              aria-label="Host emails or user IDs"
            />
          </label>
          <Button type="submit" variant="primary" size="sm" icon={Search} loading={searching} disabled={(!entries.length && !draft.trim()) || searching}>
            Find gigs
          </Button>
        </form>
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
