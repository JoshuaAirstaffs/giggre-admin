"use client";

import { useState, useCallback } from "react";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { writeLog, buildDescription } from "@/lib/activitylog";
import type { ContentSectionKey, LogPayload } from "@/lib/activitylog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BaseItem {
  id: string;
  sortNumber: number;
  lastSortNumber?: number;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}

export interface CarouselItem extends BaseItem {
  picture: string; // Image URL (Firebase Storage or external URL)
  imageName: string; // Name given by admin
}

export interface UpdateItem extends BaseItem {
  category: string;
  title: string;
  body: string;
  sortNumberByCategory?: number;
}

export interface AboutItem extends BaseItem {
  title: string;
  body: string;
}

export interface TermsItem extends BaseItem {
  title: string;
  body: string;
}

export interface PrivacyItem extends BaseItem {
  title: string;
  body: string;
}

export interface FaqItem extends BaseItem {
  category: string;
  title: string;
  body: string;
  sortNumberByCategory?: number;
}

export type ContentItem =
  | CarouselItem
  | UpdateItem
  | AboutItem
  | TermsItem
  | PrivacyItem
  | FaqItem;

/**
 * Options stored flat on the section root document alongside `lastUpdated`.
 * Path: app_content/{sectionKey}
 */
export interface SectionOptions {
  sortMode?: "manual" | "newest" | "oldest";
  maxVisibleItems?: number;
  // carousel_items only
  autoplay?: boolean;
  transitionInterval?: number;
  showArrows?: boolean;
  showDots?: boolean;
  loop?: boolean;
}

export interface SectionData {
  items: ContentItem[];
  options: SectionOptions;
  lastUpdated: Date | null;
  categories?: string[];
}

export interface ActorInfo {
  actorId: string;
  actorName: string;
  actorEmail: string;
}

// ─── Visibility helper (single definition, used everywhere) ───────────────────

/**
 * An item is visible when its sortNumber is greater than zero.
 * sortNumber === 0 means the item exists in the database but is hidden from
 * the app.  There is no separate `published` field.
 */
