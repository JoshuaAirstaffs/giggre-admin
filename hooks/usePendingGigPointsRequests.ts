"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

function usePendingCount(collectionName: string, enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, collectionName), where("status", "==", "pending")),
      (snap) => setCount(snap.size),
      (err) => console.warn(`[usePendingCount:${collectionName}]`, err.code ?? err)
    );
  }, [collectionName, enabled]);

  return count;
}

/** Live count of Gig Points conversion requests waiting for review. */
export const usePendingGigPointsRequests = (enabled: boolean) => usePendingCount("gig_points_requests", enabled);

/** Live count of Gig Wallet requests waiting for review. */
export const usePendingWalletRequests = (enabled: boolean) => usePendingCount("wallet_requests", enabled);
