"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export type CurrencySymbol = "$" | "₱";

interface CurrencyContextValue {
  symbol: CurrencySymbol;
  setSymbol: (s: CurrencySymbol) => void;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  symbol: "₱",
  setSymbol: () => {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState<CurrencySymbol>("₱");

  useEffect(() => {
    getDoc(doc(db, "general_config", "currency"))
      .then((snap) => {
        if (snap.exists()) {
          const s = snap.data().symbol;
          if (s === "$" || s === "₱") setSymbol(s);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <CurrencyContext.Provider value={{ symbol, setSymbol }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
