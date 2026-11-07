const videoId = process.argv[2] ?? "dQw4w9WgXcQ";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
  headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
});
const html = await pageResponse.text();
console.log(`page_status=${pageResponse.status} html_bytes=${html.length}`);

const pick = (pattern) => {
  const match = pattern.exec(html);
  return match?.[1] ?? null;
};

const params = pick(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
const apiKey = pick(/"INNERTUBE_API_KEY":"([^"]+)"/);
const clientVersion = pick(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
const visitorData = pick(/"VISITOR_DATA":"([^"]+)"/);

console.log(`params=${params ? params.slice(0, 40) + "..." : "null"} apiKey=${apiKey ? "yes" : "no"} clientVersion=${clientVersion} visitorData=${visitorData ? "yes" : "no"}`);

if (!params || !apiKey) {
  console.log("FAIL: thiếu params hoặc apiKey");
  process.exit(1);
}

const body = {
  context: {
    client: {
      clientName: "WEB",
      clientVersion: clientVersion ?? "2.20260101.00.00",
      hl: "en",
      gl: "US",
      originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      ...(visitorData ? { visitorData } : {}),
    },
    request: { useSsl: true },
  },
  params,
};

const transcriptResponse = await fetch(
  `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      origin: "https://www.youtube.com",
      referer: `https://www.youtube.com/watch?v=${videoId}`,
      "x-youtube-client-name": "1",
      "x-youtube-client-version": clientVersion ?? "2.20260101.00.00",
      ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
    },
    body: JSON.stringify(body),
  },
);

const text = await transcriptResponse.text();
console.log(`transcript_status=${transcriptResponse.status} bytes=${text.length}`);
console.log(`transcript_body=${JSON.stringify(text.slice(0, 400))}`);

const segments = [];
const walk = (node) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  if (node.transcriptSegmentRenderer) {
    const segment = node.transcriptSegmentRenderer;
    const snippet = segment.snippet?.runs?.map((run) => run.text ?? "").join("") ?? "";
    segments.push({ startMs: Number(segment.startMs ?? 0), endMs: Number(segment.endMs ?? 0), text: snippet });
  }
  for (const value of Object.values(node)) walk(value);
};

try {
  walk(JSON.parse(text));
} catch (error) {
  console.log("FAIL parse json: " + error.message);
  console.log(text.slice(0, 300));
  process.exit(1);
}

console.log(`segments=${segments.length}`);
for (const segment of segments.slice(0, 3)) {
  console.log(`  [${(segment.startMs / 1000).toFixed(2)}-${(segment.endMs / 1000).toFixed(2)}] ${segment.text.slice(0, 70)}`);
}
process.exit(segments.length > 0 ? 0 : 1);
