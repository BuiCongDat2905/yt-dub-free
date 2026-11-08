import { logEvent } from "../log.ts";
import { TtsUnavailableError, type TtsProvider } from "./provider.ts";

/** Thử provider chính (Piper offline), lỗi thì rơi về provider phụ (Google TTS). */
export class PreferredTtsProvider implements TtsProvider {
  readonly name: string;
  private readonly primary: TtsProvider;
  private readonly secondary: TtsProvider;

  constructor(primary: TtsProvider, secondary: TtsProvider) {
    this.primary = primary;
    this.secondary = secondary;
    this.name = `${primary.name}+${secondary.name}`;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    try {
      return await this.primary.synthesize(text, signal);
    } catch (error) {
      await logEvent("warn", "tts", `provider chính lỗi, dùng dự phòng: ${this.primary.name}`, error);
      try {
        return await this.secondary.synthesize(text, signal);
      } catch (fallbackError) {
        throw new TtsUnavailableError(
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
      }
    }
  }
}
