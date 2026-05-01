import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const token   = authHeader.split("Bearer ")[1];
    const decoded = await adminAuth.verifyIdToken(token);

    const callerDoc = await adminDb.doc(`admins/${decoded.uid}`).get();
    if (!callerDoc.exists) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { email, name, phone, password, role, pendingDeletion, scheduledDeleteAt } = await req.json();

    // Build Firebase Auth user — all fields optional for testing
    const authPayload: Record<string, any> = {};
    if (email)    authPayload.email       = email;
    if (password) authPayload.password    = password;
    if (name)     authPayload.displayName = name;

    const newUser = await adminAuth.createUser(authPayload);

    const schedDeleteTs = scheduledDeleteAt
      ? Timestamp.fromDate(new Date(scheduledDeleteAt))
      : null;

    await adminDb.doc(`users/${newUser.uid}`).set({
      uid:                       newUser.uid,
      userId:                    newUser.uid,
      email:                     email    || "",
      name:                      name     || "No Name",
      phone:                     phone    || "",
      role:                      role     || "user",
      balance:                   0,
      isOnline:                  false,
      acceptanceRate:            0,
      autoAccept:                false,
      availableForGigs:          false,
      decline_count:             0,
      location:                  null,
      openGigsUnlocked:          false,
      ratingAsHost:              0,
      ratingAsWorker:            0,
      ratingCount:               0,
      seekingQuickGigs:          false,
      signInMethod:              "email_password",
      skills:                    [],
      slot:                      0,
      suspended_until:           null,
      isBanned:                  false,
      pendingDeletion:           pendingDeletion ?? false,
      scheduledDeleteAt:         schedDeleteTs,
      quickGigDailyDeclineCount: 0,
      quickGigTotalDeclines:     0,
      totalGigs:                 0,
      lastOnline:                null,
      ban_reason:                null,
      createdAt:                 FieldValue.serverTimestamp(),
      updatedAt:                 FieldValue.serverTimestamp(),
      createdBy:                 decoded.uid,
    });

    const callerData = callerDoc.data();
    await adminDb.collection("activityLogs").add({
      actorId:       decoded.uid,
      actorName:     callerData?.name  ?? "Unknown",
      actorEmail:    callerData?.email ?? null,
      module:        "user_management",
      action:        "user_created",
      description:   `Created app user ${name || newUser.uid} (${email || "no email"})`,
      targetSection: null,
      targetId:      newUser.uid,
      targetName:    name || newUser.uid,
      affectedFiles: [`users/${newUser.uid}`],
      meta: {
        from:  null,
        to:    null,
        other: { email, phone, role: role || "user", authMethod: "email_password" },
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
    if (err.code === "auth/phone-number-already-exists") {
      return NextResponse.json(
        { error: "An account with this phone number already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
