"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { TabBar } from "@/components/ui/TabBar";
import { useTabs } from "@/hooks/useTabs";
import { usePerSectionData } from "@/hooks/usePerSectionData";
import {
  useContent,
  emptyItemForSection,
  getItemTitle,
  hasCategories,
  CAROUSEL_AUDIENCES,
  slideAudience,
  type ContentItem,
  type SectionOptions,
  type SectionData,
} from "@/hooks/useContent";
import { AboutGiggrePanel } from "@/components/ui/content/AboutGiggrePanel";
import { TutorialVideosPanel } from "@/components/ui/content/TutorialVideosPanel";
import { ImageUploadField } from "@/components/ui/content/ImageUploadField";
import { VideoUploadField } from "@/components/ui/content/VideoUploadField";
import { CarouselPreview, SHAPE_ADVICE, type CarouselShape } from "@/components/ui/content/CarouselPreview";
import { slideCountries, coversAllCountries, countryByCode } from "@/lib/carouselCountries";
import { CountrySummary, CountryPickerModal } from "@/components/ui/content/CountryPicker";
import { deleteOwnedImage } from "@/lib/storageCleanup";
import type { ContentSectionKey } from "@/lib/activitylog";
import { isCarouselSection, hasRoleHighlight, CAROUSEL_SECTION_KEYS, type CarouselSectionKey } from "@/lib/activitylog";
import {
  Plus, Edit2, Trash2, Settings, Tag, Shuffle,
  Image, HelpCircle, Shield, ScrollText, Info, RefreshCw,
  X, AlertCircle, Check, ChevronLeft, ChevronRight, Info as InfoIcon, PlayCircle,
} from "lucide-react";
import type { SectionState } from "@/hooks/usePerSectionData";

// ─── Section Config ───────────────────────────────────────────────────────────

const SECTIONS: {
  key: ContentSectionKey;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
}[] = [
    { key: "carousel_items",     label: "Carousel",           icon: Image,      description: "Home screen carousel slides",      color: "var(--blue)"   },
    { key: "updates",            label: "Updates",            icon: RefreshCw,  description: "App update announcements",          color: "var(--green)"  },
    { key: "about_giggre",       label: "About Giggre",       icon: Info,       description: "About page content sections",       color: "var(--purple)" },
    { key: "terms_and_conditions", label: "Terms & Conditions", icon: ScrollText, description: "Terms and conditions sections",   color: "var(--amber)"  },
    { key: "privacy",            label: "Privacy Policy",     icon: Shield,     description: "Privacy policy sections",           color: "var(--orange)" },
    { key: "help_faq",           label: "Help / FAQ",         icon: HelpCircle, description: "Help center FAQ items",             color: "var(--red)"    },
    { key: "tutorial_videos",    label: "Tutorial Videos",    icon: PlayCircle, description: "How-to videos (Welcome, Log In, Sign Up, Profile)", color: "var(--blue)" },
  ];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

// The Carousel tab holds the app's three carousels, each its own section.
const CAROUSEL_TABS: { key: CarouselSectionKey; tab: string; label: string; description: string }[] = [
  { key: "carousel_items",        tab: "Home",       label: "Carousel (Home)",       description: "Home screen carousel, next to the Gig Worker / Gig Host buttons" },
  { key: "worker_carousel_items", tab: "Gig Worker", label: "Carousel (Gig Worker)", description: "Carousel in the Gig Worker side of the app" },
  { key: "host_carousel_items",   tab: "Gig Host",   label: "Carousel (Gig Host)",   description: "Carousel in the Gig Host side of the app" },
];
const CAROUSEL_TAB_KEY = "cm_carousel_tab";

// Sections with their own panel (not the generic item editor).
const CUSTOM_SECTIONS: ContentSectionKey[] = ["about_giggre", "tutorial_videos"];
const ITEM_BASED_SECTIONS = SECTION_KEYS.filter((k) => !CUSTOM_SECTIONS.includes(k));

const ITEMS_PER_PAGE = 10;

const PREDEFINED_CATEGORIES: string[] = [
  "Announcements",
  "News",
  "Events or Promos",
  "Community Messages",
  "System Updates",
  "Software Version Updates (Release Notes)",
  "Maintenance & Downtime Notices",
  "Security & Privacy Updates",
  "Marketing & Promotions",
  "Policy & Legal Updates",
  "Support & Help Updates",
];

function getSectionMeta(key: ContentSectionKey) {
  const carousel = CAROUSEL_TABS.find((c) => c.key === key);
  if (carousel) {
    return { ...SECTIONS.find((s) => s.key === "carousel_items")!, key, label: carousel.label, description: carousel.description };
  }
  return SECTIONS.find((s) => s.key === key)!;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Skeleton & Error states ──────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <style>{`
        @keyframes skel-pulse { 0%,100% { opacity:.45 } 50% { opacity:.9 } }
        .skel { background: var(--bg-elevated); border-radius: var(--radius-sm); animation: skel-pulse 1.4s ease-in-out infinite; }
      `}</style>
      <div style={{ display: "flex", gap: 12, paddingBottom: 8 }}>
        <div className="skel" style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
          <div className="skel" style={{ width: 130, height: 14 }} />
          <div className="skel" style={{ width: 210, height: 11 }} />
        </div>
      </div>
      <div className="skel" style={{ height: 36 }} />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="skel" style={{ height: 46, opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

function SectionError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "52px 24px", gap: 10, textAlign: "center" }}>
      <AlertCircle size={26} style={{ color: "var(--red)" }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Failed to load section</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 280 }}>{error}</div>
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>Retry</Button>
    </div>
  );
}

// ─── Pagination Component ─────────────────────────────────────────────────────

