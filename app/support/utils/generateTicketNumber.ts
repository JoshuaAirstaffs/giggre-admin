import { db } from "@/lib/firebase"
import { doc, runTransaction } from "firebase/firestore"

export const generateTicketNumber = async (): Promise<string> => {
  const counterRef = doc(db, "_counters", "support_tickets")
  const year = new Date().getFullYear()

  const ticketNumber = await runTransaction(db, async (t) => {
    const snap = await t.get(counterRef)
    const currentCount = snap.data()?.[`count_${year}`] ?? 0
    const next = currentCount + 1
    t.set(counterRef, { [`count_${year}`]: next }, { merge: true })
    return next
  })

  return `TKT-${year}-${String(ticketNumber).padStart(6, "0")}`
}