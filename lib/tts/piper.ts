import { TtsUnavailableError, type TtsProvider } from "./provider.ts";

export const PIPER_SYNTH_MESSAGE = "ytdubfree:piper-synth";
export const PIPER_DO_MESSAGE = "ytdubfree:piper-do";
export const DEFAULT_PIPER_VOICE = "vi_VN-vais1000-medium";

interface PiperReply {
  ok?: boolean;
  base64?: string;
  error?: string;
  bytes?: number;
}

export type PiperSender = (message: unknown) => Promise<unknown>;

function defaultSender(message: unknown): Promise<unknown> {
  const runtime = (globalThis as { chrome?: { runtime?: { sendMessage(msg: unknown): Promise<unknown> } } }).chrome
    ?.runtime;
  if (!runtime) return Promise.resolve({ ok: false, error: "không có chrome.runtime" });
  return runtime.sendMessage(message);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Giọng nữ tiếng Việt chạy cục bộ bằng Piper (ONNX/WASM) trong offscreen document.
 * Model tải một lần từ HuggingFace, lưu OPFS; sau đó không gọi mạng.
 */
export class PiperTtsProvider implements TtsProvider {
  readonly name = "piper-tts";
  private readonly voiceId: string;
  private readonly send: PiperSender;

  constructor(options: { voiceId?: string; send?: PiperSender } = {}) {
    this.voiceId = options.voiceId ?? DEFAULT_PIPER_VOICE;
    this.send = options.send ?? defaultSender;
  }

  async synthesize(text: string): Promise<Uint8Array> {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed === "") throw new TtsUnavailableError("câu rỗng, không có gì để đọc");

    const reply = (await this.send({
      type: PIPER_SYNTH_MESSAGE,
      text: trimmed,
      voiceId: this.voiceId,
    })) as PiperReply | undefined;

    if (!reply?.ok || !reply.base64) {
      throw new TtsUnavailableError(reply?.error ?? "Piper TTS không phản hồi");
    }
    const bytes = base64ToBytes(reply.base64);
    if (bytes.length < 256) throw new TtsUnavailableError(`audio Piper quá ngắn: ${bytes.length} byte`);
    return bytes;
  }
}
