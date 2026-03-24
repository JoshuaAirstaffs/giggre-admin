"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useId,
} from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link2,
  Link2Off,
  Eye,
  EyeOff,
  Unlink,
} from "lucide-react";
import { sanitizeHtml } from "@/lib/sanitize";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  required?: boolean;
  error?: string;
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

interface ToolbarBtnProps {
  title: string;
  active?: boolean;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolbarBtn({ title, active, onClick, disabled, children }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault(); // prevent editor blur
        onClick(e);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        border: active ? "1px solid var(--blue)" : "1px solid transparent",
        background: active ? "rgba(59,130,246,0.12)" : "transparent",
        color: active ? "var(--blue)" : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.12s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
        }
      }}
    >
      {children}
    </button>
  );
}

// ─── Link Dialog ──────────────────────────────────────────────────────────────

interface LinkDialogProps {
  initialHref?: string;
  onConfirm: (href: string) => void;
  onClose: () => void;
}

function LinkDialog({ initialHref = "", onConfirm, onClose }: LinkDialogProps) {
  const [href, setHref] = useState(initialHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const confirm = () => {
    const val = href.trim();
    onConfirm(val ? (val.startsWith("http") ? val : `https://${val}`) : "");
  };

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 100,
        top: "100%",
        left: 0,
        marginTop: 4,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "12px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
        minWidth: 280,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        Insert Link
      </div>
      <input
        ref={inputRef}
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
          if (e.key === "Escape") onClose();
        }}
        placeholder="https://example.com"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "7px 10px",
          color: "var(--text-primary)",
          fontSize: 12,
          outline: "none",
          width: "100%",
          boxSizing: "border-box" as const,
          fontFamily: "inherit",
        }}
        onFocus={(e) => { e.target.style.borderColor = "var(--blue)"; }}
        onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onClose(); }}
          style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); confirm(); }}
          style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--blue)", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ─── Active format detector ───────────────────────────────────────────────────

