import type { AudioCache, TtsProvider } from "./provider.ts";
import type { SystemTtsProvider } from "./system.ts";

export interface TtsResult {
  text: string;
  audio: Uint8Array | null;
  provider: string;
  fromCache?: boolean;
  error?: string;
}

export interface TtsQueueOptions {
  provider: TtsProvider;
  fallback?: Pick<SystemTtsProvider, "speak" | "name">;
  cache?: AudioCache;
  lang?: string;
  concurrency?: number;
  /** Số lỗi liên tiếp trước khi chuyển vĩnh viễn sang provider dự phòng. */
  maxFailures?: number;
}

/** Hàng đợi tổng hợp giọng: giới hạn song song, cache, tự chuyển dự phòng, huỷ được. */
export class TtsQueue {
  private readonly provider: TtsProvider;
  private readonly fallback: TtsQueueOptions["fallback"];
  private readonly cache: AudioCache | undefined;
  private readonly lang: string;
  private readonly concurrency: number;
  private readonly maxFailures: number;

  private cancelled = false;
  private consecutiveFailures = 0;
  private systemMode = false;
  private firstError: string | null = null;
  private inFlight = 0;
  private peakInFlight = 0;

  constructor(options: TtsQueueOptions) {
    this.provider = options.provider;
    this.fallback = options.fallback;
    this.cache = options.cache;
    this.lang = options.lang ?? "vi";
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.maxFailures = Math.max(1, options.maxFailures ?? 2);
  }

  get stats(): { peakInFlight: number; systemMode: boolean; firstError: string | null } {
    return { peakInFlight: this.peakInFlight, systemMode: this.systemMode, firstError: this.firstError };
  }

  cancel(): void {
    this.cancelled = true;
  }

  private cacheKey(text: string): string {
    return `${this.lang}|${text}`;
  }

  private async viaSystem(text: string): Promise<TtsResult> {
    const fallback = this.fallback;
    if (!fallback) {
      return { text, audio: null, provider: this.provider.name, error: this.firstError ?? "không có dự phòng" };
    }
    try {
      await fallback.speak(text);
      return { text, audio: null, provider: fallback.name };
    } catch (error) {
      return {
        text,
        audio: null,
        provider: fallback.name,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async synthesizeOne(text: string): Promise<TtsResult> {
    if (text.trim() === "") return { text, audio: null, provider: "empty" };

    if (this.cache) {
      const cached = await this.cache.get(this.cacheKey(text));
      if (cached && cached.length > 0) {
        return { text, audio: cached, provider: this.provider.name, fromCache: true };
      }
    }

    if (this.systemMode) return this.viaSystem(text);

    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    try {
      const audio = await this.provider.synthesize(text);
      this.consecutiveFailures = 0;
      if (this.cache) await this.cache.set(this.cacheKey(text), audio);
      return { text, audio, provider: this.provider.name };
    } catch (error) {
      this.consecutiveFailures += 1;
      this.firstError ??= error instanceof Error ? error.message : String(error);
      if (this.fallback && this.consecutiveFailures >= this.maxFailures) this.systemMode = true;
      if (this.fallback) return this.viaSystem(text);
      return {
        text,
        audio: null,
        provider: this.provider.name,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  async synthesizeAll(texts: string[], signal?: AbortSignal): Promise<TtsResult[]> {
    const results = new Array<TtsResult>(texts.length);
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= texts.length) return;
        const text = texts[index] ?? "";
        if (this.cancelled || signal?.aborted) {
          results[index] = { text, audio: null, provider: "cancelled" };
          continue;
        }
        results[index] = await this.synthesizeOne(text);
      }
    };

    const workers = Array.from({ length: Math.min(this.concurrency, Math.max(1, texts.length)) }, () =>
      runNext(),
    );
    await Promise.all(workers);
    return results;
  }
}
