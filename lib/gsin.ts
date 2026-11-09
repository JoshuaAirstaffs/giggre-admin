import {
  collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { db } from "@/lib/firebase";
import { FUNCTIONS_REGION } from "@/lib/gigPoints";

// ── GSIN Library (admin only) ─────────────────────────────────────────────────
// Mirrors giggre_app functions/src/gsin.ts.
//   GSINS  G + CATEGORY (3) + SEQ (6)                       GADS000001  — per task type
//   GSKU   T + SUB-CAT (2) + TASK TYPE (2) + LEVEL (1) + SERVICE (2) + SEQ (5+)
//                                                          TVAAS1QG00001 — per gig
// Level: entry 1 · intermediate 2 · expert 3 · none 0. Service: QG quick · PG open · FG offered.
// Catalog docs use their prefix as id (gsin_categories/ADS, gsin_subcategories/VA,
// gsin_task_types/VAAS). Task types are created by the adminCreateGsinTaskType
// callable (it assigns the GSINS); codes on gigs only by Cloud Functions.

export interface GsinCategory { id: string; name: string; prefix: string; gsinsSeq: number }
export interface GsinSubcategory { id: string; name: string; prefix: string; categoryId: string }
export interface GsinTaskType {
  id: string; name: string; prefix: string; categoryId: string; subcategoryId: string;
  gsins: string; gskuSeq: number; skillIds: string[]; createdAt: Date | null;
}

export const SERVICE_LABEL: Record<string, string> = { QG: "Quick Gig", PG: "Open Gig", FG: "Offered Gig" };
export const LEVEL_LABEL: Record<string, string> = { "0": "No level", "1": "Entry", "2": "Intermediate", "3": "Expert" };

/** "TVAAS1QG00001" → its parts, for tooltips. */
export function explainGsku(gsku: string) {
  const m = /^T([A-Z]{2})([A-Z]{2})(\d)([A-Z]{2})(\d{5,})$/.exec(gsku);
  if (!m) return null;
  return { sub: m[1], task: m[2], level: m[3], service: m[4], seq: m[5] };
}

const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" ? v : 0);

export function watchGsinCatalog(onData: (c: {
  categories: GsinCategory[]; subcategories: GsinSubcategory[]; taskTypes: GsinTaskType[];
}) => void, onError: (e: { code?: string }) => void) {
  let categories: GsinCategory[] | null = null;
  let subcategories: GsinSubcategory[] | null = null;
  let taskTypes: GsinTaskType[] | null = null;
  const emit = () => categories && subcategories && taskTypes && onData({ categories, subcategories, taskTypes });
  const u1 = onSnapshot(query(collection(db, "gsin_categories"), orderBy("prefix")), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, name: s(d.data().name), prefix: s(d.data().prefix) || d.id, gsinsSeq: n(d.data().gsinsSeq) }));
    emit();
  }, onError);
  const u2 = onSnapshot(query(collection(db, "gsin_subcategories"), orderBy("prefix")), (snap) => {
    subcategories = snap.docs.map((d) => ({ id: d.id, name: s(d.data().name), prefix: s(d.data().prefix) || d.id, categoryId: s(d.data().categoryId) }));
    emit();
  }, onError);
  const u3 = onSnapshot(query(collection(db, "gsin_task_types"), orderBy("gsins")), (snap) => {
    taskTypes = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id, name: s(x.name), prefix: s(x.prefix), categoryId: s(x.categoryId), subcategoryId: s(x.subcategoryId),
        gsins: s(x.gsins), gskuSeq: n(x.gskuSeq), skillIds: Array.isArray(x.skillIds) ? x.skillIds.filter((i: unknown) => typeof i === "string") : [],
        createdAt: (x.createdAt as Timestamp | undefined)?.toDate?.() ?? null,
      };
    });
    emit();
  }, onError);
  return () => { u1(); u2(); u3(); };
}

export const createCategory = (prefix: string, name: string, uid: string) =>
  setDoc(doc(db, "gsin_categories", prefix), { prefix, name: name.trim(), gsinsSeq: 0, createdAt: serverTimestamp(), createdBy: uid });
export const renameCategory = (id: string, name: string) =>
  updateDoc(doc(db, "gsin_categories", id), { name: name.trim(), updatedAt: serverTimestamp() });
export const deleteCategory = (id: string) => deleteDoc(doc(db, "gsin_categories", id));

export const createSubcategory = (prefix: string, name: string, categoryId: string, uid: string) =>
  setDoc(doc(db, "gsin_subcategories", prefix), { prefix, name: name.trim(), categoryId, createdAt: serverTimestamp(), createdBy: uid });
export const renameSubcategory = (id: string, name: string) =>
  updateDoc(doc(db, "gsin_subcategories", id), { name: name.trim(), updatedAt: serverTimestamp() });
export const deleteSubcategory = (id: string) => deleteDoc(doc(db, "gsin_subcategories", id));

export const updateTaskType = (id: string, data: { name?: string; skillIds?: string[] }, uid: string) =>
  updateDoc(doc(db, "gsin_task_types", id), { ...data, updatedAt: serverTimestamp(), updatedBy: uid });
export const deleteTaskType = (id: string) => deleteDoc(doc(db, "gsin_task_types", id));

/** Links skills to a task type (skills/{id}.taskTypeId) — used to find a gig's task type from its skill. */
// Skill ↔ task type links live on gsin_task_types.skillIds (many-to-many).
// Older builds stored one link on skills/{id}.taskTypeId — clear it when a
// skill is unlinked from that task type so it doesn't linger.
export async function clearLegacySkillLinks(skillIds: string[]) {
  await Promise.all(skillIds.map((id) => updateDoc(doc(db, "skills", id), { taskTypeId: null })));
}

const call = <Req, Res>(name: string) => async (data: Req): Promise<Res> =>
  (await httpsCallable<Req, Res>(getFunctions(app, FUNCTIONS_REGION), name)(data)).data;

export const createTaskType = call<
  { subcategoryId: string; name: string; prefix: string; skillIds: string[] },
  { id: string; gsins: string }
>("adminCreateGsinTaskType");

export type GigCollection = "quick_gigs" | "open_gigs" | "offered_gigs";
export const assignGigTaskType = call<
  { collection: GigCollection; gigId: string; taskTypeId: string },
  { status: string; gsins?: string; gsku?: string }
>("adminAssignGigTaskType");

export const backfillGigCodes = call<
  { limit?: number },
  { assigned: number; needsPick?: number; noTaskType: number; failed: number; remaining: number }
>("adminBackfillGigCodes");

// Adds a skill to the User Skills library (same shape as app/user-skills:
// random 2-letter + 7-digit library id), optionally linked to a task type.
export async function createSkill(name: string, taskTypeId?: string): Promise<string> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let skillId = "";
  for (let i = 0; i < 10 && !skillId; i++) {
    const id = letters[Math.floor(Math.random() * 26)] + letters[Math.floor(Math.random() * 26)]
      + String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0");
    const taken = await getDocs(query(collection(db, "skills"), where("skillId", "==", id)));
    if (taken.empty) skillId = id;
  }
  if (!skillId) throw new Error("Could not generate a unique skill id.");
  const ref = doc(collection(db, "skills"));
  await setDoc(ref, { skillId, name, createdAt: Timestamp.now(), ...(taskTypeId ? { taskTypeId } : {}) });
  return ref.id;
}