export function isVisible(item: Pick<BaseItem, "sortNumber">): boolean {
  return item.sortNumber > 0;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function itemPath(sectionKey: ContentSectionKey, itemId: string): string {
  return `app_content/${sectionKey}/items/${itemId}`;
}

export function sectionPath(sectionKey: ContentSectionKey): string {
  return `app_content/${sectionKey}`;
}

// ─── Section helpers ──────────────────────────────────────────────────────────

export function hasCategories(key: ContentSectionKey): boolean {
  return key === "updates" || key === "help_faq";
}

export function getItemTitle(
  item: Partial<ContentItem>,
  sectionKey: ContentSectionKey,
): string {
  if ("title" in item && (item as any).title) return (item as any).title;
  if ("imageName" in item) return (item as CarouselItem).imageName || "(No name)";
  return "Untitled";
}

export function emptyItemForSection(key: ContentSectionKey): Partial<ContentItem> {
  // sortNumber: 1 → new items are visible by default
  const base = { sortNumber: 1 };
  switch (key) {
    case "carousel_items":
      return { ...base, picture: "", imageName: "" };
    case "updates":
      return { ...base, category: "", title: "", body: "" };
    case "about_giggre":
      return { ...base, title: "", body: "" };
    case "terms_and_conditions":
      return { ...base, title: "", body: "" };
    case "privacy":
      return { ...base, title: "", body: "" };
    case "help_faq":
      return { ...base, category: "", title: "", body: "" };
  }
}

// ─── Default section options ──────────────────────────────────────────────────

const DEFAULT_OPTIONS: SectionOptions = {
  sortMode: "manual",
  maxVisibleItems: 0,
};

const DEFAULT_CAROUSEL_OPTIONS: SectionOptions = {
  ...DEFAULT_OPTIONS,
  autoplay: true,
  transitionInterval: 3000,
  showArrows: true,
  showDots: true,
  loop: true,
};

const OPTION_FIELDS = new Set<string>([
  "sortMode",
  "maxVisibleItems",
  "autoplay",
  "transitionInterval",
  "showArrows",
  "showDots",
  "loop",
]);

function extractOptions(data: Record<string, any>): SectionOptions {
  const opts: SectionOptions = {};
  for (const key of OPTION_FIELDS) {
    if (key in data) (opts as any)[key] = data[key];
  }
  return opts;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useContent(actor: ActorInfo) {
  const [sectionData, setSectionData] = useState<
    Partial<Record<ContentSectionKey, SectionData>>
  >({});
  const [loading,    setLoading]    = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Internal log helper ──────────────────────────────────────────────────
  // `log` accepts only the action-specific fields (LogPayload).
  // The actor fields are injected here so every call-site stays clean.
  const log = useCallback(
    (params: LogPayload) => writeLog({ ...actor, ...params }),
    [actor],
  );

  // ── fetchAll ─────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (sectionKeys: ContentSectionKey[]) => {
    setLoading(true);
    try {
      const result: Partial<Record<ContentSectionKey, SectionData>> = {};

      await Promise.all(
        sectionKeys.map(async (key) => {
          const sectionRef  = doc(db, "app_content", key);
          const sectionSnap = await getDoc(sectionRef);

          if (!sectionSnap.exists()) {
            const defaults =
              key === "carousel_items" ? DEFAULT_CAROUSEL_OPTIONS : DEFAULT_OPTIONS;
            await setDoc(sectionRef, { ...defaults, lastUpdated: serverTimestamp() });
          }

          const itemsSnap = await getDocs(
            collection(db, "app_content", key, "items"),
          );

          const items: ContentItem[] = itemsSnap.docs
            .map((d) => {
              const data = d.data();
              return {
                id: d.id,
                ...data,
                sortNumber:     Number(data.sortNumber     ?? 0),
                lastSortNumber: data.lastSortNumber != null
                  ? Number(data.lastSortNumber)
                  : undefined,
                dateCreated: data.dateCreated?.toDate?.() ?? null,
                dateUpdated: data.dateUpdated?.toDate?.() ?? null,
              } as ContentItem;
            })
            .sort((a, b) => {
              // Hidden items (sort = 0) go to the bottom of the admin list
              const sa = a.sortNumber;
              const sb = b.sortNumber;
              if (sa === 0 && sb === 0) return 0;
              if (sa === 0) return 1;
              if (sb === 0) return -1;
              return sa - sb;
            });

          // Read options from the flat root doc
          const rawData       = sectionSnap.exists() ? sectionSnap.data() : {};
          const storedOptions = extractOptions(rawData);
          const fallback      = key === "carousel_items"
            ? DEFAULT_CAROUSEL_OPTIONS
            : DEFAULT_OPTIONS;
          const options: SectionOptions = Object.keys(storedOptions).length
            ? storedOptions
            : fallback;

          result[key] = {
            items,
            options,
            lastUpdated: rawData?.lastUpdated?.toDate?.() ?? null,
            categories: Array.isArray(rawData?.categories) ? rawData.categories as string[] : undefined,
          };
        }),
      );

      setSectionData(result);
    } catch (err) {
      console.error("[useContent] fetchAll failed:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── createItem ───────────────────────────────────────────────────────────
  const createItem = useCallback(
    async (
      sectionKey:   ContentSectionKey,
      sectionLabel: string,
      form:         Partial<ContentItem>,
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        // Ensure sortNumber is a clean number; strip lastSortNumber from creates
        const { lastSortNumber: _unused, ...cleanForm } = form as any;
        const payload = {
          ...cleanForm,
          sortNumber:  Number(cleanForm.sortNumber ?? 1),
          dateCreated: serverTimestamp(),
          dateUpdated: serverTimestamp(),
        };

        const docRef = await addDoc(
          collection(db, "app_content", sectionKey, "items"),
          payload,
        );

        await updateDoc(doc(db, "app_content", sectionKey), {
          lastUpdated: serverTimestamp(),
        });

        const title = getItemTitle({ ...form, id: docRef.id }, sectionKey);

        await log({
          module:      "content_management",
          action:      "content_created",
          description: buildDescription.contentCreated(sectionLabel, title),
          targetSection: sectionKey,
          targetId:    docRef.id,
          targetName:  title,
          affectedFiles: [itemPath(sectionKey, docRef.id), sectionPath(sectionKey)],
          meta: { other: { ...payload } },
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to create item." };
      } finally {
        setSubmitting(false);
      }
    },
    [log],
  );

  // ── updateItem ───────────────────────────────────────────────────────────
  const updateItem = useCallback(
    async (
      sectionKey:   ContentSectionKey,
      sectionLabel: string,
      item:         ContentItem,
      form:         Partial<ContentItem>,
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        const previous = { ...item };
        
        // Build clean payload — only include content fields relevant to this section
        const payload: Record<string, any> = {};
        
        // Add content fields based on section type
        switch (sectionKey) {
          case "carousel_items":
            if ("picture" in form) payload.picture = form.picture;
            if ("imageName" in form) payload.imageName = form.imageName;
            break;
          case "updates":
            if ("category" in form) payload.category = (form as any).category ?? "";
            if ("title" in form) payload.title = form.title;
            if ("body" in form) payload.body = form.body;
            if ("sortNumberByCategory" in form)
              payload.sortNumberByCategory = Number((form as any).sortNumberByCategory ?? 0);
            break;
          case "help_faq":
            if ("category" in form) payload.category = (form as any).category;
            if ("title" in form) payload.title = form.title;
            if ("body" in form) payload.body = form.body;
            if ("sortNumberByCategory" in form)
              payload.sortNumberByCategory = Number((form as any).sortNumberByCategory ?? 0);
            break;
          default:
            // about_giggre, terms_and_conditions, privacy
            if ("title" in form) payload.title = form.title;
            if ("body" in form) payload.body = form.body;
            break;
        }
        
        // Always include sortNumber
        payload.sortNumber = Number((form as any).sortNumber ?? item.sortNumber);
        payload.dateUpdated = serverTimestamp();

        await updateDoc(
          doc(db, "app_content", sectionKey, "items", item.id),
          payload,
        );

        await updateDoc(doc(db, "app_content", sectionKey), {
          lastUpdated: serverTimestamp(),
        });

        const title = getItemTitle(item, sectionKey);

        await log({
          module:      "content_management",
          action:      "content_updated",
          description: buildDescription.contentUpdated(sectionLabel, title),
          targetSection: sectionKey,
          targetId:    item.id,
          targetName:  title,
          affectedFiles: [itemPath(sectionKey, item.id), sectionPath(sectionKey)],
          meta: { from: previous, to: form },
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to update item." };
      } finally {
        setSubmitting(false);
      }
    },
    [log],
  );

  // ── deleteItem ───────────────────────────────────────────────────────────
  const deleteItem = useCallback(
    async (
      sectionKey:   ContentSectionKey,
      sectionLabel: string,
      item:         ContentItem,
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        const snapshot = { ...item };
        const title    = getItemTitle(item, sectionKey);

        await deleteDoc(doc(db, "app_content", sectionKey, "items", item.id));

        await updateDoc(doc(db, "app_content", sectionKey), {
          lastUpdated: serverTimestamp(),
        });

        await log({
          module:      "content_management",
          action:      "content_deleted",
          description: buildDescription.contentDeleted(sectionLabel, title),
          targetSection: sectionKey,
          targetId:    item.id,
          targetName:  title,
          affectedFiles: [itemPath(sectionKey, item.id), sectionPath(sectionKey)],
          meta: { from: snapshot },
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to delete item." };
      } finally {
        setSubmitting(false);
      }
    },
    [log],
  );

  // ── saveSettings ─────────────────────────────────────────────────────────
  const saveSettings = useCallback(
    async (
      sectionKey:      ContentSectionKey,
      sectionLabel:    string,
      opts:            SectionOptions,
      previousOptions: SectionOptions,
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        await updateDoc(doc(db, "app_content", sectionKey), {
          ...opts,
          lastUpdated: serverTimestamp(),
        });

        await log({
          module:      "content_management",
          action:      "content_settings_updated",
          description: buildDescription.contentSettingsUpdated(sectionLabel),
          targetSection: sectionKey,
          targetId:    null,
          targetName:  sectionLabel,
          affectedFiles: [sectionPath(sectionKey)],
          meta: { from: previousOptions, to: opts },
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to save settings." };
      } finally {
        setSubmitting(false);
      }
    },
    [log],
  );

  // ── saveCategories ───────────────────────────────────────────────────────
  const saveCategories = useCallback(
    async (
      sectionKey:         ContentSectionKey,
      sectionLabel:       string,
      categories:         string[],
      previousCategories: string[],
    ): Promise<{ success: boolean; error?: string }> => {
      setSubmitting(true);
      try {
        await updateDoc(doc(db, "app_content", sectionKey), {
          categories,
          lastUpdated: serverTimestamp(),
        });

        await log({
          module:        "content_management",
          action:        "categories_saved",
          description:   buildDescription.categoriesSaved(sectionLabel),
          targetSection: sectionKey,
          targetId:      null,
          targetName:    sectionLabel,
          affectedFiles: [sectionPath(sectionKey)],
          meta:          { from: previousCategories, to: categories },
        });

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message ?? "Failed to save categories." };
      } finally {
        setSubmitting(false);
      }
    },
    [log],
  );

  const fetchSection = useCallback(async (key: ContentSectionKey): Promise<SectionData> => {
    const sectionRef = doc(db, "app_content", key);
    const sectionSnap = await getDoc(sectionRef);

    if (!sectionSnap.exists()) {
      const defaults = key === "carousel_items" ? DEFAULT_CAROUSEL_OPTIONS : DEFAULT_OPTIONS;
      await setDoc(sectionRef, { ...defaults, lastUpdated: serverTimestamp() });
    }

    const itemsSnap = await getDocs(collection(db, "app_content", key, "items"));

    const items: ContentItem[] = itemsSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          sortNumber: Number(data.sortNumber ?? 0),
          lastSortNumber: data.lastSortNumber != null ? Number(data.lastSortNumber) : undefined,
          dateCreated: data.dateCreated?.toDate?.() ?? null,
          dateUpdated: data.dateUpdated?.toDate?.() ?? null,
        } as ContentItem;
      })
      .sort((a, b) => {
        const sa = a.sortNumber, sb = b.sortNumber;
        if (sa === 0 && sb === 0) return 0;
        if (sa === 0) return 1;
        if (sb === 0) return -1;
        return sa - sb;
      });

    const rawData = sectionSnap.exists() ? sectionSnap.data() : {};
    const storedOptions = extractOptions(rawData);
    const fallback = key === "carousel_items" ? DEFAULT_CAROUSEL_OPTIONS : DEFAULT_OPTIONS;

    return {
      items,
      options: Object.keys(storedOptions).length ? storedOptions : fallback,
      lastUpdated: rawData?.lastUpdated?.toDate?.() ?? null,
      categories: Array.isArray(rawData?.categories) ? rawData.categories as string[] : undefined,
    };
  }, []);

  return {
    sectionData,
    loading,
    submitting,
    fetchAll,
    fetchSection,
    createItem,
    updateItem,
    deleteItem,
    saveSettings,
    saveCategories,
  };
}