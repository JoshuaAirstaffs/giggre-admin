"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Live count of skill requests still waiting for review, for the
 * sidebar badge. Pass `enabled: false` for admins without the User Skills
 * module so they don't open a listener they can't use.
 */
export function usePendingSkillRequests(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, "skill_requests"), where("status", "==", "pending")),
      (snap) => setCount(snap.size),
      (err) => console.warn("[usePendingSkillRequests]", err.code ?? err)
    );
  }, [enabled]);

  return count;
}
