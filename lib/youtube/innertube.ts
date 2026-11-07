import type { CaptionTrack } from "../subtitle/types.ts";
import { CaptionUnavailableError } from "../subtitle/types.ts";

interface RawTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface PlayerResponseLike {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: RawTrack[] };
  };
}

const RESPONSE_MARKER = "ytInitialPlayerResponse";

/** Cắt một object JSON cân bằng ngoặc, bỏ qua ngoặc nằm trong chuỗi. */
function sliceJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function extractPlayerResponse(source: string): PlayerResponseLike | null {
  if (!source) return null;
  const markerIndex = source.indexOf(RESPONSE_MARKER);
  if (markerIndex < 0) return null;

  const braceIndex = source.indexOf("{", markerIndex);
  if (braceIndex < 0) return null;

  const json = sliceJsonObject(source, braceIndex);
  if (!json) return null;

  try {
    return JSON.parse(json) as PlayerResponseLike;
  } catch {
    return null;
  }
}

export function extractPlayerResponseFromDocument(doc: Document): PlayerResponseLike | null {
  const globalCandidate = (globalThis as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
  if (globalCandidate) return globalCandidate as PlayerResponseLike;

  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (!text.includes(RESPONSE_MARKER)) continue;
    const parsed = extractPlayerResponse(text);
    if (parsed) return parsed;
  }
  return null;
}

function trackName(track: RawTrack): string | undefined {
  const name = track.name;
  if (!name) return undefined;
  if (typeof name.simpleText === "string") return name.simpleText;
  const runs = name.runs?.map((run) => run.text ?? "").join("") ?? "";
  return runs.trim() || undefined;
}

export function toCaptionTracks(response: PlayerResponseLike | null): CaptionTrack[] {
  const raw = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((track): track is RawTrack & { baseUrl: string } => typeof track.baseUrl === "string" && track.baseUrl.length > 0)
    .map((track) => ({
      baseUrl: track.baseUrl,
      languageCode: track.languageCode ?? "",
      kind: track.kind,
      name: trackName(track),
      isTranslatable: track.isTranslatable,
    }));
}

const PAGE_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
};

export async function getCaptionTracks(
  videoId: string,
  options: { fetchImpl?: typeof fetch; document?: Document } = {},
): Promise<CaptionTrack[]> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new CaptionUnavailableError(`videoId không hợp lệ: ${videoId}`);
  }

  if (options.document) {
    const fromDocument = toCaptionTracks(extractPlayerResponseFromDocument(options.document));
    if (fromDocument.length > 0) return fromDocument;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: PAGE_HEADERS,
    credentials: "include",
  });
  if (!response.ok) {
    throw new CaptionUnavailableError(`tải trang video thất bại: HTTP ${response.status}`);
  }

  const tracks = toCaptionTracks(extractPlayerResponse(await response.text()));
  if (tracks.length === 0) {
    throw new CaptionUnavailableError("video không có caption");
  }
  return tracks;
}
