import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = "D:\\Ai20K\\yt-dub-free\\.output\\chrome-mv3";
const PORT = 9555;
const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-smoke-"));
const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, label, timeoutMs = 45000) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timeout " + label);
    await sleep(300);
  }
}

const version = await waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  return response.ok ? response.json() : null;
}, "devtools");

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}, sessionId) => {
  const id = (sequence += 1);
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve) => pending.set(id, resolve));
};

const created = await send("Target.createTarget", { url: `https://www.youtube.com/watch?v=${videoId}` });
const targetId = created.result?.targetId;
const attached = await send("Target.attachToTarget", { targetId, flatten: true });
const sessionId = attached.result?.sessionId;
await send("Runtime.enable", {}, sessionId);

const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return reply.result?.result?.value;
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  const badge = await waitFor(
    async () => (await evaluate("!!document.getElementById('ytdubfree-badge')")) && true,
    "badge",
  );
  check("badge mount trên /watch", badge === true);

  const shadow = await evaluate(
    "(() => { const h = document.getElementById('ytdubfree-badge'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('button')); })()",
  );
  check("badge có button trong shadow DOM", shadow === true);

  const status = await waitFor(async () => {
    const raw = await evaluate("document.documentElement.dataset.ytdubfree || ''");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed.tracks !== undefined || parsed.error ? parsed : null;
    } catch {
      return null;
    }
  }, "status");
  check("dataset có tracks hoặc error", true, JSON.stringify(status).slice(0, 120));

  check(
    "dataset có settings",
    status?.settings !== undefined,
    JSON.stringify(status?.settings ?? null),
  );

  const overlayAbsent = await evaluate("!document.getElementById('ytdubfree-overlay')");
  check("overlay chưa tạo khi chưa bật", overlayAbsent === true);
} catch (error) {
  failures += 1;
  console.log(`FAIL smoke :: ${error.message}`);
}

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });

console.log(failures === 0 ? "SMOKE OK" : `smoke_failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
