"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Edit2, Eye, EyeOff, Film, Plus, PlayCircle, Trash2, Youtube, AlertCircle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { VideoUploadField } from "@/components/ui/content/VideoUploadField";
import { ImageUploadField } from "@/components/ui/content/ImageUploadField";
import { deleteOwnedImage } from "@/lib/storageCleanup";
import { writeLog } from "@/lib/activitylog";
import type { ActorInfo } from "@/hooks/useContent";
import {
  PLACEMENTS, TUTORIAL_FOLDER, TUTORIAL_MAX_BYTES, TUTORIAL_MAX_SECONDS,
  createTutorialVideo, deleteTutorialVideo, fmtDuration, reorderTutorialVideos, setTutorialPublished,
  updateTutorialVideo, watchTutorialVideos, youtubeIdOf, youtubeThumb, emptyVersion, keywordsFromText,
  type Placement, type TutorialVideo, type TutorialVideoInput, type VideoSource, type VideoVersion,
} from "@/lib/tutorialVideos";

// Content Management → Tutorial Videos. Each video has a placement (Welcome /
// Log In / Sign Up / Help); the app shows the published videos of a
// placement there, in this order, and hides the section when there are none.
// Each video has an English version (required, the default) and an optional
// Tagalog one: users in the Philippines get Tagalog, everyone else English.

const placementLabel = (p: Placement) => PLACEMENTS.find((x) => x.key === p)?.label ?? p;

