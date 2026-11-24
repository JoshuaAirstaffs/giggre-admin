"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle, Download, FileSpreadsheet, Info, Loader2, Pencil, ShieldCheck, Upload, UserX } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { writeLog } from "@/lib/activitylog";
import { useAuth } from "@/context/AuthContext";
import { downloadEditSheet, readEditFile, type EditableGig, type EditCheck, type EditRow, type PhotoSlot } from "@/lib/bulkEdit";
import { deleteGigPhotos, loadPhotoThumb, uploadGigPhoto } from "@/lib/gigPhotos";
import { HostPicker, MAX_HOSTS, hostKey } from "./bulkUi";

async function call<T extends object>(body: object): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/admin/bulk-gigs/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  const data = await readApiJson<T>(res);
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data;
}

const MAX_ROWS = 500;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type HostInfo = { query: string; host: { id: string; name: string; email: string } | null; editable: number; locked: number };
type ListResult = { hosts: HostInfo[]; gigs: EditableGig[] };

type ItemState = "checking" | "ready" | "unchanged" | "invalid" | "saving" | "saved" | "failed";
interface Item {
  row: EditRow;
  state: ItemState;
  check?: EditCheck;
  /** New pictures placed on this row in the file (row.photos refers to them by index). */
  files: File[];
}

/**
 * Bulk edit with Excel: find hosts, download their editable gigs with current
 * values, change cells, upload it back, review the changes and save.
 * The file can also be uploaded later on its own (after a reload / re-login).
 */
