import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

async function runDeletion(actor: { id: string; name: string; email: string | null }) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const cutoff = Timestamp.fromDate(endOfToday);

  const snap = await adminDb
    .collection("users")
    .where("pendingDeletion", "==", true)
    .where("scheduledDeleteAt", "<=", cutoff)
    .get();

  if (snap.empty) {
    return { deleted: [], count: 0, ranAt: now.toISOString() };
  }

  const deleted: { id: string; name: string; email: string; scheduledDeleteAt: string }[] = [];
  const errors: { id: string; error: string }[] = [];

  await Promise.all(
    snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const userId = docSnap.id;
      const name = data.name ?? "Unknown";
      const email = data.email ?? "";
      const scheduledAt = (data.scheduledDeleteAt as Timestamp).toDate().toISOString();

      try {
        try {
          await adminAuth.deleteUser(userId);
        } catch (authErr: any) {
          if (authErr?.code !== "auth/user-not-found") throw authErr;
        }
        await adminDb.collection("users").doc(userId).delete();
        deleted.push({ id: userId, name, email, scheduledDeleteAt: scheduledAt });
      } catch (err: any) {
        errors.push({ id: userId, error: err?.message ?? "Unknown error" });
      }
    })
  );

  if (deleted.length > 0) {
    const userList = deleted
      .map((u) => `• "${u.name}" (${u.email}) — ID: ${u.id}`)
      .join("\n");

    await adminDb.collection("activityLogs").add({
      actorId:       actor.id,
      actorName:     actor.name,
      actorEmail:    actor.email,
      module:        "user_management",
      action:        "user_deleted",
      description:   `Deleted ${deleted.length} scheduled account${deleted.length !== 1 ? "s" : ""}:\n${userList}`,
      targetSection: null,
      targetId:      null,
      targetName:    null,
      affectedFiles: deleted.map((u) => `users/${u.id}`),
      meta: {
        from:  null,
        to:    null,
        other: {
          count: deleted.length,
          users: deleted.map((u) => ({ id: u.id, name: u.name, email: u.email, scheduledDeleteAt: u.scheduledDeleteAt })),
        },
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    deleted,
    count: deleted.length,
    errors: errors.length > 0 ? errors : undefined,
    ranAt: now.toISOString(),
  };
}

// Cron-triggered — actor is System
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runDeletion({ id: "system", name: "System (Cron)", email: null });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[delete-scheduled-users] GET fatal error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error", deleted: [], count: 0 },
      { status: 500 }
    );
  }
}

// Admin-triggered — actor is the calling admin
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const token   = authHeader.split("Bearer ")[1];
    const decoded = await adminAuth.verifyIdToken(token);

    const callerDoc = await adminDb.doc(`admins/${decoded.uid}`).get();
    if (!callerDoc.exists) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const callerData = callerDoc.data();
    const actor = {
      id:    decoded.uid,
      name:  callerData?.name  ?? decoded.name ?? decoded.email ?? "Admin",
      email: decoded.email ?? null,
    };

    const result = await runDeletion(actor);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[delete-scheduled-users] POST fatal error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error", deleted: [], count: 0 },
      { status: 500 }
    );
  }
}
