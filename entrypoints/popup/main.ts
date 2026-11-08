import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type VoiceEngine,
} from "@/lib/settings";
import { clearLogs, formatLogs, loadLogs } from "@/lib/log";

const originalInput = document.querySelector<HTMLInputElement>("#original-volume");
const dubInput = document.querySelector<HTMLInputElement>("#dub-volume");
const enabledInput = document.querySelector<HTMLInputElement>("#enabled");
const subtitleInput = document.querySelector<HTMLInputElement>("#subtitle");
const voiceInput = document.querySelector<HTMLSelectElement>("#voice-engine");
const originalValue = document.querySelector<HTMLOutputElement>("#original-value");
const dubValue = document.querySelector<HTMLOutputElement>("#dub-value");
const status = document.querySelector<HTMLParagraphElement>("#status");
const editorButton = document.querySelector<HTMLButtonElement>("#open-editor");
const downloadLogButton = document.querySelector<HTMLButtonElement>("#download-log");
const clearLogButton = document.querySelector<HTMLButtonElement>("#clear-log");

function format(value: number): string {
  return value.toFixed(2);
}

function render(values: {
  originalVolume: number;
  dubVolume: number;
  enabled: boolean;
  showSubtitle: boolean;
  voiceEngine: VoiceEngine;
}): void {
  if (originalInput) originalInput.value = String(values.originalVolume);
  if (dubInput) dubInput.value = String(values.dubVolume);
  if (enabledInput) enabledInput.checked = values.enabled;
  if (subtitleInput) subtitleInput.checked = values.showSubtitle;
  if (voiceInput) voiceInput.value = values.voiceEngine;
  if (originalValue) originalValue.textContent = format(values.originalVolume);
  if (dubValue) dubValue.textContent = format(values.dubVolume);
}

async function update(patch: {
  originalVolume?: number;
  dubVolume?: number;
  enabled?: boolean;
  showSubtitle?: boolean;
  voiceEngine?: VoiceEngine;
}): Promise<void> {
  const saved = await saveSettings(patch);
  render(saved);
  if (status) status.textContent = "Đã lưu cài đặt.";
}

interface TabsApi {
  query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

function tabsApi(): TabsApi | null {
  return (globalThis as { chrome?: { tabs?: TabsApi } }).chrome?.tabs ?? null;
}

async function openEditor(): Promise<void> {
  const tabs = tabsApi();
  if (!tabs) return;
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    if (status) status.textContent = "Không tìm thấy tab đang mở.";
    return;
  }
  try {
    await tabs.sendMessage(tab.id, { type: "ytdubfree:open-editor" });
    if (status) status.textContent = "Đã mở panel sửa bản dịch trên trang video.";
  } catch {
    if (status) status.textContent = "Mở video YouTube và bật lồng tiếng trước.";
  }
}

async function downloadLogs(): Promise<void> {
  const entries = await loadLogs();
  const blob = new Blob([formatLogs(entries)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ytdubfree-log-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  if (status) status.textContent = `Đã xuất ${entries.length} dòng log.`;
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  render(settings);

  originalInput?.addEventListener("input", () => {
    const value = Number(originalInput.value);
    if (originalValue) originalValue.textContent = format(value);
  });
  dubInput?.addEventListener("input", () => {
    const value = Number(dubInput.value);
    if (dubValue) dubValue.textContent = format(value);
  });

  originalInput?.addEventListener("change", () => {
    void update({ originalVolume: Number(originalInput.value) });
  });
  dubInput?.addEventListener("change", () => {
    void update({ dubVolume: Number(dubInput.value) });
  });
  enabledInput?.addEventListener("change", () => {
    void update({ enabled: enabledInput.checked });
  });
  subtitleInput?.addEventListener("change", () => {
    void update({ showSubtitle: subtitleInput.checked });
  });
  voiceInput?.addEventListener("change", () => {
    const value = voiceInput.value === "google" ? "google" : "piper";
    void update({ voiceEngine: value });
  });

  editorButton?.addEventListener("click", () => void openEditor());
  downloadLogButton?.addEventListener("click", () => void downloadLogs());
  clearLogButton?.addEventListener("click", () => {
    void clearLogs().then(() => {
      if (status) status.textContent = "Đã xoá log.";
    });
  });

  if (status) {
    status.textContent = `Sẵn sàng. Mặc định Google TTS nữ; Piper offline là tuỳ chọn (tải model ~63 MB). Tiếng gốc ${format(DEFAULT_SETTINGS.originalVolume)}.`;
  }
}

void init();
