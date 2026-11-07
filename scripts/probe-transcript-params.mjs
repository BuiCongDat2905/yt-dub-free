const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const id = "Rm0t1KwFmBw";
const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "user-agent": ua, "accept-language": "en-US,en;q=0.9" } })).text();
console.log("html_bytes=" + html.length);

const candidates = [...html.matchAll(/"getTranscriptEndpoint":\{"params":"([^"]+)"/g)].map((m) => m[1]);
console.log("candidates=" + candidates.length);
const b64d = (s) => { try { const n = s.replace(/-/g,"+").replace(/_/g,"/"); return atob(n.padEnd(Math.ceil(n.length/4)*4,"=")); } catch { return ""; } };
for (const p of candidates) {
  const once = b64d(p);
  console.log(`param_len=${p.length} contains_id_once=${once.includes(id)} printable=${JSON.stringify(once.slice(0, 80))}`);
  const twice = b64d(once);
  console.log(`  twice_contains=${twice.includes(id)} twice=${JSON.stringify(twice.slice(0, 80))}`);
}

const b64e = (bytes) => btoa(String.fromCharCode(...bytes));
const idBytes = new TextEncoder().encode(id);
const variants = {
  "page": candidates[0],
  "minimal": b64e(new Uint8Array([0x0a, idBytes.length, ...idBytes])),
  "plus-08-01": b64e(new Uint8Array([0x0a, idBytes.length, ...idBytes, 0x12, 0x02, 0x08, 0x01])),
  "plus-asr": b64e(new Uint8Array([0x0a, idBytes.length, ...idBytes, 0x12, 0x03, 0x0a, 0x01, 0x31])),
};
const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] ?? "";
const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] ?? "2.20260101.00.00";
const visitorData = decodeURIComponent((/"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&"));

for (const [name, params] of Object.entries(variants)) {
  if (!params) { console.log(`${name}: no params`); continue; }
  for (const clientName of ["WEB", "ANDROID"]) {
    const body = {
      context: { client: { clientName, clientVersion, hl: "en", gl: "US", ...(visitorData ? { visitorData } : {}) }, request: { useSsl: true } },
      params,
    };
    const url = `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": ua,
          "accept-language": "en-US,en;q=0.9",
          "x-youtube-client-name": clientName === "WEB" ? "1" : "3",
          "x-youtube-client-version": clientVersion,
          ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      console.log(`${name}/${clientName} status=${response.status} bytes=${text.length} head=${JSON.stringify(text.slice(0, 60))}`);
    } catch (error) {
      console.log(`${name}/${clientName} FAIL ${String(error).slice(0, 80)}`);
    }
  }
}
