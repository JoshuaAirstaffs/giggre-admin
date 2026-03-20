import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { buildDescription } from "@/lib/activitylog";

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const token   = authHeader.split("Bearer ")[1];
    const decoded = await adminAuth.verifyIdToken(token);

    const callerDoc = await adminDb.doc(`admins/${decoded.uid}`).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Create Firebase Auth user ────────────────────────────────────────────
    const { email, name, password, role, permissions } = await req.json();

    const newUser = await adminAuth.createUser({
      email,
      password,
      displayName: name,
    });

    // ── Write admin Firestore document ───────────────────────────────────────
    await adminDb.doc(`admins/${newUser.uid}`).set({
      id:          newUser.uid,
      email,
      name,
      role,
      isActive:    true,
      permissions,
      createdAt:   FieldValue.serverTimestamp(),
      createdBy:   decoded.uid,
      lastLogin:   null,
      updatedAt:   FieldValue.serverTimestamp(),
      updatedBy:   decoded.uid,
      isPending:   false,
    });

    // ── Write activity log ───────────────────────────────────────────────────
    const callerData = callerDoc.data();

    await adminDb.collection("activityLogs").add({
      actorId:    decoded.uid,
      actorName:  callerData?.name  ?? "Unknown",
      actorEmail: callerData?.email ?? null,

      module:      "admin_management",
      action:      "created_admin",
      description: buildDescription.createdAdmin(name, email, "email_password"),

      targetSection: null,
      targetId:      newUser.uid,
      targetName:    name,
      affectedFiles: [`admins/${newUser.uid}`],

      meta: {
        from:  null,
        to:    null,
        other: { email, role, authMethod: "email_password" },
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, uid: newUser.uid });
  } catch (err: any) {
    if (err.code === "auth/email-already-exists") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}