function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Build page number array with ellipsis logic
  const getPageNumbers = (): (number | "…")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "…")[] = [1];
    if (currentPage > 3) pages.push("…");
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="pg-bar">
      <style>{`
        .pg-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 12px;
          gap: 12px;
          flex-wrap: wrap;
        }
        .pg-info {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .pg-controls {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .pg-btn {
          min-width: 28px;
          height: 28px;
          padding: 0 6px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          line-height: 1;
        }
        .pg-btn:hover:not(:disabled):not(.active) {
          background: var(--bg-hover);
          color: var(--text-primary);
          border-color: var(--border-muted);
        }
        .pg-btn:disabled {
          opacity: 0.38;
          cursor: not-allowed;
        }
        .pg-btn.active {
          background: var(--blue);
          border-color: var(--blue);
          color: #fff;
          font-weight: 700;
          cursor: default;
        }
        .pg-ellipsis {
          min-width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: var(--text-muted);
          user-select: none;
        }
      `}</style>

      <span className="pg-info">
        {startItem}–{endItem} of {totalItems} item{totalItems !== 1 ? "s" : ""}
      </span>

      <div className="pg-controls">
        <button
          className="pg-btn"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          title="Previous page"
        >
          <ChevronLeft size={13} />
        </button>

        {getPageNumbers().map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="pg-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`pg-btn${p === currentPage ? " active" : ""}`}
              onClick={() => p !== currentPage && onPageChange(p as number)}
              disabled={p === currentPage}
            >
              {p}
            </button>
          )
        )}

        <button
          className="pg-btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          title="Next page"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Item Form ────────────────────────────────────────────────────────────────

/** Carousel items carry an uploaded `picture`; other sections don't. */
function pictureOf(item: Partial<ContentItem>): string | undefined {
  const picture = (item as { picture?: unknown }).picture;
  return typeof picture === "string" ? picture : undefined;
}

/** Optional carousel video URL. */
function videoOf(item: Partial<ContentItem>): string | undefined {
  const video = (item as { video?: unknown }).video;
  return typeof video === "string" && video ? video : undefined;
}

