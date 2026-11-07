import { browser } from "wxt/browser";

import { TTS_PROXY_MESSAGE, base64ToBytes, type TtsProxyReply } from "../tts/proxy.ts";

/**
 * Content script không được CORS cho `translate.google.com/translate_tts`
 * (endpoint không trả `Access-Control-Allow-Origin`), nên tải audio qua
 * background service worker — nơi host permission cho phép fetch cross-origin.
 */
export function createBackgroundFetch(): typeof fetch {
  const backgroundFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const reply = (await browser.runtime.sendMessage({
      type: TTS_PROXY_MESSAGE,
      url,
    })) as TtsProxyReply | undefined;

    if (!reply) throw new Error("background không phản hồi yêu cầu TTS");
    if (!reply.ok) {
      throw new Error(`TTS proxy lỗi: HTTP ${reply.status}${reply.error ? ` (${reply.error})` : ""}`);
    }
    const bytes = base64ToBytes(reply.base64 ?? "");
    const body = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Response(body, {
      status: reply.status || 200,
      headers: { "content-type": "audio/mpeg" },
    });
  };
  return backgroundFetch as typeof fetch;
}
