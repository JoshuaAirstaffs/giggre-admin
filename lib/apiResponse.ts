/**
 * Reads a JSON body from one of our /api routes without throwing on
 * non-JSON responses. If a route crashes, Next.js answers with an HTML error
 * page; calling res.json() on that surfaces as the unhelpful
 * "Unexpected token '<'". This returns a readable { error } instead.
 */
export async function readApiJson<T extends object = Record<string, unknown>>(
  res: Response,
): Promise<T & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `The server returned an unexpected response (HTTP ${res.status}). ` +
        "Check the server logs — it may be missing configuration such as FIREBASE_SERVICE_ACCOUNT_KEY.",
    } as T & { error?: string };
  }
}
