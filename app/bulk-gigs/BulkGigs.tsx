"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { downloadXlsx } from "@/lib/xlsx";
import { writeLog } from "@/lib/activitylog";
import { useAuth } from "@/context/AuthContext";
import { downloadTemplate, loadSkillNames, readBulkGigFile, type BulkGigPreview, type BulkGigRow } from "@/lib/bulkGigs";

type Status =
  | { state: "checking" }
  | { state: "ready"; preview: BulkGigPreview }
  | { state: "invalid"; errors: string[]; skillNotFound?: boolean }
  | { state: "creating"; preview: BulkGigPreview }
  | { state: "created"; preview: BulkGigPreview; gigId: string }
  | { state: "failed"; preview?: BulkGigPreview; errors: string[] };

interface Item { n: number; row: BulkGigRow; status: Status }

// Nominatim allows about one lookup per second; the check geocodes each row.
const CHECK_SPACING_MS = 1100;
const MAX_ROWS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callRow(body: object) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/admin/bulk-gigs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<{ ok?: boolean; errors?: string[]; skillNotFound?: boolean; preview?: BulkGigPreview; gigId?: string }>(res);
  if (!res.ok) return { ok: false, errors: [data.error ?? `Request failed (HTTP ${res.status}).`] };
  return data;
}

const money = (p: BulkGigPreview) =>
  `${p.currencyCode === "PHP" ? "₱" : "$"}${p.amount.toLocaleString()}${p.payType === "hourly" ? "/hr" : ""}`;

