import { TTS_MAX_CHARS } from "../config.ts";
import { splitMixedSegments } from "../glossary/terms.ts";
import { TtsUnavailableError, concatBytes, type TtsProvider } from "./provider.ts";

const ENDPOINT = "https://translate.google.com/translate_tts";

export function buildTtsUrl(text: string, lang = "vi"): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("client", "tw-ob");
  url.searchParams.set("tl", lang);
  url.searchParams.set("q", text);
  return url.toString();
}

/** Google TTS giới hạn ~200 ký tự mỗi request; cắt ở khoảng trắng để không gãy từ. */
export function splitForTts(text: string, maxChars = TTS_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(window.lastIndexOf(" "), window.lastIndexOf(","), window.lastIndexOf("."));
    const end = cut > maxChars / 3 ? cut + 1 : maxChars;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.filter((chunk) => chunk.length > 0);
}

export class GoogleTtsProvider implements TtsProvider {
  readonly name = "google-tts";
  private readonly lang: string;
  private readonly englishLang: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { lang?: string; englishLang?: string; fetchImpl?: typeof fetch } = {}) {
    this.lang = options.lang ?? "vi";
    this.englishLang = options.englishLang ?? "en";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    // Thuật ngữ CNTT giữ tiếng Anh được đọc bằng giọng Anh; phần còn lại giọng Việt.
    const segments = splitMixedSegments(text);
    if (segments.length === 0) throw new TtsUnavailableError("câu rỗng, không có gì để đọc");

    const buffers: Uint8Array[] = [];
    for (const segment of segments) {
      const lang = segment.lang === "en" ? this.englishLang : this.lang;
      const chunks = splitForTts(segment.text);
      for (const chunk of chunks) {
        const response = await this.fetchImpl(buildTtsUrl(chunk, lang), { signal });
        if (!response.ok) {
          throw new TtsUnavailableError(`Google TTS trả HTTP ${response.status}`, response.status);
        }
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.length < 512) throw new TtsUnavailableError(`audio quá ngắn: ${buffer.length} byte`);
        buffers.push(buffer);
      }
    }
    if (buffers.length === 0) throw new TtsUnavailableError("câu rỗng, không có gì để đọc");
    return concatBytes(buffers);
  }
}
