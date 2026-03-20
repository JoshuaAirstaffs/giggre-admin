"use client";

import { useState, useEffect, useCallback } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { writeLog, buildDescription } from "@/lib/activitylog";
import type { ModuleKey } from "@/lib/modules";
import type { AdminRole } from "@/context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminRecord {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  permissions: ModuleKey[];
  createdAt: Date | null;
  createdBy: string;
  lastLogin: Date | null;
  updatedAt: Date | null;
  updatedBy: string;
}

export interface CreateAdminInput {
  email: string;
  name: string;
  role: AdminRole;
  permissions: ModuleKey[];
  password?: string;
}

export interface UpdateAdminInput {
  name?: string;
  role?: AdminRole;
  isActive?: boolean;
  permissions?: ModuleKey[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAdmins() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch all admins ───────────────────────────────────────────────────────
  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, "admins"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const list: AdminRecord[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:          d.id,
          email:       data.email       ?? "",
          name:        data.name        ?? "",
          role:        data.role        ?? "admin",
          isActive:    data.isActive    ?? true,
          permissions: data.permissions ?? [],
          createdAt:   data.createdAt?.toDate?.()  ?? null,
          createdBy:   data.createdBy   ?? "",
          lastLogin:   data.lastLogin?.toDate?.()  ?? null,
          updatedAt:   data.updatedAt?.toDate?.()  ?? null,
          updatedBy:   data.updatedBy   ?? "",
        };
      });
      setAdmins(list);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch admins.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  // ── Shared actor fields ────────────────────────────────────────────────────
  const actor = useCallback(() => ({
    actorId:    user?.uid            ?? "",
    actorName:  user?.displayName   ?? "Unknown",
    actorEmail: user?.email         ?? "",
  }), [user]);

  // ── createAdmin ────────────────────────────────────────────────────────────
  const createAdmin = useCallback(
    async (input: CreateAdminInput): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };

      try {
        if (input.password) {
          // Email/password path — delegated to the API route which writes its own log
          const currentUser = auth.currentUser;
          if (!currentUser) return { success: false, error: "Not authenticated. Please sign in again." };

          const token = await currentUser.getIdToken(true);
          const res = await fetch("/api/admin/create-user", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email:       input.email,
              name:        input.name,
              password:    input.password,
              role:        input.role,
              permissions: input.permissions,
            }),
          });

          if (!res.ok) {
            const body = await res.json();
            return { success: false, error: body.error };
          }

          await fetchAdmins();
          return { success: true };
        }

        // Google OAuth pending record
        const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await setDoc(doc(db, "admins", tempId), {
          id:          tempId,
          email:       input.email,
          name:        input.name,
          role:        input.role,
          isActive:    true,
          permissions: input.permissions,
          createdAt:   serverTimestamp(),
          createdBy:   user.uid,
          lastLogin:   null,
          updatedAt:   serverTimestamp(),
          updatedBy:   user.uid,
          isPending:   true,
        });

        await writeLog({
          ...actor(),
          module:      "admin_management",
          action:      "created_admin",
          description: buildDescription.createdAdmin(input.name, input.email, "google_oauth"),
          targetId:    tempId,
          targetName:  input.name,
          affectedFiles: [`admins/${tempId}`],
          meta: {
            other: { email: input.email, role: input.role, authMethod: "google_oauth" },
          },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        let msg = err.message ?? "Failed to create admin.";
        if (err.code === "auth/email-already-in-use") msg = "An account with this email already exists.";
        if (err.code === "auth/invalid-email")        msg = "Please enter a valid email address.";
        if (err.code === "auth/weak-password")        msg = "Password must be at least 6 characters.";
        return { success: false, error: msg };
      }
    },
    [user, actor, fetchAdmins],
  );

  // ── updateAdmin ────────────────────────────────────────────────────────────
  const updateAdmin = useCallback(
    async (
      adminId: string,
      input: UpdateAdminInput,
      adminName: string,
      previousValues?: Partial<UpdateAdminInput>,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        await updateDoc(doc(db, "admins", adminId), {
          ...input,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          ...actor(),
          module:      "admin_management",
          action:      "updated_admin",
          description: buildDescription.updatedAdmin(user.displayName ?? "Unknown", adminName),
          targetId:    adminId,
          targetName:  adminName,
          affectedFiles: [`admins/${adminId}`],
          meta: { from: previousValues ?? null, to: input },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to update admin." };
      }
    },
    [user, actor, fetchAdmins],
  );

  // ── toggleActive ───────────────────────────────────────────────────────────
  const toggleActive = useCallback(
    async (
      adminId: string,
      currentState: boolean,
      adminName: string,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      const nextState = !currentState;
      try {
        await updateDoc(doc(db, "admins", adminId), {
          isActive:  nextState,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          ...actor(),
          module:      "admin_management",
          action:      "toggled_admin_status",
          description: buildDescription.toggledAdminStatus(adminName, nextState),
          targetId:    adminId,
          targetName:  adminName,
          affectedFiles: [`admins/${adminId}`],
          meta: { from: currentState, to: nextState },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to toggle status." };
      }
    },
    [user, actor, fetchAdmins],
  );

  // ── deleteAdmin ────────────────────────────────────────────────────────────
  const deleteAdmin = useCallback(
    async (
      adminId: string,
      adminName: string,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      if (adminId === user.uid) return { success: false, error: "You cannot delete your own account." };

      try {
        await deleteDoc(doc(db, "admins", adminId));

        await writeLog({
          ...actor(),
          module:      "admin_management",
          action:      "deleted_admin",
          description: buildDescription.deletedAdmin(adminName),
          targetId:    adminId,
          targetName:  adminName,
          affectedFiles: [`admins/${adminId}`],
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to delete admin." };
      }
    },
    [user, actor, fetchAdmins],
  );

  // ── updatePermissions ──────────────────────────────────────────────────────
  const updatePermissions = useCallback(
    async (
      adminId: string,
      permissions: ModuleKey[],
      adminName: string,
      previousPermissions?: ModuleKey[],
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        await updateDoc(doc(db, "admins", adminId), {
          permissions,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          ...actor(),
          module:      "admin_management",
          action:      "updated_permissions",
          description: buildDescription.updatedPermissions(adminName, permissions),
          targetId:    adminId,
          targetName:  adminName,
          affectedFiles: [`admins/${adminId}`],
          meta: { from: previousPermissions ?? null, to: permissions },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to update permissions." };
      }
    },
    [user, actor, fetchAdmins],
  );

  return {
    admins,
    loading,
    error,
    refetch: fetchAdmins,
    createAdmin,
    updateAdmin,
    toggleActive,
    deleteAdmin,
    updatePermissions,
  };
}