export default function BulkGigs() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<"" | "checking" | "creating">("");
  const cancelRef = useRef(false);
  const [skills, setSkills] = useState<string[] | null>(null);

  useEffect(() => {
    loadSkillNames()
      .then(setSkills)
      .catch((e) => {
        setSkills([]);
        toast.error("Couldn't load the skills library", e?.message);
      });
  }, []);

  const update = (n: number, status: Status) =>
    setItems((xs) => xs.map((x) => (x.n === n ? { ...x, status } : x)));

  const checkRow = async (row: BulkGigRow): Promise<Status> => {
    try {
      const r = await callRow({ row, create: false });
      return r.ok && r.preview
        ? { state: "ready", preview: r.preview }
        : { state: "invalid", errors: r.errors?.length ? r.errors : ["Check failed."], skillNotFound: r.skillNotFound };
    } catch (e: any) {
      return { state: "invalid", errors: [e.message ?? "Check failed."] };
    }
  };

  // Picking a skill from the dropdown on a row whose skill wasn't found re-checks just that row.
  const fixSkill = async (n: number, skill: string) => {
    const it = items.find((x) => x.n === n);
    if (!it || !skill) return;
    const row = { ...it.row, skill };
    setItems((xs) => xs.map((x) => (x.n === n ? { ...x, row, status: { state: "checking" } } : x)));
    update(n, await checkRow(row));
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    let rows: BulkGigRow[];
    try {
      rows = await readBulkGigFile(file);
    } catch (e: any) {
      toast.error("Can't read this file", e.message);
      return;
    }
    if (rows.length > MAX_ROWS) {
      toast.error("Too many rows", `Upload at most ${MAX_ROWS} gigs at a time (this file has ${rows.length}).`);
      return;
    }
    const list: Item[] = rows.map((row, i) => ({ n: i + 1, row, status: { state: "checking" } }));
    setFileName(file.name);
    setItems(list);
    setBusy("checking");
    cancelRef.current = false;
    try {
      for (const it of list) {
        if (cancelRef.current) break;
        const started = Date.now();
        update(it.n, await checkRow(it.row));
        const wait = CHECK_SPACING_MS - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    } finally {
      setBusy("");
    }
  };

  const ready = items.filter((x) => x.status.state === "ready");
  const invalid = items.filter((x) => x.status.state === "invalid");
  const created = items.filter((x) => x.status.state === "created");
  const failed = items.filter((x) => x.status.state === "failed");
  const checked = items.filter((x) => x.status.state !== "checking").length;

  const createAll = async () => {
    if (busy || ready.length === 0) return;
    setBusy("creating");
    cancelRef.current = false;
    const batchId = `bulk_${Date.now()}`;
    let ok = 0;
    try {
      for (const it of ready) {
        if (cancelRef.current) break;
        if (it.status.state !== "ready") continue;
        const preview = it.status.preview;
        update(it.n, { state: "creating", preview });
        try {
          // Re-checked on the server; the resolved location is reused so the address isn't geocoded again.
          const r = await callRow({ row: it.row, create: true, resolved: preview.location, batchId });
          if (r.ok && r.gigId && r.preview) {
            ok++;
            update(it.n, { state: "created", preview: r.preview, gigId: r.gigId });
          } else {
            update(it.n, { state: "failed", preview, errors: r.errors?.length ? r.errors : ["Create failed."] });
          }
        } catch (e: any) {
          update(it.n, { state: "failed", preview, errors: [e.message ?? "Create failed."] });
        }
      }
    } finally {
      setBusy("");
    }
    if (ok > 0) {
      toast.success(`${ok} gig${ok === 1 ? "" : "s"} posted`, "They're live for workers now.");
      if (user) {
        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? user.email ?? "Admin",
          actorEmail: user.email ?? undefined,
          module: "gig_management",
          action: "gig_created",
          description: `Bulk-posted ${ok} Open Gig${ok === 1 ? "" : "s"} from ${fileName}`,
          targetId: batchId,
          targetName: fileName,
        });
      }
    }
  };

  const exportResults = () => {
    const statusText = (s: Status) =>
      s.state === "created" ? `Created (${s.gigId})`
      : s.state === "ready" ? "Ready (not created)"
      : s.state === "invalid" || s.state === "failed" ? `Error: ${s.errors.join(" ")}`
      : s.state === "checking" ? "Not checked" : "Creating";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return downloadXlsx(
      `giggre-bulk-gigs-results-${stamp}.xlsx`,
      "Results",
      ["Row", "Host", "Title", "Skill", "Amount", "Workers", "Schedule", "Address", "Status"],
      items.map((x) => [x.n, x.row.host, x.row.title, x.row.skill, x.row.amount, x.row.workers || 1, x.row.scheduleText, x.row.address, statusText(x.status)]),
    );
  };

  const reset = () => {
    if (busy) return;
    setItems([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="bg-wrap">
      <style>{`
        .bg-wrap { display: flex; flex-direction: column; gap: 16px; }
        .bg-card { background: var(--bg-card, var(--bg-elevated)); border: 1px solid var(--border); border-radius: var(--radius, 12px); padding: 18px; }
        .bg-steps { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .bg-hint { font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; margin-top: 12px; }
        .bg-hint b { color: var(--text-primary); font-weight: 600; }
        .bg-drop { border: 1.5px dashed var(--border); border-radius: var(--radius, 12px); padding: 28px; text-align: center; cursor: pointer; color: var(--text-secondary); font-size: 13px; transition: border-color .15s; }
        .bg-drop:hover, .bg-drop.over { border-color: var(--blue); color: var(--text-primary); }
        .bg-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .bg-file { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-right: auto; }
        .bg-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); }
        .bg-chip.ok { color: var(--green); } .bg-chip.err { color: var(--red); }
        .bg-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .bg-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; padding: 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .bg-table td { padding: 9px 8px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text-primary); }
        .bg-sub { color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
        .bg-err { color: var(--red); font-size: 12px; display: flex; gap: 5px; align-items: flex-start; }
        .bg-err + .bg-err { margin-top: 3px; }
        .bg-ok { color: var(--green); display: inline-flex; gap: 5px; align-items: center; }
        .bg-muted { color: var(--text-muted); display: inline-flex; gap: 5px; align-items: center; }
        .bg-tag { font-size: 10.5px; padding: 1px 6px; border-radius: 4px; background: var(--bg-elevated); color: var(--text-secondary); margin-left: 6px; }
        .bg-scroll { overflow-x: auto; }
        .bg-select { margin-top: 6px; width: 100%; max-width: 220px; padding: 6px 8px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 12.5px; font-family: inherit; }
        .bg-select:focus { outline: none; border-color: var(--blue); }
        .bg-spin { animation: bg-spin .8s linear infinite; }
        @keyframes bg-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="bg-card">
        <div className="bg-steps">
          <Button variant="secondary" size="sm" icon={Download} loading={skills === null} disabled={skills === null}
            onClick={async () => {
              // Fetch fresh so skills added while this page was open are included.
              const latest = await loadSkillNames().catch(() => skills ?? []);
              setSkills(latest);
              await downloadTemplate(latest);
            }}>
            Download template
          </Button>
          <Button variant="primary" size="sm" icon={Upload} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {items.length ? "Upload another file" : "Upload Excel file"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <p className="bg-hint">
          One gig per row. <b>Host</b> is the poster&apos;s email or user ID. <b>Amount</b> is per worker (the hourly rate for hourly gigs).
          Leave <b>Date</b> blank for a Flexible gig; times are read in your computer&apos;s timezone and default to 08:00.
          <b> Address</b> is looked up on the map, or give <b>Latitude/Longitude</b> to pin it exactly. <b>Skill</b>,
          Experience and Pay Type are dropdowns in the template; the skill must be one from the skills library.
          Nothing is posted until you click Create.
        </p>
      </div>

      {items.length === 0 ? (
        <div
          className="bg-drop"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
          onDragLeave={(e) => e.currentTarget.classList.remove("over")}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); onFile(e.dataTransfer.files?.[0]); }}
        >
          <FileSpreadsheet size={28} style={{ margin: "0 auto 8px", display: "block" }} />
          Drop an .xlsx file here, or click to choose one (up to {MAX_ROWS} gigs).
        </div>
      ) : (
        <div className="bg-card">
          <div className="bg-bar" style={{ marginBottom: 12 }}>
            <span className="bg-file"><FileSpreadsheet size={16} /> {fileName}</span>
            {busy === "checking" && <span className="bg-chip">Checking {checked}/{items.length}…</span>}
            <span className="bg-chip ok">{ready.length} ready</span>
            {invalid.length > 0 && <span className="bg-chip err">{invalid.length} with errors</span>}
            {created.length > 0 && <span className="bg-chip ok">{created.length} created</span>}
            {failed.length > 0 && <span className="bg-chip err">{failed.length} failed</span>}
            {busy && <Button variant="ghost" size="sm" onClick={() => { cancelRef.current = true; }}>Stop</Button>}
            {!busy && <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>}
            <Button variant="ghost" size="sm" icon={Download} onClick={exportResults} disabled={!!busy}>Export results</Button>
            <Button variant="success" size="sm" loading={busy === "creating"} disabled={!!busy || ready.length === 0} onClick={createAll}>
              Create {ready.length || ""} gig{ready.length === 1 ? "" : "s"}
            </Button>
          </div>
          {invalid.length > 0 && !busy && (
            <p className="bg-hint" style={{ marginTop: 0, marginBottom: 10 }}>
              Rows with errors are skipped. Fix them in the sheet and upload it again (remove the rows you already created).
            </p>
          )}

          <div className="bg-scroll">
            <table className="bg-table">
              <thead>
                <tr><th>#</th><th>Gig</th><th>Host</th><th>Pay</th><th>Schedule</th><th>Location</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map(({ n, row, status }) => {
                  const p = "preview" in status ? status.preview : undefined;
                  return (
                    <tr key={n}>
                      <td className="bg-sub">{n}</td>
                      <td>
                        {row.title || <span className="bg-sub">(no title)</span>}
                        <div className="bg-sub">
                          {p?.skill ?? row.skill}
                          {p && <span className="bg-tag">{p.experience}</span>}
                        </div>
                      </td>
                      <td>{p?.hostName || row.host}{p?.hostName && <div className="bg-sub">{row.host}</div>}</td>
                      <td>
                        {p ? money(p) : row.amount}
                        <div className="bg-sub">{p ? p.workers : row.workers || 1} worker{(p ? p.workers : Number(row.workers || 1)) === 1 ? "" : "s"}</div>
                      </td>
                      <td>{row.scheduleText}</td>
                      <td style={{ maxWidth: 240 }}>
                        {p?.location.address ?? row.address ?? `${row.lat}, ${row.lng}`}
                        {p?.location.place && (
                          <div className="bg-sub">{[p.location.place.city, p.location.place.countryCode].filter(Boolean).join(", ")}</div>
                        )}
                      </td>
                      <td style={{ minWidth: 200 }}>
                        {status.state === "checking" && <span className="bg-muted"><Loader2 size={13} className="bg-spin" /> Checking</span>}
                        {status.state === "ready" && <span className="bg-ok"><CheckCircle size={13} /> Ready</span>}
                        {status.state === "creating" && <span className="bg-muted"><Loader2 size={13} className="bg-spin" /> Creating</span>}
                        {status.state === "created" && <span className="bg-ok"><CheckCircle size={13} /> Created</span>}
                        {(status.state === "invalid" || status.state === "failed") &&
                          status.errors.map((e, i) => <div key={i} className="bg-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {e}</div>)}
                        {status.state === "invalid" && status.skillNotFound && !!skills?.length && (
                          <select className="bg-select" value="" disabled={!!busy} onChange={(e) => fixSkill(n, e.target.value)}>
                            <option value="" disabled>Choose a skill…</option>
                            {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
