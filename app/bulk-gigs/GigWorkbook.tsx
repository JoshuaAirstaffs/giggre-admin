"use client";

// One Excel file for posting, editing and deleting Open Gigs (lib/gigWorkbook.ts):
//   1. Download the chosen hosts' open gigs (or a blank template).
//   2. Upload it back: every row is sorted into new / changed / delete /
//      unchanged and checked, then one click posts and deletes.
//   3. The admin's own file comes back with the new Gig IDs filled in.

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle, Download, FileSpreadsheet, Loader2, Pencil, PlusCircle, ShieldCheck, Trash2, Upload,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { auth } from "@/lib/firebase";
import { readApiJson } from "@/lib/apiResponse";
import { writeLog } from "@/lib/activitylog";
import { useAuth } from "@/context/AuthContext";
import { loadSkillNames, type BulkGigPreview, type BulkGigRow } from "@/lib/bulkGigs";
import { deleteGigPhotos, loadPhotoThumb, photoApi, shrinkPhoto, uploadGigPhoto } from "@/lib/gigPhotos";
import type { EditCheck, EditRow, PhotoSlot } from "@/lib/bulkEdit";
import {
  downloadAllSheet, readWorkbook,
  type CompareDuplicate, type CompareResult, type ReadWorkbook, type WbExistingRow, type WbNewRow,
} from "@/lib/gigWorkbook";
import { patchCells, saveBlob, updatedName, type CellEdit } from "@/lib/xlsxPatch";
import type { HostGigsResult, OpenGigHost } from "@/app/api/admin/bulk-gigs/host-gigs/route";
import { HOST_BATCH, LatLngForm, MAX_HOSTS, callRow, hostKey, money, type Suggestion } from "./bulkUi";

type NewStatus =
  | { state: "checking" }
  | { state: "waiting" }
  | { state: "duplicate" }
  | { state: "ready"; preview: BulkGigPreview }
  | { state: "invalid"; errors: string[]; skillNotFound?: boolean; locationNotFound?: boolean; suggestions?: Suggestion[] }
  | { state: "creating"; preview: BulkGigPreview }
  | { state: "created"; preview: BulkGigPreview; gigId: string; version: string }
  | { state: "failed"; preview?: BulkGigPreview; errors: string[] };

interface NewItem extends WbNewRow { status: NewStatus; dup?: CompareDuplicate }

type EditStatus =
  | { state: "waiting" }
  | { state: "checking" }
  | { state: "ready"; check: EditCheck }
  | { state: "nochange" }
  | { state: "invalid"; errors: string[]; check?: EditCheck }
  | { state: "saving"; check: EditCheck }
  | { state: "saved"; check: EditCheck; version: string }
  | { state: "failed"; errors: string[]; check?: EditCheck };

interface EditItem { n: number; gigId: string; title: string; labels: string[]; row: EditRow; files: File[]; status: EditStatus }

/** A changed row as the edit route takes it (new pictures as indexes into the row's files). */
function toEditRow(r: WbExistingRow): EditRow {
  return {
    row: r.n, gigId: r.gigId, host: r.host, version: r.version, title: r.title, description: r.description, skill: r.skill,
    workers: r.workers, experience: r.experience, payType: r.payType, amount: r.amount, hours: r.hours,
    scheduledAt: r.scheduledAt, scheduleText: r.scheduleText, address: r.address, lat: r.lat, lng: r.lng,
    photos: r.photos?.map((p): PhotoSlot => ("keep" in p ? { keep: p.keep } : { newIdx: p.idx })),
  };
}

const editCall = (body: object) =>
  post<{ check: EditCheck }>("/api/admin/bulk-gigs/edit", { ...body, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

type DeleteState = "pending" | "deleting" | "deleted" | "gone" | "kept" | "failed";

// Nominatim allows about one lookup per second; the check geocodes each new row.
const CHECK_SPACING_MS = 1100;
const MAX_NEW = 200;
const MAX_DELETE = 500;
/** Rows per compare request (the route's limit). */
const COMPARE_CHUNK = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "earlier");

async function post<T extends object>(url: string, body: object): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await readApiJson<T>(res);
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data;
}

/** Compares the file with the live gigs, a few hundred rows per request. */
async function compareAll(wb: ReadWorkbook): Promise<CompareResult> {
  const items = [
    ...wb.existing.map((r) => ({ kind: "existing" as const, r })),
    ...wb.deletes.map((r) => ({ kind: "deletes" as const, r })),
    ...wb.newRows.map((x) => ({ kind: "newRows" as const, r: { n: x.n, host: x.row.host, title: x.row.title, scheduledAt: x.row.scheduledAt, address: x.row.address } })),
  ];
  const out: CompareResult = { existing: [], deletes: [], duplicates: [] };
  for (let i = 0; i < items.length; i += COMPARE_CHUNK) {
    const chunk = items.slice(i, i + COMPARE_CHUNK);
    const body = {
      action: "compare",
      existing: chunk.filter((c) => c.kind === "existing").map((c) => c.r),
      deletes: chunk.filter((c) => c.kind === "deletes").map((c) => c.r),
      newRows: chunk.filter((c) => c.kind === "newRows").map((c) => c.r),
    };
    const r = await post<CompareResult>("/api/admin/bulk-gigs/workbook", body);
    out.existing.push(...r.existing);
    out.deletes.push(...r.deletes);
    out.duplicates.push(...r.duplicates);
  }
  return out;
}

