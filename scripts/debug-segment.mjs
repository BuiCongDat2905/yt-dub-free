import { segmentCues } from "../lib/subtitle/segment.ts";
const long = `${"từ ngắn ".repeat(30)}hết`.trim();
console.log("input_len=" + long.length);
const cues = segmentCues([{ start: 0, end: 12, text: long }]);
console.log("cues=" + cues.length);
for (const [i, c] of cues.entries()) console.log(`${i}: [${c.start.toFixed(2)}-${c.end.toFixed(2)}] len=${c.text.length} head=${JSON.stringify(c.text.slice(0,30))} tail=${JSON.stringify(c.text.slice(-16))}`);
console.log("joined_len=" + cues.map((c)=>c.text).join(" ").replace(/\s+/g," ").length);
