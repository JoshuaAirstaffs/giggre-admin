"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Live count of verification requests still waiting for review, for the
 * sidebar badge. Pass `enabled: false` for admins without the Verification
 * module so they don't open a listener they can't use.
 */
export function usePendingVerifications(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, "verification_requests"), where("status", "==", "pending")),
      (snap) => setCount(snap.size),
      (err) => console.warn("[usePendingVerifications]", err.code ?? err)
    );
  }, [enabled]);

  return count;
}
