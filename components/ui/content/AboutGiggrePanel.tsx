"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  RefreshCw, AlertCircle, Globe, Info, Cpu, Star, Rocket,
  Save, RotateCcw, Eye, EyeOff, CheckCircle2, ExternalLink,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toaster";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
// import TiptapEditor from "@/components/ui/texteditor/TiptapEditor"
import { sanitizeHtml, normalizeUrl, isValidUrl } from "@/lib/sanitize";
import {
  useAboutGiggre,
  validateAboutForm,
  EMPTY_FORM,
  type AboutGiggreForm,
  type AboutGiggreErrors,
} from "@/hooks/useAboutGiggre";
import type { ActorInfo } from "@/hooks/useContent";

// ─── Field definitions ────────────────────────────────────────────────────────

const RICH_FIELDS: {
  key: keyof Omit<AboutGiggreForm, "website">;
  label: string;
  icon: React.ElementType;
  placeholder: string;
  required: boolean;
  minHeight: number;
  hint: string;
}[] = [
  {
    key: "whatIsGiggre",
    label: "What is Giggre?",
    icon: Info,
    placeholder: "Describe what Giggre is and what it offers to users…",
    required: true,
    minHeight: 130,
    hint: "Shown on the About page intro section.",
  },
  {
    key: "howItWorks",
    label: "How It Works",
    icon: Cpu,
    placeholder: "Explain the step-by-step process of using Giggre…",
    required: true,
    minHeight: 140,
    hint: "Use numbered lists to outline each step.",
  },
  {
    key: "values",
    label: "Our Values",
    icon: Star,
    placeholder: "Describe the core values that guide Giggre…",
    required: false,
    minHeight: 120,
    hint: "Optional. Bullet lists work great here.",
  },
  {
    key: "mission",
    label: "Our Mission",
    icon: Rocket,
    placeholder: "Describe Giggre's mission and long-term vision…",
    required: true,
    minHeight: 120,
    hint: "Keep it concise and inspiring.",
  },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AboutSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`
        @keyframes ag-pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }
        .ag-skel { background: var(--bg-elevated); border-radius: var(--radius-sm); animation: ag-pulse 1.4s ease-in-out infinite; }
      `}</style>
      {[160, 140, 120, 120].map((h, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="ag-skel" style={{ width: 120, height: 12 }} />
          <div className="ag-skel" style={{ height: h }} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <div className="ag-skel" style={{ width: 100, height: 32 }} />
        <div className="ag-skel" style={{ width: 80, height: 32 }} />
      </div>
    </div>
  );
}

// ─── Whole-form Preview Drawer ────────────────────────────────────────────────

function PreviewDrawer({ form, onClose }: { form: AboutGiggreForm; onClose: () => void }) {
  const fields = [
    { label: "What is Giggre?", value: form.whatIsGiggre },
    { label: "How It Works", value: form.howItWorks },
    { label: "Our Values", value: form.values },
    { label: "Our Mission", value: form.mission },
  ];

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(560px, 95vw)", height: "100%",
          background: "var(--bg-surface)", borderLeft: "1px solid var(--border)",
          overflowY: "auto", padding: 28,
          display: "flex", flexDirection: "column", gap: 28,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          .ag-prev-body { font-size: 13px; line-height: 1.75; color: var(--text-secondary); }
          .ag-prev-body p { margin: 0 0 8px; }
          .ag-prev-body ul, .ag-prev-body ol { margin: 4px 0 10px 20px; }
          .ag-prev-body li { margin-bottom: 4px; }
          .ag-prev-body a { color: var(--blue); text-decoration: underline; }
          .ag-prev-body b, .ag-prev-body strong { font-weight: 700; color: var(--text-primary); }
          .ag-prev-body i, .ag-prev-body em { font-style: italic; }
        `}</style>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Content Preview</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>As it will appear in the app</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, borderRadius: 6 }}
          >
            <EyeOff size={16} />
          </button>
        </div>

        {fields.map(({ label, value }) => (
          value?.replace(/<[^>]+>/g, "").trim() ? (
            <div key={label}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border-muted)" }}>
                {label}
              </div>
              <div className="ag-prev-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }} />
            </div>
          ) : null
        ))}

        {form.website?.trim() && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border-muted)" }}>
              Website
            </div>
            <a
              href={normalizeUrl(form.website)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--blue)", textDecoration: "underline" }}
            >
              <Globe size={13} />
              {normalizeUrl(form.website)}
              <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface AboutGiggrePanelProps {
  actor: ActorInfo;
}

export function AboutGiggrePanel({ actor }: AboutGiggrePanelProps) {
  const {
    loading, saving, error: fetchError,
    fetchAboutGiggre, saveAboutGiggre, getFormFromDoc,
    document: aboutDoc, lastFetched,
  } = useAboutGiggre(actor);

  const [form, setForm] = useState<AboutGiggreForm>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<AboutGiggreErrors>({});
  const [touched, setTouched] = useState<Set<keyof AboutGiggreForm>>(new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const initialFormRef = useRef<AboutGiggreForm>({ ...EMPTY_FORM });

  // ── Load data on mount ────────────────────────────────────────────────────
  useEffect(() => {
    fetchAboutGiggre().then((d) => {
      if (d) {
        const f = getFormFromDoc(d);
        setForm(f);
        initialFormRef.current = f;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Field change ──────────────────────────────────────────────────────────
  const setField = useCallback(
    <K extends keyof AboutGiggreForm>(key: K, value: AboutGiggreForm[K]) => {
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        // Validate only touched fields as user types
        setErrors((prevErrs) => {
          const errs = validateAboutForm(next);
          return { ...prevErrs, [key]: touched.has(key) ? errs[key] : undefined };
        });
        setIsDirty(true);
        setSaved(false);
        return next;
      });
    },
    [touched],
  );

  const markTouched = useCallback((key: keyof AboutGiggreForm) => {
    setTouched((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setErrors((prev) => {
      const errs = validateAboutForm(form);
      return { ...prev, [key]: errs[key] };
    });
  }, [form]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    // Touch all fields to show all errors
    const allKeys = Object.keys(form) as (keyof AboutGiggreForm)[];
    setTouched(new Set(allKeys));
    const errs = validateAboutForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Validation error", "Please fix the highlighted fields before saving.");
      return;
    }

    const result = await saveAboutGiggre(form, initialFormRef.current);
    if (result.success) {
      toast.success("About Giggre saved", "Content updated successfully.");
      initialFormRef.current = { ...form };
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      toast.error("Save failed", result.error);
    }
  }, [form, saveAboutGiggre]);

  // ── Cancel / Reset ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    setForm({ ...initialFormRef.current });
    setErrors({});
    setTouched(new Set());
    setIsDirty(false);
    setSaved(false);
  }, []);

  // ── Refresh ───────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    const d = await fetchAboutGiggre();
    if (d) {
      const f = getFormFromDoc(d);
      setForm(f);
      initialFormRef.current = f;
      setErrors({});
      setTouched(new Set());
      setIsDirty(false);
    }
  }, [fetchAboutGiggre, getFormFromDoc]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !aboutDoc) return <AboutSkeleton />;

  if (fetchError && !aboutDoc) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "52px 24px", gap: 10, textAlign: "center" }}>
        <AlertCircle size={26} style={{ color: "var(--red)" }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Failed to load content</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 280 }}>{fetchError}</div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={handleRefresh}>Retry</Button>
      </div>
    );
  }

  const websiteNormalized = form.website.trim() ? normalizeUrl(form.website) : "";
  const websiteValid = !form.website.trim() || isValidUrl(websiteNormalized);

  return (
    <>
      <style>{`
        .ag-panel { display: flex; flex-direction: column; gap: 0; }
        .ag-header { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; }
        .ag-icon { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: rgba(168,85,247,0.12); }
        .ag-section-card { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; background: var(--bg-surface); }
        .ag-section-label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; color: var(--text-secondary); padding-bottom: 10px; border-bottom: 1px solid var(--border-muted); margin-bottom: 4px; }
        .ag-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .ag-website-row { display: flex; align-items: center; gap: 8px; }
        .ag-url-input { flex: 1; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit; transition: border-color 0.2s; box-sizing: border-box; }
        .ag-url-input:focus { border-color: var(--blue); }
        .ag-url-input.error { border-color: var(--red); }
        .ag-url-preview { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--blue); margin-top: 5px; text-decoration: none; }
        .ag-url-preview:hover { text-decoration: underline; }
        .ag-footer { display: flex; align-items: center; gap: 10px; padding-top: 8px; flex-wrap: wrap; }
        .ag-dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--amber); flex-shrink: 0; }
        .ag-saved-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--green); font-weight: 600; }
        @media (max-width: 600px) {
          .ag-section-card { padding: 14px; }
          .ag-footer { flex-direction: column; align-items: flex-start; }
        }
      `}</style>

      <div className="ag-panel">
        {/* Header */}
        <div className="ag-header">
          <div className="ag-icon">
            <Info size={18} style={{ color: "var(--purple)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>About Giggre</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>About page content sections</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {loading && (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                <RefreshCw size={11} style={{ animation: "ag-spin 0.9s linear infinite" }} /> Refreshing…
              </span>
            )}
            {lastFetched && !loading && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {new Date(lastFetched).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={() => setPreviewOpen(true)}
              title="Preview all content"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
            >
              <Eye size={12} /> Preview
            </button>
            <button
              onClick={handleRefresh}
              title="Reload from Firestore"
              disabled={loading}
              style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <RefreshCw size={13} style={loading ? { animation: "ag-spin 0.9s linear infinite" } : {}} />
            </button>
          </div>
        </div>

        {/* Rich text fields */}
        {RICH_FIELDS.map(({ key, label, icon: Icon, placeholder, required, minHeight, hint }) => (
          <div className="ag-section-card" key={key}>
            <div className="ag-section-label">
              <Icon size={13} />
              {label}
              {required && <span style={{ color: "var(--red)", fontSize: 10 }}>required</span>}
            </div>
            <RichTextEditor
              value={form[key]}
              onChange={(html) => setField(key, html)}
              placeholder={placeholder}
              disabled={saving}
              minHeight={minHeight}
              required={required}
              error={errors[key]}
            />
            {/* <TiptapEditor
              value={form[key]}
              onChange={(html) => setField(key, html)}
              disabled={saving}
              minHeight={minHeight}
              error={errors[key]}
            /> */}
            <div className="ag-hint">{hint}</div>
          </div>
        ))}

        {/* Website field */}
        <div className="ag-section-card">
          <div className="ag-section-label">
            <Globe size={13} />
            Website
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>optional</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="ag-website-row">
              <Globe size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                type="url"
                className={`ag-url-input${errors.website ? " error" : ""}`}
                value={form.website}
                onChange={(e) => setField("website", e.target.value)}
                onBlur={() => markTouched("website")}
                placeholder="https://giggre.com"
                disabled={saving}
              />
            </div>
            {errors.website && (
              <div style={{ fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
                <AlertCircle size={11} /> {errors.website}
              </div>
            )}
            {!errors.website && websiteValid && websiteNormalized && (
              <a
                href={websiteNormalized}
                target="_blank"
                rel="noopener noreferrer"
                className="ag-url-preview"
              >
                <ExternalLink size={10} /> {websiteNormalized}
              </a>
            )}
            <div className="ag-hint">The official website URL shown in the About page.</div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="ag-footer">
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            loading={saving}
            onClick={handleSave}
            disabled={saving}
          >
            Save Changes
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            onClick={handleCancel}
            disabled={saving || !isDirty}
          >
            Cancel
          </Button>
          {isDirty && !saved && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
              <span className="ag-dirty-dot" /> Unsaved changes
            </span>
          )}
          {saved && (
            <span className="ag-saved-badge">
              <CheckCircle2 size={13} /> Saved!
            </span>
          )}
        </div>
      </div>

      {/* Preview drawer */}
      {previewOpen && (
        <PreviewDrawer form={form} onClose={() => setPreviewOpen(false)} />
      )}

      <style>{`@keyframes ag-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

export default AboutGiggrePanel;