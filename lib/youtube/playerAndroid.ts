import type { CaptionTrack } from "../subtitle/types.ts";
import { toCaptionTracks } from "./innertube.ts";
import { extractInnertubeConfig, type TranscriptDiagnostic } from "./transcriptInnertube.ts";

const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "19.44.38",
  androidSdkVersion: 30,
};

const ANDROID_UA = "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip";

function pickApiKey(pageSource: string): string | null {
  return extractInnertubeConfig(pageSource).apiKey;
}

/**
 * Xin danh sách caption track qua InnerTube client ANDROID.
 * Một số video chỉ trả baseUrl dùng được (kèm pot) cho client này khi WEB bị chặn.
 */
export async function fetchCaptionTracksViaAndroid(options: {
  videoId: string;
  pageSource: string;
  fetchImpl?: typeof fetch;
}): Promise<{ tracks: CaptionTrack[]; diagnostic: TranscriptDiagnostic }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const diagnostic: TranscriptDiagnostic = { source: "player-android", ok: false };
  const apiKey = pickApiKey(options.pageSource);

  const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
  if (apiKey) endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("prettyPrint", "false");

  const body = {
    context: {
      client: {
        ...ANDROID_CLIENT,
        hl: "en",
        gl: "US",
      },
    },
    videoId: options.videoId,
  };

  let response: Response;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "user-agent": ANDROID_UA,
        "x-youtube-client-name": "3",
        "x-youtube-client-version": ANDROID_CLIENT.clientVersion,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    diagnostic.error = `mạng: ${error instanceof Error ? error.message : String(error)}`;
    return { tracks: [], diagnostic };
  }

  diagnostic.status = response.status;
  const text = await response.text();
  diagnostic.bytes = text.length;
  diagnostic.head = text.slice(0, 120);

  if (!response.ok) {
    diagnostic.error = `HTTP ${response.status}`;
    return { tracks: [], diagnostic };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    diagnostic.error = "JSON không hợp lệ";
    return { tracks: [], diagnostic };
  }

  const tracks = toCaptionTracks(payload as Parameters<typeof toCaptionTracks>[0]);
  diagnostic.cues = tracks.length;
  if (tracks.length === 0) {
    diagnostic.error = "không có captionTracks trong player response";
    return { tracks: [], diagnostic };
  }

  diagnostic.ok = true;
  return { tracks, diagnostic };
}