export default function EditGigs() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [list, setList] = useState<ListResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<"reading" | "checking" | "saving" | null>(null);
  const [progress, setProgress] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  // ── Hosts ──────────────────────────────────────────────────────────────

  const lookupFor = (e: string) => list?.hosts.find((h) => hostKey(h.query) === hostKey(e));

  const search = async (hosts: string[]) => {
    if (hosts.length === 0 || searching) return;
    setSearching(true);
    try {
      const r = await call<ListResult>({ action: "list", hosts });
      setList(r);
      const missing = r.hosts.filter((h) => !h.host).length;
      if (missing) toast.warning(`${plural(missing, "host")} not found`, "Check the emails marked in red.");
    } catch (e: any) {
      toast.error("Search failed", e.message);
    } finally {
      setSearching(false);
    }
  };

  const removeEntry = (entry: string) => {
    setEntries((l) => l.filter((e) => e !== entry));
    const id = lookupFor(entry)?.host?.id;
    setList((r) => {
      if (!r) return r;
      const hosts = r.hosts.filter((h) => hostKey(h.query) !== hostKey(entry));
      const still = hosts.some((h) => h.host?.id === id);
      return { hosts, gigs: id && !still ? r.gigs.filter((g) => g.hostId !== id) : r.gigs };
    });
  };

  const found = (list?.hosts ?? []).filter((h): h is HostInfo & { host: NonNullable<HostInfo["host"]> } => !!h.host);
  const uniqueFound = found.filter((h, i) => found.findIndex((x) => x.host.id === h.host.id) === i);
  const notFound = (list?.hosts ?? []).filter((h) => !h.host);
  const locked = uniqueFound.reduce((n, h) => n + h.locked, 0);

  // ── File ───────────────────────────────────────────────────────────────

  const setItem = (i: number, patch: Partial<Item>) =>
    setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const readFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy("reading");
    try {
      const { rows, files } = await readEditFile(file);
      if (rows.length > MAX_ROWS) throw new Error(`The file has ${rows.length} gigs; edit at most ${MAX_ROWS} at a time.`);
      const fresh: Item[] = rows.map((row) => ({ row, state: "checking", files: files.get(row.row) ?? [] }));
      setFileName(file.name);
      setItems(fresh);
      setBusy("checking");
      setProgress(0);
      stopRef.current = false;
      // One row per request (like the bulk upload) so progress shows and nothing times out.
      for (let i = 0; i < fresh.length; i++) {
        if (stopRef.current) { setItem(i, { state: "invalid", check: { gigId: fresh[i].row.gigId, title: fresh[i].row.title, hostName: "", errors: ["Not checked (stopped)."], changes: [] } }); continue; }
        try {
          const { check } = await call<{ check: EditCheck }>({ action: "check", row: fresh[i].row });
          setItem(i, { check, state: check.errors.length ? "invalid" : check.changes.length ? "ready" : "unchanged" });
        } catch (e: any) {
          setItem(i, { state: "invalid", check: { gigId: fresh[i].row.gigId, title: fresh[i].row.title, hostName: "", errors: [e.message], changes: [] } });
        }
        setProgress(i + 1);
      }
    } catch (e: any) {
      toast.error("Couldn't read the file", e.message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clearFile = () => { setItems([]); setFileName(""); };

  // Download with each gig's current photos embedded in the Picture cells.
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  const downloadSheet = async () => {
    if (!list || preparing) return;
    setPreparing({ done: 0, total: 0 });
    try {
      let missed = 0;
      await downloadEditSheet(
        list.gigs,
        async (url) => { const t = await loadPhotoThumb(url); if (!t) missed++; return t; },
        (done, total) => setPreparing({ done, total }),
      );
      if (missed) toast.warning(`${plural(missed, "photo")} couldn't be loaded`, "They're shown as \"Current photo N\" links instead and are kept as they are.");
    } catch (e: any) {
      toast.error("Download failed", e.message);
    } finally {
      setPreparing(null);
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────

  const ready = items.filter((it) => it.state === "ready");
  const saveAll = async () => {
    if (busy || ready.length === 0) return;
    setConfirmOpen(false);
    setBusy("saving");
    setProgress(0);
    setSaveTotal(ready.length);
    stopRef.current = false;
    const saved: { gigId: string; title: string; changes: string[] }[] = [];
    let failed = 0;
    let done = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.state !== "ready") continue;
      if (stopRef.current) break;
      setItem(i, { state: "saving" });
      const uploaded: string[] = [];
      try {
        // New photos go into the host's gig_images folder first; the save then lists their links.
        let row = it.row;
        if (row.photos?.some((sl) => "newIdx" in sl)) {
          const hostId = it.check?.hostId;
          if (!hostId) throw new Error("Couldn't tell which host this gig belongs to. Upload the file again.");
          const photos: PhotoSlot[] = [];
          for (const sl of row.photos) {
            if (!("newIdx" in sl)) { photos.push(sl); continue; }
            const file = it.files[sl.newIdx];
            if (!file) throw new Error("A new photo is missing. Upload the file again.");
            const up = await uploadGigPhoto(hostId, file);
            uploaded.push(up.path);
            photos.push({ url: up.url });
          }
          row = { ...row, photos };
        }
        const { check } = await call<{ check: EditCheck }>({ action: "save", row, resolved: it.check?.resolved ?? null });
        if (check.saved) {
          setItem(i, { state: "saved", check });
          saved.push({ gigId: check.gigId, title: check.title, changes: check.changes.map((c) => c.label) });
        } else {
          await deleteGigPhotos(uploaded);
          setItem(i, { state: "failed", check });
          failed++;
        }
      } catch (e: any) {
        await deleteGigPhotos(uploaded);
        setItem(i, { state: "failed", check: { ...(it.check as EditCheck), errors: [e.message] } });
        failed++;
      }
      setProgress(++done);
    }
    setBusy(null);
    if (saved.length) {
      toast.success(`${plural(saved.length, "gig")} updated`, failed ? `${failed} couldn't be saved; see the list.` : undefined);
      if (user) {
        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? user.email ?? "Admin",
          actorEmail: user.email ?? undefined,
          module: "gig_management",
          action: "gig_updated",
          description: `Bulk edited ${plural(saved.length, "Open Gig")} from ${fileName}`,
          targetName: fileName,
          meta: { other: { source: `excel:${fileName}`, saved, failed } },
        }).catch(() => {});
      }
    } else if (failed) {
      toast.error("Nothing saved", "See the reasons in the list.");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const count = (s: ItemState) => items.filter((it) => it.state === s).length;
  const shown = items.filter((it) => it.state !== "unchanged");
  const noteFor = (it: Item) => it.check?.errors ?? [];

  return (
    <div className="dh">
      <style>{`
        .eg-hosts { display: grid; gap: 6px; margin: 4px 0 14px; }
        .eg-host { display: flex; align-items: center; gap: 10px; font-size: 12.5px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); }
        .eg-host .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
        .eg-host .who span { color: var(--text-muted); margin-left: 6px; }
        .eg-host .n { white-space: nowrap; color: var(--text-secondary); }
        .eg-host.missing { border-style: dashed; border-color: var(--red); color: var(--red); }
        .eg-rules { margin: 0 0 12px; padding-left: 18px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; }
        .eg-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .eg-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--border); }
        .eg-table td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text-primary); }
        .eg-chg { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
        .eg-chg .k { color: var(--text-muted); white-space: nowrap; }
        .eg-chg .v { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; min-width: 0; }
        .eg-chg .from { color: var(--text-muted); text-decoration: line-through; overflow-wrap: anywhere; max-width: 260px; }
        .eg-chg .to { color: var(--text-primary); font-weight: 600; overflow-wrap: anywhere; max-width: 260px; }
        .eg-ok { color: var(--green); display: inline-flex; gap: 5px; align-items: center; white-space: nowrap; }
        .eg-muted { color: var(--text-muted); display: inline-flex; gap: 5px; align-items: center; white-space: nowrap; }
        .eg-spin { animation: eg-spin .8s linear infinite; }
        @keyframes eg-spin { to { transform: rotate(360deg); } }
      `}</style>

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => readFile(e.target.files?.[0])} />

      {/* ── Step 1: hosts ─────────────────────────────────────────────── */}
      <section className="dh-step">
        <div className="dh-head">
          <span className="dh-num">1</span>
          <div className="txt">
            <h3>Find the hosts</h3>
            <p>Enter each host&apos;s <b>exact email</b> or user ID to get their gigs that can still be edited.</p>
          </div>
        </div>
        <HostPicker
          entries={entries}
          onChange={setEntries}
          onRemove={removeEntry}
          statusOf={(e) => { const l = lookupFor(e); return l ? (l.host ? "ok" : "bad") : undefined; }}
          onSearch={search}
          searching={searching}
        />
        <div className="dh-tip" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ marginRight: "auto" }}>Press Enter or comma after each email, or paste a list. Up to {MAX_HOSTS} hosts.</span>
          <button type="button" className="dh-link" disabled={!!busy} onClick={() => fileRef.current?.click()}
            title="Continue with an Excel you edited earlier, even after reloading the page or signing in again">
            <Upload size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Already have an edited Excel? Upload it
          </button>
        </div>
      </section>

      {/* ── Step 2: download, edit, upload ────────────────────────────── */}
      {list && (
        <section className="dh-step">
          <div className="dh-head">
            <span className="dh-num">2</span>
            <div className="txt">
              <h3>Download, edit in Excel, upload</h3>
              <p>
                {plural(list.gigs.length, "gig")} can be edited across {plural(uniqueFound.length, "host")}.
                {locked > 0 && <> {plural(locked, "gig")} already in progress can&apos;t be edited.</>}
              </p>
            </div>
            <Button variant="secondary" size="sm" icon={Download} loading={!!preparing} disabled={list.gigs.length === 0 || !!preparing} onClick={downloadSheet}>
              {preparing ? (preparing.total ? `Adding photos ${preparing.done}/${preparing.total}…` : "Preparing…") : "Download Excel"}
            </Button>
          </div>

          <div className="eg-hosts">
            {uniqueFound.map((h) => (
              <div key={h.host.id} className="eg-host">
                <span className="who">{h.host.name || "(no name)"}<span>{h.host.email || h.host.id}</span></span>
                <span className="n"><b>{h.editable}</b> editable{h.locked > 0 && <> · {h.locked} in progress</>}</span>
              </div>
            ))}
            {notFound.map((h) => (
              <div key={h.query} className="eg-host missing">
                <UserX size={14} />
                <span className="who" style={{ color: "var(--red)" }}>{h.query}<span style={{ color: "var(--red)" }}>No account with this email or user ID</span></span>
                <button type="button" className="dh-link" onClick={() => removeEntry(entries.find((e) => hostKey(e) === hostKey(h.query)) ?? h.query)}>Remove</button>
              </div>
            ))}
          </div>

          <ul className="eg-rules">
            <li>Change only the cells you want: title, description, experience, pay type, amount, hours, date/time, address, photos.</li>
            <li><b>Photos</b>: Picture 1–5 show the gig&apos;s photos. Leave a photo to keep it; click it and press Delete to remove it; delete it and put a new picture in the cell to replace it.</li>
            <li>To move a gig, change the <b>Address</b> (it&apos;s looked up on the map) or the <b>Latitude/Longitude</b>.</li>
            <li>Don&apos;t change <b>Gig ID</b>, <b>Host email</b> or <b>Version</b>. <b>Skill</b> and workers needed can&apos;t be changed.</li>
          </ul>
        </section>
      )}

      {/* ── Upload / review ───────────────────────────────────────────── */}
      {(list || items.length > 0) && (
        <section className="dh-step">
          <div className="dh-head">
            <span className="dh-num">{list ? 3 : 2}</span>
            <div className="txt">
              <h3>Review the changes</h3>
              <p>Every row is checked against the gig as it is now. Nothing is saved until you click Save.</p>
            </div>
          </div>

          {items.length === 0 ? (
            <div
              className={`dh-drop${dragOver ? " over" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files?.[0]); }}
            >
              <Upload size={22} style={{ display: "block", margin: "0 auto 6px" }} />
              {busy === "reading" ? "Reading file…" : "Drop the edited file here, or click to upload it"}
            </div>
          ) : (
            <>
              <div className="dh-file-top" style={{ marginBottom: 12 }}>
                <span className="name"><FileSpreadsheet size={15} /> {fileName}</span>
                {busy === "checking" && <span className="dh-chip">Checking {progress}/{items.length}…</span>}
                {busy === "saving" && <span className="dh-chip">Saving {progress}/{saveTotal}…</span>}
                <span className="dh-chip">{count("ready")} to update</span>
                {count("saved") > 0 && <span className="dh-chip" style={{ color: "var(--green)" }}>{count("saved")} saved</span>}
                <span className="dh-chip">{count("unchanged")} unchanged</span>
                {count("invalid") + count("failed") > 0 && <span className="dh-chip" style={{ color: "var(--red)" }}>{count("invalid") + count("failed")} with problems</span>}
                {busy ? (
                  <Button variant="ghost" size="sm" onClick={() => { stopRef.current = true; }}>Stop</Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>Replace</Button>
                    <Button variant="ghost" size="sm" onClick={clearFile}>Clear</Button>
                  </>
                )}
              </div>

              {shown.length === 0 && !busy ? (
                <div className="dh-tip" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Info size={13} /> No changes found in this file. Edit some cells and upload it again.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="eg-table">
                    <thead><tr><th>Row</th><th>Gig</th><th>Changes</th><th>Status</th></tr></thead>
                    <tbody>
                      {items.map((it, i) => it.state === "unchanged" ? null : (
                        <tr key={i}>
                          <td style={{ color: "var(--text-muted)" }}>{it.row.row}</td>
                          <td style={{ minWidth: 160 }}>
                            {it.check?.title || it.row.title || "(no title)"}
                            <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>{it.check?.hostName || it.row.host}</div>
                          </td>
                          <td style={{ minWidth: 260 }}>
                            {it.check?.changes.length ? (
                              <div className="eg-chg">
                                {it.check.changes.map((c, k) => (
                                  <div key={k} style={{ display: "contents" }}>
                                    <span className="k">{c.label}</span>
                                    <span className="v"><span className="from">{c.from || "—"}</span><ArrowRight size={11} /><span className="to">{c.to || "—"}</span></span>
                                  </div>
                                ))}
                              </div>
                            ) : it.state === "checking" ? null : <span className="eg-muted">—</span>}
                          </td>
                          <td style={{ minWidth: 200 }}>
                            {it.state === "checking" && <span className="eg-muted"><Loader2 size={13} className="eg-spin" /> Checking</span>}
                            {it.state === "ready" && <span className="eg-ok"><CheckCircle size={13} /> Ready</span>}
                            {it.state === "saving" && <span className="eg-muted"><Loader2 size={13} className="eg-spin" /> Saving</span>}
                            {it.state === "saved" && <span className="eg-ok"><CheckCircle size={13} /> Saved</span>}
                            {(it.state === "invalid" || it.state === "failed") && noteFor(it).map((m, k) => (
                              <div key={k} className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {m}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Summary / action ──────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="dh-foot">
          <div className="sum">
            {ready.length > 0 ? (
              <><Pencil size={14} style={{ color: "var(--blue)", verticalAlign: -2, marginRight: 6 }} /><b>{plural(ready.length, "gig")}</b> will be updated</>
            ) : (
              <span style={{ color: "var(--text-secondary)" }}>
                {busy === "checking" ? "Checking the file…" : count("saved") ? "All changes saved." : "Nothing to save yet."}
              </span>
            )}
            <small><ShieldCheck size={12} /> A gig someone applied to in the meantime is never overwritten.</small>
          </div>
          <Button variant="primary" icon={CheckCircle} loading={busy === "saving"} disabled={!!busy || ready.length === 0} onClick={() => setConfirmOpen(true)}>
            {ready.length ? `Save ${plural(ready.length, "change")}` : "Save"}
          </Button>
        </div>
      )}

      {!list && items.length === 0 && (
        <p className="dh-tip" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
          <Info size={13} /> Find the hosts first, or upload an Excel you edited earlier.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={saveAll}
        title={`Update ${plural(ready.length, "gig")}?`}
        confirmLabel={`Save ${plural(ready.length, "change")}`}
        message="Workers will see the new details right away. Each gig is checked once more before it's saved."
      />
    </div>
  );
}
