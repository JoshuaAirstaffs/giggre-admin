import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { runExpiry } from "@/lib/runExpiry";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const token = authHeader.split("Bearer ")[1];
  const decoded = await adminAuth.verifyIdToken(token);

  const callerDoc = await adminDb.doc(`admins/${decoded.uid}`).get();
  const role = callerDoc.data()?.role;
  if (!callerDoc.exists || (role !== "super_admin" && role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const callerName  = callerDoc.data()?.name ?? decoded.name ?? decoded.email ?? "Admin";
  const callerEmail = decoded.email ?? null;

  const result = await runExpiry(decoded.uid, callerName, callerEmail);
  return NextResponse.json(result);
}
