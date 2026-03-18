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
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { writeLog } from "@/lib/activitylog";
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

  // ── Fetch all admins ───────────────────────────────────────────────────
  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, "admins"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const list: AdminRecord[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          email: data.email ?? "",
          name: data.name ?? "",
          role: data.role ?? "admin",
          isActive: data.isActive ?? true,
          permissions: data.permissions ?? [],
          createdAt: data.createdAt?.toDate?.() ?? null,
          createdBy: data.createdBy ?? "",
          lastLogin: data.lastLogin?.toDate?.() ?? null,
          updatedAt: data.updatedAt?.toDate?.() ?? null,
          updatedBy: data.updatedBy ?? "",
        };
      });
      setAdmins(list);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch admins.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  // ── Create admin ───────────────────────────────────────────────────────
  // Note: This creates a Firestore document. The user must sign in with
  // the matching Google account to complete Firebase Auth provisioning.
  // For full pre-provisioning, use Firebase Admin SDK in a Cloud Function.
  const createAdmin = useCallback(
    async (input: CreateAdminInput): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        // Use email as a temporary ID seed — will be replaced by Firebase UID on first login
        // Best practice: use a Cloud Function to create via Admin SDK and get real UID.
        // Here we store a "pending" record by email and match on first login.
        const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await setDoc(doc(db, "admins", tempId), {
          id: tempId,
          email: input.email,
          name: input.name,
          role: input.role,
          isActive: true,
          permissions: input.permissions,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          lastLogin: null,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
          isPending: true, // Resolved on first Google login
        });

        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Unknown",
          action: "created_admin",
          targetName: input.name,
          meta: { email: input.email, role: input.role },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to create admin." };
      }
    },
    [user, fetchAdmins]
  );

  // ── Update admin ───────────────────────────────────────────────────────
  const updateAdmin = useCallback(
    async (
      adminId: string,
      input: UpdateAdminInput,
      adminName: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        await updateDoc(doc(db, "admins", adminId), {
          ...input,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Unknown",
          action: "updated_admin",
          targetId: adminId,
          targetName: adminName,
          meta: input as any,
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to update admin." };
      }
    },
    [user, fetchAdmins]
  );

  // ── Toggle isActive ────────────────────────────────────────────────────
  const toggleActive = useCallback(
    async (
      adminId: string,
      currentState: boolean,
      adminName: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        await updateDoc(doc(db, "admins", adminId), {
          isActive: !currentState,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Unknown",
          action: "toggled_admin_status",
          targetId: adminId,
          targetName: adminName,
          meta: { from: currentState, to: !currentState },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to toggle status." };
      }
    },
    [user, fetchAdmins]
  );

  // ── Delete admin ───────────────────────────────────────────────────────
  const deleteAdmin = useCallback(
    async (
      adminId: string,
      adminName: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      // Prevent self-deletion
      if (adminId === user.uid) {
        return { success: false, error: "You cannot delete your own account." };
      }
      try {
        await deleteDoc(doc(db, "admins", adminId));

        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Unknown",
          action: "deleted_admin",
          targetId: adminId,
          targetName: adminName,
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to delete admin." };
      }
    },
    [user, fetchAdmins]
  );

  // ── Update permissions only ────────────────────────────────────────────
  const updatePermissions = useCallback(
    async (
      adminId: string,
      permissions: ModuleKey[],
      adminName: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!user) return { success: false, error: "Not authenticated." };
      try {
        await updateDoc(doc(db, "admins", adminId), {
          permissions,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });

        await writeLog({
          actorId: user.uid,
          actorName: user.displayName ?? "Unknown",
          action: "updated_permissions",
          targetId: adminId,
          targetName: adminName,
          meta: { permissions },
        });

        await fetchAdmins();
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to update permissions." };
      }
    },
    [user, fetchAdmins]
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