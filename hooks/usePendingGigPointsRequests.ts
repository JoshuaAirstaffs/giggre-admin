"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Live count of Gig Points requests waiting for review (sidebar badge). */
export function usePendingGigPointsRequests(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, "gig_points_requests"), where("status", "==", "pending")),
      (snap) => setCount(snap.size),
      (err) => console.warn("[usePendingGigPointsRequests]", err.code ?? err)
    );
  }, [enabled]);

  return count;
}
