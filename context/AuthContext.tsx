"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { signOutWithReason } from "@/lib/sessionLogout";
import type { ModuleKey } from "@/lib/modules";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdminRole = "super_admin" | "admin";

export interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: AdminRole;
  permissions: ModuleKey[];
  isActive: boolean;
  photoURL?: string | null;
}

interface AuthContextValue {
  user: AdminUser | null;
  firebaseUser: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  hasPermission: (module: ModuleKey) => boolean;
  isSuperAdmin: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  firebaseUser: null,
  loading: true,
  isAuthenticated: false,
  hasPermission: () => false,
  isSuperAdmin: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      // console.log("────────────────────────────────────");
      // console.log("onAuthStateChanged fired");
      // console.log("Firebase user:", fbUser ? `${fbUser.email} (${fbUser.uid})` : "null");

      setFirebaseUser(fbUser);

      if (!fbUser) {
        // console.log("No Firebase user — clearing state");
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        // console.log("Looking up admins/" + fbUser.uid);
        const ref = doc(db, "admins", fbUser.uid);
        const snap = await getDoc(ref);
        // console.log("Document exists:", snap.exists());

        if (snap.exists()) {
          const data = snap.data();
          // console.log("Document data:", JSON.stringify(data, null, 2));

          // console.log("isActive value:", data.isActive, "| type:", typeof data.isActive);

          if (!data.isActive) {
            // console.warn("Admin is inactive — signing out");
            await auth.signOut();
            setUser(null);
            setLoading(false);
            return;
          }

          //  console.log("Stamping lastLogin...");
          updateDoc(ref, { lastLogin: serverTimestamp() }).catch((err) => {
          // console.warn("Failed to stamp lastLogin:", err);
          });

          const adminUser: AdminUser = {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: data.name ?? fbUser.displayName ?? null,
            role: data.role ?? "admin",
            permissions: data.permissions ?? [],
            isActive: data.isActive,
            photoURL: fbUser.photoURL,
          };

          // console.log("Setting user:", JSON.stringify(adminUser, null, 2));
          setUser(adminUser);
          setLoading(false);
          return;
        }

        // console.log("No doc found by UID — checking for pending record by email:", fbUser.email);

        const pendingQ = query(
          collection(db, "admins"),
          where("email", "==", fbUser.email),
          where("isPending", "==", true)
        );
        const pendingSnap = await getDocs(pendingQ);
        // console.log("Pending docs found:", pendingSnap.size);

        if (pendingSnap.empty) {
        // console.warn("No pending record found for:", fbUser.email, "— denying access");
          await auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }

        const pendingDoc = pendingSnap.docs[0];
        const pendingData = pendingDoc.data();
        // console.log("Pending doc data:", JSON.stringify(pendingData, null, 2));

        if (!pendingData.isActive) {
          // console.warn("Pending admin is inactive — signing out");
          await auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }

        // console.log("Promoting pending record to UID-based doc...");
        await setDoc(ref, {
          ...pendingData,
          id: fbUser.uid,
          isPending: false,
          promotedFrom: pendingDoc.id,
          lastLogin: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await deleteDoc(pendingDoc.ref);
        // console.log("Pending record promoted successfully");

        const promotedUser: AdminUser = {
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: pendingData.name ?? fbUser.displayName ?? null,
          role: pendingData.role ?? "admin",
          permissions: pendingData.permissions ?? [],
          isActive: true,
          photoURL: fbUser.photoURL,
        };

        // console.log("Setting promoted user:", JSON.stringify(promotedUser, null, 2));
        setUser(promotedUser);
      } catch (err) {
        console.error("AuthContext: sign-in lookup failed, signing out —", err);
        await auth.signOut();
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // ── Live access check ──────────────────────────────────────────────────────
  // The lookup above only runs at sign-in. Watching the admin's own doc means a
  // super admin deactivating or removing them takes effect immediately, and
  // role / permission changes apply without a reload.
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(db, "admins", uid),
      (snap) => {
        const data = snap.data();
        if (!snap.exists() || !data?.isActive || data.isPending === true) {
          signOutWithReason("revoked");
          return;
        }
        setUser((prev) => {
          if (!prev) return prev;
          const role: AdminRole = data.role ?? "admin";
          const permissions: ModuleKey[] = data.permissions ?? [];
          const displayName = data.name ?? prev.displayName;
          const unchanged =
            prev.role === role &&
            prev.displayName === displayName &&
            prev.permissions.length === permissions.length &&
            prev.permissions.every((p, i) => p === permissions[i]);
          return unchanged ? prev : { ...prev, role, permissions, displayName };
        });
      },
      // Expected right after sign-out, when the read is no longer allowed
      (err) => console.warn("[AuthContext] admin doc listener:", err.code ?? err)
    );
  }, [uid]);

  // ── hasPermission ──────────────────────────────────────────────────────────
  const hasPermission = useCallback(
    (module: ModuleKey): boolean => {
      if (!user) {
        // console.log("hasPermission('" + module + "') → false (no user)");
        return false;
      }
      if (user.role === "super_admin") {
        return true;
      }
      const result = user.permissions.includes(module);
      if (!result) {
        // console.log("hasPermission('" + module + "') → false (not in permissions:", user.permissions, ")");
      }
      return result;
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        loading,
        isAuthenticated: !!user,
        hasPermission,
        isSuperAdmin: user?.role === "super_admin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext);
}