export default function GigWorkbook() {
  const { user } = useAuth();
  const [skills, setSkills] = useState<string[] | null>(null);

  // Step 1: download
  const [hostList, setHostList] = useState<OpenGigHost[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listSort, setListSort] = useState<"gigs" | "recent" | "name">("gigs");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState("");
  const [found, setFound] = useState<HostGigsResult | null>(null);
  const [downloading, setDownloading] = useState<string>("");
  /** Posted-date filter for the download (YYYY-MM-DD, local time; "" = no limit). */
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");

  // Step 2: upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [wb, setWb] = useState<ReadWorkbook | null>(null);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [items, setItems] = useState<NewItem[]>([]);
  const [edits, setEdits] = useState<EditItem[]>([]);
  const [delState, setDelState] = useState<Map<number, { state: DeleteState; note?: string }>>(new Map());
  const [busy, setBusy] = useState<"" | "reading" | "comparing" | "checking" | "applying">("");
  const [checked, setChecked] = useState(0);
  const cancelRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Step 3: updated file
  const [done, setDone] = useState<{ open: boolean; posted: number; updated: number; deleted: number; failed: number; downloaded: boolean; asking: boolean } | null>(null);

  // The host list loads when the page opens (one read of the open gigs).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadHostList(); }, []);

  useEffect(() => {
    loadSkillNames().then(setSkills).catch((e) => {
      setSkills([]);
      toast.error("Couldn't load the skills library", e?.message);
    });
  }, []);

  // ── Step 1 ──────────────────────────────────────────────────────────────

  const dayStart = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).getTime(); };
  const filtering = !!(postedFrom || postedTo);
  const fromMs = postedFrom ? dayStart(postedFrom) : -Infinity;
  const toMs = postedTo ? dayStart(postedTo) + 86_400_000 : Infinity;
  /** The found gigs posted within the chosen dates (gigs without a posted date only when there's no filter). */
  const shown = (found?.gigs ?? []).filter((g) => (g.createdAt == null ? !filtering : g.createdAt >= fromMs && g.createdAt < toMs));
  const inRange = (ms: number) => (filtering ? ms > 0 && ms >= fromMs && ms < toMs : true);

  const loadHostList = async () => {
    if (loadingList) return;
    setLoadingList(true);
    try {
      const r = await post<{ hosts: OpenGigHost[] }>("/api/admin/bulk-gigs/host-gigs", { action: "hosts" });
      setHostList(r.hosts);
    } catch (e: any) {
      toast.error("Couldn't load the hosts", e.message);
    } finally {
      setLoadingList(false);
    }
  };

  /** The list rows: matching the search, with their gig count in the date range (hosts with none are hidden). */
  const listRows = (hostList ?? [])
    .map((h) => {
      const dates = h.posted.filter(inRange);
      return { ...h, count: dates.length, last: dates.length ? Math.max(...dates) : 0 };
    })
    .filter((h) => h.count > 0)
    .filter((h) => {
      const q = listQuery.trim().toLowerCase();
      return !q || h.name.toLowerCase().includes(q) || h.email.toLowerCase().includes(q) || h.id.toLowerCase() === q;
    })
    .sort((a, b) => listSort === "gigs" ? b.count - a.count || b.last - a.last
      : listSort === "recent" ? b.last - a.last
      : (a.name || a.email).localeCompare(b.name || b.email));
  const allPicked = listRows.length > 0 && listRows.every((h) => picked.has(h.id));
  const togglePick = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else if (next.size >= MAX_HOSTS) toast.warning(`At most ${MAX_HOSTS} hosts`, "Untick some to add more.");
    else next.add(id);
    return next;
  });
  const toggleAllPicked = () => setPicked((cur) => {
    const next = new Set(cur);
    if (allPicked) { for (const h of listRows) next.delete(h.id); return next; }
    for (const h of listRows) { if (next.size >= MAX_HOSTS) break; next.add(h.id); }
    if (listRows.some((h) => !next.has(h.id))) toast.warning(`At most ${MAX_HOSTS} hosts`, `The first ${MAX_HOSTS} were selected.`);
    return next;
  });
  const usePicked = () => {
    const chosen = (hostList ?? []).filter((h) => picked.has(h.id));
    // By user ID: always unique, even for hosts without an email.
    const list = chosen.map((h) => h.id);
    search(list);
  };

  const ymd = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const preset = (days: number | null) => {
    if (days == null) { setPostedFrom(""); setPostedTo(""); return; }
    const today = ymd(Date.now());
    setPostedFrom(ymd(dayStart(today) - (days - 1) * 86_400_000));
    setPostedTo(today);
  };
  const presetOn = (days: number | null) => {
    if (days == null) return !filtering;
    const today = ymd(Date.now());
    return postedTo === today && postedFrom === ymd(dayStart(today) - (days - 1) * 86_400_000);
  };

  const search = async (list: string[]) => {
    if (searching || list.length === 0) return;
    setSearching(true);
    try {
      // In batches, so a long list (up to MAX_HOSTS) never hits the server's time limit.
      const queries = [...new Map(list.map((q) => [hostKey(q), q.trim()])).values()].filter(Boolean).slice(0, MAX_HOSTS);
      const r: HostGigsResult = { hosts: [], gigs: [] };
      const seenHosts = new Set<string>();
      for (let i = 0; i < queries.length; i += HOST_BATCH) {
        if (queries.length > HOST_BATCH) setSearchProgress(`Finding hosts ${Math.min(i + HOST_BATCH, queries.length)}/${queries.length}…`);
        const part = await post<HostGigsResult>("/api/admin/bulk-gigs/host-gigs", { action: "search", hosts: queries.slice(i, i + HOST_BATCH) });
        // The same account typed twice in different batches (email and user ID): list its gigs once.
        const fresh = new Set<string>();
        for (const h of part.hosts) {
          const id = h.host?.id;
          if (id && seenHosts.has(id) && !fresh.has(id)) r.hosts.push({ ...h, deletable: 0, inUse: 0 });
          else { r.hosts.push(h); if (id) { seenHosts.add(id); fresh.add(id); } }
        }
        r.gigs.push(...part.gigs.filter((g) => fresh.has(g.hostId)));
      }
      r.gigs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setFound(r);
      const missing = r.hosts.filter((h) => !h.host).length;
      if (missing) toast.warning(`${plural(missing, "host")} not found`, "Check the emails marked in red.");
    } catch (e: any) {
      toast.error("Search failed", e.message);
    } finally {
      setSearching(false);
      setSearchProgress("");
    }
  };

  const download = async (withGigs: boolean) => {
    if (downloading) return;
    try {
      setDownloading("Preparing…");
      const latest = await loadSkillNames().catch(() => skills ?? []);
      setSkills(latest);
      const gigs = withGigs ? shown : [];
      let missing = 0;
      await downloadAllSheet(
        gigs,
        latest,
        gigs.length ? async (url) => { const t = await loadPhotoThumb(url); if (!t) missing++; return t; } : undefined,
        (d, t) => setDownloading(t ? `Adding photos ${d}/${t}…` : "Preparing…"),
      );
      if (missing) toast.warning(`${plural(missing, "photo")} couldn't be added`, "Those cells link to the photo instead; leaving them keeps the photo.");
    } catch (e: any) {
      toast.error("Download failed", e.message);
    } finally {
      setDownloading("");
    }
  };

  // ── Step 2 ──────────────────────────────────────────────────────────────

  const setStatus = (n: number, status: NewStatus) => setItems((xs) => xs.map((x) => (x.n === n ? { ...x, status } : x)));

  const checkRow = async (row: BulkGigRow): Promise<NewStatus> => {
    try {
      const r = await callRow({ row, create: false });
      return r.ok && r.preview
        ? { state: "ready", preview: r.preview }
        : { state: "invalid", errors: r.errors?.length ? r.errors : ["Check failed."], skillNotFound: r.skillNotFound, locationNotFound: r.locationNotFound, suggestions: r.suggestions };
    } catch (e: any) {
      return { state: "invalid", errors: [e.message ?? "Check failed."] };
    }
  };

  /** Checks the given new rows one by one (the address lookup allows ~1 per second). */
  const checkRows = async (list: NewItem[]) => {
    setBusy("checking");
    cancelRef.current = false;
    try {
      for (const it of list) {
        if (cancelRef.current) { setStatus(it.n, { state: "waiting" }); continue; }
        setStatus(it.n, { state: "checking" });
        const started = Date.now();
        setStatus(it.n, await checkRow(it.row));
        setChecked((c) => c + 1);
        const wait = CHECK_SPACING_MS - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    } finally {
      setBusy("");
    }
  };

  const setEditStatus = (n: number, status: EditStatus) => setEdits((xs) => xs.map((x) => (x.n === n ? { ...x, status } : x)));

  const checkEdit = async (it: EditItem): Promise<EditStatus> => {
    try {
      const { check } = await editCall({ action: "check", row: it.row });
      if (check.errors.length) return { state: "invalid", errors: check.errors, check };
      return check.changes.length ? { state: "ready", check } : { state: "nochange" };
    } catch (e: any) {
      return { state: "invalid", errors: [e.message ?? "Check failed."] };
    }
  };

  /** Checks changed rows one by one (a changed address is looked up on the map, ~1 per second). */
  const checkEdits = async (list: EditItem[]) => {
    setBusy("checking");
    cancelRef.current = false;
    try {
      for (const it of list) {
        if (cancelRef.current) { setEditStatus(it.n, { state: "waiting" }); continue; }
        setEditStatus(it.n, { state: "checking" });
        const started = Date.now();
        setEditStatus(it.n, await checkEdit(it));
        setChecked((c) => c + 1);
        const geocodes = it.labels.includes("Address") || it.labels.includes("Map pin");
        const wait = geocodes ? CHECK_SPACING_MS - (Date.now() - started) : 0;
        if (wait > 0) await sleep(wait);
      }
    } finally {
      setBusy("");
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f || busy) return;
    if (!/\.xlsx$/i.test(f.name)) { toast.error("Not an Excel file", "Upload the .xlsx file."); return; }
    setBusy("reading");
    try {
      const read = await readWorkbook(f);
      if (read.newRows.length > MAX_NEW) throw new Error(`The file has ${read.newRows.length} new gigs; post at most ${MAX_NEW} at a time.`);
      if (read.deletes.length > MAX_DELETE) throw new Error(`The file marks ${read.deletes.length} gigs to delete; delete at most ${MAX_DELETE} at a time.`);
      setBusy("comparing");
      const result = await compareAll(read);
      const dups = new Map(result.duplicates.map((d) => [d.n, d]));
      const list: NewItem[] = read.newRows.map((r) => ({
        ...r,
        dup: dups.get(r.n),
        status: r.photoError ? { state: "invalid", errors: [r.photoError] } : dups.has(r.n) ? { state: "duplicate" } : { state: "waiting" },
      }));
      setFile(f);
      setWb(read);
      setCmp(result);
      setItems(list);
      setDelState(new Map(result.deletes.map((d) => [d.n, { state: d.ok ? "pending" : d.gone ? "gone" : "kept", note: d.reason }])));
      const byN = new Map(read.existing.map((r) => [r.n, r]));
      const editList: EditItem[] = result.existing
        .filter((c) => c.status === "changed" || c.status === "blocked")
        .map((c) => ({
          n: c.n, gigId: c.gigId, title: c.title ?? "", labels: c.changes, row: toEditRow(byN.get(c.n)!), files: read.addedFiles.get(c.n) ?? [],
          status: c.status === "blocked" ? { state: "invalid", errors: [`Can't be changed: ${c.reason}`] } : { state: "waiting" },
        }));
      setEdits(editList);
      setChecked(0);
      setDone(null);
      setBusy("");
      await checkRows(list.filter((x) => x.status.state === "waiting"));
      if (!cancelRef.current) await checkEdits(editList.filter((x) => x.status.state === "waiting"));
    } catch (e: any) {
      toast.error("Can't use this file", e.message);
      setBusy("");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const postAnyway = async (n: number) => {
    const it = items.find((x) => x.n === n);
    if (!it || busy) return;
    await checkRows([it]);
  };

  const fixRow = async (n: number, patch: Partial<BulkGigRow>) => {
    const it = items.find((x) => x.n === n);
    if (!it || busy) return;
    const row = { ...it.row, ...patch };
    setItems((xs) => xs.map((x) => (x.n === n ? { ...x, row, status: { state: "checking" } } : x)));
    setStatus(n, await checkRow(row));
  };

  const clear = () => {
    if (busy) return;
    setFile(null); setWb(null); setCmp(null); setItems([]); setEdits([]); setDelState(new Map()); setDone(null);
  };

  // ── Apply ───────────────────────────────────────────────────────────────

  const ready = items.filter((x) => x.status.state === "ready");
  const readyEdits = edits.filter((x) => x.status.state === "ready");
  const savedEdits = edits.filter((x): x is EditItem & { status: Extract<EditStatus, { state: "saved" }> } => x.status.state === "saved");
  const toDelete = (cmp?.deletes ?? []).filter((d) => d.ok && delState.get(d.n)?.state === "pending");
  const nothingToApply = ready.length + toDelete.length + readyEdits.length === 0;
  const posted = items.filter((x): x is NewItem & { status: Extract<NewStatus, { state: "created" }> } => x.status.state === "created");
  // Rows to mark "Deleted" in the updated file (also old delete rows whose gig was already gone).
  const deletedRows = [...delState.entries()].filter(([, v]) => v.state === "deleted" || v.state === "gone").map(([n]) => n);

  const apply = async () => {
    if (busy || nothingToApply) return;
    setConfirmOpen(false);
    setBusy("applying");
    const batchId = `bulk_${Date.now()}`;
    let ok = 0, failed = 0, deleted = 0, updated = 0;
    try {
      for (const it of ready) {
        if (it.status.state !== "ready") continue;
        const preview = it.status.preview;
        setStatus(it.n, { state: "creating", preview });
        const uploaded: { url: string; path: string }[] = [];
        const cleanUp = () => Promise.all(uploaded.map((u) => photoApi("DELETE", `path=${encodeURIComponent(u.path)}`).catch(() => {})));
        try {
          for (const f of it.files) {
            const r = await photoApi("POST", `hostId=${encodeURIComponent(preview.hostId)}`, await shrinkPhoto(f));
            if (r.url && r.path) uploaded.push({ url: r.url, path: r.path });
          }
          const r = await callRow({ row: it.row, create: true, resolved: preview.location, batchId, images: uploaded.map((u) => u.url) });
          if (r.ok && r.gigId && r.preview) {
            ok++;
            setStatus(it.n, { state: "created", preview: r.preview, gigId: r.gigId, version: r.version ?? "" });
          } else {
            failed++;
            await cleanUp();
            setStatus(it.n, { state: "failed", preview, errors: r.errors?.length ? r.errors : ["Posting failed."] });
          }
        } catch (e: any) {
          failed++;
          await cleanUp();
          setStatus(it.n, { state: "failed", preview, errors: [e.message ?? "Posting failed."] });
        }
      }

      for (const it of readyEdits) {
        if (it.status.state !== "ready") continue;
        const check = it.status.check;
        setEditStatus(it.n, { state: "saving", check });
        const uploaded: { url: string; path: string }[] = [];
        try {
          // New photos go into the host's folder first; the save then lists them.
          for (const f of it.files) uploaded.push(await uploadGigPhoto(check.hostId ?? "", f));
          const photos = it.row.photos?.map((p): PhotoSlot => ("newIdx" in p ? { url: uploaded[p.newIdx]?.url ?? "" } : p));
          const { check: saved } = await editCall({ action: "save", row: { ...it.row, photos }, resolved: check.resolved ?? null });
          if (saved.saved) {
            updated++;
            setEditStatus(it.n, { state: "saved", check: saved, version: saved.version ?? "" });
          } else {
            failed++;
            await deleteGigPhotos(uploaded.map((u) => u.path)).catch(() => {});
            setEditStatus(it.n, { state: "failed", errors: saved.errors.length ? saved.errors : ["Not saved."], check });
          }
        } catch (e: any) {
          failed++;
          await deleteGigPhotos(uploaded.map((u) => u.path)).catch(() => {});
          setEditStatus(it.n, { state: "failed", errors: [e.message ?? "Save failed."], check });
        }
      }

      if (toDelete.length) {
        setDelState((m) => { const n = new Map(m); for (const d of toDelete) n.set(d.n, { state: "deleting" }); return n; });
        try {
          const r = await post<{ deleted: { id: string }[]; skipped: { id: string; reason: string }[]; failed: { id: string; error: string }[] }>(
            "/api/admin/bulk-gigs/host-gigs",
            { action: "delete", hostIds: [...new Set(toDelete.map((d) => d.hostId!))], gigIds: toDelete.map((d) => d.gigId) },
          );
          const gone = new Set(r.deleted.map((d) => d.id));
          const kept = new Map(r.skipped.map((s) => [s.id, s.reason]));
          const err = new Map(r.failed.map((s) => [s.id, s.error]));
          deleted = gone.size;
          failed += err.size;
          setDelState((m) => {
            const n = new Map(m);
            for (const d of toDelete) {
              n.set(d.n, gone.has(d.gigId) ? { state: "deleted" }
                : kept.has(d.gigId) ? { state: "kept", note: `Kept: ${kept.get(d.gigId)}` }
                : { state: "failed", note: err.get(d.gigId) ?? "Not deleted." });
            }
            return n;
          });
        } catch (e: any) {
          failed += toDelete.length;
          setDelState((m) => { const n = new Map(m); for (const d of toDelete) n.set(d.n, { state: "failed", note: e.message }); return n; });
        }
      }
    } finally {
      setBusy("");
    }

    if (user && (ok || deleted || updated)) {
      const actor = { actorId: user.uid, actorName: user.displayName ?? user.email ?? "Admin", actorEmail: user.email ?? undefined, module: "gig_management" as const };
      if (ok) await writeLog({ ...actor, action: "gig_created", description: `Bulk-posted ${plural(ok, "Open Gig")} from ${file?.name}`, targetId: batchId, targetName: file?.name }).catch(() => {});
      if (updated) await writeLog({ ...actor, action: "gig_updated", description: `Bulk-edited ${plural(updated, "Open Gig")} from ${file?.name}`, targetId: batchId, targetName: file?.name }).catch(() => {});
      if (deleted) await writeLog({ ...actor, action: "gig_deleted", description: `Deleted ${plural(deleted, "Open Gig")} from ${file?.name}`, targetId: batchId, targetName: file?.name }).catch(() => {});
    }
    // The updated file is needed whenever the sheet should change: new gigs get
    // their Gig ID (else they'd be posted again), edited gigs their new Version
    // (else the next edit is blocked), deleted gigs "Deleted" in Action (the row
    // stays in the file, marked delete).
    if (ok || updated || deleted) setDone({ open: true, posted: ok, updated, deleted, failed, downloaded: false, asking: false });
    else toast.error("Nothing was saved", failed ? "See the rows marked in red." : undefined);
  };

  // ── Updated file ────────────────────────────────────────────────────────

  const downloadUpdated = async () => {
    if (!file || !wb) return;
    try {
      const edits: CellEdit[] = [];
      const cells: CellEdit[] = [];
      const keys = (n: number) => {
        if (wb.cols.photoKeys != null) cells.push({ row: n, col: wb.cols.photoKeys, value: (wb.photoKeys.get(n) ?? []).join(",") });
      };
      for (const it of posted) {
        cells.push({ row: it.n, col: wb.cols.gigId, value: it.status.gigId });
        if (wb.cols.version != null && it.status.version) cells.push({ row: it.n, col: wb.cols.version, value: it.status.version });
        keys(it.n);
      }
      for (const it of savedEdits) {
        if (wb.cols.version != null && it.status.version) cells.push({ row: it.n, col: wb.cols.version, value: it.status.version });
        if (it.labels.includes("Photos")) keys(it.n);
      }
      if (wb.cols.action != null) for (const n of deletedRows) cells.push({ row: n, col: wb.cols.action, value: "Deleted" });
      const blob = await patchCells(file, "Gigs", cells);
      saveBlob(blob, updatedName(file.name));
      setDone((d) => (d ? { ...d, downloaded: true, asking: false } : d));
    } catch (e: any) {
      toast.error("Couldn't make the updated file", e.message);
    }
  };

  const closeDone = () => setDone((d) => (d ? (d.downloaded ? { ...d, open: false } : { ...d, asking: true }) : d));

  // ── View ────────────────────────────────────────────────────────────────

  const unchanged = (cmp?.existing ?? []).filter((e) => e.status === "unchanged").length;
  const missing = (cmp?.existing ?? []).filter((e) => e.status === "missing");
  const problems = [...(wb?.issues ?? []), ...missing.map((m) => ({ n: m.n, message: m.reason ?? "Gig not found." }))].sort((a, b) => a.n - b.n);
  const newErrors = items.filter((x) => x.status.state === "invalid" || x.status.state === "failed").length
    + edits.filter((x) => x.status.state === "invalid" || x.status.state === "failed").length;
  const dupWaiting = items.filter((x) => x.status.state === "duplicate").length;
  const hasUpdates = posted.length > 0 || deletedRows.length > 0 || savedEdits.length > 0;
  const foundHosts = (found?.hosts ?? []).filter((h) => h.host);
  const inUse = (found?.hosts ?? []).reduce((n, h) => n + h.inUse, 0);

  return (
    <div className="dh">
      <style>{`
        .wb-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
        .wb-note { font-size: 12px; color: var(--text-muted); }
        .wb-list { margin-top: 12px; }
        .wb-list-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .wb-q, .wb-sort { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); }
        .wb-q { flex: 1; min-width: 200px; }
        .wb-q:focus, .wb-sort:focus { outline: none; border-color: var(--blue); }
        .wb-hosts { max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm, 8px); }
        .wb-host { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 13px; }
        .wb-host:last-child { border-bottom: none; }
        .wb-host:hover { background: var(--bg-elevated); }
        .wb-host.on { background: var(--blue-dim); }
        .wb-host .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .wb-host .who b { font-weight: 600; color: var(--text-primary); }
        .wb-host .who span, .wb-host .cnt span { font-size: 11.5px; color: var(--text-muted); overflow-wrap: anywhere; }
        .wb-host .cnt { text-align: right; display: flex; flex-direction: column; white-space: nowrap; color: var(--text-secondary); }
        .wb-host .cnt b { color: var(--text-primary); }
        .wb-filter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; font-size: 12.5px; }
        .wb-filter .lbl { font-weight: 600; color: var(--text-secondary); margin-right: 4px; }
        .wb-pre { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; }
        .wb-pre:hover { color: var(--text-primary); }
        .wb-pre.on { border-color: var(--blue); color: var(--blue); background: var(--blue-dim); }
        .wb-range { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; color: var(--text-muted); }
        .wb-range input { font: inherit; font-size: 12.5px; padding: 4px 8px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); color-scheme: light dark; }
        .wb-range input:focus { outline: none; border-color: var(--blue); }
        .wb-drop { border: 1.5px dashed var(--border); border-radius: var(--radius, 12px); padding: 26px; text-align: center; cursor: pointer; color: var(--text-secondary); font-size: 13px; transition: border-color .15s; }
        .wb-drop:hover, .wb-drop.over { border-color: var(--blue); color: var(--text-primary); }
        .wb-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .wb-file { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-right: auto; }
        .wb-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; }
        .wb-chip.new { color: var(--blue); } .wb-chip.del { color: var(--red); } .wb-chip.chg { color: var(--amber); } .wb-chip.err { color: var(--red); }
        .wb-sec { margin-top: 16px; }
        .wb-sec h4 { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .wb-sec h4 small { font-weight: 400; color: var(--text-muted); font-size: 12px; }
        .wb-scroll { overflow-x: auto; }
        .wb-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .wb-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .wb-table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; color: var(--text-primary); }
        .bg-sub { color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
        .wb-ok { color: var(--green); display: inline-flex; gap: 5px; align-items: center; }
        .wb-muted { color: var(--text-muted); display: inline-flex; gap: 5px; align-items: center; }
        .wb-warn { color: var(--amber); font-size: 12px; display: flex; gap: 5px; align-items: flex-start; }
        .wb-tag { font-size: 11px; padding: 1px 7px; border-radius: 4px; background: var(--bg-elevated); color: var(--text-secondary); margin: 0 4px 3px 0; display: inline-block; }
        .wb-select { margin-top: 6px; width: 100%; max-width: 220px; padding: 6px 8px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-size: 12.5px; font-family: inherit; }
        .wb-chg { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .wb-chg b { font-weight: 600; margin-right: 4px; }
        .wb-chg .from { color: var(--text-muted); text-decoration: line-through; }
        .wb-chg .to { color: var(--text-primary); }
        .wb-spin { animation: wb-spin .8s linear infinite; }
        @keyframes wb-spin { to { transform: rotate(360deg); } }
        .wb-done p { margin: 0 0 10px; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
        .wb-done b { color: var(--text-primary); }
      `}</style>

      <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => onFile(e.target.files?.[0])} />

      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      <section className="dh-step">
        <div className="dh-head">
          <span className="dh-num">1</span>
          <div className="txt">
            <h3>Download the Excel file</h3>
            <p>
              Tick hosts to get their open gigs in the file (to change or delete them), or download a blank template to only post new gigs.
              Gigs someone applied to aren&apos;t included.
            </p>
          </div>
        </div>
        {(hostList || (found && foundHosts.length > 0 && found.gigs.length > 0)) && (
          <div className="wb-filter">
            <span className="lbl">Posted</span>
            {([["All", null], ["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30]] as const).map(([label, days]) => (
              <button key={label} type="button" className={`wb-pre${presetOn(days) ? " on" : ""}`} onClick={() => preset(days)}>{label}</button>
            ))}
            <span className="wb-range">
              <input type="date" aria-label="Posted from" value={postedFrom} max={postedTo || undefined} onChange={(e) => setPostedFrom(e.target.value)} />
              <span>to</span>
              <input type="date" aria-label="Posted to" value={postedTo} min={postedFrom || undefined} onChange={(e) => setPostedTo(e.target.value)} />
            </span>
          </div>
        )}
        {!hostList ? (
          <div className="wb-actions" style={{ marginTop: 10 }}>
            <Button variant="secondary" size="sm" loading={loadingList} disabled={loadingList} onClick={loadHostList}>
              {loadingList ? "Loading hosts…" : "Show hosts with open gigs"}
            </Button>
            <span className="wb-note">Lists every host that has open gigs nobody applied to yet.</span>
          </div>
        ) : (
          <div className="wb-list">
            <div className="wb-list-top">
              <input className="wb-q" placeholder="Search name or email…" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
              <select className="wb-sort" value={listSort} onChange={(e) => setListSort(e.target.value as typeof listSort)} aria-label="Sort hosts">
                <option value="gigs">Most gigs</option>
                <option value="recent">Newest post</option>
                <option value="name">Name A–Z</option>
              </select>
              <button type="button" className="dh-link" disabled={listRows.length === 0} onClick={toggleAllPicked}>
                {allPicked ? "Clear these" : `Select all (${Math.min(listRows.length, MAX_HOSTS)})`}
              </button>
              <button type="button" className="dh-link" onClick={loadHostList} disabled={loadingList}>{loadingList ? "Refreshing…" : "Refresh"}</button>
            </div>
            <div className="wb-hosts">
              {listRows.length === 0 && <div className="wb-note" style={{ padding: 12 }}>{filtering ? "No host posted gigs in these dates." : "No hosts match."}</div>}
              {listRows.map((h) => (
                <label key={h.id} className={`wb-host${picked.has(h.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={picked.has(h.id)} onChange={() => togglePick(h.id)} />
                  <span className="who"><b>{h.name || "(no name)"}</b><span>{h.email || h.id}</span></span>
                  <span className="cnt"><b>{h.count}</b> gig{h.count === 1 ? "" : "s"}<span>{h.last ? `last ${fmtDate(h.last)}` : ""}</span></span>
                </label>
              ))}
            </div>
            <div className="wb-actions" style={{ marginTop: 10 }}>
              <Button variant="secondary" size="sm" disabled={picked.size === 0 || searching} loading={searching} onClick={usePicked}>
                {searching ? searchProgress || "Finding gigs…" : `Use ${plural(picked.size, "host")}`}
              </Button>
              {picked.size > 0 && <button type="button" className="dh-link" onClick={() => setPicked(new Set())}>Clear selection</button>}
            </div>
          </div>
        )}
        <div className="wb-actions">
          {found && foundHosts.length > 0 && (
            <Button variant="primary" size="sm" icon={Download} loading={!!downloading} disabled={!!downloading || shown.length === 0} onClick={() => download(true)}>
              {downloading || (shown.length ? `Download ${plural(shown.length, "gig")}` : filtering ? "No gigs posted in these dates" : "No open gigs to download")}
            </Button>
          )}
          <Button variant="secondary" size="sm" icon={Download} disabled={!!downloading || skills === null} onClick={() => download(false)}>
            Blank template
          </Button>
          {found && foundHosts.length > 0 && (
            <span className="wb-note">
              {filtering ? `${shown.length} of ${plural(found.gigs.length, "gig")}` : plural(found.gigs.length, "gig")} from {plural(foundHosts.length, "host")}
              {inUse > 0 && <> · {plural(inUse, "gig")} with applicants or workers left out</>}
            </span>
          )}
        </div>
      </section>

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      <section className="dh-step">
        <div className="dh-head">
          <span className="dh-num">2</span>
          <div className="txt">
            <h3>Upload the file</h3>
            <p>
              Rows without a Gig ID are <b>posted</b>; rows with Action <b>delete</b> are <b>deleted</b>; changed rows <b>update</b> their gig.
              Your notes and extra columns are ignored. Nothing happens until you click Apply.
            </p>
          </div>
        </div>

        {!wb ? (
          <div
            className={`wb-drop${dragOver ? " over" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => !busy && fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(Array.from(e.dataTransfer.files ?? []).find((f) => /\.xlsx$/i.test(f.name))); }}
          >
            <FileSpreadsheet size={26} style={{ margin: "0 auto 8px", display: "block" }} />
            {busy === "reading" ? "Reading the file…" : busy === "comparing" ? "Comparing with the live gigs…" : "Drop the .xlsx file here, or click to choose it"}
          </div>
        ) : (
          <>
            <div className="wb-bar">
              <span className="wb-file"><FileSpreadsheet size={16} /> {file?.name}</span>
              {busy === "checking" && <span className="wb-chip"><Loader2 size={12} className="wb-spin" /> Checking {Math.min(checked, items.length + edits.length)}/{items.length + edits.length}…</span>}
              <span className="wb-chip new"><PlusCircle size={12} /> {items.length} new</span>
              <span className="wb-chip chg"><Pencil size={12} /> {edits.length} changed</span>
              <span className="wb-chip del"><Trash2 size={12} /> {cmp?.deletes.length ?? 0} to delete</span>
              <span className="wb-chip">{unchanged} unchanged</span>
              {problems.length + newErrors > 0 && <span className="wb-chip err"><AlertTriangle size={12} /> {problems.length + newErrors} with problems</span>}
              {busy === "checking" && <Button variant="ghost" size="sm" onClick={() => { cancelRef.current = true; }}>Stop</Button>}
              {hasUpdates && !busy && <Button variant="secondary" size="sm" icon={Download} onClick={downloadUpdated}>Download updated file</Button>}
              {!busy && <Button variant="ghost" size="sm" icon={Upload} onClick={() => fileRef.current?.click()}>Upload another</Button>}
              {!busy && <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>}
            </div>

            {/* New gigs */}
            {items.length > 0 && (
              <div className="wb-sec">
                <h4><PlusCircle size={14} style={{ color: "var(--blue)" }} /> New gigs to post <small>· rows without a Gig ID</small></h4>
                <div className="wb-scroll">
                  <table className="wb-table">
                    <thead><tr><th>Row</th><th>Gig</th><th>Host</th><th>Pay</th><th>Schedule</th><th>Location</th><th>Photos</th><th>Status</th></tr></thead>
                    <tbody>
                      {items.map((it) => {
                        const { n, row, status } = it;
                        const p = "preview" in status ? status.preview : undefined;
                        return (
                          <tr key={n}>
                            <td className="bg-sub">{n}</td>
                            <td>{row.title || <span className="bg-sub">(no title)</span>}<div className="bg-sub">{p?.skill ?? row.skill}</div></td>
                            <td>{p?.hostName || row.host}{p?.hostName && <div className="bg-sub">{row.host}</div>}</td>
                            <td>{p ? money(p) : row.amount}<div className="bg-sub">{plural(p ? p.workers : Number(row.workers || 1), "worker")}</div></td>
                            <td>{row.scheduleText}</td>
                            <td style={{ maxWidth: 220 }}>{p?.location.address ?? row.address ?? `${row.lat}, ${row.lng}`}</td>
                            <td>{it.files.length || <span className="bg-sub">—</span>}</td>
                            <td style={{ minWidth: 220 }}>
                              {status.state === "waiting" && <span className="wb-muted">Waiting</span>}
                              {status.state === "checking" && <span className="wb-muted"><Loader2 size={13} className="wb-spin" /> Checking</span>}
                              {status.state === "ready" && <span className="wb-ok"><CheckCircle size={13} /> Ready</span>}
                              {status.state === "creating" && <span className="wb-muted"><Loader2 size={13} className="wb-spin" /> Posting</span>}
                              {status.state === "created" && <span className="wb-ok"><CheckCircle size={13} /> Posted</span>}
                              {status.state === "duplicate" && it.dup && (
                                <>
                                  <div className="wb-warn"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                                    Looks already posted ({fmtDate(it.dup.createdAt)}, Gig ID {it.dup.gigId}). Skipped.</div>
                                  <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => postAnyway(n)}>Post it anyway</Button>
                                </>
                              )}
                              {(status.state === "invalid" || status.state === "failed") &&
                                status.errors.map((e, i) => <div key={i} className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {e}</div>)}
                              {status.state === "invalid" && status.skillNotFound && !!skills?.length && (
                                <select className="wb-select" value="" disabled={!!busy} onChange={(e) => fixRow(n, { skill: e.target.value })}>
                                  <option value="" disabled>Choose a skill…</option>
                                  {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              )}
                              {status.state === "invalid" && status.locationNotFound && (
                                <LatLngForm suggestions={status.suggestions ?? []} address={row.address} lat={row.lat} lng={row.lng} disabled={!!busy}
                                  onSubmit={(lat, lng) => fixRow(n, { lat, lng })} />
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

            {/* Deletes */}
            {(cmp?.deletes.length ?? 0) > 0 && (
              <div className="wb-sec">
                <h4><Trash2 size={14} style={{ color: "var(--red)" }} /> Gigs to delete <small>· Action is delete</small></h4>
                <div className="wb-scroll">
                  <table className="wb-table">
                    <thead><tr><th>Row</th><th>Gig</th><th>Host</th><th>Status</th></tr></thead>
                    <tbody>
                      {cmp!.deletes.map((d) => {
                        const st = delState.get(d.n);
                        return (
                          <tr key={d.n}>
                            <td className="bg-sub">{d.n}</td>
                            <td>{d.title || <span className="bg-sub">{d.gigId}</span>}<div className="bg-sub">{d.gigId}</div></td>
                            <td>{d.hostLabel ?? "—"}</td>
                            <td style={{ minWidth: 200 }}>
                              {st?.state === "pending" && <span className="wb-muted"><Trash2 size={13} /> Will be deleted</span>}
                              {st?.state === "deleting" && <span className="wb-muted"><Loader2 size={13} className="wb-spin" /> Deleting</span>}
                              {st?.state === "deleted" && <span className="wb-ok"><CheckCircle size={13} /> Deleted</span>}
                              {st?.state === "gone" && <span className="wb-muted"><CheckCircle size={13} /> Already deleted, skipped</span>}
                              {(st?.state === "kept" || st?.state === "failed") && <div className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {st.note ?? "Not deleted."}</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Changes */}
            {edits.length > 0 && (
              <div className="wb-sec">
                <h4><Pencil size={14} style={{ color: "var(--amber)" }} /> Changed gigs <small>· saved on Apply</small></h4>
                <div className="wb-scroll">
                  <table className="wb-table">
                    <thead><tr><th>Row</th><th>Gig</th><th>Change</th><th>Status</th></tr></thead>
                    <tbody>
                      {edits.map((it) => {
                        const st = it.status;
                        const check = "check" in st ? st.check : undefined;
                        return (
                          <tr key={it.n}>
                            <td className="bg-sub">{it.n}</td>
                            <td>{it.title || it.gigId}<div className="bg-sub">{it.gigId}</div></td>
                            <td style={{ minWidth: 240 }}>
                              {check?.changes.length
                                ? check.changes.map((c, i) => (
                                    <div key={i} className="wb-chg">
                                      <b>{c.label}</b> <span className="from">{c.from || "—"}</span> → <span className="to">{c.to || "—"}</span>
                                    </div>
                                  ))
                                : it.labels.map((l) => <span key={l} className="wb-tag">{l}</span>)}
                            </td>
                            <td style={{ minWidth: 200 }}>
                              {st.state === "waiting" && <span className="wb-muted">Waiting</span>}
                              {st.state === "checking" && <span className="wb-muted"><Loader2 size={13} className="wb-spin" /> Checking</span>}
                              {st.state === "ready" && <span className="wb-ok"><CheckCircle size={13} /> Ready</span>}
                              {st.state === "nochange" && <span className="wb-muted">No change</span>}
                              {st.state === "saving" && <span className="wb-muted"><Loader2 size={13} className="wb-spin" /> Saving</span>}
                              {st.state === "saved" && <span className="wb-ok"><CheckCircle size={13} /> Saved</span>}
                              {(st.state === "invalid" || st.state === "failed") &&
                                st.errors.map((e, i) => <div key={i} className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {e}</div>)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Problems */}
            {problems.length > 0 && (
              <div className="wb-sec">
                <h4><AlertTriangle size={14} style={{ color: "var(--red)" }} /> Rows skipped <small>· fix them in the file and upload again</small></h4>
                <ul className="dh-issues" style={{ maxHeight: 220 }}>
                  {problems.map((p, i) => <li key={i} className="dh-err"><AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> Row {p.n}: {p.message}</li>)}
                </ul>
              </div>
            )}

            {unchanged > 0 && <p className="wb-note" style={{ marginTop: 12 }}>{plural(unchanged, "gig")} unchanged, skipped.{wb.alreadyDeleted ? ` ${plural(wb.alreadyDeleted, "row")} already marked Deleted, skipped.` : ""}</p>}
          </>
        )}
      </section>

      {/* ── Apply ──────────────────────────────────────────────────────── */}
      {wb && (
        <div className="dh-foot">
          <div className="sum">
            {!nothingToApply ? (
              <>
                {[
                  ready.length > 0 && <span key="p"><b>{plural(ready.length, "new gig")}</b> to post</span>,
                  readyEdits.length > 0 && <span key="e"><b style={{ color: "var(--amber)" }}>{plural(readyEdits.length, "gig")}</b> to update</span>,
                  toDelete.length > 0 && <span key="d"><b style={{ color: "var(--red)" }}>{plural(toDelete.length, "gig")}</b> to delete</span>,
                ].filter(Boolean).flatMap((el, i) => (i ? [" · ", el] : [el]))}
              </>
            ) : (
              <span style={{ color: "var(--text-secondary)" }}>
                {busy === "checking" ? "Checking the new gigs…" : hasUpdates ? "Done. Download the updated file to keep working." : "Nothing to post or delete."}
              </span>
            )}
            {dupWaiting > 0 && <small><AlertTriangle size={12} /> {plural(dupWaiting, "row")} that look{dupWaiting === 1 ? "s" : ""} already posted won&apos;t be posted unless you choose Post it anyway.</small>}
            <small><ShieldCheck size={12} /> Gigs with applicants or workers are never deleted.</small>
          </div>
          <Button variant="primary" loading={busy === "applying"} disabled={!!busy || nothingToApply}
            onClick={() => (toDelete.length ? setConfirmOpen(true) : apply())}>
            Apply
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={apply}
        danger
        title={`Delete ${plural(toDelete.length, "gig")} permanently?`}
        confirmLabel="Apply"
        message={[
          ready.length ? `${plural(ready.length, "new gig")} will be posted.` : "",
          readyEdits.length ? `${plural(readyEdits.length, "gig")} will be updated.` : "",
          toDelete.length ? `${plural(toDelete.length, "gig")} will be permanently deleted. Workers will no longer see them. This can't be undone.` : "",
        ].filter(Boolean).join(" ")}
      />

      <Modal
        open={!!done?.open}
        onClose={closeDone}
        size="sm"
        title={[done?.posted ? `${plural(done.posted, "gig")} posted` : "", done?.updated ? `${done.updated} updated` : "", done?.deleted ? `${done.deleted} deleted` : ""].filter(Boolean).join(" · ")}
        footer={done?.asking ? (
          <>
            <Button variant="ghost" onClick={() => setDone((d) => (d ? { ...d, asking: false } : d))}>Go back</Button>
            <Button variant="danger" onClick={() => setDone((d) => (d ? { ...d, open: false, asking: false } : d))}>Close anyway</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={closeDone}>Close</Button>
            <Button variant="primary" icon={done?.downloaded ? CheckCircle : Download} onClick={downloadUpdated}>
              {done?.downloaded ? "Downloaded · again" : "Download file"}
            </Button>
          </>
        )}
      >
        <div className="wb-done">
          {done?.asking ? (
            <p><b>Close without the updated file?</b> Your file doesn&apos;t have the new Gig IDs and versions, so uploading it again could post gigs twice or block your changes.</p>
          ) : (
            <>
              <p>Download the updated file and <b>keep working in it</b>. It has the new Gig IDs and versions, so gigs aren&apos;t posted twice and your next changes aren&apos;t blocked. Your notes and columns are kept.</p>
              {(done?.failed ?? 0) > 0 && <p style={{ color: "var(--red)" }}>{plural(done!.failed, "row")} had errors and {done!.failed === 1 ? "wasn't" : "weren't"} applied. {done!.failed === 1 ? "It's" : "They're"} unchanged in the file, so you can fix and upload again.</p>}
              {done?.downloaded && <p className="wb-ok" style={{ display: "flex" }}><CheckCircle size={14} /> Downloaded as {file ? updatedName(file.name) : ""}</p>}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