function ItemForm({
  sectionKey,
  initial,
  onSubmit,
  loading,
  isEdit,
  takenSortNumbers = [],
  availableCategories = [],
}: {
  sectionKey: ContentSectionKey;
  initial: Partial<ContentItem>;
  onSubmit: (data: Partial<ContentItem>) => void;
  loading: boolean;
  isEdit?: boolean;
  takenSortNumbers?: number[];
  availableCategories?: string[];
}) {
  const [form, setForm] = useState<any>({
    ...emptyItemForSection(sectionKey),
    ...initial,
  });

  const set = (key: string, value: any) =>
    setForm((prev: any) => ({ ...prev, [key]: value }));
  const [uploading, setUploading] = useState(false);
  const [imageValid, setImageValid] = useState(true);
  const [videoUploading, setVideoUploading] = useState(false);
  const busy = uploading || videoUploading;

  // Images uploaded while this form was open. When it closes, any that weren't
  // the one saved (replaced, removed, or the form was cancelled) are deleted.
  const uploadedRef = useRef<string[]>([]);
  const savedPictureRef = useRef<string | null>(null);
  const savedVideoRef = useRef<string | null>(null);
  useEffect(() => () => {
    uploadedRef.current
      .filter((url) => url !== savedPictureRef.current && url !== savedVideoRef.current)
      .forEach((url) => deleteOwnedImage(url));
  }, []);

  const currentSortTaken =
    isCarouselSection(sectionKey) &&
    form.sortNumber > 0 &&
    takenSortNumbers.filter(n => n !== (isEdit ? initial.sortNumber : null)).includes(form.sortNumber);

  // A carousel slide needs an image or a video to show; with neither it can
  // still be saved, but only as hidden (sort 0)
  const hasMedia = (f: any) => !!f.picture?.trim() || !!f.video?.trim();
  const carouselNoImage = isCarouselSection(sectionKey) && !hasMedia(form);
  const lastSortRef = useRef<number>(0);
  const setMedia = (key: "picture" | "video", url: string) =>
    setForm((prev: any) => {
      const next = { ...prev, [key]: url };
      if (!isCarouselSection(sectionKey)) return next;
      if (hasMedia(prev) && !hasMedia(next)) {
        if (prev.sortNumber > 0) lastSortRef.current = prev.sortNumber;
        return { ...next, sortNumber: 0 };
      }
      // Media back: restore the slide's previous position if it had one
      const restore = !hasMedia(prev) && hasMedia(next) && prev.sortNumber === 0 && lastSortRef.current > 0;
      return restore ? { ...next, sortNumber: lastSortRef.current } : next;
    });
  const setPicture = (url: string) => setMedia("picture", url);

  // One media per slide: an image OR a video. Switching type clears the other
  // (the old file is removed from Storage when the slide is saved).
  const [mediaType, setMediaType] = useState<"image" | "video">(
    (initial as { video?: string }).video ? "video" : "image"
  );
  const switchMediaType = (t: "image" | "video") => {
    if (t === mediaType) return;
    setMediaType(t);
    setImageValid(true);
    setMedia(t === "video" ? "picture" : "video", "");
    if (t === "image" && slideAudience(form)) set("audience", null); // images have no button
  };

  const countries: string[] = isCarouselSection(sectionKey) ? slideCountries(form) : [];
  // Home is 16:9; the Gig Worker / Gig Host carousels are a 140px-tall banner
  const carouselShape: CarouselShape = sectionKey === "carousel_items" ? "home" : "banner";
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const audience = slideAudience(form);

  const canSubmit =
    isCarouselSection(sectionKey)
      ? !!form.imageName?.trim() && !currentSortTaken && imageValid && countries.length > 0
      : !!form.title?.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .if-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 5px; }
        .if-input, .if-textarea { width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; box-sizing: border-box; }
        .if-input:focus, .if-textarea:focus { border-color: var(--blue); }
        .if-textarea { resize: vertical; min-height: 100px; line-height: 1.6; }
        .if-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .if-sort-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .if-select { width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; }
        .if-select:focus { border-color: var(--blue); }
        .if-media-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .if-media-switch { display: flex; gap: 2px; padding: 3px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .if-media-switch button {
          padding: 4px 14px; font-size: 12px; font-weight: 600; font-family: inherit; border: none; border-radius: 6px;
          color: var(--text-muted); background: none; cursor: pointer;
        }
        .if-media-switch button.active { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
        .if-media-switch button:disabled { cursor: default; opacity: 0.6; }
        .if-link { font-size: 12px; font-weight: 600; color: var(--blue); background: none; border: none; cursor: pointer; padding: 0; font-family: inherit; }
        .if-link:disabled { opacity: 0.5; cursor: default; }
        .if-media-tip {
          display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; padding: 9px 11px;
          font-size: 12px; line-height: 1.5; color: var(--text-secondary);
          background: var(--blue-dim); border: 1px solid var(--blue); border-radius: var(--radius-sm);
        }
        .if-media-tip > svg { color: var(--blue); flex-shrink: 0; margin-top: 2px; }
        .if-media-tip b { color: var(--text-primary); }
        .if-media-tip-meta { margin-top: 3px; font-size: 11px; color: var(--text-muted); }
      `}</style>

      {isCarouselSection(sectionKey) && (
        <>
          <div>
            <div className="if-media-head">
              <label className="if-label" style={{ marginBottom: 0 }}>Media</label>
              <div className="if-media-switch" role="radiogroup" aria-label="Media type">
                {(["image", "video"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={mediaType === t}
                    className={mediaType === t ? "active" : ""}
                    onClick={() => switchMediaType(t)}
                    disabled={loading || busy}
                  >
                    {t === "image" ? "Image" : "Video"}
                  </button>
                ))}
              </div>
            </div>

            <div className="if-media-tip">
              <InfoIcon size={14} />
              <div>
                <b>Best fit: {SHAPE_ADVICE[carouselShape].best}</b> — {SHAPE_ADVICE[carouselShape][mediaType]}.{" "}
                {SHAPE_ADVICE[carouselShape].tip}
                <div className="if-media-tip-meta">
                  {mediaType === "image"
                    ? "JPG, PNG or WebP · up to 5 MB"
                    : "MP4 (H.264) · up to 25 MB · up to 30 seconds · plays with sound (users can mute)"}
                </div>
              </div>
            </div>

            {mediaType === "image" ? (
              <>
                <ImageUploadField
                  value={form.picture ?? ""}
                  onChange={setPicture}
                  folder="app_content/carousel"
                  disabled={loading}
                  onUploadingChange={setUploading}
                  onValidityChange={setImageValid}
                  onUploaded={(url) => uploadedRef.current.push(url)}
                  onFileChosen={(name) => setForm((prev: any) => (prev.imageName?.trim() ? prev : { ...prev, imageName: name }))}
                />
                <input className="if-input" style={{ marginTop: 8 }} placeholder="…or paste an image URL" value={form.picture ?? ""} onChange={(e) => setPicture(e.target.value)} disabled={loading || uploading} />
              </>
            ) : (
              <>
                <VideoUploadField
                  value={form.video ?? ""}
                  onChange={(url) => setMedia("video", url)}
                  folder="app_content/carousel/videos"
                  disabled={loading}
                  onUploadingChange={setVideoUploading}
                  onUploaded={(url) => uploadedRef.current.push(url)}
                />
                <div className="if-sort-hint">Plays with sound in the app&apos;s home carousel (users can mute it), then moves to the next slide.</div>
              </>
            )}
            {carouselNoImage && (
              <div className="if-sort-hint" style={{ color: "var(--amber)" }}>
                No {mediaType} — this slide will be saved as hidden (sort 0). Add {mediaType === "image" ? "an image" : "a video"} to publish it.
              </div>
            )}
          </div>
          {(() => {
            // How the slide will look in the app, before saving
            const src = mediaType === "image" ? form.picture?.trim() : form.video?.trim();
            if (!src || busy || (mediaType === "image" && !imageValid)) return null;
            return <CarouselPreview key={`${mediaType}:${src}`} kind={mediaType} src={src} shape={carouselShape} />;
          })()}
          <div>
            <div className="if-media-head">
              <label className="if-label" style={{ marginBottom: 0 }}>Show in countries *</label>
              <button type="button" className="if-link" onClick={() => setCountryPickerOpen(true)} disabled={loading}>
                Choose countries
              </button>
            </div>
            <CountrySummary codes={countries} />
            <div className="if-sort-hint" style={countries.length === 0 ? { color: "var(--red)" } : undefined}>
              {countries.length === 0
                ? "Pick at least one country — otherwise no one would see this slide."
                : coversAllCountries(countries)
                  ? "Shown to users in every available country."
                  : "Only users in the chosen countries will see this slide."}
            </div>
            <CountryPickerModal
              open={countryPickerOpen}
              value={countries}
              onClose={() => setCountryPickerOpen(false)}
              onApply={(codes) => set("countries", codes)}
            />
          </div>
          {mediaType === "video" && hasRoleHighlight(sectionKey) && <div>
            <div className="if-media-head">
              <label className="if-label" style={{ marginBottom: 0 }}>Plays when highlighted</label>
              <div className="if-media-switch" role="radiogroup" aria-label="Plays when highlighted">
                {[{ value: null, label: "None" }, ...CAROUSEL_AUDIENCES].map((a) => (
                  <button
                    key={a.value ?? "none"}
                    type="button"
                    role="radio"
                    aria-checked={audience === a.value}
                    className={audience === a.value ? "active" : ""}
                    onClick={() => set("audience", a.value)}
                    disabled={loading}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="if-sort-hint">
              {audience
                ? CAROUSEL_AUDIENCES.find((a) => a.value === audience)?.hint
                : "Plays only in the normal carousel rotation. No button jumps to it."}
            </div>
          </div>}
          <div>
            <label className="if-label">Image Name *</label>
            <input className="if-input" value={form.imageName ?? ""} onChange={(e) => set("imageName", e.target.value)} disabled={loading} placeholder="Display name for this carousel item…" />
          </div>
        </>
      )}

      {sectionKey === "updates" && (
        <div>
          <label className="if-label">Category</label>
          <select
            className="if-select"
            value={(form as any).category ?? ""}
            onChange={(e) => set("category", e.target.value)}
            disabled={loading}
          >
            <option value="">— Select a category —</option>
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      )}

      {sectionKey === "help_faq" && (
        <div>
          <label className="if-label">Category</label>
          <input className="if-input" value={(form as any).category ?? ""} onChange={(e) => set("category", e.target.value)} disabled={loading} placeholder="e.g. Account, Payments…" />
        </div>
      )}

      {!isCarouselSection(sectionKey) && (
        <div>
          <label className="if-label">Title *</label>
          <input className="if-input" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={loading} placeholder="Title…" />
        </div>
      )}
      {!isCarouselSection(sectionKey) && (
        <div>
          <label className="if-label">Body Text</label>
          <textarea className="if-textarea" style={{ minHeight: 140 }} value={form.body ?? ""} onChange={(e) => set("body", e.target.value)} disabled={loading} placeholder="Body content…" />
        </div>
      )}
      <div className="if-row">
        <div>
          <label className="if-label">Sort Number</label>
          <input
            className="if-input"
            type="number"
            min={0}
            value={form.sortNumber ?? 0}
            onChange={(e) => set("sortNumber", parseInt(e.target.value) || 0)}
            disabled={loading || carouselNoImage}
            title={carouselNoImage ? `Add ${mediaType === "image" ? "an image" : "a video"} to publish this slide` : undefined}
            style={{
              borderColor: currentSortTaken ? "var(--red)" : undefined,
            }}
          />
          {currentSortTaken && (
            <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>
              ⚠️ This sort number is already taken. Please choose a different one.
            </div>
          )}
          <div className="if-sort-hint">{`0   = the content should not be displayed.`}</div>
          <div className="if-sort-hint">{`1+ = the content is visible and ordered accordingly.`}</div>
        </div>
        {hasCategories(sectionKey) && (
          <div>
            <label className="if-label">Sort# in Category</label>
            <input className="if-input" type="number" min={0} value={(form as any).sortNumberByCategory ?? 0} onChange={(e) => set("sortNumberByCategory", parseInt(e.target.value) || 0)} disabled={loading} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <Button variant="primary" size="sm" loading={loading} onClick={() => {
          const data = isCarouselSection(sectionKey)
            ? (mediaType === "video" ? { ...form, picture: "" } : { ...form, video: "" })
            : form;
          savedPictureRef.current = data.picture || null;
          savedVideoRef.current = data.video || null;
          onSubmit(carouselNoImage ? { ...data, sortNumber: 0 } : data);
        }} disabled={!canSubmit || loading || busy}>
          {isEdit ? "Save Changes" : "Create Item"}
        </Button>
      </div>
    </div>
  );
}

// ─── Categories Manager Modal ─────────────────────────────────────────────────

function CategoriesManagerModal({
  open,
  onClose,
  currentCategories,
  onSave,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  currentCategories: string[];
  onSave: (categories: string[]) => void;
  loading: boolean;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const [newInput, setNewInput] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState("");

  // Sync working copy when modal opens
  useEffect(() => {
    if (open) {
      setCategories([...currentCategories]);
      setNewInput("");
      setEditIndex(null);
      setEditValue("");
      setError("");
    }
  }, [open, currentCategories]);

  const handleAdd = () => {
    const trimmed = newInput.trim();
    if (!trimmed) { setError("Category name cannot be empty."); return; }
    if (categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setError("This category already exists.");
      return;
    }
    setCategories((prev) => [...prev, trimmed]);
    setNewInput("");
    setError("");
  };

  const handleDelete = (idx: number) => {
    if (editIndex === idx) { setEditIndex(null); setEditValue(""); }
    setCategories((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStartEdit = (idx: number) => {
    setEditIndex(idx);
    setEditValue(categories[idx]);
    setError("");
  };

  const handleSaveEdit = () => {
    if (editIndex === null) return;
    const trimmed = editValue.trim();
    if (!trimmed) { setError("Category name cannot be empty."); return; }
    if (categories.some((c, i) => i !== editIndex && c.toLowerCase() === trimmed.toLowerCase())) {
      setError("This category already exists.");
      return;
    }
    setCategories((prev) => prev.map((c, i) => (i === editIndex ? trimmed : c)));
    setEditIndex(null);
    setEditValue("");
    setError("");
  };

  const handleCancelEdit = () => {
    setEditIndex(null);
    setEditValue("");
    setError("");
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage Categories — Updates" size="md" description="Define the list of categories available when creating or editing update items.">
      <style>{`
        .cm-cat-list { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow-y: auto; margin-bottom: 16px; }
        .cm-cat-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .cm-cat-row-name { flex: 1; font-size: 13px; color: var(--text-primary); }
        .cm-cat-edit-input { flex: 1; background: var(--bg-surface); border: 1px solid var(--blue); border-radius: 4px; padding: 4px 8px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; }
        .cm-cat-add-row { display: flex; gap: 8px; align-items: center; }
        .cm-cat-add-input { flex: 1; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; }
        .cm-cat-add-input:focus { border-color: var(--blue); }
        .cm-cat-error { font-size: 11px; color: var(--red); margin-top: 4px; }
        .cm-cat-empty { font-size: 12px; color: var(--text-muted); padding: 16px; text-align: center; }
        .cm-cat-icon-btn { width: 26px; height: 26px; border-radius: 5px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; transition: all 0.15s; flex-shrink: 0; }
        .cm-cat-icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .cm-cat-icon-btn.danger:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.25); }
        .cm-cat-icon-btn.confirm { background: var(--blue); border-color: var(--blue); color: #fff; }
        .cm-cat-icon-btn.confirm:hover { opacity: 0.85; }
      `}</style>

      <div className="cm-cat-list">
        {categories.length === 0 ? (
          <div className="cm-cat-empty">No categories yet. Add one below.</div>
        ) : (
          categories.map((cat, idx) => (
            <div key={idx} className="cm-cat-row">
              {editIndex === idx ? (
                <>
                  <input
                    className="cm-cat-edit-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") handleCancelEdit(); }}
                    autoFocus
                    disabled={loading}
                  />
                  <button className="cm-cat-icon-btn confirm" title="Save" onClick={handleSaveEdit} disabled={loading}>
                    <Check size={11} />
                  </button>
                  <button className="cm-cat-icon-btn" title="Cancel" onClick={handleCancelEdit} disabled={loading}>
                    <X size={11} />
                  </button>
                </>
              ) : (
                <>
                  <span className="cm-cat-row-name">{cat}</span>
                  <button className="cm-cat-icon-btn" title="Edit" onClick={() => handleStartEdit(idx)} disabled={loading}>
                    <Edit2 size={11} />
                  </button>
                  <button className="cm-cat-icon-btn danger" title="Delete" onClick={() => handleDelete(idx)} disabled={loading}>
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <div className="cm-cat-add-row">
        <input
          className="cm-cat-add-input"
          placeholder="New category name…"
          value={newInput}
          onChange={(e) => { setNewInput(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          disabled={loading}
        />
        <Button variant="secondary" size="sm" icon={Plus} onClick={handleAdd} disabled={loading || !newInput.trim()}>
          Add
        </Button>
      </div>
      {error && <div className="cm-cat-error">{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 16, borderTop: "1px solid var(--border)", marginTop: 16 }}>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="primary" size="sm" loading={loading} onClick={() => onSave(categories)}>
          Save Categories
        </Button>
      </div>
    </Modal>
  );
}

// ─── Settings Form ────────────────────────────────────────────────

function SectionSettingsForm({
  sectionKey,
  initial,
  onSubmit,
  loading,
}: {
  sectionKey: ContentSectionKey;
  initial: SectionOptions;
  onSubmit: (data: SectionOptions) => void;
  loading: boolean;
}) {
  const [opts, setOpts] = useState<SectionOptions>({ ...initial });
  const set = (key: string, value: any) => setOpts((p) => ({ ...p, [key]: value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .sf-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 5px; }
        .sf-input, .sf-select { width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; }
        .sf-input:focus, .sf-select:focus { border-color: var(--blue); }
        .sf-toggle { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
        .sf-toggle-label { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
        .sf-toggle input { accent-color: var(--blue); width: 15px; height: 15px; cursor: pointer; }
      `}</style>
      <div>
        <label className="sf-label">Sort Mode</label>
        <select className="sf-select" value={opts.sortMode ?? "manual"} onChange={(e) => set("sortMode", e.target.value)}>
          <option value="manual">Manual / Custom (sortNumber)</option>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>
      <div>
        <label className="sf-label">Max Visible Items</label>
        <input className="sf-input" type="number" min={0} value={opts.maxVisibleItems ?? 0} onChange={(e) => set("maxVisibleItems", parseInt(e.target.value) || 0)} placeholder="0 = show all" />
      </div>
      {isCarouselSection(sectionKey) && (
        <>
          <label className="sf-toggle"><span className="sf-toggle-label">Autoplay</span><input type="checkbox" checked={!!opts.autoplay} onChange={(e) => set("autoplay", e.target.checked)} /></label>
          <div>
            <label className="sf-label">Transition Interval (ms)</label>
            <input className="sf-input" type="number" min={500} step={500} value={opts.transitionInterval ?? 3000} onChange={(e) => set("transitionInterval", parseInt(e.target.value) || 3000)} />
          </div>
          <label className="sf-toggle"><span className="sf-toggle-label">Show Navigation Arrows</span><input type="checkbox" checked={!!opts.showArrows} onChange={(e) => set("showArrows", e.target.checked)} /></label>
          <label className="sf-toggle"><span className="sf-toggle-label">Show Dots / Indicators</span><input type="checkbox" checked={!!opts.showDots} onChange={(e) => set("showDots", e.target.checked)} /></label>
          <label className="sf-toggle"><span className="sf-toggle-label">Loop</span><input type="checkbox" checked={!!opts.loop} onChange={(e) => set("loop", e.target.checked)} /></label>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <Button variant="primary" size="sm" loading={loading} onClick={() => onSubmit(opts)}>Save Settings</Button>
      </div>
    </div>
  );
}

