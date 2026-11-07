import type { AudioCache } from "../tts/provider.ts";
import { AUDIO_STORE, openDb, withStore } from "./db.ts";

/** Giới hạn dung lượng cache audio (bytes). Vượt thì xoá bớt bản cũ. */
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const TRIM_EVERY_WRITES = 20;

let writesSinceTrim = 0;

async function trimAudioStore(maxBytes: number): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(AUDIO_STORE, "readwrite");
      const store = transaction.objectStore(AUDIO_STORE);
      const entries: Array<{ key: IDBValidKey; size: number }> = [];
      let total = 0;
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const value = cursor.value as ArrayBuffer | Uint8Array;
          const size = value instanceof Uint8Array ? value.byteLength : value.byteLength;
          total += size;
          entries.push({ key: cursor.key, size });
          cursor.continue();
          return;
        }
        if (total > maxBytes) {
          const target = Math.floor(maxBytes * 0.9);
          for (const entry of entries) {
            store.delete(entry.key);
            total -= entry.size;
            if (total <= target) break;
          }
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error("đọc cache audio thất bại"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("dọn cache audio thất bại"));
      transaction.onabort = () => reject(transaction.error ?? new Error("dọn cache audio bị huỷ"));
    });
  } finally {
    db.close();
  }
}

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

    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY_WRITES) {
      writesSinceTrim = 0;
      await trimAudioStore(MAX_AUDIO_BYTES).catch(() => {
        // dọn cache lỗi không được làm hỏng việc phát
      });
    }
  },
};
