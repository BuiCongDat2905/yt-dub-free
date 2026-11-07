import type { TranslationCache } from "../translate/google.ts";
import { TRANSLATION_STORE, withStore } from "./db.ts";

/** Cache bản dịch theo khoá `lang|text`. Dùng chung một DB với cache audio. */
export const translationCache: TranslationCache = {
  async get(key) {
    const value = await withStore<string | undefined>(TRANSLATION_STORE, "readonly", (store) =>
      store.get(key),
    );
    return value ?? null;
  },
  async set(key, value) {
    await withStore(TRANSLATION_STORE, "readwrite", (store) => store.put(value, key));
  },
};

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
