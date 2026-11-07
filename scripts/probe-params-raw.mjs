const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const id = "Rm0t1KwFmBw";
const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "user-agent": ua } })).text();
const raw = /"getTranscriptEndpoint":\{"params":"([^"]+)"/.exec(html)?.[1] ?? "";
console.log("raw_head=" + JSON.stringify(raw.slice(0, 100)));
console.log("raw_len=" + raw.length);
const unescaped = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
console.log("unescaped_head=" + JSON.stringify(unescaped.slice(0, 100)));
const decodedUri = decodeURIComponent(unescaped);
console.log("decoded_uri_head=" + JSON.stringify(decodedUri.slice(0, 100)));
const b64d = (s) => { try { const n = s.replace(/-/g,"+").replace(/_/g,"/"); return atob(n.padEnd(Math.ceil(n.length/4)*4,"=")); } catch (e) { return "ERR:" + e.message; } };
for (const [name, value] of [["raw", raw], ["unescaped", unescaped], ["decoded_uri", decodedUri]]) {
  const decoded = b64d(value);
  console.log(`${name} atob_len=${decoded.length} contains_id=${decoded.includes(id)} head=${JSON.stringify(decoded.slice(0, 60))}`);
}
