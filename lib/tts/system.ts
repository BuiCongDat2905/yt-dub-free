/** Dự phòng khi provider chính hỏng: đọc trực tiếp bằng giọng của hệ điều hành. */
export class SystemTtsProvider {
  readonly name = "system-tts";
  private readonly lang: string;

  constructor(options: { lang?: string } = {}) {
    this.lang = options.lang ?? "vi-VN";
  }

  isAvailable(): boolean {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
  }

  pickVoice(): SpeechSynthesisVoice | null {
    if (!this.isAvailable()) return null;
    const voices = speechSynthesis.getVoices();
    const wanted = this.lang.toLowerCase();
    return (
      voices.find((voice) => voice.lang.toLowerCase() === wanted) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("vi")) ??
      null
    );
  }

  speak(text: string): Promise<void> {
    if (!this.isAvailable()) return Promise.reject(new Error("speechSynthesis không có"));
    const trimmed = text.trim();
    if (trimmed === "") return Promise.resolve();

    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = this.lang;
      const voice = this.pickVoice();
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error(`speechSynthesis lỗi: ${event.error}`));
      speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (this.isAvailable()) speechSynthesis.cancel();
  }
}
