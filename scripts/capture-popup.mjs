import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = "D:\\Ai20K\\yt-dub-free\\.output\\chrome-mv3";
const OUT = "docs/popup.png";
const PORT = 9666;

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-shot-"));
const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=320,420",
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

const extensionId = await waitFor(async () => {
  const reply = await send("Target.getTargets");
  const targets = reply.result?.targetInfos ?? [];
  const match = targets.find((target) => String(target.url).startsWith("chrome-extension://"));
  return match ? new URL(match.url).host : null;
}, "extension id");

const popupUrl = `chrome-extension://${extensionId}/popup.html`;
const created = await send("Target.createTarget", { url: popupUrl });
const targetId = created.result?.targetId;
const attached = await send("Target.attachToTarget", { targetId, flatten: true });
const sessionId = attached.result?.sessionId;

await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await sleep(1200);

const shot = await send(
  "Page.captureScreenshot",
  { format: "png", captureBeyondViewport: true },
  sessionId,
);
const data = shot.result?.data;
if (!data) throw new Error("không lấy được screenshot");

mkdirSync("docs", { recursive: true });
writeFileSync(OUT, Buffer.from(data, "base64"));
console.log(`saved ${OUT}`);
console.log(`popup_url=${popupUrl}`);

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
