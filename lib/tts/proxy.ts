export const TTS_PROXY_MESSAGE = "ytdubfree:tts-fetch";

export const ALLOWED_TTS_HOSTS = ["translate.google.com", "translate.googleapis.com"];

export interface TtsProxyRequest {
  type: typeof TTS_PROXY_MESSAGE;
  url: string;
}

export interface TtsProxyReply {
  ok: boolean;
  status: number;
  base64?: string;
  error?: string;
}

/** Chỉ cho proxy tới endpoint TTS của Google, tránh biến background thành proxy mở. */
export function isAllowedTtsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_TTS_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
