"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { writeLog, buildDescription } from "@/lib/activitylog";
import { ASSIGNABLE_MODULES } from "@/lib/modules";
import { Save, KeyRound, Shield, ShieldCheck, Eye, EyeOff } from "lucide-react";
import type { ModuleKey } from "@/lib/modules";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date | null) {
  return d
    ? d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "—";
}

function getModuleLabel(key: ModuleKey): string {
  return ASSIGNABLE_MODULES.find((m) => m.key === key)?.label ?? key;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  useAuthGuard();
  const { user, firebaseUser } = useAuth();

  // ── Firestore record for createdAt / lastLogin ─────────────────────────────
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [lastLogin, setLastLogin] = useState<Date | null>(null);
  const [recordLoading, setRecordLoading] = useState(true);

  const fetchRecord = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "admins", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        setCreatedAt(d.createdAt?.toDate?.() ?? null);
        setLastLogin(d.lastLogin?.toDate?.() ?? null);
      }
    } catch {
      // non-critical — stats simply show "—"
    } finally {
      setRecordLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  // ── Profile name edit ──────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.displayName]);

  const handleSaveProfile = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "admins", user.uid), {
        name:      displayName.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      await writeLog({
        actorId:    user.uid,
        actorName:  user.displayName ?? "Unknown",
        actorEmail: user.email ?? "",
        module:     "admin_management",
        action:     "updated_admin",
        description: buildDescription.updatedAdmin(
          user.displayName ?? "Unknown",
          displayName.trim()
        ),
        targetId:      user.uid,
        targetName:    displayName.trim(),
        affectedFiles: [`admins/${user.uid}`],
        meta: { from: user.displayName, to: displayName.trim() },
      });
      toast.success("Profile updated", "Your display name has been saved.");
    } catch (err: any) {
      toast.error("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // ── Password change ────────────────────────────────────────────────────────
  const isEmailPasswordUser =
    firebaseUser?.providerData.some((p) => p.providerId === "password") ?? false;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const passwordMismatch =
    newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;

  const canChangePassword =
    currentPassword.length > 0 && newPassword.length >= 8 && !passwordMismatch;

  const handleChangePassword = async () => {
    if (!firebaseUser || !user) return;
    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email!, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      toast.success("Password changed", "Your password has been updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      let msg = err.message ?? "Failed to change password.";
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
        msg = "Current password is incorrect.";
      if (err.code === "auth/weak-password")
        msg = "New password must be at least 6 characters.";
      if (err.code === "auth/requires-recent-login")
        msg = "Please sign out and sign back in before changing your password.";
      toast.error("Password change failed", msg);
    } finally {
      setChangingPassword(false);
    }
  };

  // ── Avatar initials ────────────────────────────────────────────────────────
  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "SA";

  return (
    <AdminLayout title="My Profile" subtitle="Manage your account settings">
      <style>{`
        .profile-grid {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 20px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .profile-grid { grid-template-columns: 1fr; }
        }

        /* ── Left card ── */
        .profile-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          text-align: center;
        }
        .profile-avatar {
          width: 80px; height: 80px;
          background: linear-gradient(135deg, var(--blue), var(--purple));
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; font-weight: 700; color: white;
          font-family: 'Space Mono', monospace;
          flex-shrink: 0;
        }
        .profile-name { font-size: 17px; font-weight: 700; color: var(--text-primary); }
        .profile-email { font-size: 12px; color: var(--text-muted); word-break: break-all; }
        .profile-stat {
          font-size: 12px; color: var(--text-secondary);
          display: flex; align-items: center; gap: 6px; justify-content: center;
          width: 100%;
        }
        .profile-stat strong {
          color: var(--text-primary);
          font-family: 'Space Mono', monospace;
          font-size: 11px;
        }
        .profile-divider { width: 100%; height: 1px; background: var(--border); }
        .profile-perm-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
          text-transform: uppercase; color: var(--text-muted); align-self: flex-start;
        }
        .profile-perms {
          display: flex; flex-wrap: wrap; gap: 6px;
          justify-content: center; width: 100%;
        }
        .perm-tag {
          font-size: 10px; font-weight: 600; padding: 3px 9px;
          border-radius: 12px; background: var(--blue-dim); color: var(--blue);
          white-space: nowrap;
        }

        /* ── Right forms ── */
        .profile-forms { display: flex; flex-direction: column; gap: 16px; }
        .form-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .form-title {
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 8px;
        }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
        .field-group { display: flex; flex-direction: column; gap: 7px; }
        .field-label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
          text-transform: uppercase; color: var(--text-muted);
        }
        .field-input {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 9px 12px;
          color: var(--text-primary); font-size: 13px; outline: none;
          font-family: inherit; transition: border-color 0.2s;
          width: 100%; box-sizing: border-box;
        }
        .field-input:focus { border-color: var(--blue); }
        .field-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .field-input.readonly { opacity: 0.6; cursor: default; }
        .field-hint { font-size: 11px; color: var(--text-muted); }
        .field-error { font-size: 11px; color: var(--red); }
        .form-actions { display: flex; justify-content: flex-end; margin-top: 20px; }
        .pw-wrap { position: relative; }
        .pw-toggle {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: var(--text-muted); display: flex; padding: 2px;
        }
        .pw-toggle:hover { color: var(--text-secondary); }
        .pw-input { padding-right: 36px !important; }
      `}</style>

      <div className="profile-grid">

        {/* ── Left: Identity card ── */}
        <div className="profile-card">
          <div className="profile-avatar">{initials}</div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div className="profile-name">{user?.displayName ?? "—"}</div>
            {user?.role === "super_admin" ? (
              <Badge variant="purple">
                <ShieldCheck size={10} style={{ display: "inline", marginRight: 3 }} />
                Super Admin
              </Badge>
            ) : (
              <Badge variant="blue">
                <Shield size={10} style={{ display: "inline", marginRight: 3 }} />
                Admin
              </Badge>
            )}
          </div>

          <div className="profile-email">{user?.email ?? "—"}</div>

          <div className="profile-divider" />

          <div className="profile-stat">
            <span>Last login:</span>
            <strong>{recordLoading ? "…" : formatDate(lastLogin)}</strong>
          </div>
          <div className="profile-stat">
            <span>Account since:</span>
            <strong>{recordLoading ? "…" : formatDate(createdAt)}</strong>
          </div>

          {user?.role === "super_admin" && (
            <>
              <div className="profile-divider" />
              <span style={{ fontSize: 12, color: "var(--purple)", fontWeight: 600 }}>
                Full access to all modules
              </span>
            </>
          )}

          {user?.role !== "super_admin" && user?.permissions && user.permissions.length > 0 && (
            <>
              <div className="profile-divider" />
              <span className="profile-perm-label">Module Access</span>
              <div className="profile-perms">
                {user.permissions.map((key) => (
                  <span key={key} className="perm-tag">{getModuleLabel(key)}</span>
                ))}
              </div>
            </>
          )}

          {user?.role !== "super_admin" && user?.permissions?.length === 0 && (
            <>
              <div className="profile-divider" />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No modules assigned</span>
            </>
          )}
        </div>

        {/* ── Right: Forms ── */}
        <div className="profile-forms">

          {/* Personal Information */}
          <div className="form-card">
            <div className="form-title">Personal Information</div>
            <div className="form-grid">
              <div className="field-group" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label">Display Name</label>
                <input
                  className="field-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={saving}
                  placeholder="Your full name"
                />
              </div>
              <div className="field-group">
                <label className="field-label">Email Address</label>
                <input
                  className="field-input readonly"
                  value={user?.email ?? ""}
                  readOnly
                />
                <span className="field-hint">Email cannot be changed.</span>
              </div>
              <div className="field-group">
                <label className="field-label">Role</label>
                <input
                  className="field-input readonly"
                  value={user?.role === "super_admin" ? "Super Admin" : "Admin"}
                  readOnly
                />
              </div>
            </div>
            <div className="form-actions">
              <Button
                variant="primary"
                size="sm"
                icon={Save}
                loading={saving}
                disabled={
                  saving ||
                  !displayName.trim() ||
                  displayName.trim() === (user?.displayName ?? "")
                }
                onClick={handleSaveProfile}
              >
                Save Profile
              </Button>
            </div>
          </div>

          {/* Change Password — email/password accounts only */}
          {isEmailPasswordUser && (
            <div className="form-card">
              <div className="form-title">
                <KeyRound size={15} />
                Change Password
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="field-group">
                  <label className="field-label">Current Password</label>
                  <div className="pw-wrap">
                    <input
                      className="field-input pw-input"
                      type={showCurrentPw ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={changingPassword}
                      placeholder="Enter current password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="pw-toggle"
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                      disabled={changingPassword}
                    >
                      {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">New Password</label>
                  <div className="pw-wrap">
                    <input
                      className="field-input pw-input"
                      type={showNewPw ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      disabled={changingPassword}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="pw-toggle"
                      onClick={() => setShowNewPw(!showNewPw)}
                      disabled={changingPassword}
                    >
                      {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {newPassword.length > 0 && newPassword.length < 8 && (
                    <p className="field-error">Password must be at least 8 characters.</p>
                  )}
                </div>

                <div className="field-group">
                  <label className="field-label">Confirm New Password</label>
                  <div className="pw-wrap">
                    <input
                      className="field-input pw-input"
                      type={showConfirmPw ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={changingPassword}
                      placeholder="Repeat new password"
                      autoComplete="new-password"
                      style={passwordMismatch ? { borderColor: "var(--red)" } : {}}
                    />
                    <button
                      type="button"
                      className="pw-toggle"
                      onClick={() => setShowConfirmPw(!showConfirmPw)}
                      disabled={changingPassword}
                    >
                      {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {passwordMismatch && <p className="field-error">Passwords do not match.</p>}
                </div>
              </div>
              <div className="form-actions">
                <Button
                  variant="primary"
                  size="sm"
                  icon={KeyRound}
                  loading={changingPassword}
                  disabled={!canChangePassword || changingPassword}
                  onClick={handleChangePassword}
                >
                  Update Password
                </Button>
              </div>
            </div>
          )}

          {/* Sign-in method info — Google OAuth accounts */}
          {!isEmailPasswordUser && !recordLoading && (
            <div className="form-card">
              <div className="form-title">
                <KeyRound size={15} />
                Sign-in Method
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Your account uses{" "}
                <strong style={{ color: "var(--text-primary)" }}>Google OAuth</strong>{" "}
                for authentication. Password management is handled through your Google account.
              </p>
            </div>
          )}

        </div>
      </div>
    </AdminLayout>
  );
}