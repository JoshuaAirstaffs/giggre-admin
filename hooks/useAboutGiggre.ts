"use client";

import { useState, useCallback } from "react";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sanitizeHtml, isValidUrl, normalizeUrl } from "@/lib/sanitize";
import { writeLog, buildDescription } from "@/lib/activitylog";
import type { ActorInfo } from "@/hooks/useContent";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AboutGiggreDocument {
  what_is_giggre: string;
  how_it_works: string;
  values: string;
  mission: string;
  website: string;
  lastUpdated: Date | null;
}

export interface AboutGiggreForm {
  whatIsGiggre: string;
  howItWorks: string;
  values: string;
  mission: string;
  website: string;
}

export type AboutGiggreErrors = Partial<Record<keyof AboutGiggreForm, string>>;

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const EMPTY_FORM: AboutGiggreForm = {
  whatIsGiggre: "",
  howItWorks: "",
  values: "",
  mission: "",
  website: "",
};

// ─── Firestore path ───────────────────────────────────────────────────────────

const ABOUT_DOC_PATH = "app_content/about_giggre2";

// ─── Converters ───────────────────────────────────────────────────────────────

function docToForm(data: Record<string, any>): AboutGiggreForm {
  return {
    whatIsGiggre: data.what_is_giggre ?? "",
    howItWorks: data.how_it_works ?? "",
    values: data.values ?? "",
    mission: data.mission ?? "",
    website: data.website ?? "",
  };
}

function formToDoc(form: AboutGiggreForm): Omit<AboutGiggreDocument, "lastUpdated"> {
  return {
    what_is_giggre: sanitizeHtml(form.whatIsGiggre),
    how_it_works: sanitizeHtml(form.howItWorks),
    values: sanitizeHtml(form.values),
    mission: sanitizeHtml(form.mission),
    website: form.website.trim() ? normalizeUrl(form.website) : "",
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateAboutForm(form: AboutGiggreForm): AboutGiggreErrors {
  const errors: AboutGiggreErrors = {};
  const stripTags = (html: string) => html.replace(/<[^>]+>/g, "").trim();

  if (!stripTags(form.whatIsGiggre)) {
    errors.whatIsGiggre = "This field is required.";
  }
  if (!stripTags(form.howItWorks)) {
    errors.howItWorks = "This field is required.";
  }
  if (!stripTags(form.mission)) {
    errors.mission = "This field is required.";
  }
  if (form.website.trim() && !isValidUrl(normalizeUrl(form.website))) {
    errors.website = "Please enter a valid URL (e.g. https://giggre.com).";
  }

  return errors;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAboutGiggre(actor: ActorInfo) {
  const [document_, setDocument] = useState<AboutGiggreDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // ── fetchAboutGiggre ────────────────────────────────────────────────────
  const fetchAboutGiggre = useCallback(async (): Promise<AboutGiggreDocument | null> => {
    setLoading(true);
    setError(null);
    try {
      const ref = doc(db, "app_content", "about_giggre2");
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        const defaults = {
          what_is_giggre: "",
          how_it_works: "",
          values: "",
          mission: "",
          website: "",
          lastUpdated: serverTimestamp(),
        };
        await setDoc(ref, defaults);
        const result: AboutGiggreDocument = {
          what_is_giggre: "",
          how_it_works: "",
          values: "",
          mission: "",
          website: "",
          lastUpdated: null,
        };
        setDocument(result);
        setLastFetched(Date.now());
        return result;
      }

      const data = snap.data();
      const result: AboutGiggreDocument = {
        what_is_giggre: data.what_is_giggre ?? "",
        how_it_works: data.how_it_works ?? "",
        values: data.values ?? "",
        mission: data.mission ?? "",
        website: data.website ?? "",
        lastUpdated: data.lastUpdated?.toDate?.() ?? null,
      };

      setDocument(result);
      setLastFetched(Date.now());
      return result;
    } catch (err: any) {
      const msg = err?.message ?? "Failed to load About Giggre content.";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAboutGiggre = useCallback(
    async (
      form: AboutGiggreForm,
      previous: AboutGiggreForm,
    ): Promise<{ success: boolean; error?: string }> => {
      setSaving(true);
      try {
        const payload = formToDoc(form);

        await updateDoc(doc(db, "app_content", "about_giggre2"), {
          ...payload,
          lastUpdated: serverTimestamp(),
        });

        await writeLog({
          ...actor,
          module: "content_management",
          action: "content_updated",
          description: buildDescription.contentUpdated("About Giggre", "About Giggre content"),
          targetSection: "about_giggre",
          targetId: null,
          targetName: "About Giggre",
          affectedFiles: [ABOUT_DOC_PATH],
          meta: {
            from: {
              what_is_giggre: previous.whatIsGiggre,
              how_it_works: previous.howItWorks,
              values: previous.values,
              mission: previous.mission,
              website: previous.website,
            },
            to: payload,
          },
        });

        setDocument((prev) =>
          prev
            ? { ...prev, ...payload, lastUpdated: new Date() }
            : null,
        );

        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message ?? "Failed to save." };
      } finally {
        setSaving(false);
      }
    },
    [actor],
  );

  const getFormFromDoc = useCallback(
    (d: AboutGiggreDocument = document_!): AboutGiggreForm =>
      d ? docToForm(d as any) : { ...EMPTY_FORM },
    [document_],
  );

  return {
    document: document_,
    loading,
    saving,
    error,
    lastFetched,
    fetchAboutGiggre,
    saveAboutGiggre,
    getFormFromDoc,
  };
}