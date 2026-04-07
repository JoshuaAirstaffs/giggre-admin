"use client";

import { useState, useCallback, useEffect} from "react";
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
  type ContentItem,
  type SectionOptions,
  type SectionData,
} from "@/hooks/useContent";
import { AboutGiggrePanel } from "@/components/ui/content/AboutGiggrePanel";
import type { ContentSectionKey } from "@/lib/activitylog";
import {
  Plus, Edit2, Trash2, Settings,
  Image, HelpCircle, Shield, ScrollText, Info, RefreshCw,
  X, Upload, AlertCircle,
  ChevronLeft, ChevronRight,
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
  ];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

const ITEM_BASED_SECTIONS = SECTION_KEYS.filter((k) => k !== "about_giggre");

const ITEMS_PER_PAGE = 10;

function getSectionMeta(key: ContentSectionKey) {
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

function ItemForm({
  sectionKey,
  initial,
  onSubmit,
  loading,
  isEdit,
  takenSortNumbers = [],
}: {
  sectionKey: ContentSectionKey;
  initial: Partial<ContentItem>;
  onSubmit: (data: Partial<ContentItem>) => void;
  loading: boolean;
  isEdit?: boolean;
  takenSortNumbers?: number[];
}) {
  const [form, setForm] = useState<any>({
    ...emptyItemForSection(sectionKey),
    ...initial,
  });

  const set = (key: string, value: any) =>
    setForm((prev: any) => ({ ...prev, [key]: value }));

  const currentSortTaken =
    sectionKey === "carousel_items" &&
    form.sortNumber > 0 &&
    takenSortNumbers.filter(n => n !== (isEdit ? initial.sortNumber : null)).includes(form.sortNumber);

  const canSubmit =
    sectionKey === "carousel_items"
      ? !!form.picture?.trim() && !!form.imageName?.trim() && !currentSortTaken
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
        .if-upload { width: 100%; height: 90px; background: var(--bg-elevated); border: 2px dashed var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-muted); font-size: 12px; cursor: pointer; transition: border-color 0.2s; }
        .if-upload:hover { border-color: var(--blue); color: var(--blue); }
      `}</style>

      {sectionKey === "carousel_items" && (
        <>
          <div>
            <label className="if-label">Image URL *</label>
            <div className="if-upload" onClick={() => toast.info("Image upload", "Storage integration coming soon")}>
              <Upload size={16} /><span>Click to upload or paste URL below</span>
            </div>
            <input className="if-input" style={{ marginTop: 8 }} placeholder="Paste image URL (Firebase Storage or external)…" value={form.picture ?? ""} onChange={(e) => set("picture", e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="if-label">Image Name *</label>
            <input className="if-input" value={form.imageName ?? ""} onChange={(e) => set("imageName", e.target.value)} disabled={loading} placeholder="Display name for this carousel item…" />
          </div>
        </>
      )}
      {hasCategories(sectionKey) && (
        <div>
          <label className="if-label">Category *</label>
          <input className="if-input" value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} disabled={loading} placeholder="e.g. Feature, General…" />
        </div>
      )}
      {sectionKey !== "carousel_items" && (
        <div>
          <label className="if-label">Title *</label>
          <input className="if-input" value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} disabled={loading} placeholder="Title…" />
        </div>
      )}
      {sectionKey !== "carousel_items" && (
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
            disabled={loading}
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
        <Button variant="primary" size="sm" loading={loading} onClick={() => onSubmit(form)} disabled={!canSubmit || loading}>
          {isEdit ? "Save Changes" : "Create Item"}
        </Button>
      </div>
    </div>
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
      {sectionKey === "carousel_items" && (
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
  const { submitting, createItem, updateItem, deleteItem, saveSettings } = content;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const takenSortNumbers =
    sectionKey === "carousel_items" && sectionState.data
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

  const handleCreate = async (form: Partial<ContentItem>) => {
    if (sectionKey === "carousel_items" && (form.sortNumber ?? 0) > 0) {
      if (takenSortNumbers.includes(form.sortNumber ?? 0)) {
        toast.error("Invalid sort number", "This sort number is already taken");
        return;
      }
    }

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

    if (sectionKey === "carousel_items" && (form.sortNumber ?? 0) > 0) {
      const sortNumberTaken = takenSortNumbers.filter(n => n !== editing.sortNumber).includes(form.sortNumber ?? 0);
      if (sortNumberTaken) {
        toast.error("Invalid sort number", "This sort number is already taken");
        return;
      }
    }

    const result = await updateItem(sectionKey, meta.label, editing, form);
    if (result.success) {
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
          <Badge variant="blue">{data.items.length} items</Badge>
          {data.lastUpdated && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {formatDate(data.lastUpdated)}
            </span>
          )}
        </div>
      </div>

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
        {sectionKey !== "carousel_items" && (
          <button className="cm-icon-btn" title="Section settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={13} />
          </button>
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
              <th>Sort #</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.length === 0 ? (
              <tr>
                <td colSpan={hasCategories(sectionKey) ? 6 : 5} className="cm-empty">
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
                    <div className="cm-title">{getItemTitle(item, sectionKey)}</div>
                  </td>
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
        <ItemForm sectionKey={sectionKey} initial={emptyItemForSection(sectionKey)} onSubmit={handleCreate} loading={submitting} takenSortNumbers={takenSortNumbers} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit Item — ${meta.label}`} size="md">
        {editing && (
          <ItemForm sectionKey={sectionKey} initial={editing} onSubmit={handleEdit} loading={submitting} isEdit takenSortNumbers={takenSortNumbers} />
        )}
      </Modal>

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

  const handleTabChange = useCallback(
    (key: ContentSectionKey) => {
      setActiveTab(key);
    },
    [setActiveTab],
  );

  useEffect(() => {
    if (activeTab !== "about_giggre") fetchSection(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const tabConfigs = SECTIONS.map((s) => {
    if (s.key === "about_giggre") {
      return { ...s, count: undefined, loading: false };
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
      `}</style>

      <div className="cm-page">
        <TabBar tabs={tabConfigs} activeTab={activeTab} onChange={handleTabChange} />

        <div className="cm-tab-content">
          {activeTab === "about_giggre" && (
            <AboutGiggrePanel actor={actor} />
          )}

          {ITEM_BASED_SECTIONS.map((key) =>
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