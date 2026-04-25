import { NextRequest, NextResponse } from "next/server";
import { runExpiry } from "@/lib/runExpiry";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const isDev = process.env.NODE_ENV === "development";
  if (!isDev && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runExpiry("system", "System (Cron)", null);
  return NextResponse.json(result);
}
