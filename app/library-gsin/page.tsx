"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { FolderTree, Layers, ListTree, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { db } from "@/lib/firebase";
import { writeLog } from "@/lib/activitylog";
import { callableError } from "@/lib/gigPoints";
import { GP_STYLES } from "../gig-points/styles";
import { IconGlyph, IconPickerModal } from "@/components/ui/IconPickerModal";
import { iconLabel } from "@/lib/iconify";
import {
  createCategory, createSkill, createSubcategory, createTaskType, deleteCategory, deleteSubcategory, deleteTaskType,
  clearLegacySkillLinks, renameCategory, renameSubcategory, setSubcategoryIcon, updateTaskType, watchGsinCatalog,
  type GsinCategory, type GsinSubcategory, type GsinTaskType,
} from "@/lib/gsin";

// GSIN Library — Category → Sub-category → Task type, each with its prefix.
// Creating a task type gives it the category's next GSINS (G + CAT + 6 digits);
// every gig of that task type then gets its own GSKU (see lib/gsin.ts and
// giggre_app functions/src/gsin.ts). Prefixes can't change once created —
// existing codes would stop meaning the same thing.

// legacyTaskTypeId: old one-per-skill link (skills/{id}.taskTypeId).
// taskTypes: every task type the skill is linked to (task type skillIds + legacy).
interface Skill { id: string; name: string; legacyTaskTypeId: string | null; taskTypes: string[] }

const err = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Firestore refused it — deploy firestore.rules from giggre_app, or check your permissions.";
  return callableError(e);
};

