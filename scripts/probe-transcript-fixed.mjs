import { parseTranscriptSegments } from "../lib/youtube/transcriptInnertube.ts";
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const id = process.argv[2] ?? "Rm0t1KwFmBw";
const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "user-agent": ua } })).text();
const raw = /"getTranscriptEndpoint":\{"params":"([^"]+)"/.exec(html)?.[1] ?? "";
const params = decodeURIComponent(raw);
const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] ?? "";
const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] ?? "2.20260101.00.00";
const visitorData = decodeURIComponent(/"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? "");
console.log("params_len=" + params.length + " decodes_id=" + atob(params.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(params.length/4)*4,"=")).includes(id));

const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "user-agent": ua,
    "x-youtube-client-name": "1",
    "x-youtube-client-version": clientVersion,
    ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
  },
  body: JSON.stringify({
    context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US", originalUrl: `https://www.youtube.com/watch?v=${id}`, ...(visitorData ? { visitorData } : {}) }, request: { useSsl: true } },
    params,
  }),
});
const text = await response.text();
console.log("status=" + response.status + " bytes=" + text.length);
let payload = null;
try { payload = JSON.parse(text); } catch {}
const cues = payload ? parseTranscriptSegments(payload) : [];
console.log("cues=" + cues.length);
if (cues[0]) console.log("first=[" + cues[0].start.toFixed(2) + "-" + cues[0].end.toFixed(2) + "] " + cues[0].text.slice(0, 70));
if (cues.length === 0) console.log("head=" + JSON.stringify(text.slice(0, 120)));
