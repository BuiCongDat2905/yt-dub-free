import { EdgeTTS } from "edge-tts-universal";
import { writeFileSync } from "node:fs";

const VOICE = "vi-VN-HoaiMyNeural";
const TEXT = "Xin chào, đây là bài kiểm tra lồng tiếng tiếng Việt cho video YouTube.";

const t0 = performance.now();
const result = await new EdgeTTS(TEXT, VOICE).synthesize();
const audioMs = performance.now() - t0;
const bytes = new Uint8Array(await result.audio.arrayBuffer());

writeFileSync("out.mp3", bytes);

console.log("voice=" + VOICE);
console.log("bytes=" + bytes.length);
console.log("synthesize_ms=" + Math.round(audioMs));
console.log("subtitle_cues=" + (Array.isArray(result.subtitle) ? result.subtitle.length : "n/a"));
console.log("head=" + Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