function useActiveFormats() {
  const [formats, setFormats] = useState({ bold: false, italic: false, ul: false, ol: false, link: false });

  const refresh = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    setFormats({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
      link: !!sel.anchorNode?.parentElement?.closest("a"),
    });
  }, []);

  return { formats, refresh };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RichTextEditor({
  value,
  onChange,
  label,
  placeholder = "Enter content…",
  disabled = false,
  minHeight = 120,
  required = false,
  error,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef<string>("");
  const savedRangeRef = useRef<Range | null>(null);
  const id = useId();

  const [previewMode, setPreviewMode] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [existingHref, setExistingHref] = useState("");
  const { formats, refresh: refreshFormats } = useActiveFormats();

  // ── Sync external value → DOM (only when different to avoid caret jumps) ──
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const sanitized = sanitizeHtml(value);
    if (sanitized !== lastHtmlRef.current) {
      el.innerHTML = sanitized;
      lastHtmlRef.current = sanitized;
    }
  }, [value]);

  // ── Notify parent on change ───────────────────────────────────────────────
  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    lastHtmlRef.current = html;
    onChange(html);
    refreshFormats();
  }, [onChange, refreshFormats]);

  // ── Save / restore selection for toolbar commands ─────────────────────────
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  }, []);

  // ── execCommand wrapper ───────────────────────────────────────────────────
  const exec = useCallback(
    (command: string, value?: string) => {
      if (disabled) return;
      restoreSelection();
      document.execCommand(command, false, value);
      handleInput();
      editorRef.current?.focus();
    },
    [disabled, restoreSelection, handleInput],
  );

  // ── Link handling ─────────────────────────────────────────────────────────
  const openLinkDialog = useCallback(() => {
    saveSelection();
    const sel = window.getSelection();
    const anchor = sel?.anchorNode?.parentElement?.closest("a");
    setExistingHref(anchor?.getAttribute("href") ?? "");
    setLinkDialogOpen(true);
  }, [saveSelection]);

  const applyLink = useCallback(
    (href: string) => {
      setLinkDialogOpen(false);
      if (!href) {
        exec("unlink");
        return;
      }
      exec("createLink", href);
      const sel = window.getSelection();
      const anchor = sel?.anchorNode?.parentElement?.closest("a");
      if (anchor) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }
    },
    [exec],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "b") { e.preventDefault(); exec("bold"); }
      if (mod && e.key === "i") { e.preventDefault(); exec("italic"); }
      if (mod && e.key === "k") { e.preventDefault(); openLinkDialog(); }
    },
    [exec, openLinkDialog],
  );

  // ── Paste as plain text ───────────────────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const isEmpty = !value || sanitizeHtml(value).replace(/<[^>]+>/g, "").trim() === "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <style>{`
        .rte-editor { outline: none; line-height: 1.7; font-size: 13px; color: var(--text-primary); font-family: inherit; }
        .rte-editor p { margin: 0 0 6px; }
        .rte-editor ul, .rte-editor ol { margin: 4px 0 8px 20px; padding: 0; }
        .rte-editor li { margin-bottom: 3px; }
        .rte-editor a { color: var(--blue); text-decoration: underline; }
        .rte-editor b, .rte-editor strong { font-weight: 700; }
        .rte-editor i, .rte-editor em { font-style: italic; }
        .rte-preview { font-size: 13px; color: var(--text-primary); line-height: 1.7; font-family: inherit; }
        .rte-preview p { margin: 0 0 6px; }
        .rte-preview ul, .rte-preview ol { margin: 4px 0 8px 20px; }
        .rte-preview li { margin-bottom: 3px; }
        .rte-preview a { color: var(--blue); text-decoration: underline; }
        .rte-preview b, .rte-preview strong { font-weight: 700; }
        .rte-preview i, .rte-preview em { font-style: italic; }
      `}</style>

      {/* Label */}
      {label && (
        <label
          htmlFor={id}
          style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-muted)" }}
        >
          {label}{required && <span style={{ color: "var(--red)", marginLeft: 3 }}>*</span>}
        </label>
      )}

      {/* Editor shell */}
      <div
        style={{
          border: error ? "1px solid var(--red)" : "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-elevated)",
          overflow: "hidden",
          transition: "border-color 0.2s",
          opacity: disabled ? 0.6 : 1,
          position: "relative",
        }}
        onFocus={() => {
          const el = document.activeElement as HTMLElement;
          if (el.closest("[data-rte-shell]")) {
            (el.closest("[data-rte-shell]") as HTMLElement).style.borderColor = error ? "var(--red)" : "var(--blue)";
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            (e.currentTarget as HTMLElement).style.borderColor = error ? "var(--red)" : "var(--border)";
          }
        }}
        data-rte-shell="1"
      >
        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "5px 8px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-surface)",
            flexWrap: "wrap" as const,
          }}
        >
          <ToolbarBtn title="Bold (Ctrl+B)" active={formats.bold} disabled={disabled || previewMode} onClick={() => exec("bold")}>
            <Bold size={13} />
          </ToolbarBtn>
          <ToolbarBtn title="Italic (Ctrl+I)" active={formats.italic} disabled={disabled || previewMode} onClick={() => exec("italic")}>
            <Italic size={13} />
          </ToolbarBtn>

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 3px", flexShrink: 0 }} />

          <ToolbarBtn title="Bullet List" active={formats.ul} disabled={disabled || previewMode} onClick={() => exec("insertUnorderedList")}>
            <List size={13} />
          </ToolbarBtn>
          <ToolbarBtn title="Numbered List" active={formats.ol} disabled={disabled || previewMode} onClick={() => exec("insertOrderedList")}>
            <ListOrdered size={13} />
          </ToolbarBtn>

          {/* Divider */}
          <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 3px", flexShrink: 0 }} />

          <div style={{ position: "relative" }}>
            <ToolbarBtn title="Insert Link (Ctrl+K)" active={formats.link} disabled={disabled || previewMode} onClick={openLinkDialog}>
              <Link2 size={13} />
            </ToolbarBtn>
            {linkDialogOpen && (
              <LinkDialog
                initialHref={existingHref}
                onConfirm={applyLink}
                onClose={() => setLinkDialogOpen(false)}
              />
            )}
          </div>

          {formats.link && (
            <ToolbarBtn title="Remove Link" disabled={disabled || previewMode} onClick={() => exec("unlink")}>
              <Unlink size={13} />
            </ToolbarBtn>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Preview toggle */}
          <ToolbarBtn title={previewMode ? "Back to Edit" : "Preview"} active={previewMode} onClick={() => setPreviewMode((p) => !p)}>
            {previewMode ? <EyeOff size={13} /> : <Eye size={13} />}
          </ToolbarBtn>
        </div>

        {/* ── Editable / Preview area ───────────────────────────────────────── */}
        <div style={{ padding: "10px 14px", minHeight, position: "relative" }}>
          {previewMode ? (
            /* Preview pane */
            <div
              className="rte-preview"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) || `<span style="color:var(--text-muted);font-style:italic">Nothing to preview.</span>` }}
            />
          ) : (
            <>
              {/* Placeholder */}
              {isEmpty && !disabled && (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    left: 14,
                    fontSize: 13,
                    color: "var(--text-muted)",
                    pointerEvents: "none",
                    userSelect: "none",
                    fontStyle: "italic",
                  }}
                >
                  {placeholder}
                </div>
              )}
              <div
                id={id}
                ref={editorRef}
                className="rte-editor"
                contentEditable={!disabled}
                suppressContentEditableWarning
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onKeyUp={refreshFormats}
                onMouseUp={refreshFormats}
                onSelect={refreshFormats}
                onPaste={handlePaste}
                onFocus={saveSelection}
                onBlur={saveSelection}
                style={{ minHeight, outline: "none" }}
                aria-label={label}
                aria-required={required}
                aria-multiline="true"
                role="textbox"
                spellCheck
              />
            </>
          )}
        </div>
      </div>

      {/* Hint / Error */}
      {error && (
        <div style={{ fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          {error}
        </div>
      )}

      {!previewMode && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap" as const }}>
          <span>Ctrl+B Bold</span>
          <span>Ctrl+I Italic</span>
          <span>Ctrl+K Link</span>
        </div>
      )}
    </div>
  );
}

export default RichTextEditor;