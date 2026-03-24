"use client";

import { useState, useEffect, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import {
  useContent,
  emptyItemForSection,
  getItemTitle,
  hasCategories,
  type ContentItem,
  type SectionOptions,
  type SectionData,
  type CarouselItem,
} from "@/hooks/useContent";
import type { ContentSectionKey } from "@/lib/activitylog";
import {
  Plus, Edit2, Trash2, Settings, ChevronDown, ChevronUp,
  Image, HelpCircle, Shield, ScrollText, Info, RefreshCw,
  Eye, EyeOff, X, Upload,
} from "lucide-react";

// ─── Section Config ───────────────────────────────────────────────────────────

const SECTIONS: {
  key: ContentSectionKey;
  label: string;
  icon: React.ElementType;
  description: string;
  color: string;
}[] = [
  { key: "carousel_items",       label: "Carousel",           icon: Image,      description: "Home screen carousel slides",   color: "var(--blue)"   },
  { key: "updates",              label: "Updates",            icon: RefreshCw,  description: "App update announcements",       color: "var(--green)"  },
  { key: "about_giggre",         label: "About Giggre",       icon: Info,       description: "About page content sections",    color: "var(--purple)" },
  { key: "terms_and_conditions", label: "Terms & Conditions", icon: ScrollText, description: "Terms and conditions sections",  color: "var(--amber)"  },
  { key: "privacy",              label: "Privacy Policy",     icon: Shield,     description: "Privacy policy sections",        color: "var(--orange)" },
  { key: "help_faq",             label: "Help / FAQ",         icon: HelpCircle, description: "Help center FAQ items",          color: "var(--red)"    },
];

const SECTION_KEYS = SECTIONS.map((s) => s.key);

function getSectionMeta(key: ContentSectionKey) {
  return SECTIONS.find((s) => s.key === key)!;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });
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

  const set = (key: string, value: any) => {
    setForm((prev: any) => ({ ...prev, [key]: value }));
  };

  // Check if current sort number is already taken (but not by this item if editing)
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
        .if-input, .if-textarea { width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; }
        .if-input:focus, .if-textarea:focus { border-color: var(--blue); }
        .if-textarea { resize: vertical; min-height: 100px; line-height: 1.6; }
        .if-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .if-toggle-row { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .if-toggle-row input { accent-color: var(--blue); width: 14px; height: 14px; cursor: pointer; }
        .if-sort-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .if-upload { width: 100%; height: 90px; background: var(--bg-elevated); border: 2px dashed var(--border); border-radius: var(--radius-sm); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-muted); font-size: 12px; cursor: pointer; transition: border-color 0.2s; }
        .if-upload:hover { border-color: var(--blue); color: var(--blue); }
      `}</style>

      {/* <label className="if-toggle-row" style={{ userSelect: "none" }}>
        <input
          type="checkbox"
          checked={!!form.published}
          onChange={(e) => set("published", e.target.checked)}
          disabled={loading}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Published</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Visible to app users</div>
        </div>
      </label> */}

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
{/* 
      {sectionKey === "terms_and_conditions" && (
        <div>
          <label className="if-label">Section Number</label>
          <input className="if-input" value={form.numberedSection ?? ""} onChange={(e) => set("numberedSection", e.target.value)} disabled={loading} placeholder="e.g. 1, 1.1, 2…" />
        </div>
      )} */}

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

// ─── Settings Form ────────────────────────────────────────────────────────────

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
  const set = (key: string, value: any) =>
    setOpts((prev) => ({ ...prev, [key]: value }));

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
          <label className="sf-toggle">
            <span className="sf-toggle-label">Autoplay</span>
            <input type="checkbox" checked={!!opts.autoplay} onChange={(e) => set("autoplay", e.target.checked)} />
          </label>
          <div>
            <label className="sf-label">Transition Interval (ms)</label>
            <input className="sf-input" type="number" min={500} step={500} value={opts.transitionInterval ?? 3000} onChange={(e) => set("transitionInterval", parseInt(e.target.value) || 3000)} />
          </div>
          <label className="sf-toggle">
            <span className="sf-toggle-label">Show Navigation Arrows</span>
            <input type="checkbox" checked={!!opts.showArrows} onChange={(e) => set("showArrows", e.target.checked)} />
          </label>
          <label className="sf-toggle">
            <span className="sf-toggle-label">Show Dots / Indicators</span>
            <input type="checkbox" checked={!!opts.showDots} onChange={(e) => set("showDots", e.target.checked)} />
          </label>
          <label className="sf-toggle">
            <span className="sf-toggle-label">Loop</span>
            <input type="checkbox" checked={!!opts.loop} onChange={(e) => set("loop", e.target.checked)} />
          </label>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <Button variant="primary" size="sm" loading={loading} onClick={() => onSubmit(opts)}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}

// ─── Section Panel ────────────────────────────────────────────────────────────

function SectionPanel({
  sectionKey,
  data,
  onRefresh,
  content,
}: {
  sectionKey: ContentSectionKey;
  data: SectionData;
  onRefresh: () => void;
  content: ReturnType<typeof useContent>;
}) {
  const meta = getSectionMeta(sectionKey);
  const { submitting, createItem, updateItem, deleteItem, saveSettings } = content;

  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Get all taken sort numbers for carousel items (excluding 0 which means hidden)
  const takenSortNumbers = 
    sectionKey === "carousel_items" 
      ? data.items
          .map(item => (item as any).sortNumber)
          .filter(n => n > 0)
      : [];

  const filteredItems = data.items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      getItemTitle(item, sectionKey).toLowerCase().includes(q) ||
      ((item as any).category ?? "").toLowerCase().includes(q)
    );
  });

  const handleCreate = async (form: Partial<ContentItem>) => {
    // Validate carousel sort number
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
    
    // Validate carousel sort number
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
      onRefresh();
    } else {
      toast.error("Failed to delete item", result.error);
    }
  };

  // const handleTogglePublish = async (item: ContentItem) => {
  //   const result = await togglePublish(sectionKey, meta.label, item);
  //   if (result.success) {
  //     toast.success(item.published ? "Item unpublished" : "Item published");
  //     onRefresh();
  //   } else {
  //     toast.error("Failed to toggle publish", result.error);
  //   }
  // };

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

  // const publishedCount = data.items.filter((i) => i.published !== false).length;

  return (
    <div className="section-panel">
      <style>{`
        .section-panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; transition: box-shadow 0.15s; }
        .section-panel:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
        .section-header { display: flex; align-items: center; gap: 14px; padding: 16px 20px; cursor: pointer; transition: background 0.12s; user-select: none; }
        .section-header:hover { background: var(--bg-elevated); }
        .section-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .section-info { flex: 1; min-width: 0; }
        .section-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
        .section-desc { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .section-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .section-body { border-top: 1px solid var(--border); padding: 0 20px 20px; }
        .section-toolbar { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; flex-wrap: wrap; }
        .section-search { display: flex; align-items: center; gap: 7px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; flex: 1; min-width: 160px; transition: border-color 0.2s; }
        .section-search:focus-within { border-color: var(--blue); }
        .section-search input { background: none; border: none; outline: none; color: var(--text-primary); font-size: 12px; width: 100%; font-family: inherit; }
        .section-search input::placeholder { color: var(--text-muted); }
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
        .cm-empty { padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px; }
        .last-updated { font-size: 11px; color: var(--text-muted); padding: 8px 0 0; }
      `}</style>

      {/* Header */}
      <div className="section-header" onClick={() => setExpanded((e) => !e)}>
        <div className="section-icon" style={{ background: `${meta.color}18` }}>
          <meta.icon size={17} style={{ color: meta.color }} />
        </div>
        <div className="section-info">
          <div className="section-title">{meta.label}</div>
          <div className="section-desc">{meta.description}</div>
        </div>
        <div className="section-meta">
          <Badge variant="blue">{data.items.length} items</Badge>
          {/* {publishedCount < data.items.length && (
            <Badge variant="amber">{data.items.length - publishedCount} hidden</Badge>
          )} */}
          {data.lastUpdated && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {formatDate(data.lastUpdated)}
            </span>
          )}
          {expanded
            ? <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
            : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
          }
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="section-body">
          <div className="section-toolbar">
            <div className="section-search">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
              </svg>
              <input
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }} onClick={() => setSearch("")}>
                  <X size={11} />
                </button>
              )}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {sectionKey !== "carousel_items" && (
                <button className="cm-icon-btn" title="Section settings" onClick={() => setSettingsOpen(true)}>
                  <Settings size={13} />
                </button>
              )}
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                Add Item
              </Button>
            </div>
          </div>

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
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="cm-empty">
                      No items found.{!search && ` Click "Add Item" to create the first one.`}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id}>
                      {hasCategories(sectionKey) && (
                        <td><Badge variant="blue">{(item as any).category || "—"}</Badge></td>
                      )}
                      <td>
                        <div className="cm-title">{getItemTitle(item, sectionKey)}</div>
                        {sectionKey === "carousel_items" && (item as CarouselItem).picture && (
                          <div className="cm-body">{(item as CarouselItem).picture}</div>
                        )}
                        {("body" in item && (item as any).body) && (
                          <div className="cm-body">{(item as any).body}</div>
                        )}
                      </td>
                      
                      {/* {sectionKey === "terms_and_conditions" && (
                        <td style={{ fontFamily: "'Space Mono', monospace", fontSize: 11 }}>
                          {(item as any).numberedSection || "—"}
                        </td>
                      )} */}
                      <td style={{ fontFamily: "'Space Mono', monospace" }}>
                        {item.sortNumber}
                      </td>
                      <td>
                        <Badge variant={item.sortNumber > 0 ? "green" : "amber"} dot>
                          {item.sortNumber > 0 ? "Published" : "Hidden"}
                        </Badge>
                      </td>
                      <td>{formatDate(item.dateUpdated)}</td>
                      <td>
                        <div className="cm-actions">
                          {/* <button
                            className="cm-icon-btn"
                            title={item.published !== false ? "Unpublish" : "Publish"}
                            onClick={() => handleTogglePublish(item)}
                          >
                            {item.published !== false ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button> */}
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

          {data.lastUpdated && (
            <div className="last-updated">
              Last updated:{" "}
              {data.lastUpdated.toLocaleString("en-PH", {
                month: "short", day: "numeric", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </div>
          )}
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

      {/* Settings modal — writes flat to the section root doc */}
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
    actorId:    user?.uid          ?? "",
    actorName:  user?.displayName  ?? "Unknown",
    actorEmail: user?.email        ?? "",
  };

  const content = useContent(actor);
  const { sectionData, loading } = content;
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      await content.fetchAll(SECTION_KEYS);
    } catch {
      toast.error("Failed to load content", "Check console for details");
    }
  }, [content]);

  useEffect(() => { loadAll(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const totalItems = Object.values(sectionData).reduce(
    (acc, d) => acc + (d?.items.length ?? 0), 0,
  );
  // const totalPublished = Object.values(sectionData).reduce(
  //   (acc, d) => acc + (d?.items.filter((i) => i.published !== false).length ?? 0), 0,
  // );

  return (
    <AdminLayout title="Content Management" subtitle="Manage app content sections and display settings">
      <style>{`
        .cm-page { display: flex; flex-direction: column; gap: 12px; }
        .cm-stats { display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
        .cm-stat { display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 14px; font-size: 12px; color: var(--text-secondary); }
        .cm-stat strong { color: var(--text-primary); font-size: 14px; font-weight: 700; }
        .cm-toolbar { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 4px; }
        .cm-refresh-btn { display: flex; align-items: center; gap: 6px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 12px; font-size: 12px; color: var(--text-secondary); cursor: pointer; transition: all 0.15s; }
        .cm-refresh-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .cm-refresh-btn svg { transition: transform 0.3s; }
        .cm-refresh-btn:hover svg { transform: rotate(180deg); }
        .cm-loading { display: flex; align-items: center; justify-content: center; padding: 80px; flex-direction: column; gap: 12px; }
        .spin-anim { animation: cm-spin 1s linear infinite; }
        @keyframes cm-spin { to { transform: rotate(360deg); } }
        .cm-section-grid { display: flex; flex-direction: column; gap: 10px; }
      `}</style>

      <div className="cm-page">
        {!loading && (
          <div className="cm-stats">
            <div className="cm-stat"><strong>{SECTIONS.length}</strong> sections</div>
            <div className="cm-stat"><strong>{totalItems}</strong> total items</div>
            {/* <div className="cm-stat">
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
              <strong>{totalPublished}</strong> published
            </div>
            {totalItems - totalPublished > 0 && (
              <div className="cm-stat">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--amber)", display: "inline-block" }} />
                <strong>{totalItems - totalPublished}</strong> hidden
              </div>
            )} */}
          </div>
        )}

        <div className="cm-toolbar">
          <button className="cm-refresh-btn" onClick={handleRefresh} disabled={refreshing || loading}>
            <RefreshCw size={13} className={refreshing ? "spin-anim" : ""} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="cm-loading">
            <RefreshCw size={22} className="spin-anim" style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading content sections…</span>
          </div>
        ) : (
          <div className="cm-section-grid">
            {SECTION_KEYS.map((key) =>
              sectionData[key] ? (
                <SectionPanel
                  key={key}
                  sectionKey={key}
                  data={sectionData[key]!}
                  onRefresh={loadAll}
                  content={content}
                />
              ) : null,
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}