// ─── Section Panel ────────────────────────────────────────────────────────────

function SectionPanel({
  sectionKey,
  sectionState,
  onRefresh,
  content,
}: {
  sectionKey: ContentSectionKey;
  sectionState: SectionState;
  onRefresh: () => void;
  content: ReturnType<typeof useContent>;
}) {
  const meta = getSectionMeta(sectionKey);
  const { submitting, createItem, updateItem, deleteItem, shuffleItems, saveSettings, saveCategories } = content;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [replacing, setReplacing] = useState<{ form: Partial<ContentItem>; mode: "create" | "edit"; conflicts: { item: ContentItem; overlap: string[]; keep: string[] }[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [catMgrOpen, setCatMgrOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // For the updates section: use stored categories, falling back to predefined list
  const availableCategories: string[] =
    sectionKey === "updates"
      ? (sectionState.data?.categories ?? PREDEFINED_CATEGORIES)
      : [];

  const takenSortNumbers =
    isCarouselSection(sectionKey) && sectionState.data
      ? sectionState.data.items
          .map(item => (item as any).sortNumber)
          .filter(n => n > 0)
      : [];

  if (sectionState.loading && !sectionState.data) return <SectionSkeleton />;
  if (sectionState.error && !sectionState.data) return <SectionError error={sectionState.error} onRetry={onRefresh} />;
  if (!sectionState.data) return <SectionSkeleton />;

  const data = sectionState.data;

  const filteredItems = data.items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      getItemTitle(item, sectionKey).toLowerCase().includes(q) ||
      ((item as any).category ?? "").toLowerCase().includes(q)
    );
  });

  // Pagination calculations
  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  // Clamp currentPage in case items are deleted or search narrows results
  const safePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const pagedItems = filteredItems.slice(pageStartIndex, pageStartIndex + ITEMS_PER_PAGE);

  // Reset to page 1 when search changes
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  // One video per role button per country: a published Gig Worker / Gig Host
  // video slide takes that button over. Older videos for the same button in
  // any of its countries lose their button (all countries — a slide has one
  // button) but stay in the carousel's normal rotation.
  type RoleConflict = { item: ContentItem; overlap: string[]; keep: string[] };
  const roleVideoConflicts = (form: Partial<ContentItem>, selfId?: string): RoleConflict[] => {
    if (!hasRoleHighlight(sectionKey) || !videoOf(form) || (form.sortNumber ?? 0) <= 0) return [];
    const audience = slideAudience(form);
    if (!audience) return [];
    const countries = slideCountries(form);
    return data.items
      .filter((item) => item.id !== selfId && item.sortNumber > 0 && !!videoOf(item) && slideAudience(item) === audience)
      .map((item) => {
        const theirs = slideCountries(item);
        return { item, overlap: theirs.filter((c) => countries.includes(c)), keep: theirs.filter((c) => !countries.includes(c)) };
      })
      .filter((c) => c.overlap.length > 0);
  };

  const countryList = (codes: string[]) => codes.map((c) => countryByCode(c)?.name ?? c).join(", ");

  const applyReplaced = async (conflicts: RoleConflict[]): Promise<boolean> => {
    for (const { item } of conflicts) {
      const result = await updateItem(sectionKey, meta.label, item, { audience: null } as Partial<ContentItem>);
      if (!result.success) {
        toast.error(`Couldn't update "${getItemTitle(item, sectionKey)}"`, result.error);
        return false;
      }
    }
    return true;
  };

  const confirmReplace = async () => {
    if (!replacing) return;
    const { form, mode, conflicts } = replacing;
    if (!(await applyReplaced(conflicts))) return;
    setReplacing(null);
    if (mode === "create") await saveCreate(form);
    else await saveEdit(form);
  };

  const handleCreate = async (form: Partial<ContentItem>) => {
    if (isCarouselSection(sectionKey) && (form.sortNumber ?? 0) > 0) {
      if (takenSortNumbers.includes(form.sortNumber ?? 0)) {
        toast.error("Invalid sort number", "This sort number is already taken");
        return;
      }
    }
    const conflicts = roleVideoConflicts(form);
    if (conflicts.length) { setReplacing({ form, mode: "create", conflicts }); return; }
    await saveCreate(form);
  };

  const saveCreate = async (form: Partial<ContentItem>) => {
    const result = await createItem(sectionKey, meta.label, form);
    if (result.success) {
      toast.success("Item created", meta.label);
      setCreating(false);
      onRefresh();
    } else {
      toast.error("Failed to create item", result.error);
    }
  };

  const handleEdit = async (form: Partial<ContentItem>) => {
    if (!editing) return;

    if (isCarouselSection(sectionKey) && (form.sortNumber ?? 0) > 0) {
      const sortNumberTaken = takenSortNumbers.filter(n => n !== editing.sortNumber).includes(form.sortNumber ?? 0);
      if (sortNumberTaken) {
        toast.error("Invalid sort number", "This sort number is already taken");
        return;
      }
    }
    const conflicts = roleVideoConflicts({ ...editing, ...form }, editing.id);
    if (conflicts.length) { setReplacing({ form, mode: "edit", conflicts }); return; }
    await saveEdit(form);
  };

  const saveEdit = async (form: Partial<ContentItem>) => {
    if (!editing) return;
    const result = await updateItem(sectionKey, meta.label, editing, form);
    if (result.success) {
      // The replaced / removed image is no longer referenced anywhere
      const oldPicture = pictureOf(editing);
      if (oldPicture && oldPicture !== pictureOf(form)) deleteOwnedImage(oldPicture);
      const oldVideo = videoOf(editing);
      if (oldVideo && oldVideo !== videoOf(form)) deleteOwnedImage(oldVideo);
      toast.success("Item updated");
      setEditing(null);
      onRefresh();
    } else {
      toast.error("Failed to update item", result.error);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const result = await deleteItem(sectionKey, meta.label, deleting);
    if (result.success) {
      deleteOwnedImage(pictureOf(deleting));
      deleteOwnedImage(videoOf(deleting));
      toast.success("Item deleted");
      setDeleting(null);
      // If last item on current page was deleted, go back one page
      const newTotal = filteredItems.length - 1;
      const newTotalPages = Math.max(1, Math.ceil(newTotal / ITEMS_PER_PAGE));
      if (safePage > newTotalPages) setCurrentPage(newTotalPages);
      onRefresh();
    } else {
      toast.error("Failed to delete item", result.error);
    }
  };

  const handleShuffle = async () => {
    const result = await shuffleItems(sectionKey, meta.label, sectionState.data?.items ?? []);
    if (result.success) {
      toast.success("Order shuffled", `${takenSortNumbers.length} published slides reordered`);
      setShuffling(false);
      onRefresh();
    } else {
      toast.error("Couldn't shuffle", result.error);
    }
  };

  const handleSaveSettings = async (opts: SectionOptions) => {
    const result = await saveSettings(sectionKey, meta.label, opts, data.options);
    if (result.success) {
      toast.success("Settings saved", meta.label);
      setSettingsOpen(false);
      onRefresh();
    } else {
      toast.error("Failed to save settings", result.error);
    }
  };

  // Whole-carousel visibility in the app. Slides and their settings are kept.
  const carouselHidden = isCarouselSection(sectionKey) && !!data.options.hidden;
  const setCarouselHidden = async (hidden: boolean) => {
    const result = await saveSettings(sectionKey, meta.label, { ...data.options, hidden }, data.options);
    if (result.success) {
      toast.success(hidden ? "Carousel hidden" : "Carousel shown", meta.label);
      setConfirmHide(false);
      onRefresh();
    } else {
      toast.error(hidden ? "Couldn't hide the carousel" : "Couldn't show the carousel", result.error);
    }
  };

  const handleSaveCategories = async (categories: string[]) => {
    const previous = data.categories ?? PREDEFINED_CATEGORIES;
    const result = await saveCategories(sectionKey, meta.label, categories, previous);
    if (result.success) {
      toast.success("Categories saved");
      setCatMgrOpen(false);
      onRefresh();
    } else {
      toast.error("Failed to save categories", result.error);
    }
  };

  return (
    <div>
      <style>{`
        .sp-header { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; }
        .sp-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .sp-meta { flex: 1; min-width: 0; }
        .sp-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .sp-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .sp-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .sp-search { display: flex; align-items: center; gap: 7px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 10px; flex: 1; min-width: 160px; transition: border-color 0.2s; }
        .sp-search:focus-within { border-color: var(--blue); }
        .sp-search input { background: none; border: none; outline: none; color: var(--text-primary); font-size: 12px; width: 100%; font-family: inherit; }
        .sp-search input::placeholder { color: var(--text-muted); }
        .cm-table { width: 100%; border-collapse: collapse; }
        .cm-table thead tr { background: var(--bg-elevated); border-bottom: 1px solid var(--border); }
        .cm-table th { padding: 9px 12px; text-align: left; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); white-space: nowrap; }
        .cm-table tbody tr { border-bottom: 1px solid var(--border-muted); transition: background 0.12s; }
        .cm-table tbody tr:last-child { border-bottom: none; }
        .cm-table tbody tr:hover { background: var(--bg-elevated); }
        .cm-table td { padding: 11px 12px; font-size: 12px; color: var(--text-secondary); vertical-align: top; }
        .cm-title { font-weight: 600; color: var(--text-primary); font-size: 13px; }
        .cm-body { font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cm-actions { display: flex; align-items: center; gap: 4px; }
        .cm-icon-btn { width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
        .cm-icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .cm-icon-btn.danger:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.25); }
        .cm-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .cm-empty { padding: 36px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .sp-vis { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px 5px 6px; font-size: 12px; font-weight: 600; font-family: inherit; color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; cursor: pointer; white-space: nowrap; }
        .sp-vis.on { color: var(--text-secondary); }
        .sp-vis:disabled { opacity: 0.6; cursor: not-allowed; }
        .sp-vis-track { position: relative; width: 28px; height: 16px; border-radius: 10px; background: var(--bg-hover); border: 1px solid var(--border); transition: background 0.15s; }
        .sp-vis.on .sp-vis-track { background: var(--green, #22c55e); border-color: transparent; }
        .sp-vis-thumb { position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.3); transition: transform 0.15s; }
        .sp-vis.on .sp-vis-thumb { transform: translateX(12px); }
        .sp-hidden-note { margin-bottom: 14px; padding: 10px 12px; font-size: 12.5px; color: var(--text-secondary); background: var(--bg-elevated); border: 1px dashed var(--border); border-radius: var(--radius-sm); }
        .sp-refreshing { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); }
        .spin-anim { animation: sp-spin 0.9s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div className="sp-header">
        <div className="sp-icon" style={{ background: `${meta.color}18` }}>
          <meta.icon size={18} style={{ color: meta.color }} />
        </div>
        <div className="sp-meta">
          <div className="sp-title">{meta.label}</div>
          <div className="sp-desc">{meta.description}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {sectionState.loading && (
            <span className="sp-refreshing">
              <RefreshCw size={11} className="spin-anim" /> Refreshing…
            </span>
          )}
          {isCarouselSection(sectionKey) && (
            <button
              type="button"
              role="switch"
              aria-checked={!carouselHidden}
              className={`sp-vis${carouselHidden ? "" : " on"}`}
              disabled={submitting}
              onClick={() => (carouselHidden ? setCarouselHidden(false) : setConfirmHide(true))}
              title={carouselHidden ? "Hidden in the app. Click to show it." : "Shown in the app. Click to hide it."}
            >
              <span className="sp-vis-track"><span className="sp-vis-thumb" /></span>
              {carouselHidden ? "Hidden in app" : "Shown in app"}
            </button>
          )}
          {data.lastUpdated && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {formatDate(data.lastUpdated)}
            </span>
          )}
        </div>
      </div>

      {carouselHidden && (
        <div className="sp-hidden-note">
          This carousel is hidden in the app. You can still edit its slides; nobody sees them until you switch it back on.
        </div>
      )}

      {/* Toolbar */}
      <div className="sp-toolbar">
        <div className="sp-search">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            placeholder="Search items…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {search && (
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }} onClick={() => handleSearchChange("")}>
              <X size={11} />
            </button>
          )}
        </div>
        <button
          className="cm-icon-btn"
          title="Refresh this section"
          onClick={onRefresh}
          disabled={sectionState.loading}
        >
          <RefreshCw size={13} className={sectionState.loading ? "spin-anim" : ""} />
        </button>
        {sectionKey === "updates" && (
          <button className="cm-icon-btn" title="Manage categories" onClick={() => setCatMgrOpen(true)}>
            <Tag size={13} />
          </button>
        )}
        {!isCarouselSection(sectionKey) && (
          <button className="cm-icon-btn" title="Section settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={13} />
          </button>
        )}
        {isCarouselSection(sectionKey) && (
          <Button
            variant="secondary"
            size="sm"
            icon={Shuffle}
            onClick={() => setShuffling(true)}
            disabled={submitting || takenSortNumbers.length < 2}
            title={takenSortNumbers.length < 2 ? "Needs at least 2 published slides" : "Randomly reorder the published slides"}
          >
            Shuffle order
          </Button>
        )}
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Add Item
        </Button>
      </div>

      {/* Table */}
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        <table className="cm-table">
          <thead>
            <tr>
              {hasCategories(sectionKey) && <th>Category</th>}
              <th>Content</th>
              {isCarouselSection(sectionKey) && <th>Countries</th>}
              {hasRoleHighlight(sectionKey) && <th>Highlight</th>}
              <th>Sort #</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.length === 0 ? (
              <tr>
                <td colSpan={5 + (hasCategories(sectionKey) ? 1 : 0) + (isCarouselSection(sectionKey) ? 1 : 0) + (hasRoleHighlight(sectionKey) ? 1 : 0)} className="cm-empty">
                  No items found.{!search && ` Click "Add Item" to create the first one.`}
                </td>
              </tr>
            ) : (
              pagedItems.map((item) => (
                <tr key={item.id}>
                  {hasCategories(sectionKey) && (
                    <td><Badge variant="blue">{(item as any).category || "—"}</Badge></td>
                  )}
                  <td>
                    <div className="cm-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {getItemTitle(item, sectionKey)}
                      {videoOf(item) && <Badge variant="purple">Video</Badge>}
                    </div>
                  </td>
                  {isCarouselSection(sectionKey) && (
                    <td><CountrySummary codes={slideCountries(item)} compact /></td>
                  )}
                  {hasRoleHighlight(sectionKey) && (
                    <td>
                      {!videoOf(item) ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : slideAudience(item) ? (
                        <Badge variant={slideAudience(item) === "worker" ? "blue" : "amber"}>
                          {slideAudience(item) === "worker" ? "Gig Worker" : "Gig Host"}
                        </Badge>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }} title="No button jumps to this video; it plays in the normal rotation">None</span>
                      )}
                    </td>
                  )}
                  <td style={{ fontFamily: "'Space Mono', monospace" }}>{item.sortNumber}</td>
                  <td>
                    <Badge variant={item.sortNumber > 0 ? "green" : "amber"} dot>
                      {item.sortNumber > 0 ? "Published" : "Hidden"}
                    </Badge>
                  </td>
                  <td>{formatDate(item.dateUpdated)}</td>
                  <td>
                    <div className="cm-actions">
                      <button className="cm-icon-btn" title="Edit" onClick={() => setEditing(item)}>
                        <Edit2 size={12} />
                      </button>
                      <button className="cm-icon-btn danger" title="Delete" onClick={() => setDeleting(item)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={safePage}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={ITEMS_PER_PAGE}
        onPageChange={setCurrentPage}
      />

      {sectionState.lastFetched && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", paddingTop: 8 }}>
          Fetched {new Date(sectionState.lastFetched).toLocaleString("en-PH", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })}
        </div>
      )}

      {/* Modals */}
      <Modal open={creating} onClose={() => setCreating(false)} title={`Add Item — ${meta.label}`} size="md">
        <ItemForm sectionKey={sectionKey} initial={emptyItemForSection(sectionKey)} onSubmit={handleCreate} loading={submitting} takenSortNumbers={takenSortNumbers} availableCategories={availableCategories} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit Item — ${meta.label}`} size="md">
        {editing && (
          <ItemForm sectionKey={sectionKey} initial={editing} onSubmit={handleEdit} loading={submitting} isEdit takenSortNumbers={takenSortNumbers} availableCategories={availableCategories} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!replacing}
        onClose={() => setReplacing(null)}
        onConfirm={confirmReplace}
        title={`Replace the ${replacing && slideAudience(replacing.form) === "host" ? "Gig Host" : "Gig Worker"} video?`}
        message={replacing ? `Tapping ${slideAudience(replacing.form) === "host" ? "Gig Host" : "Gig Worker"} will play ${getItemTitle(replacing.form, sectionKey) !== "(No name)" ? `"${getItemTitle(replacing.form, sectionKey)}"` : "this slide"} instead. The current ${slideAudience(replacing.form) === "host" ? "Gig Host" : "Gig Worker"} ${replacing.conflicts.length === 1 ? "video stays" : "videos stay"} in the carousel without the highlight:` : ""}
        confirmLabel="Replace & save"
        loading={submitting}
      >
        {replacing && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {replacing.conflicts.map(({ item, keep }) => (
              <li key={item.id}>
                <b style={{ color: "var(--text-primary)" }}>&ldquo;{getItemTitle(item, sectionKey)}&rdquo;</b>{" "}
                ({countryList(slideCountries(item))}): Highlight changes to None.
                {keep.length > 0 && <> It also stops being the {slideAudience(replacing.form) === "host" ? "Gig Host" : "Gig Worker"} video in {countryList(keep)}.</>}
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmHide}
        onClose={() => setConfirmHide(false)}
        onConfirm={() => setCarouselHidden(true)}
        title={`Hide ${meta.label}?`}
        message="Nobody in the app will see this carousel until you show it again. The slides and their settings are kept."
        confirmLabel="Hide carousel"
        loading={submitting}
      />

      <ConfirmDialog
        open={shuffling}
        onClose={() => setShuffling(false)}
        onConfirm={handleShuffle}
        title="Shuffle carousel order?"
        message={`The ${takenSortNumbers.length} published slides will be put in a new random order, using the same sort numbers. Hidden slides (sort 0) stay hidden. The app shows the new order right away.`}
        confirmLabel="Shuffle"
        loading={submitting}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete Item"
        message={`Delete "${deleting ? getItemTitle(deleting, sectionKey) : ""}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={submitting}
      />

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={`Settings — ${meta.label}`}
        size="sm"
        description="Configure display options for this section."
      >
        <SectionSettingsForm
          sectionKey={sectionKey}
          initial={data.options}
          onSubmit={handleSaveSettings}
          loading={submitting}
        />
      </Modal>

      {sectionKey === "updates" && (
        <CategoriesManagerModal
          open={catMgrOpen}
          onClose={() => setCatMgrOpen(false)}
          currentCategories={availableCategories}
          onSave={handleSaveCategories}
          loading={submitting}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContentManagementPage() {
  useAuthGuard({ module: "content-management" });
  const { user } = useAuth();

  const actor = {
    actorId: user?.uid ?? "",
    actorName: user?.displayName ?? "Unknown",
    actorEmail: user?.email ?? "",
  };

  const content = useContent(actor);
  const { activeTab, setActiveTab } = useTabs(SECTION_KEYS);

  const { getSection, fetchSection, refreshSection } = usePerSectionData(
    content.fetchSection,
  );

  // Which of the three carousels the Carousel tab shows (remembered per browser)
  const [carouselTab, setCarouselTabState] = useState<CarouselSectionKey>("carousel_items");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CAROUSEL_TAB_KEY);
      if (saved && (CAROUSEL_SECTION_KEYS as readonly string[]).includes(saved)) setCarouselTabState(saved as CarouselSectionKey);
    } catch { /* storage blocked */ }
  }, []);
  const setCarouselTab = (key: CarouselSectionKey) => {
    setCarouselTabState(key);
    try { localStorage.setItem(CAROUSEL_TAB_KEY, key); } catch { /* storage blocked */ }
  };
  useEffect(() => {
    if (activeTab === "carousel_items") fetchSection(carouselTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, carouselTab]);

  const handleTabChange = useCallback(
    (key: ContentSectionKey) => {
      setActiveTab(key);
    },
    [setActiveTab],
  );

  useEffect(() => {
    if (!CUSTOM_SECTIONS.includes(activeTab)) fetchSection(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const tabConfigs = SECTIONS.map((s) => {
    if (CUSTOM_SECTIONS.includes(s.key)) {
      return { ...s, count: undefined, loading: false };
    }
    if (s.key === "carousel_items") {
      // No count here: each inner carousel tab shows its own.
      return { ...s, count: undefined, loading: CAROUSEL_SECTION_KEYS.some((k) => getSection(k).loading) };
    }
    const state = getSection(s.key);
    return { ...s, count: state.data?.items.length, loading: state.loading };
  });

  return (
    <AdminLayout
      title="Content Management"
      subtitle="Manage app content sections and display settings"
    >
      <style>{`
        .cm-page { display: flex; flex-direction: column; gap: 14px; }
        .cm-tab-content { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; min-height: 320px; }
        .cm-subtabs { display: inline-flex; gap: 2px; padding: 3px; margin-bottom: 18px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); max-width: 100%; overflow-x: auto; }
        .cm-subtab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 16px; font-size: 12.5px; font-weight: 600; font-family: inherit; border: none; border-radius: 6px; color: var(--text-muted); background: none; cursor: pointer; white-space: nowrap; }
        .cm-subtab:hover:not(.active) { color: var(--text-secondary); }
        .cm-subtab.active { background: var(--bg-surface); color: var(--text-primary); box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
      `}</style>

      <div className="cm-page">
        <TabBar tabs={tabConfigs} activeTab={activeTab} onChange={handleTabChange} />

        <div className="cm-tab-content">
          {activeTab === "about_giggre" && (
            <AboutGiggrePanel actor={actor} />
          )}

          {activeTab === "tutorial_videos" && (
            <TutorialVideosPanel actor={actor} />
          )}

          {activeTab === "carousel_items" && (
            <>
              <div className="cm-subtabs" role="tablist" aria-label="Carousels">
                {CAROUSEL_TABS.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      role="tab"
                      aria-selected={carouselTab === c.key}
                      className={`cm-subtab${carouselTab === c.key ? " active" : ""}`}
                      onClick={() => setCarouselTab(c.key)}
                    >
                      {c.tab}
                    </button>
                ))}
              </div>
              <SectionPanel
                key={carouselTab}
                sectionKey={carouselTab}
                sectionState={getSection(carouselTab)}
                onRefresh={() => refreshSection(carouselTab)}
                content={content}
              />
            </>
          )}

          {ITEM_BASED_SECTIONS.filter((key) => key !== "carousel_items").map((key) =>
            activeTab === key ? (
              <SectionPanel
                key={key}
                sectionKey={key}
                sectionState={getSection(key)}
                onRefresh={() => refreshSection(key)}
                content={content}
              />
            ) : null
          )}
        </div>
      </div>
    </AdminLayout>
  );
}