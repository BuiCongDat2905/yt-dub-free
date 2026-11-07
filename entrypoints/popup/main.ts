import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/settings";

const originalInput = document.querySelector<HTMLInputElement>("#original-volume");
const dubInput = document.querySelector<HTMLInputElement>("#dub-volume");
const enabledInput = document.querySelector<HTMLInputElement>("#enabled");
const subtitleInput = document.querySelector<HTMLInputElement>("#subtitle");
const originalValue = document.querySelector<HTMLOutputElement>("#original-value");
const dubValue = document.querySelector<HTMLOutputElement>("#dub-value");
const status = document.querySelector<HTMLParagraphElement>("#status");

function format(value: number): string {
  return value.toFixed(2);
}

function render(values: { originalVolume: number; dubVolume: number; enabled: boolean; showSubtitle: boolean }): void {
  if (originalInput) originalInput.value = String(values.originalVolume);
  if (dubInput) dubInput.value = String(values.dubVolume);
  if (enabledInput) enabledInput.checked = values.enabled;
  if (subtitleInput) subtitleInput.checked = values.showSubtitle;
  if (originalValue) originalValue.textContent = format(values.originalVolume);
  if (dubValue) dubValue.textContent = format(values.dubVolume);
}

async function update(patch: {
  originalVolume?: number;
  dubVolume?: number;
  enabled?: boolean;
  showSubtitle?: boolean;
}): Promise<void> {
  const saved = await saveSettings(patch);
  render(saved);
  if (status) status.textContent = "Đã lưu cài đặt.";
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

  if (status) status.textContent = `Sẵn sàng. Mặc định gốc ${format(DEFAULT_SETTINGS.originalVolume)}.`;
}

void init();
