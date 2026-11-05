import {
  addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ── Tutorial videos (CMS) ─────────────────────────────────────────────────────
// Admin-managed how-to videos shown in the app wherever their placement says
// (giggre_app lib/features/tutorial_videos). Public read, admin write — the
// app_content rules in giggre_app/firestore.rules already cover this path,
// because the Welcome / Log In / Sign Up screens are seen before sign-in.
//
//   app_content/tutorial_videos                { lastUpdated }
//   app_content/tutorial_videos/items/{id}
//     { title, description, keywords: string[] (extra search words for the
//       app's Video Tutorials search, e.g. "signup, register"), placements: Placement[], source: 'upload'|'youtube',
//       videoUrl (upload), youtubeUrl, youtubeId, thumbnailUrl, durationSec,
//       published, order, createdAt, updatedAt, updatedBy,
//       tl: null | { source, videoUrl, youtubeUrl, youtubeId, thumbnailUrl,
//                    durationSec, title, description } }
//
// The top-level fields are the ENGLISH version (required, the default). `tl`
// is an optional Tagalog version: the app shows it to users in the
// Philippines and English to everyone else (and when there's no Tagalog).
//
// Uploaded files live under app_content/tutorial_videos/ in Storage so
// lib/storageCleanup.ts can delete them when replaced or removed.

export const TUTORIAL_FOLDER = "app_content/tutorial_videos";
export const TUTORIAL_MAX_BYTES = 200 * 1024 * 1024;
export const TUTORIAL_MAX_SECONDS = 10 * 60;

export const PLACEMENTS = [
  { key: "welcome", label: "Welcome", hint: "Before Log In / Create account" },
  { key: "login", label: "Log In", hint: "On the Log In form" },
  { key: "signup", label: "Sign Up", hint: "On the Create account form" },
  // Stored as "help" (kept for existing videos); shown in the app under
  // Profile → Settings → Video Tutorials.
  { key: "help", label: "Video Tutorials", hint: "Profile → Settings → Video Tutorials" },
] as const;
export type Placement = (typeof PLACEMENTS)[number]["key"];

export type VideoSource = "upload" | "youtube";

/** One language's video. title/description empty = use the English ones. */
export interface VideoVersion {
  source: VideoSource;
  videoUrl: string;
  youtubeUrl: string;
  youtubeId: string;
  thumbnailUrl: string;
  durationSec: number | null;
  title: string;
  description: string;
}

export const emptyVersion = (): VideoVersion => ({
  source: "upload", videoUrl: "", youtubeUrl: "", youtubeId: "", thumbnailUrl: "", durationSec: null, title: "", description: "",
});

export interface TutorialVideo {
  id: string;
  title: string;
  description: string;
  /** Extra search words (any language), lowercase, deduped. */
  keywords: string[];
  placements: Placement[];
  source: VideoSource;
  videoUrl: string;
  youtubeUrl: string;
  youtubeId: string;
  thumbnailUrl: string;
  durationSec: number | null;
  published: boolean;
  order: number;
  updatedAt: Date | null;
  /** Tagalog version (Philippines), or null. */
  tl: VideoVersion | null;
}

export type TutorialVideoInput = Omit<TutorialVideo, "id" | "updatedAt">;

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The 11-char video id of a youtube.com / youtu.be / shorts / embed link, else null. */
export function youtubeIdOf(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  try {
    const p = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const host = p.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = p.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "music.youtube.com") {
      id = p.searchParams.get("v") ?? p.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const youtubeThumb = (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

export function parseTutorialVideo(id: string, d: Record<string, unknown>): TutorialVideo {
  const placements = Array.isArray(d.placements)
    ? (d.placements as unknown[]).filter((p): p is Placement => PLACEMENTS.some((x) => x.key === p))
    : [];
  return {
    id,
    title: str(d.title),
    description: str(d.description),
    keywords: Array.isArray(d.keywords) ? (d.keywords as unknown[]).filter((k): k is string => typeof k === "string") : [],
    placements,
    source: d.source === "youtube" ? "youtube" : "upload",
    videoUrl: str(d.videoUrl),
    youtubeUrl: str(d.youtubeUrl),
    youtubeId: str(d.youtubeId),
    thumbnailUrl: str(d.thumbnailUrl),
    durationSec: typeof d.durationSec === "number" ? d.durationSec : null,
    published: d.published === true,
    order: typeof d.order === "number" ? d.order : 0,
    updatedAt: (d.updatedAt as Timestamp | undefined)?.toDate?.() ?? null,
    tl: parseVersion(d.tl),
  };
}

function parseVersion(v: unknown): VideoVersion | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const out: VideoVersion = {
    source: d.source === "youtube" ? "youtube" : "upload",
    videoUrl: str(d.videoUrl), youtubeUrl: str(d.youtubeUrl), youtubeId: str(d.youtubeId),
    thumbnailUrl: str(d.thumbnailUrl), durationSec: typeof d.durationSec === "number" ? d.durationSec : null,
    title: str(d.title), description: str(d.description),
  };
  return (out.source === "upload" ? out.videoUrl : out.youtubeId) ? out : null;
}

function versionPayload(v: VideoVersion) {
  return {
    source: v.source,
    videoUrl: v.source === "upload" ? v.videoUrl : "",
    youtubeUrl: v.source === "youtube" ? v.youtubeUrl.trim() : "",
    youtubeId: v.source === "youtube" ? v.youtubeId : "",
    thumbnailUrl: v.thumbnailUrl || (v.source === "youtube" && v.youtubeId ? youtubeThumb(v.youtubeId) : ""),
    durationSec: v.source === "upload" ? v.durationSec : null,
    title: v.title.trim(),
    description: v.description.trim(),
  };
}

const items = () => collection(db, "app_content", "tutorial_videos", "items");
const sectionDoc = () => doc(db, "app_content", "tutorial_videos");
const touch = () => setDoc(sectionDoc(), { lastUpdated: serverTimestamp() }, { merge: true });

export function watchTutorialVideos(onData: (v: TutorialVideo[]) => void, onError: (e: { code?: string }) => void) {
  return onSnapshot(query(items(), orderBy("order", "asc")),
    (snap) => onData(snap.docs.map((d) => parseTutorialVideo(d.id, d.data()))), onError);
}

function payload(v: TutorialVideoInput, uid: string) {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    keywords: normalizeKeywords(v.keywords),
    placements: v.placements,
    source: v.source,
    videoUrl: v.source === "upload" ? v.videoUrl : "",
    youtubeUrl: v.source === "youtube" ? v.youtubeUrl.trim() : "",
    youtubeId: v.source === "youtube" ? v.youtubeId : "",
    thumbnailUrl: v.thumbnailUrl || (v.source === "youtube" && v.youtubeId ? youtubeThumb(v.youtubeId) : ""),
    durationSec: v.source === "upload" ? v.durationSec : null,
    published: v.published,
    order: v.order,
    tl: v.tl ? versionPayload(v.tl) : null,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}

export async function createTutorialVideo(v: TutorialVideoInput, uid: string) {
  const ref = await addDoc(items(), { ...payload(v, uid), createdAt: serverTimestamp() });
  await touch();
  return ref.id;
}

export async function updateTutorialVideo(id: string, v: TutorialVideoInput, uid: string) {
  await updateDoc(doc(items(), id), payload(v, uid));
  await touch();
}

export async function setTutorialPublished(id: string, published: boolean, uid: string) {
  await updateDoc(doc(items(), id), { published, updatedAt: serverTimestamp(), updatedBy: uid });
  await touch();
}

export async function deleteTutorialVideo(id: string) {
  await deleteDoc(doc(items(), id));
  await touch();
}

/** Saves a new order (0..n-1) for the given ids. */
export async function reorderTutorialVideos(ids: string[]) {
  const b = writeBatch(db);
  ids.forEach((id, i) => b.update(doc(items(), id), { order: i }));
  await b.commit();
  await touch();
}

export const fmtDuration = (s: number | null) =>
  s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** "Signup, register ,  Sign up" → ["signup", "register", "sign up"] (max 20, ≤ 40 chars each). */
export function normalizeKeywords(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const k = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (k && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 20);
}

export const keywordsFromText = (text: string) => normalizeKeywords(text.split(/[,\n]/));