export default function GsinLibraryPage() {
  const { user } = useAuthGuard({ module: "library-gsin" });
  const [cats, setCats] = useState<GsinCategory[] | null>(null);
  const [subs, setSubs] = useState<GsinSubcategory[]>([]);
  const [tasks, setTasks] = useState<GsinTaskType[]>([]);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "cat" | "sub" | "task">(null);
  const [editTask, setEditTask] = useState<GsinTaskType | null>(null);
  const [iconFor, setIconFor] = useState<GsinSubcategory | null>(null);
  const [confirmDel, setConfirmDel] = useState<null | { kind: "cat" | "sub" | "task"; id: string; label: string }>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => watchGsinCatalog(
    (c) => { setCats(c.categories); setSubs(c.subcategories); setTasks(c.taskTypes); setLoadError(null); },
    (e) => setLoadError(e.code === "permission-denied"
      ? "Firestore rules don't allow the GSIN Library yet. Deploy firestore.rules from giggre_app."
      : `Couldn't load the library (${e.code ?? "error"}).`),
  ), []);
  useEffect(() => onSnapshot(collection(db, "skills"), (snap) => {
    setSkillsError(null);
    setSkills(
      snap.docs
        .filter((d) => !d.id.startsWith("_")) // same as User Skills: "_…" docs are internal
        .map((d) => ({ id: d.id, name: String(d.data().name ?? ""), legacyTaskTypeId: (d.data().taskTypeId as string) || null, taskTypes: [] as string[] }))
        .filter((s) => s.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, (e) => {
    console.error("[gsin] skills listener:", e);
    setSkillsError(`Couldn't load User Skills (${e.code ?? "error"}).`);
    setSkills([]);
  }), []);
  const skillList = useMemo(() => (skills ?? []).map((s) => {
    const linked = new Set(tasks.filter((t) => t.skillIds?.includes(s.id)).map((t) => t.id));
    if (s.legacyTaskTypeId && tasks.some((t) => t.id === s.legacyTaskTypeId)) linked.add(s.legacyTaskTypeId);
    return { ...s, taskTypes: [...linked].sort() };
  }), [skills, tasks]);
  const taskName = (id: string) => tasks.find((t) => t.id === id)?.name ?? id;

  // Keep a valid selection.
  const cat = cats?.find((c) => c.id === catId) ?? cats?.[0] ?? null;
  const catSubs = useMemo(() => subs.filter((s) => s.categoryId === cat?.id), [subs, cat]);
  const sub = catSubs.find((s) => s.id === subId) ?? catSubs[0] ?? null;
  const subTasks = useMemo(() => tasks.filter((t) => t.subcategoryId === sub?.id), [tasks, sub]);
  const skillName = (id: string) => skillList.find((s) => s.id === id)?.name ?? id;

  const log = (action: string, description: string, targetId: string) => user && writeLog({
    actorId: user.uid, actorName: user.displayName ?? user.email ?? "Admin", actorEmail: user.email ?? undefined,
    module: "library-gsin" as never, action: action as never, description, targetId, targetName: targetId,
  });

  const remove = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      if (confirmDel.kind === "cat") await deleteCategory(confirmDel.id);
      if (confirmDel.kind === "sub") await deleteSubcategory(confirmDel.id);
      if (confirmDel.kind === "task") {
        const t = tasks.find((x) => x.id === confirmDel.id);
        if (t) await clearLegacySkillLinks(skillList.filter((s) => s.legacyTaskTypeId === t.id).map((s) => s.id));
        await deleteTaskType(confirmDel.id);
      }
      await log("gsin_deleted", `Deleted ${confirmDel.label}`, confirmDel.id);
      toast.success("Deleted");
      setConfirmDel(null);
    } catch (e) {
      toast.error("Couldn't delete", err(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  const usedBy = (t: GsinTaskType) => skillList.filter((s) => s.taskTypes.includes(t.id));

  return (
    <AdminLayout title="GSIN Library" subtitle="Categories, sub-categories and task types that give every gig its GSINS and GSKU codes (admin only)">
      <style>{GP_STYLES + `
        .gl-grid { display: grid; grid-template-columns: 240px 240px minmax(0, 1fr); gap: 14px; align-items: start; }
        .gl-grid > .gp-card { min-width: 0; }
        /* Not enough room for three columns → task types get their own full-width row. */
        @media (max-width: 1500px) { .gl-grid { grid-template-columns: 1fr 1fr; } .gl-tasks { grid-column: 1 / -1; } }
        @media (max-width: 800px) { .gl-grid { grid-template-columns: 1fr; } }
        .gl-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
        .gl-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; background: transparent; color: var(--text-secondary); font-family: inherit; font-size: 13px; text-align: left; width: 100%; }
        .gl-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .gl-item.active { background: var(--blue-dim); color: var(--blue); border-color: var(--blue); }
        .gl-prefix { font-family: monospace; font-weight: 700; font-size: 12px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; color: var(--text-primary); }
        .gl-code { font-family: monospace; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
        .gl-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .gl-chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-secondary); }
        .gl-icon { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; }
        .gl-icon-box { width: 38px; height: 38px; border-radius: 9px; display: flex; align-items: center; justify-content: center; background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); flex-shrink: 0; }
        .gl-icon:hover { color: var(--text-primary); background: var(--bg-hover); }
        .gl-format { font-size: 12px; color: var(--text-muted); line-height: 1.7; }
        .gl-format code { font-family: monospace; color: var(--text-primary); background: var(--bg-elevated); padding: 1px 5px; border-radius: 4px; }
      `}</style>

      <div className="gp-card" style={{ marginBottom: 14 }}>
        <div className="gl-format">
          <b style={{ color: "var(--text-primary)" }}>GSINS</b> <code>G</code> + category prefix (3) + number per task type (6) — e.g. <code>GADS000001</code>. One per task type.<br />
          <b style={{ color: "var(--text-primary)" }}>GSKU</b> <code>T</code> + sub-category (2) + task type (2) + expert level (1: entry 1 · intermediate 2 · expert 3 · none 0)
          + priority service (<code>QG</code> Quick · <code>PG</code> Open · <code>FG</code> Offered) + running number (5) — e.g. <code>TVAAS1QG00001</code>. One per gig, assigned automatically when it&apos;s posted.<br />
          A gig&apos;s task type comes from the Quick Gig picker or from its skill — link skills to task types below. Prefixes can&apos;t be changed later.
        </div>
      </div>

      {loadError ? <div className="gp-empty" style={{ color: "var(--red)" }}>{loadError}</div>
        : cats == null ? <div className="gp-empty">Loading library…</div> : (
          <div className="gl-grid">
            {/* Categories */}
            <div className="gp-card">
              <div className="gp-head">
                <div className="gp-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><FolderTree size={15} /> Categories</div>
                <Button size="sm" icon={Plus} onClick={() => setModal("cat")}>Add</Button>
              </div>
              <div className="gl-list">
                {cats.length === 0 && <div className="gp-sub">No categories yet.</div>}
                {cats.map((c) => (
                  <button key={c.id} className={`gl-item ${cat?.id === c.id ? "active" : ""}`} onClick={() => { setCatId(c.id); setSubId(null); }}>
                    <span className="gl-prefix">{c.prefix}</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <span className="gp-sub">{tasks.filter((t) => t.categoryId === c.id).length}</span>
                  </button>
                ))}
              </div>
              {cat && (
                <RenameRow key={cat.id} label="Category name" value={cat.name}
                  onSave={async (v) => { await renameCategory(cat.id, v); await log("gsin_renamed", `Renamed category ${cat.prefix} to ${v}`, cat.id); }}
                  onDelete={cat.gsinsSeq === 0 && catSubs.length === 0 ? () => setConfirmDel({ kind: "cat", id: cat.id, label: `category ${cat.prefix} ${cat.name}` }) : undefined} />
              )}
            </div>

            {/* Sub-categories */}
            <div className="gp-card">
              <div className="gp-head">
                <div className="gp-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><Layers size={15} /> Sub-categories</div>
                <Button size="sm" icon={Plus} disabled={!cat} onClick={() => setModal("sub")}>Add</Button>
              </div>
              <div className="gl-list">
                {!cat ? <div className="gp-sub">Add a category first.</div>
                  : catSubs.length === 0 ? <div className="gp-sub">No sub-categories in {cat.name} yet.</div>
                  : catSubs.map((s) => (
                    <button key={s.id} className={`gl-item ${sub?.id === s.id ? "active" : ""}`} onClick={() => setSubId(s.id)}>
                      <IconGlyph icon={s.icon} size={16} title={s.icon ? iconLabel(s.icon) : "No icon yet"} />
                      <span className="gl-prefix">{s.prefix}</span>
                      <span style={{ flex: 1 }}>{s.name}</span>
                      <span className="gp-sub">{tasks.filter((t) => t.subcategoryId === s.id).length}</span>
                    </button>
                  ))}
              </div>
              {sub && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="gl-icon-box"><IconGlyph icon={sub.icon} size={22} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>Icon</div>
                    <div className="gp-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sub.icon ? iconLabel(sub.icon) : "None yet. Skills in it show no icon."}
                    </div>
                  </div>
                  <button className="gl-icon" onClick={() => setIconFor(sub)}><Pencil size={13} /> <span style={{ fontSize: 12, marginLeft: 4 }}>{sub.icon ? "Change" : "Choose"}</span></button>
                </div>
              )}
              {sub && (
                <RenameRow key={sub.id} label="Sub-category name" value={sub.name}
                  onSave={async (v) => { await renameSubcategory(sub.id, v); await log("gsin_renamed", `Renamed sub-category ${sub.prefix} to ${v}`, sub.id); }}
                  onDelete={subTasks.length === 0 ? () => setConfirmDel({ kind: "sub", id: sub.id, label: `sub-category ${sub.prefix} ${sub.name}` }) : undefined} />
              )}
            </div>

            {/* Task types */}
            <div className="gp-card gl-tasks">
              <div className="gp-head">
                <div className="gp-title" style={{ display: "flex", alignItems: "center", gap: 6 }}><ListTree size={15} /> Task types {sub ? `· ${sub.name}` : ""}</div>
                <Button size="sm" icon={Plus} disabled={!sub} onClick={() => setModal("task")}>Add task type</Button>
              </div>
              {!sub ? <div className="gp-sub" style={{ marginTop: 10 }}>Pick or add a sub-category.</div>
                : subTasks.length === 0 ? <div className="gp-empty">No task types in {sub.name} yet.</div> : (
                  <div className="gp-table-wrap" style={{ marginTop: 10 }}>
                    <table className="gp-table">
                      <thead><tr><th>GSINS</th><th>Task type</th><th>Prefix</th><th>Linked skills</th><th style={{ textAlign: "right" }}>Gigs</th><th /></tr></thead>
                      <tbody>
                        {subTasks.map((t) => (
                          <tr key={t.id}>
                            <td><span className="gl-code">{t.gsins}</span></td>
                            <td>{t.name}</td>
                            <td><span className="gl-prefix">{t.prefix}</span> <span className="gp-sub">T{t.subcategoryId}{t.prefix}…</span></td>
                            <td><div className="gl-chips">{usedBy(t).length ? usedBy(t).map((s) => <span key={s.id} className="gl-chip" title={s.taskTypes.length > 1 ? `Also in: ${s.taskTypes.filter((x) => x !== t.id).map(taskName).join(", ")} — gigs needing it will ask for a task type` : undefined}>{s.name}{s.taskTypes.length > 1 ? " ⇄" : ""}</span>) : <span className="gp-sub">None</span>}</div></td>
                            <td style={{ textAlign: "right" }}>{t.gskuSeq}</td>
                            <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                              <button className="gl-icon" title="Edit" onClick={() => setEditTask(t)}><Pencil size={14} /></button>
                              {t.gskuSeq === 0 && (
                                <button className="gl-icon" title="Delete" onClick={() => setConfirmDel({ kind: "task", id: t.id, label: `task type ${t.gsins} ${t.name}` })}><Trash2 size={14} /></button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>
        )}

      {modal === "cat" && (
        <PrefixModal title="Add category" prefixLen={3} prefixHint="ADS" nameHint="Admin & Digital Services"
          taken={(p) => !!cats?.some((c) => c.id === p)}
          onClose={() => setModal(null)}
          onSave={async (prefix, name) => {
            await createCategory(prefix, name, user.uid);
            await log("gsin_category_created", `Created category ${prefix} ${name}`, prefix);
            setCatId(prefix);
          }} />
      )}
      {modal === "sub" && cat && (
        <PrefixModal title={`Add sub-category to ${cat.name}`} prefixLen={2} prefixHint="VA" nameHint="Virtual Assistance"
          note="Sub-category prefixes are unique across all categories (they start every GSKU)."
          taken={(p) => subs.some((s) => s.id === p)}
          onClose={() => setModal(null)}
          onSave={async (prefix, name) => {
            await createSubcategory(prefix, name, cat.id, user.uid);
            await log("gsin_subcategory_created", `Created sub-category ${prefix} ${name} in ${cat.prefix}`, prefix);
            setSubId(prefix);
          }} />
      )}
      {modal === "task" && sub && cat && (
        <TaskModal sub={sub} cat={cat} skills={skillList} taskName={taskName} skillsLoading={skills == null} skillsError={skillsError} taken={(p) => tasks.some((t) => t.id === `${sub.id}${p}`)}
          nextGsins={`G${cat.prefix}${String(cat.gsinsSeq + 1).padStart(6, "0")}`}
          onClose={() => setModal(null)} />
      )}
      {iconFor && (
        <IconPickerModal
          key={iconFor.id}
          title={`Icon for ${iconFor.name} (${iconFor.prefix})`}
          initialQuery={iconFor.name}
          value={iconFor.icon}
          onClose={() => setIconFor(null)}
          onSave={async (icon) => {
            try {
              await setSubcategoryIcon(iconFor.id, icon);
              await log("gsin_icon_set", icon ? `Set icon of sub-category ${iconFor.prefix} ${iconFor.name} to ${icon}` : `Removed icon of sub-category ${iconFor.prefix} ${iconFor.name}`, iconFor.id);
              toast.success(icon ? "Icon saved" : "Icon removed", iconFor.name);
            } catch (e) {
              toast.error("Couldn't save the icon", err(e));
              throw e;
            }
          }} />
      )}
      {editTask && (
        <EditTaskModal task={editTask} skills={skillList} taskName={taskName} skillsLoading={skills == null} skillsError={skillsError} uid={user.uid} onClose={() => setEditTask(null)} skillName={skillName} />
      )}
      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={remove} loading={busy} danger
        title="Delete?" confirmLabel="Delete" message={`Delete ${confirmDel?.label ?? ""}? Only unused entries can be deleted.`} />
    </AdminLayout>
  );
}

function RenameRow({ label, value, onSave, onDelete }: { label: string; value: string; onSave: (v: string) => Promise<void>; onDelete?: () => void }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  const save = async () => {
    if (v.trim().length < 2) return;
    try { await onSave(v.trim()); setEditing(false); toast.success("Saved"); } catch (e) { toast.error("Couldn't save", err(e)); }
  };
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center" }}>
      {editing ? (
        <>
          <input className="gp-input" value={v} maxLength={60} onChange={(e) => setV(e.target.value)} aria-label={label} />
          <button className="gl-icon" title="Save" onClick={save}><Check size={15} /></button>
          <button className="gl-icon" title="Cancel" onClick={() => { setV(value); setEditing(false); }}><X size={15} /></button>
        </>
      ) : (
        <>
          <button className="gl-icon" onClick={() => setEditing(true)}><Pencil size={13} /> <span style={{ fontSize: 12, marginLeft: 4 }}>Rename</span></button>
          {onDelete && <button className="gl-icon" onClick={onDelete}><Trash2 size={13} /> <span style={{ fontSize: 12, marginLeft: 4 }}>Delete</span></button>}
        </>
      )}
    </div>
  );
}

function PrefixModal({ title, prefixLen, prefixHint, nameHint, note, taken, onClose, onSave }: {
  title: string; prefixLen: number; prefixHint: string; nameHint: string; note?: string;
  taken: (p: string) => boolean; onClose: () => void; onSave: (prefix: string, name: string) => Promise<void>;
}) {
  const [prefix, setPrefix] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const p = prefix.toUpperCase();
  const problem = !new RegExp(`^[A-Z]{${prefixLen}}$`).test(p) ? `Prefix must be ${prefixLen} letters (A–Z).`
    : taken(p) ? `${p} is already used.` : name.trim().length < 2 ? "Enter a name." : null;
  const save = async () => {
    if (problem) return;
    setBusy(true);
    try { await onSave(p, name); toast.success("Added"); onClose(); } catch (e) { toast.error("Couldn't add", err(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} size="sm" title={title}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={!!problem || busy}>Add</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="gp-label">Prefix ({prefixLen} letters — can&apos;t be changed later)</label>
          <input className="gp-input" value={p} maxLength={prefixLen} placeholder={prefixHint} style={{ fontFamily: "monospace", textTransform: "uppercase" }}
            onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, ""))} />
        </div>
        <div>
          <label className="gp-label">Name</label>
          <input className="gp-input" value={name} maxLength={60} placeholder={nameHint} onChange={(e) => setName(e.target.value)} />
        </div>
        {note && <div className="gp-sub">{note}</div>}
        {problem && (prefix || name) && <div className="gp-sub" style={{ color: "var(--red)" }}>{problem}</div>}
      </div>
    </Modal>
  );
}

function SkillPicker({ skills, selected, onChange, taskTypeId, loading, error, taskName }: {
  skills: Skill[]; selected: string[]; onChange: (ids: string[]) => void; taskTypeId?: string; taskName: (id: string) => string;
  loading?: boolean; error?: string | null;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = skills.filter((s) => s.name.toLowerCase().includes(needle));
  const exact = skills.some((s) => s.name.toLowerCase() === needle);
  // Selected skills first, so you can see what's linked while searching.
  list.sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)));

  const addSkill = async () => {
    const name = q.trim();
    if (name.length < 2) return;
    setAdding(true);
    try {
      const id = await createSkill(name);
      onChange([...selected, id]);
      setQ("");
      toast.success(`Skill "${name}" added to User Skills`);
    } catch (e) {
      toast.error("Couldn't add skill", err(e));
    } finally {
      setAdding(false);
    }
  };

  const msg = (text: string, color = "var(--text-muted)") => <div style={{ padding: 6, fontSize: 12, color }}>{text}</div>;
  return (
    <div>
      <input className="gp-input" placeholder={`Search ${skills.length} skills…`} value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && needle && !exact) { e.preventDefault(); addSkill(); } }} />
      <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
        {error ? msg(error, "var(--red)")
          : loading ? msg("Loading skills…")
          : skills.length === 0 ? msg("User Skills is empty — type a skill name above to add one.")
          : list.length === 0 ? msg(`No skill matches "${q.trim()}".`)
          : list.map((s) => {
            const others = s.taskTypes.filter((x) => x !== taskTypeId);
            const on = selected.includes(s.id);
            return (
              <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])} />
                {s.name}
                {others.length > 0 && <span className="gp-sub">(also in {others.map(taskName).join(", ")})</span>}
              </label>
            );
          })}
      </div>
      {needle.length >= 2 && !exact && !loading && !error && (
        <button type="button" className="gl-icon" style={{ marginTop: 6, color: "var(--blue)" }} onClick={addSkill} disabled={adding}>
          <Plus size={13} /> <span style={{ fontSize: 12, marginLeft: 4 }}>{adding ? "Adding…" : `Add "${q.trim()}" as a new skill`}</span>
        </button>
      )}
      {selected.length > 0 && <div className="gp-sub" style={{ marginTop: 6 }}>{selected.length} selected</div>}
      {skills.some((s) => selected.includes(s.id) && s.taskTypes.some((x) => x !== taskTypeId)) && (
        <div className="gp-sub" style={{ marginTop: 4 }}>
          Skills shared with other task types are fine — gigs that only name a shared skill won&apos;t be coded automatically; the host picks the task type, or an admin does on All Gigs.
        </div>
      )}
    </div>
  );
}

