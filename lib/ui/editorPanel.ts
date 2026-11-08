const HOST_ID = "ytdubfree-editor";
const STYLE_TEXT = `
  position: fixed;
  top: 64px;
  right: 16px;
  bottom: 96px;
  width: 360px;
  max-width: calc(100vw - 32px);
  background: #16181d;
  color: #e6e8ee;
  border: 1px solid #2b3040;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  z-index: 2147483001;
  display: flex;
  flex-direction: column;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow: hidden;
`;

const ROW_STYLE = `
  padding: 8px 10px;
  border-bottom: 1px solid #23283a;
`;

export interface EditorRow {
  index: number;
  time: string;
  source: string;
  text: string;
}

export interface EditorOptions {
  title: string;
  rows: EditorRow[];
  onApply: (changes: Record<number, string>) => void | Promise<void>;
  onClose?: () => void;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export { formatTime };

/** Panel sửa bản dịch trước khi đọc, lưu theo videoId. */
export class SubtitleEditorPanel {
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private list: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private options: EditorOptions | null = null;
  private inputs = new Map<number, HTMLTextAreaElement>();

  open(options: EditorOptions): void {
    this.close();
    this.options = options;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = STYLE_TEXT;
    const root = host.attachShadow({ mode: "open" });

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2b3040;background:#1b1f2a;";

    const title = document.createElement("strong");
    title.textContent = options.title;
    title.style.cssText = "flex:1;font-size:13px;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "✕";
    closeButton.style.cssText = "background:transparent;border:0;color:#9aa2b1;font-size:14px;cursor:pointer;";
    closeButton.addEventListener("click", () => this.close());

    header.append(title, closeButton);

    const list = document.createElement("div");
    list.style.cssText = "flex:1;overflow-y:auto;";
    this.inputs.clear();

    for (const row of options.rows) {
      const item = document.createElement("div");
      item.style.cssText = ROW_STYLE;

      const meta = document.createElement("div");
      meta.style.cssText = "display:flex;gap:8px;color:#7f8899;font-size:11px;margin-bottom:4px;";
      const indexLabel = document.createElement("span");
      indexLabel.textContent = `#${row.index + 1}`;
      const timeLabel = document.createElement("span");
      timeLabel.textContent = row.time;
      meta.append(indexLabel, timeLabel);

      const source = document.createElement("div");
      source.textContent = row.source;
      source.style.cssText = "color:#9aa2b1;font-size:11px;margin-bottom:4px;white-space:pre-wrap;";

      const textarea = document.createElement("textarea");
      textarea.value = row.text;
      textarea.rows = 2;
      textarea.style.cssText =
        "width:100%;box-sizing:border-box;resize:vertical;background:#0f1218;color:#e6e8ee;border:1px solid #2b3040;border-radius:6px;padding:6px;font:12px/1.4 inherit;";
      this.inputs.set(row.index, textarea);

      item.append(meta, source, textarea);
      list.append(item);
    }

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #2b3040;background:#1b1f2a;";

    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "Áp dụng & phát";
    applyButton.style.cssText =
      "flex:1;background:#2ea043;color:#fff;border:0;border-radius:8px;padding:8px 10px;font-weight:600;cursor:pointer;";
    applyButton.addEventListener("click", () => void this.apply());

    const status = document.createElement("span");
    status.style.cssText = "color:#7ee2a8;font-size:11px;min-width:80px;text-align:right;";

    footer.append(applyButton, status);

    root.append(header, list, footer);
    document.documentElement.appendChild(host);

    this.host = host;
    this.root = root;
    this.list = list;
    this.status = status;
  }

  private async apply(): Promise<void> {
    const options = this.options;
    if (!options) return;
    const changes: Record<number, string> = {};
    for (const row of options.rows) {
      const input = this.inputs.get(row.index);
      if (!input) continue;
      const next = input.value.trim();
      if (next !== "" && next !== row.text) changes[row.index] = next;
    }
    if (Object.keys(changes).length === 0) {
      this.setStatus("Không có thay đổi");
      return;
    }
    this.setStatus("Đang áp dụng…");
    try {
      await options.onApply(changes);
      this.setStatus(`Đã lưu ${Object.keys(changes).length} câu`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  private setStatus(text: string): void {
    if (this.status) this.status.textContent = text;
  }

  close(): void {
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.list = null;
    this.status = null;
    this.inputs.clear();
    const onClose = this.options?.onClose;
    this.options = null;
    onClose?.();
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  /** Các phần tử DOM để kiểm thử tự động. */
  get rootNode(): ShadowRoot | null {
    return this.root;
  }

  get listNode(): HTMLElement | null {
    return this.list;
  }
}
