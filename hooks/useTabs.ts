"use client";

import { useState, useEffect, useCallback } from "react";
import type { ContentSectionKey } from "@/lib/activitylog";

const STORAGE_KEY = "cm_active_tab";

export function useTabs(keys: ContentSectionKey[], defaultKey?: ContentSectionKey) {
  const [activeTab, setActiveTabState] = useState<ContentSectionKey>(
    defaultKey ?? keys[0]
  );

  useEffect(() => {
    const hash   = window.location.hash.slice(1) as ContentSectionKey;
    const stored = localStorage.getItem(STORAGE_KEY) as ContentSectionKey;
    if (hash   && keys.includes(hash))   { setActiveTabState(hash);   return; }
    if (stored && keys.includes(stored)) { setActiveTabState(stored); }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1) as ContentSectionKey;
      if (hash && keys.includes(hash)) setActiveTabState(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [keys]);

  const setActiveTab = useCallback((key: ContentSectionKey) => {
    setActiveTabState(key);
    localStorage.setItem(STORAGE_KEY, key);
    history.replaceState(null, "", `#${key}`);
  }, []);

  return { activeTab, setActiveTab };
}