"use client";

import { useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAdmins } from "@/hooks/useAdmins";
import { ASSIGNABLE_MODULES } from "@/lib/modules";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toaster";
import {
  Plus, Edit2, Trash2, ToggleLeft, ToggleRight,
  Shield, ShieldCheck, Search,
} from "lucide-react";
import type { AdminRecord, CreateAdminInput, UpdateAdminInput } from "@/hooks/useAdmins";
import type { ModuleKey } from "@/lib/modules";
import type { AdminRole } from "@/context/AuthContext";

// ─── Permission Picker ────────────────────────────────────────────────────────

function PermissionPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: ModuleKey[];
  onChange: (v: ModuleKey[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: ModuleKey) => {
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    );
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {ASSIGNABLE_MODULES.map((m) => {
        const active = selected.includes(m.key);
        return (
          <button
            key={m.key}
            type="button"
            disabled={disabled}
            onClick={() => toggle(m.key)}
            style={{
              padding: "5px 12px",
              borderRadius: 20,
              border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
              background: active ? "var(--blue-dim)" : "var(--bg-elevated)",
              color: active ? "var(--blue)" : "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Admin Form ───────────────────────────────────────────────────────────────

interface AdminFormData {
  email: string;
  name: string;
  role: AdminRole;
  permissions: ModuleKey[];
}

function AdminForm({
  initial,
  onSubmit,
  loading,
  isEdit,
}: {
  initial: AdminFormData;
  onSubmit: (data: AdminFormData) => void;
  loading: boolean;
  isEdit?: boolean;
}) {
  const [form, setForm] = useState<AdminFormData>(initial);

  const set = (key: keyof AdminFormData, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`
        .af-label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
          text-transform: uppercase; color: var(--text-muted);
          margin-bottom: 6px; display: block;
        }
        .af-input {
          width: 100%; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          padding: 9px 12px; color: var(--text-primary);
          font-size: 13px; outline: none; font-family: inherit;
          transition: border-color 0.2s;
        }
        .af-input:focus { border-color: var(--blue); }
        .af-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .af-select {
          width: 100%; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          padding: 9px 12px; color: var(--text-primary);
          font-size: 13px; outline: none; font-family: inherit; cursor: pointer;
        }
        .af-select:focus { border-color: var(--blue); }
      `}</style>

      <div>
        <label className="af-label">Full Name</label>
        <input className="af-input" value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Juan Dela Cruz" disabled={loading} />
      </div>

      <div>
        <label className="af-label">Email Address</label>
        <input className="af-input" type="email" value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="admin@giggre.com"
          disabled={loading || isEdit} // Email cannot be changed after creation
        />
        {isEdit && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Email cannot be changed after account creation.
          </p>
        )}
      </div>

      <div>
        <label className="af-label">Role</label>
        <select className="af-select" value={form.role}
          onChange={(e) => set("role", e.target.value as AdminRole)}
          disabled={loading}>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>

      {form.role === "admin" && (
        <div>
          <label className="af-label" style={{ marginBottom: 10, display: "block" }}>
            Module Access
          </label>
          <PermissionPicker
            selected={form.permissions}
            onChange={(v) => set("permissions", v)}
            disabled={loading}
          />
        </div>
      )}

      {form.role === "super_admin" && (
        <div style={{
          background: "var(--purple-dim)", border: "1px solid rgba(139,92,246,0.2)",
          borderRadius: "var(--radius-sm)", padding: "10px 14px",
          fontSize: 13, color: "var(--purple)",
        }}>
          Super admins have access to all modules by default.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
        <Button variant="primary" size="sm" loading={loading}
          onClick={() => onSubmit(form)}
          disabled={!form.name.trim() || !form.email.trim()}>
          {isEdit ? "Save Changes" : "Create Admin"}
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminsPage() {
  useAuthGuard({ roles: ["super_admin"] });

  const { admins, loading, createAdmin, updateAdmin, toggleActive, deleteAdmin } = useAdmins();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminRecord | null>(null);
  const [deleting, setDeleting] = useState<AdminRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = admins.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (form: AdminFormData) => {
    setSubmitting(true);
    const result = await createAdmin(form as CreateAdminInput);
    setSubmitting(false);
    if (result.success) {
      toast.success("Admin created", "They can now sign in with their Google account.");
      setCreating(false);
    } else {
      toast.error("Failed to create admin", result.error);
    }
  };

  const handleEdit = async (form: AdminFormData) => {
    if (!editing) return;
    setSubmitting(true);
    const result = await updateAdmin(editing.id, {
      name: form.name,
      role: form.role,
      permissions: form.role === "super_admin" ? [] : form.permissions,
    } as UpdateAdminInput, editing.name);
    setSubmitting(false);
    if (result.success) {
      toast.success("Admin updated");
      setEditing(null);
    } else {
      toast.error("Failed to update admin", result.error);
    }
  };

  const handleToggle = async (admin: AdminRecord) => {
    const result = await toggleActive(admin.id, admin.isActive, admin.name);
    if (result.success) {
      toast.success(
        admin.isActive ? "Admin deactivated" : "Admin activated",
        admin.name
      );
    } else {
      toast.error("Failed to toggle status", result.error);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSubmitting(true);
    const result = await deleteAdmin(deleting.id, deleting.name);
    setSubmitting(false);
    if (result.success) {
      toast.success("Admin deleted", deleting.name);
      setDeleting(null);
    } else {
      toast.error("Failed to delete", result.error);
    }
  };

  const formatDate = (d: Date | null) =>
    d ? d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <AdminLayout
      title="Admin Management"
      subtitle="Manage admin accounts and module permissions"
      actions={
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Add Admin
        </Button>
      }
    >
      <style>{`
        .admins-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
        }
        .admins-search {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 7px 12px; width: 260px;
          transition: border-color 0.2s;
        }
        .admins-search:focus-within { border-color: var(--blue); }
        .admins-search input {
          background: none; border: none; outline: none;
          color: var(--text-primary); font-size: 13px; width: 100%;
          font-family: inherit;
        }
        .admins-search input::placeholder { color: var(--text-muted); }
        .admins-table-wrap {
          background: var(--bg-surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); overflow: hidden;
        }
        .admins-table { width: 100%; border-collapse: collapse; }
        .admins-table thead tr {
          background: var(--bg-elevated); border-bottom: 1px solid var(--border);
        }
        .admins-table th {
          padding: 11px 16px; text-align: left; font-size: 11px; font-weight: 700;
          letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted);
          white-space: nowrap;
        }
        .admins-table tbody tr {
          border-bottom: 1px solid var(--border-muted);
          transition: background 0.12s;
        }
        .admins-table tbody tr:last-child { border-bottom: none; }
        .admins-table tbody tr:hover { background: var(--bg-elevated); }
        .admins-table td { padding: 13px 16px; font-size: 13px; color: var(--text-secondary); }
        .admin-name { font-weight: 600; color: var(--text-primary); font-size: 13px; }
        .admin-email { font-size: 12px; color: var(--text-muted); margin-top: 1px; }
        .perms-chips { display: flex; flex-wrap: wrap; gap: 4px; max-width: 300px; }
        .perm-chip {
          font-size: 10px; font-weight: 600; padding: 2px 7px;
          border-radius: 10px; background: var(--blue-dim); color: var(--blue);
          white-space: nowrap;
        }
        .action-row { display: flex; align-items: center; gap: 6px; }
        .icon-btn {
          width: 30px; height: 30px; border-radius: var(--radius-sm);
          display: flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); background: var(--bg-elevated);
          color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
        }
        .icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .icon-btn.danger:hover { background: var(--red-dim); color: var(--red); border-color: rgba(239,68,68,0.25); }
        .admins-empty {
          padding: 48px; text-align: center; color: var(--text-muted); font-size: 13px;
        }
        @media (max-width: 768px) {
          .admins-table-wrap { overflow-x: auto; }
          .admins-search { width: 100%; }
        }
      `}</style>

      <div className="admins-toolbar">
        <div className="admins-search">
          <Search size={13} color="var(--text-muted)" />
          <input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {filtered.length} admin{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="admins-table-wrap">
        <table className="admins-table">
          <thead>
            <tr>
              <th>Name / Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Module Access</th>
              <th>Last Login</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="admins-empty">Loading admins…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="admins-empty">No admins found.</td>
              </tr>
            ) : (
              filtered.map((admin) => (
                <tr key={admin.id}>
                  <td>
                    <div className="admin-name">{admin.name}</div>
                    <div className="admin-email">{admin.email}</div>
                  </td>
                  <td>
                    <Badge variant={admin.role === "super_admin" ? "purple" : "blue"}>
                      {admin.role === "super_admin" ? (
                        <><ShieldCheck size={10} style={{ display:"inline", marginRight:3 }} />Super Admin</>
                      ) : (
                        <><Shield size={10} style={{ display:"inline", marginRight:3 }} />Admin</>
                      )}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={admin.isActive ? "green" : "red"} dot>
                      {admin.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td>
                    {admin.role === "super_admin" ? (
                      <span style={{ fontSize: 12, color: "var(--purple)", fontWeight: 600 }}>
                        All modules
                      </span>
                    ) : admin.permissions.length === 0 ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>None assigned</span>
                    ) : (
                      <div className="perms-chips">
                        {admin.permissions.slice(0, 4).map((p) => (
                          <span key={p} className="perm-chip">{p}</span>
                        ))}
                        {admin.permissions.length > 4 && (
                          <span className="perm-chip">+{admin.permissions.length - 4}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{formatDate(admin.lastLogin)}</td>
                  <td style={{ fontSize: 12 }}>{formatDate(admin.createdAt)}</td>
                  <td>
                    <div className="action-row">
                      <button className="icon-btn" title="Edit"
                        onClick={() => setEditing(admin)}>
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" title={admin.isActive ? "Deactivate" : "Activate"}
                        onClick={() => handleToggle(admin)}>
                        {admin.isActive
                          ? <ToggleRight size={15} style={{ color: "var(--green)" }} />
                          : <ToggleLeft size={15} />
                        }
                      </button>
                      <button className="icon-btn danger" title="Delete"
                        onClick={() => setDeleting(admin)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      <Modal open={creating} onClose={() => setCreating(false)}
        title="Add New Admin" size="md"
        description="The admin will sign in using their Google account.">
        <AdminForm
          initial={{ email: "", name: "", role: "admin", permissions: ["dashboard"] }}
          onSubmit={handleCreate}
          loading={submitting}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)}
        title="Edit Admin" size="md">
        {editing && (
          <AdminForm
            initial={{
              email: editing.email,
              name: editing.name,
              role: editing.role,
              permissions: editing.permissions,
            }}
            onSubmit={handleEdit}
            loading={submitting}
            isEdit
          />
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete Admin"
        message={`Are you sure you want to permanently delete ${deleting?.name ?? "this admin"}? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={submitting}
      />
    </AdminLayout>
  );
}