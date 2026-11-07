import type { Cue } from "./subtitle/types.ts";
import { segmentCues } from "./subtitle/segment.ts";
import { translateBatch, type TranslationCache } from "./translate/google.ts";
import type { AudioCache, TtsProvider } from "./tts/provider.ts";
import { TtsQueue } from "./tts/queue.ts";
import type { SystemTtsProvider } from "./tts/system.ts";

export interface PrepareDubbingOptions {
  cues: Cue[];
  provider: TtsProvider;
  fallback?: Pick<SystemTtsProvider, "speak" | "name">;
  translationCache?: TranslationCache;
  audioCache?: AudioCache;
  targetLang?: string;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface PreparedDubbing {
  cues: Cue[];
  translated: string[];
  audioByIndex: Array<Uint8Array | null>;
  stats: { cues: number; translated: number; audio: number; system: number; failed: number };
}

/** Ghép pipeline: cắt câu -> dịch -> tổng hợp giọng, trả về audio sẵn sàng phát. */
export async function prepareDubbing(options: PrepareDubbingOptions): Promise<PreparedDubbing> {
  const targetLang = options.targetLang ?? "vi";
  const cues = segmentCues(options.cues);
  if (cues.length === 0) throw new Error("không có câu nào sau khi cắt");

  const translated = await translateBatch(
    cues.map((cue) => cue.text),
    {
      targetLang,
      fetchImpl: options.fetchImpl,
      cache: options.translationCache,
      signal: options.signal,
    },
  );

  const queue = new TtsQueue({
    provider: options.provider,
    fallback: options.fallback,
    cache: options.audioCache,
    lang: targetLang,
    concurrency: options.concurrency,
  });
  const results = await queue.synthesizeAll(translated, options.signal);

  return {
    cues,
    translated,
    audioByIndex: results.map((result) => result.audio),
    stats: {
      cues: cues.length,
      translated: translated.filter((text) => text.length > 0).length,
      audio: results.filter((result) => result.audio !== null).length,
      system: results.filter((result) => result.provider === "system-tts").length,
      failed: results.filter((result) => result.error !== undefined).length,
    },
  };
}
