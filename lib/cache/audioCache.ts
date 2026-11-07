import type { AudioCache } from "../tts/provider.ts";
import { AUDIO_STORE, withStore } from "./db.ts";

/** Cache audio TTS theo khoá `lang|text`, lưu bytes để phát lại không cần mạng. */
export const audioCache: AudioCache = {
  async get(key) {
    const value = await withStore<ArrayBuffer | Uint8Array | undefined>(
      AUDIO_STORE,
      "readonly",
      (store) => store.get(key),
    );
    if (!value) return null;
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  },
  async set(key, value) {
    const buffer = value.slice().buffer;
    await withStore(AUDIO_STORE, "readwrite", (store) => store.put(buffer, key));
  },
};
