"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, BookOpen } from "lucide-react";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Modal, { ConfirmDialog } from "@/components/ui/Modal";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  id: string;       // Firestore document ID
  skillId: string;  // Format: 2 uppercase letters + 7 digits (e.g. AB1234567)
  name: string;
  createdAt: Timestamp | null;
}

// ─── ID Helpers ───────────────────────────────────────────────────────────────

function generateLibraryId(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const l1 = letters[Math.floor(Math.random() * 26)];
  const l2 = letters[Math.floor(Math.random() * 26)];
  const digits = String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
  return `${l1}${l2}${digits}`;
}

async function generateUniqueLibraryId(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateLibraryId();
    const snap = await getDocs(query(collection(db, "skills"), where("skillId", "==", id)));
    if (snap.empty) return id;
  }
  throw new Error("Could not generate a unique Library ID after 10 attempts.");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LibraryGSINPage() {
  useAuthGuard({ module: "library-gsin" });
  const { user } = useAuth();

  const [skills, setSkills]         = useState<Skill[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");

  // Add modal
  const [addOpen, setAddOpen]       = useState(false);
  const [addName, setAddName]       = useState("");
  const [addError, setAddError]     = useState("");
  const [addSaving, setAddSaving]   = useState(false);

  // Edit modal
  const [editSkill, setEditSkill]   = useState<Skill | null>(null);
  const [editName, setEditName]     = useState("");
  const [editError, setEditError]   = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deleteSkill, setDeleteSkill] = useState<Skill | null>(null);
  const [deleting, setDeleting]       = useState(false);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "skills"), orderBy("createdAt", "asc"))
      );
      const list: Skill[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id:        d.id,
          skillId:   data.skillId as string,
          name:      data.name as string,
          createdAt: data.createdAt ?? null,
        });
      });
      setSkills(list);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
      toast.error("Failed to load skills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // ─── Filtered list ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.skillId).includes(q)
    );
  }, [skills, search]);

  // ─── Add ────────────────────────────────────────────────────────────────────

  const openAdd = () => {
    setAddName("");
    setAddError("");
    setAddOpen(true);
  };

  const handleAdd = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { setAddError("Skill name cannot be empty."); return; }
    if (skills.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) {
      setAddError("A skill with this name already exists.");
      return;
    }

    setAddSaving(true);
    try {
      const libraryId = await generateUniqueLibraryId();
      const newSkillRef = doc(collection(db, "skills"));

      await setDoc(newSkillRef, {
        skillId:   libraryId,
        name:      trimmed,
        createdAt: Timestamp.now(),
      });

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_created",
        description: buildDescription.skillCreated(libraryId, trimmed),
        targetId:   newSkillRef.id,
        targetName: trimmed,
        meta:       { to: { skillId: libraryId, name: trimmed } },
      });

      toast.success(`Skill "${trimmed}" added.`);
      setAddOpen(false);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to add skill:", err);
      toast.error("Failed to add skill. Please try again.");
    } finally {
      setAddSaving(false);
    }
  };

  // ─── Edit ───────────────────────────────────────────────────────────────────

  const openEdit = (skill: Skill) => {
    setEditSkill(skill);
    setEditName(skill.name);
    setEditError("");
  };

  const handleEdit = async () => {
    if (!editSkill) return;
    const trimmed = editName.trim();
    if (!trimmed) { setEditError("Skill name cannot be empty."); return; }
    if (
      skills.some(
        (s) => s.id !== editSkill.id && s.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setEditError("A skill with this name already exists.");
      return;
    }
    if (trimmed === editSkill.name) {
      setEditSkill(null);
      return;
    }

    setEditSaving(true);
    try {
      await updateDoc(doc(db, "skills", editSkill.id), { name: trimmed });

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_updated",
        description: buildDescription.skillUpdated(editSkill.skillId, editSkill.name, trimmed),
        targetId:   editSkill.id,
        targetName: trimmed,
        meta:       { from: { name: editSkill.name }, to: { name: trimmed } },
      });

      toast.success(`Skill renamed to "${trimmed}".`);
      setEditSkill(null);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to update skill:", err);
      toast.error("Failed to update skill. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteSkill) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "skills", deleteSkill.id));

      await writeLog({
        actorId:    user!.uid,
        actorName:  user!.displayName ?? "Unknown",
        actorEmail: user!.email ?? "",
        module:     "library",
        action:     "skill_deleted",
        description: buildDescription.skillDeleted(deleteSkill.skillId, deleteSkill.name),
        targetId:   deleteSkill.id,
        targetName: deleteSkill.name,
        meta:       { from: { skillId: deleteSkill.skillId, name: deleteSkill.name } },
      });

      toast.success(`Skill "${deleteSkill.name}" deleted.`);
      setDeleteSkill(null);
      await fetchSkills();
    } catch (err) {
      console.error("Failed to delete skill:", err);
      toast.error("Failed to delete skill. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout
      title="Skills Library"
      subtitle="Manage the GSIN skills catalogue"
      actions={
        <>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchSkills} disabled={loading}>
            Refresh
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={openAdd}>
            Add Skill
          </Button>
        </>
      }
    >
      <style>{`
        .sl-wrap { display: flex; flex-direction: column; gap: 20px; }

        /* Stats row */
        .sl-stats { display: flex; gap: 14px; flex-wrap: wrap; }
        .sl-stat {
          flex: 1; min-width: 140px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 16px 20px;
          display: flex; align-items: center; gap: 14px;
        }
        .sl-stat-icon {
          width: 40px; height: 40px; border-radius: var(--radius-sm);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .sl-stat-val {
          font-size: 22px; font-weight: 700; color: var(--text-primary);
          font-family: 'Space Mono', monospace; line-height: 1;
        }
        .sl-stat-label { font-size: 11px; font-weight: 600; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.8px; margin-top: 3px; }

        /* Controls */
        .sl-controls {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        }
        .sl-search {
          flex: 1; min-width: 200px; max-width: 340px;
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 0 12px; height: 36px;
          transition: border-color 0.15s;
        }
        .sl-search:focus-within { border-color: var(--blue); }
        .sl-search svg { color: var(--text-muted); flex-shrink: 0; }
        .sl-search input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary); font-family: 'DM Sans', sans-serif;
        }
        .sl-search input::placeholder { color: var(--text-muted); }
        .sl-count {
          font-size: 12px; color: var(--text-muted); font-weight: 500; white-space: nowrap;
        }

        /* Table card */
        .sl-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .sl-table { width: 100%; border-collapse: collapse; }
        .sl-table thead tr {
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
        }
        .sl-table th {
          padding: 10px 16px;
          font-size: 10px; font-weight: 800; letter-spacing: 1.2px;
          text-transform: uppercase; color: var(--text-muted);
          text-align: left; white-space: nowrap;
        }
        .sl-table th.sl-th-center { text-align: center; }
        .sl-table th.sl-th-right  { text-align: right; }
        .sl-table tbody tr {
          border-bottom: 1px solid var(--border-muted);
          transition: background 0.12s;
        }
        .sl-table tbody tr:last-child { border-bottom: none; }
        .sl-table tbody tr:hover { background: var(--bg-hover); }
        .sl-table td { padding: 13px 16px; vertical-align: middle; }

        .sl-id {
          font-family: 'Space Mono', monospace;
          font-size: 12px; font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 2px 8px;
          display: inline-block;
        }
        .sl-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
        .sl-date { font-size: 12px; color: var(--text-muted); }
        .sl-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }

        /* Empty / loading */
        .sl-empty {
          padding: 60px 20px; text-align: center;
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .sl-empty-icon {
          width: 48px; height: 48px; border-radius: var(--radius-md);
          background: var(--bg-elevated); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
        }
        .sl-empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
        .sl-empty-sub   { font-size: 13px; color: var(--text-muted); }

        .sl-skeleton-row td { padding: 13px 16px; }
        .sl-skel {
          height: 14px; border-radius: 6px;
          background: linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-hover) 50%, var(--bg-elevated) 75%);
          background-size: 200% 100%;
          animation: sl-shimmer 1.4s infinite;
        }
        @keyframes sl-shimmer { to { background-position: -200% 0; } }

        /* Form field */
        .sl-field { display: flex; flex-direction: column; gap: 6px; }
        .sl-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); letter-spacing: 0.3px; }
        .sl-input {
          width: 100%; padding: 9px 12px;
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 14px; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif; outline: none;
          transition: border-color 0.15s; box-sizing: border-box;
        }
        .sl-input:focus { border-color: var(--blue); }
        .sl-input.sl-input-err { border-color: var(--red); }
        .sl-err { font-size: 12px; color: var(--red); }
        .sl-hint { font-size: 12px; color: var(--text-muted); }
      `}</style>

      <div className="sl-wrap">

        {/* Stats */}
        <div className="sl-stats">
          <div className="sl-stat">
            <div className="sl-stat-icon" style={{ background: "rgba(99,102,241,0.12)" }}>
              <BookOpen size={18} color="var(--indigo, #6366f1)" />
            </div>
            <div>
              <div className="sl-stat-val">
                {loading ? "—" : skills.length}
              </div>
              <div className="sl-stat-label">Total Skills</div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="sl-controls">
          <div className="sl-search">
            <Search size={14} />
            <input
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {search.trim() && (
            <span className="sl-count">
              {filtered.length} of {skills.length} result{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Table */}
        <div className="sl-card">
          {loading ? (
            <table className="sl-table">
              <thead>
                <tr>
                  <th>Skill ID</th>
                  <th>Skill Name</th>
                  <th>Added On</th>
                  <th className="sl-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="sl-skeleton-row">
                    <td><div className="sl-skel" style={{ width: 50 }} /></td>
                    <td><div className="sl-skel" style={{ width: 180 }} /></td>
                    <td><div className="sl-skel" style={{ width: 100 }} /></td>
                    <td><div className="sl-skel" style={{ width: 80, marginLeft: "auto" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : filtered.length === 0 ? (
            <div className="sl-empty">
              <div className="sl-empty-icon"><BookOpen size={22} /></div>
              <div className="sl-empty-title">
                {search.trim() ? "No matching skills" : "No skills yet"}
              </div>
              <div className="sl-empty-sub">
                {search.trim()
                  ? `No skills match "${search}". Try a different search.`
                  : `Click "Add Skill" to create the first skill in the library.`}
              </div>
            </div>
          ) : (
            <table className="sl-table">
              <thead>
                <tr>
                  <th>Skill ID</th>
                  <th>Skill Name</th>
                  <th>Added On</th>
                  <th className="sl-th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((skill) => (
                  <tr key={skill.id}>
                    <td>
                      <span className="sl-id">{skill.skillId}</span>
                    </td>
                    <td>
                      <span className="sl-name">{skill.name}</span>
                    </td>
                    <td>
                      <span className="sl-date">
                        {skill.createdAt
                          ? skill.createdAt.toDate().toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <div className="sl-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          onClick={() => openEdit(skill)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={Trash2}
                          onClick={() => setDeleteSkill(skill)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Add Modal ─────────────────────────────────────────────────────────── */}
      <Modal
        open={addOpen}
        onClose={() => { if (!addSaving) setAddOpen(false); }}
        title="Add Skill"
        description="A unique ID will be generated automatically."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleAdd} loading={addSaving}>
              Add Skill
            </Button>
          </>
        }
      >
        <div className="sl-field">
          <label className="sl-label">Skill Name</label>
          <input
            className={`sl-input${addError ? " sl-input-err" : ""}`}
            placeholder="e.g. Electrical Wiring"
            value={addName}
            onChange={(e) => { setAddName(e.target.value); setAddError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            autoFocus
          />
          {addError
            ? <span className="sl-err">{addError}</span>
            : <span className="sl-hint">Name must be unique within the library.</span>
          }
        </div>
      </Modal>

      {/* ── Edit Modal ────────────────────────────────────────────────────────── */}
      <Modal
        open={!!editSkill}
        onClose={() => { if (!editSaving) setEditSkill(null); }}
        title="Edit Skill"
        description={editSkill ? `Skill ID ${editSkill.skillId} — the ID cannot be changed.` : ""}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditSkill(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleEdit} loading={editSaving}>
              Save Changes
            </Button>
          </>
        }
      >
        <div className="sl-field">
          <label className="sl-label">Skill Name</label>
          <input
            className={`sl-input${editError ? " sl-input-err" : ""}`}
            placeholder="Skill name"
            value={editName}
            onChange={(e) => { setEditName(e.target.value); setEditError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleEdit(); }}
            autoFocus
          />
          {editError && <span className="sl-err">{editError}</span>}
        </div>
      </Modal>

      {/* ── Delete Confirm ────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteSkill}
        onClose={() => { if (!deleting) setDeleteSkill(null); }}
        onConfirm={handleDelete}
        title="Delete Skill"
        message={
          deleteSkill
            ? `Are you sure you want to delete skill ${deleteSkill.skillId} — "${deleteSkill.name}"? This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </AdminLayout>
  );
}
