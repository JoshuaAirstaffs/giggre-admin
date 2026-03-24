"use client";

import { useState, useCallback, useRef } from "react";
import type { ContentSectionKey } from "@/lib/activitylog";
import type { SectionData } from "@/hooks/useContent";

export interface SectionState {
  data:        SectionData | null;
  loading:     boolean;
  error:       string | null;
  lastFetched: number | null; // epoch ms
}

type SectionMap = Partial<Record<ContentSectionKey, SectionState>>;

const STALE_MS = 5 * 60 * 1000;

function emptyState(): SectionState {
  return { data: null, loading: false, error: null, lastFetched: null };
}

export function usePerSectionData(
  fetchFn: (key: ContentSectionKey) => Promise<SectionData>
) {
  const [sections, setSections] = useState<SectionMap>({});

  const inFlight = useRef<Set<ContentSectionKey>>(new Set());

  const getSection = useCallback(
    (key: ContentSectionKey): SectionState => sections[key] ?? emptyState(),
    [sections]
  );

  const setSection = useCallback(
    (key: ContentSectionKey, update: Partial<SectionState>) => {
      setSections((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? emptyState()), ...update },
      }));
    },
    []
  );

  const fetchSection = useCallback(
    async (key: ContentSectionKey, force = false) => {
      const current = sections[key] ?? emptyState();
      const isFresh =
        current.lastFetched !== null &&
        Date.now() - current.lastFetched < STALE_MS;

      if (!force && (current.loading || isFresh || inFlight.current.has(key))) {
        return;
      }

      inFlight.current.add(key);
      setSection(key, { loading: true, error: null });

      try {
        const data = await fetchFn(key);
        setSection(key, { data, loading: false, lastFetched: Date.now() });
      } catch (err: any) {
        setSection(key, { loading: false, error: err?.message ?? "Failed to load section." });
      } finally {
        inFlight.current.delete(key);
      }
    },
    [sections, fetchFn, setSection]
  );

  const refreshSection = useCallback(
    (key: ContentSectionKey) => fetchSection(key, true),
    [fetchSection]
  );

  return { getSection, fetchSection, refreshSection };
}