function TaskModal({ sub, cat, skills, taskName, skillsLoading, skillsError, taken, nextGsins, onClose }: {
  sub: GsinSubcategory; cat: GsinCategory; skills: Skill[]; taskName: (id: string) => string; skillsLoading: boolean; skillsError: string | null; taken: (p: string) => boolean; nextGsins: string; onClose: () => void;
}) {
  const [prefix, setPrefix] = useState("");
  const [name, setName] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const p = prefix.toUpperCase();
  const problem = !/^[A-Z]{2}$/.test(p) ? "Prefix must be 2 letters (A–Z)." : taken(p) ? `${sub.name} already has ${p}.` : name.trim().length < 2 ? "Enter a name." : null;
  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const r = await createTaskType({ subcategoryId: sub.id, name: name.trim(), prefix: p, skillIds });
      toast.success("Task type added", `GSINS ${r.gsins}`);
      onClose();
    } catch (e) {
      toast.error("Couldn't add", err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} size="md" title={`Add task type to ${cat.name} › ${sub.name}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={!!problem || busy}>Add task type</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="gp-row" style={{ gridTemplateColumns: "1fr 2fr" }}>
          <div>
            <label className="gp-label">Prefix (2 letters)</label>
            <input className="gp-input" value={p} maxLength={2} placeholder="AS" style={{ fontFamily: "monospace" }}
              onChange={(e) => setPrefix(e.target.value.replace(/[^a-zA-Z]/g, ""))} />
          </div>
          <div>
            <label className="gp-label">Task type name</label>
            <input className="gp-input" value={name} maxLength={80} placeholder="Admin Support" onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="gp-note">
          Gets GSINS <b style={{ fontFamily: "monospace" }}>{nextGsins}</b>. Its gigs get GSKUs like{" "}
          <b style={{ fontFamily: "monospace" }}>T{sub.prefix}{/^[A-Z]{2}$/.test(p) ? p : "__"}1QG00001</b>.
        </div>
        <div>
          <label className="gp-label">Linked skills — gigs needing these skills get this task type</label>
          <SkillPicker skills={skills} selected={skillIds} onChange={setSkillIds} loading={skillsLoading} error={skillsError} taskName={taskName} />
        </div>
        {problem && (prefix || name) && <div className="gp-sub" style={{ color: "var(--red)" }}>{problem}</div>}
      </div>
    </Modal>
  );
}

function EditTaskModal({ task, skills, taskName, skillsLoading, skillsError, uid, onClose, skillName }: {
  task: GsinTaskType; skills: Skill[]; taskName: (id: string) => string; skillsLoading: boolean; skillsError: string | null; uid: string; onClose: () => void; skillName: (id: string) => string;
}) {
  const current = skills.filter((s) => s.taskTypes.includes(task.id)).map((s) => s.id);
  const [name, setName] = useState(task.name);
  const [skillIds, setSkillIds] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      const add = skillIds.filter((id) => !current.includes(id));
      const remove = current.filter((id) => !skillIds.includes(id));
      // Unlinking a skill only affects this task type; old single links get cleared.
      await clearLegacySkillLinks(skills.filter((s) => remove.includes(s.id) && s.legacyTaskTypeId === task.id).map((s) => s.id));
      await updateTaskType(task.id, { name: name.trim(), skillIds }, uid);
      toast.success("Saved", add.length || remove.length ? `Skills: ${[...add.map((i) => `+${skillName(i)}`), ...remove.map((i) => `−${skillName(i)}`)].join(", ")}` : undefined);
      onClose();
    } catch (e) {
      toast.error("Couldn't save", err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} size="md" title={`${task.gsins} · ${task.name}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={busy || name.trim().length < 2}>Save</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="gp-label">Task type name</label>
          <input className="gp-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="gp-sub">Prefix <b style={{ fontFamily: "monospace" }}>{task.prefix}</b> and GSINS <b style={{ fontFamily: "monospace" }}>{task.gsins}</b> are fixed. {task.gskuSeq} gig(s) coded so far.</div>
        <div>
          <label className="gp-label">Linked skills</label>
          <SkillPicker skills={skills} selected={skillIds} onChange={setSkillIds} taskTypeId={task.id} loading={skillsLoading} error={skillsError} taskName={taskName} />
        </div>
      </div>
    </Modal>
  );
}