export function TutorialVideosPanel({ actor }: { actor: ActorInfo }) {
  const [videos, setVideos] = useState<TutorialVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TutorialVideo | "new" | null>(null);
  const [deleting, setDeleting] = useState<TutorialVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Placement | "all">("all");

  useEffect(() => watchTutorialVideos(
    (v) => { setVideos(v); setError(null); },
    (e) => setError(e.code === "permission-denied"
      ? "Firestore rules don't allow this yet. Deploy firestore.rules from giggre_app."
      : `Couldn't load videos (${e.code ?? "unknown error"}).`),
  ), []);

  const log = (action: "content_created" | "content_updated" | "content_deleted" | "content_reordered" | "content_published" | "content_unpublished",
    description: string, v?: { id: string; title: string }, meta?: Record<string, unknown>) =>
    writeLog({
      ...actor, module: "content_management", action, description,
      targetSection: "tutorial_videos", targetId: v?.id ?? null, targetName: v?.title ?? "Tutorial Videos",
      affectedFiles: v ? [`app_content/tutorial_videos/items/${v.id}`] : ["app_content/tutorial_videos"],
      meta: meta ? { other: meta } : undefined,
    });

  const shown = useMemo(
    () => (videos ?? []).filter((v) => filter === "all" || v.placements.includes(filter)),
    [videos, filter],
  );

  const move = async (v: TutorialVideo, dir: -1 | 1) => {
    if (!videos) return;
    const ids = videos.map((x) => x.id);
    const i = ids.indexOf(v.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    try {
      await reorderTutorialVideos(ids);
      await log("content_reordered", `${actor.actorName} moved "${v.title}" ${dir < 0 ? "up" : "down"} in Tutorial Videos`, v);
    } catch {
      toast.error("Couldn't reorder");
    } finally {
      setBusy(false);
    }
  };

  const togglePublished = async (v: TutorialVideo) => {
    setBusy(true);
    try {
      await setTutorialPublished(v.id, !v.published, actor.actorId);
      await log(v.published ? "content_unpublished" : "content_published",
        `${actor.actorName} ${v.published ? "unpublished" : "published"} tutorial video "${v.title}"`, v);
      toast.success(v.published ? "Hidden from the app" : "Now showing in the app");
    } catch {
      toast.error("Couldn't update");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const v = deleting;
    if (!v) return;
    setBusy(true);
    try {
      await deleteTutorialVideo(v.id);
      await Promise.all([v.videoUrl, v.thumbnailUrl, v.tl?.videoUrl, v.tl?.thumbnailUrl].map((u) => deleteOwnedImage(u)));
      await log("content_deleted", `${actor.actorName} deleted tutorial video "${v.title}"`, v);
      toast.success("Video deleted");
      setDeleting(null);
    } catch {
      toast.error("Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <style>{`
        .tv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
        .tv-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .tv-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; max-width: 640px; line-height: 1.5; }
        .tv-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
        .tv-chip { padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
          background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border); }
        .tv-chip.active { background: var(--blue-dim); color: var(--blue); border-color: var(--blue); }
        .tv-list { display: flex; flex-direction: column; gap: 10px; }
        .tv-row { display: flex; gap: 14px; align-items: center; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md, 10px); background: var(--bg-elevated); }
        .tv-row.off { opacity: 0.6; }
        .tv-thumb { width: 128px; height: 72px; border-radius: 8px; background: #000 center/cover no-repeat; flex-shrink: 0; position: relative; display: flex; align-items: center; justify-content: center; color: #fff; overflow: hidden; }
        .tv-thumb video { width: 100%; height: 100%; object-fit: cover; }
        .tv-dur { position: absolute; right: 4px; bottom: 4px; font-size: 10px; font-weight: 700; background: rgba(0,0,0,.75); padding: 1px 5px; border-radius: 4px; }
        .tv-info { flex: 1; min-width: 0; }
        .tv-name { font-size: 13.5px; font-weight: 700; color: var(--text-primary); }
        .tv-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tv-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
        .tv-actions { display: flex; gap: 4px; align-items: center; flex-shrink: 0; }
        .tv-icon { background: none; border: 1px solid transparent; color: var(--text-muted); cursor: pointer; padding: 6px; border-radius: 6px; display: flex; }
        .tv-icon:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-hover); }
        .tv-icon:disabled { opacity: 0.35; cursor: not-allowed; }
        .tv-empty { padding: 40px 16px; text-align: center; color: var(--text-muted); font-size: 13px; border: 1px dashed var(--border); border-radius: 10px; }
      `}</style>

      <div className="tv-head">
        <div>
          <div className="tv-title">Tutorial Videos</div>
          <div className="tv-sub">
            How-to videos for the app — e.g. &quot;How to Register&quot; on the Welcome screen. Pick where each video shows. The app
            only shows a section when it has at least one published video there.
          </div>
        </div>
        <Button icon={Plus} onClick={() => setEditing("new")}>Add video</Button>
      </div>

      <div className="tv-chips">
        <button className={`tv-chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All {videos ? `(${videos.length})` : ""}
        </button>
        {PLACEMENTS.map((p) => (
          <button key={p.key} className={`tv-chip ${filter === p.key ? "active" : ""}`} onClick={() => setFilter(p.key)}>
            {p.label} ({(videos ?? []).filter((v) => v.published && v.placements.includes(p.key)).length})
          </button>
        ))}
      </div>

      {error ? (
        <div className="tv-empty" style={{ color: "var(--red)" }}><AlertCircle size={16} /> {error}</div>
      ) : videos == null ? (
        <div className="tv-empty">Loading videos…</div>
      ) : shown.length === 0 ? (
        <div className="tv-empty">
          <Film size={22} style={{ opacity: 0.6 }} /><br />
          {filter === "all" ? "No tutorial videos yet. Add one to show it in the app." : `No videos for ${placementLabel(filter)} yet.`}
        </div>
      ) : (
        <div className="tv-list">
          {shown.map((v) => {
            const idx = videos.findIndex((x) => x.id === v.id);
            return (
              <div key={v.id} className={`tv-row ${v.published ? "" : "off"}`}>
                <div className="tv-thumb" style={v.thumbnailUrl ? { backgroundImage: `url("${v.thumbnailUrl}")` } : undefined}>
                  {!v.thumbnailUrl && v.source === "upload" && v.videoUrl
                    ? <video src={`${v.videoUrl}#t=0.5`} muted preload="metadata" playsInline />
                    : <PlayCircle size={26} style={{ opacity: 0.85 }} />}
                  {v.durationSec != null && <span className="tv-dur">{fmtDuration(v.durationSec)}</span>}
                </div>
                <div className="tv-info">
                  <div className="tv-name">{v.title || "(Untitled)"}</div>
                  {v.description && <div className="tv-desc">{v.description}</div>}
                  <div className="tv-meta">
                    <Badge variant={v.published ? "green" : "gray"} dot>{v.published ? "Published" : "Hidden"}</Badge>
                    <Badge variant={v.source === "youtube" ? "red" : "blue"}>{v.source === "youtube" ? "YouTube" : "Uploaded"}</Badge>
                    <Badge variant={v.tl ? "amber" : "gray"}>{v.tl ? "English + Tagalog" : "English only"}</Badge>
                    {v.placements.map((p) => <Badge key={p} variant="purple">{placementLabel(p)}</Badge>)}
                  </div>
                </div>
                <div className="tv-actions">
                  <button className="tv-icon" title="Move up" disabled={busy || idx <= 0} onClick={() => move(v, -1)}><ArrowUp size={15} /></button>
                  <button className="tv-icon" title="Move down" disabled={busy || idx >= videos.length - 1} onClick={() => move(v, 1)}><ArrowDown size={15} /></button>
                  <button className="tv-icon" title={v.published ? "Hide from the app" : "Publish"} disabled={busy} onClick={() => togglePublished(v)}>
                    {v.published ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button className="tv-icon" title="Edit" disabled={busy} onClick={() => setEditing(v)}><Edit2 size={15} /></button>
                  <button className="tv-icon" title="Delete" disabled={busy} onClick={() => setDeleting(v)}><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <VideoForm
          key={editing === "new" ? "new" : editing.id}
          video={editing === "new" ? null : editing}
          nextOrder={videos?.length ?? 0}
          actor={actor}
          onClose={() => setEditing(null)}
          log={log}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete this video?"
        confirmLabel="Delete"
        message={`"${deleting?.title ?? ""}" will be removed from the app${deleting?.source === "upload" ? " and its file deleted" : ""}. This can't be undone.`}
      />
    </div>
  );
}

// ── Add / edit form ───────────────────────────────────────────────────────────

type Lang = "en" | "tl";
interface FormState {
  title: string;
  description: string;
  /** Comma-separated while editing. */
  keywords: string;
  placements: Placement[];
  published: boolean;
  order: number;
  en: VideoVersion;
  tl: VideoVersion | null;
}

const toForm = (v: TutorialVideo | null, nextOrder: number): FormState => v
  ? {
    title: v.title, description: v.description, keywords: v.keywords.join(", "), placements: v.placements, published: v.published, order: v.order,
    en: { source: v.source, videoUrl: v.videoUrl, youtubeUrl: v.youtubeUrl, youtubeId: v.youtubeId, thumbnailUrl: v.thumbnailUrl, durationSec: v.durationSec, title: "", description: "" },
    tl: v.tl,
  }
  : { title: "", description: "", keywords: "", placements: ["welcome"], published: true, order: nextOrder, en: emptyVersion(), tl: null };

const withYtId = (v: VideoVersion): VideoVersion =>
  ({ ...v, youtubeId: v.source === "youtube" ? youtubeIdOf(v.youtubeUrl) ?? "" : "" });

const toInput = (f: FormState): TutorialVideoInput => {
  const en = withYtId(f.en);
  return {
    title: f.title, description: f.description, keywords: keywordsFromText(f.keywords), placements: f.placements, published: f.published, order: f.order,
    source: en.source, videoUrl: en.videoUrl, youtubeUrl: en.youtubeUrl, youtubeId: en.youtubeId,
    thumbnailUrl: en.thumbnailUrl, durationSec: en.durationSec,
    tl: f.tl ? withYtId(f.tl) : null,
  };
};

const filesOf = (v: Pick<TutorialVideoInput, "source" | "videoUrl" | "thumbnailUrl" | "tl"> | null | undefined) => v
  ? [v.source === "upload" ? v.videoUrl : "", v.thumbnailUrl, v.tl?.source === "upload" ? v.tl.videoUrl : "", v.tl?.thumbnailUrl ?? ""].filter(Boolean)
  : [];

function versionProblem(v: VideoVersion, name: string): string | null {
  if (v.source === "upload" && !v.videoUrl) return `Upload the ${name} MP4 video.`;
  if (v.source === "youtube" && !youtubeIdOf(v.youtubeUrl)) return `Paste a valid YouTube link for the ${name} version.`;
  return null;
}

function VideoForm({
  video, nextOrder, actor, onClose, log,
}: {
  video: TutorialVideo | null;
  nextOrder: number;
  actor: ActorInfo;
  onClose: () => void;
  log: (action: "content_created" | "content_updated", description: string, v?: { id: string; title: string }, meta?: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(video, nextOrder));
  const [lang, setLang] = useState<Lang>("en");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Files uploaded in this form but not saved → deleted on cancel.
  const uploaded = useRef<string[]>([]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setVersion = (l: Lang, patch: Partial<VideoVersion>) =>
    setForm((f) => (l === "en" ? { ...f, en: { ...f.en, ...patch } } : { ...f, tl: { ...(f.tl ?? emptyVersion()), ...patch } }));

  const problems = [
    !form.title.trim() && "Enter a title.",
    form.placements.length === 0 && "Pick at least one place to show it.",
    versionProblem(form.en, "English"),
    form.tl && versionProblem(form.tl, "Tagalog"),
  ].filter(Boolean) as string[];

  const cancel = async () => {
    if (saving || uploading) return;
    const keep = new Set(filesOf(video));
    await Promise.all(uploaded.current.filter((u) => !keep.has(u)).map((u) => deleteOwnedImage(u)));
    onClose();
  };

  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    const data = toInput(form);
    const now = new Set(filesOf(data));
    const langs = data.tl ? "English + Tagalog" : "English";
    try {
      if (video) {
        await updateTutorialVideo(video.id, data, actor.actorId);
        // Clean up files this edit replaced or dropped.
        await Promise.all([...filesOf(video), ...uploaded.current].filter((u) => !now.has(u)).map((u) => deleteOwnedImage(u)));
        await log("content_updated", `${actor.actorName} updated tutorial video "${data.title.trim()}" (${langs})`,
          { id: video.id, title: data.title.trim() }, { placements: data.placements, source: data.source, tagalog: !!data.tl, published: data.published });
      } else {
        const id = await createTutorialVideo(data, actor.actorId);
        await Promise.all(uploaded.current.filter((u) => !now.has(u)).map((u) => deleteOwnedImage(u)));
        await log("content_created", `${actor.actorName} added tutorial video "${data.title.trim()}" (${langs}; ${data.placements.map(placementLabel).join(", ")})`,
          { id, title: data.title.trim() }, { placements: data.placements, source: data.source, tagalog: !!data.tl, published: data.published });
      }
      toast.success(video ? "Video updated" : "Video added", data.published ? "It shows in the app right away." : "It's hidden until you publish it.");
      onClose();
    } catch (err) {
      console.error("[TutorialVideos] save", err);
      toast.error("Save failed", (err as { code?: string })?.code === "permission-denied"
        ? "Firestore refused the save. Deploy firestore.rules from giggre_app."
        : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 };
  const input: React.CSSProperties = { width: "100%", padding: "8px 10px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit" };
  const seg = (on: boolean): React.CSSProperties => ({
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", fontSize: 12.5, fontWeight: 600,
    fontFamily: "inherit", cursor: "pointer", borderRadius: "var(--radius-sm)",
    background: on ? "var(--blue-dim)" : "var(--bg-elevated)", color: on ? "var(--blue)" : "var(--text-secondary)",
    border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
  });
  const hint: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 };

  const ver = lang === "en" ? form.en : form.tl;

  return (
    <Modal open onClose={cancel} size="lg" title={video ? "Edit tutorial video" : "Add tutorial video"}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>{problems[0] ?? ""}</span>
          <Button variant="ghost" onClick={cancel} disabled={saving || uploading}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={saving || uploading || problems.length > 0}>{video ? "Save changes" : "Add video"}</Button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={label}>Title (English)</label>
          <input style={input} maxLength={60} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="How to Register" />
        </div>
        <div>
          <label style={label}>Short description (English, optional)</label>
          <input style={input} maxLength={140} value={form.description} onChange={(e) => set("description", e.target.value)}
            placeholder="Create your Giggre account in under a minute." />
        </div>

        <div>
          <label style={label}>Search keywords (optional)</label>
          <input style={input} maxLength={400} value={form.keywords} onChange={(e) => set("keywords", e.target.value)}
            placeholder="signup, register, create account, mag-register" />
          <div style={hint}>
            Comma-separated words people might search for in the app&apos;s Video Tutorials. The title, description and common
            synonyms (e.g. Sign up ↔ Register, Log in ↔ Sign in, Top up ↔ Cash in) already match without these.
          </div>
        </div>

        <div>
          <label style={label}>Show in the app on</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
            {PLACEMENTS.map((p) => {
              const on = form.placements.includes(p.key);
              return (
                <label key={p.key} style={{ ...seg(on), justifyContent: "flex-start", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={on}
                      onChange={() => set("placements", on ? form.placements.filter((x) => x !== p.key) : [...form.placements, p.key])} />
                    {p.label}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>{p.hint}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ── Language versions ── */}
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md, 10px)", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={seg(lang === "en")} disabled={uploading} onClick={() => setLang("en")}>
              English <span style={{ fontWeight: 400, opacity: 0.8 }}>· default</span>
            </button>
            <button type="button" style={seg(lang === "tl")} disabled={uploading} onClick={() => setLang("tl")}>
              Tagalog <span style={{ fontWeight: 400, opacity: 0.8 }}>· {form.tl ? "Philippines" : "not added"}</span>
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {lang === "en"
              ? "Shown to users outside the Philippines — and to everyone when there's no Tagalog version."
              : "Shown to users in the Philippines. Leave it out and they get the English version."}
          </div>

          {lang === "tl" && !form.tl ? (
            <div>
              <Button size="sm" variant="secondary" icon={Plus} onClick={() => set("tl", emptyVersion())}>Add Tagalog version</Button>
            </div>
          ) : ver && (
            <>
              {lang === "tl" && (
                <>
                  <div className="gp-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={label}>Title (Tagalog, optional)</label>
                      <input style={input} maxLength={60} value={ver.title} onChange={(e) => setVersion("tl", { title: e.target.value })}
                        placeholder={form.title || "Paano Mag-register"} />
                    </div>
                    <div>
                      <label style={label}>Description (Tagalog, optional)</label>
                      <input style={input} maxLength={140} value={ver.description} onChange={(e) => setVersion("tl", { description: e.target.value })}
                        placeholder={form.description || "Gumawa ng Giggre account sa loob ng isang minuto."} />
                    </div>
                  </div>
                  <div style={{ ...hint, marginTop: -8 }}>Empty title / description → the English ones are shown.</div>
                </>
              )}

              <div>
                <label style={label}>{lang === "en" ? "English video" : "Tagalog video"}</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {([["upload", "Upload MP4", Film], ["youtube", "YouTube link", Youtube]] as [VideoSource, string, typeof Film][]).map(([k, l, I]) => (
                    <button key={k} type="button" style={seg(ver.source === k)} disabled={uploading} onClick={() => setVersion(lang, { source: k })}>
                      <I size={14} /> {l}
                    </button>
                  ))}
                </div>
                {ver.source === "upload" ? (
                  <VideoUploadField
                    key={`video-${lang}`}
                    value={ver.videoUrl}
                    onChange={(url) => setVersion(lang, { videoUrl: url })}
                    folder={TUTORIAL_FOLDER}
                    maxBytes={TUTORIAL_MAX_BYTES}
                    maxSeconds={TUTORIAL_MAX_SECONDS}
                    onDuration={(sec) => setVersion(lang, { durationSec: sec })}
                    onUploadingChange={setUploading}
                    onUploaded={(u) => uploaded.current.push(u)}
                    label={`Click or drop the ${lang === "en" ? "English" : "Tagalog"} MP4`}
                  />
                ) : (
                  <YoutubeField key={`yt-${lang}`} value={ver.youtubeUrl} onChange={(url) => setVersion(lang, { youtubeUrl: url })} input={input} hint={hint} />
                )}
              </div>

              <div>
                <label style={label}>Thumbnail (optional)</label>
                <ImageUploadField
                  key={`thumb-${lang}`}
                  value={ver.thumbnailUrl}
                  onChange={(url) => setVersion(lang, { thumbnailUrl: url })}
                  folder={`${TUTORIAL_FOLDER}/thumbnails`}
                  onUploadingChange={setUploading}
                  onUploaded={(u) => uploaded.current.push(u)}
                />
                <div style={hint}>
                  {ver.source === "youtube" && youtubeIdOf(ver.youtubeUrl)
                    ? <>Leave empty to use YouTube&apos;s thumbnail <a href={youtubeThumb(youtubeIdOf(ver.youtubeUrl)!)} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>(preview)</a>.</>
                    : "Leave empty for a plain play card. 16:9 works best."}
                </div>
              </div>

              {lang === "tl" && (
                <div>
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={uploading} onClick={() => { set("tl", null); }}>
                    Remove Tagalog version
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-primary)", cursor: "pointer" }}>
          <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} />
          Published — show it in the app
        </label>
      </div>
    </Modal>
  );
}

function YoutubeField({ value, onChange, input, hint }: {
  value: string; onChange: (v: string) => void; input: React.CSSProperties; hint: React.CSSProperties;
}) {
  const id = youtubeIdOf(value);
  return (
    <div>
      <input style={input} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=… or https://youtu.be/…" />
      {value && !id && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>That isn&apos;t a YouTube video link.</div>}
      {id && (
        <div style={{ marginTop: 10, aspectRatio: "16 / 9", maxWidth: 420, borderRadius: 8, overflow: "hidden", background: "#000" }}>
          <iframe src={`https://www.youtube.com/embed/${id}`} title="YouTube preview" style={{ width: "100%", height: "100%", border: 0 }}
            allow="encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      )}
      <div style={hint}>Use a public or unlisted video. The app plays it in YouTube or the browser.</div>
    </div>
  );
}
