import { parseJson3 } from "../lib/subtitle/parse.ts";

const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

const CLIENTS = {
  ANDROID: {
    clientName: "ANDROID",
    clientVersion: "19.44.38",
    androidSdkVersion: 30,
    userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    headers: { "x-youtube-client-name": "3", "x-youtube-client-version": "19.44.38" },
  },
  IOS: {
    clientName: "IOS",
    clientVersion: "19.45.4",
    deviceModel: "iPhone16,2",
    userAgent: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    headers: { "x-youtube-client-name": "5", "x-youtube-client-version": "19.45.4" },
  },
};

const walk = (node, hits = []) => {
  if (!node || typeof node !== "object") return hits;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, hits));
    return hits;
  }
  if (node.captionTracks) hits.push(...node.captionTracks);
  for (const value of Object.values(node)) walk(value, hits);
  return hits;
};

for (const [name, client] of Object.entries(CLIENTS)) {
  const body = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: "en",
        gl: "US",
        ...(client.androidSdkVersion ? { androidSdkVersion: client.androidSdkVersion } : {}),
        ...(client.deviceModel ? { deviceModel: client.deviceModel } : {}),
      },
    },
    videoId,
  };

  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": client.userAgent,
      "accept-language": "en-US,en;q=0.9",
      ...client.headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let tracks = [];
  try {
    tracks = walk(JSON.parse(text));
  } catch {
    console.log(`client=${name} player_status=${response.status} parse_fail bytes=${text.length}`);
    continue;
  }

  console.log(`client=${name} player_status=${response.status} bytes=${text.length} tracks=${tracks.length}`);
  if (tracks.length === 0) {
    console.log(`   head=${JSON.stringify(text.slice(0, 120))}`);
    continue;
  }

  const track = tracks.find((t) => t.kind !== "asr") ?? tracks[0];
  const url = new URL(track.baseUrl, "https://www.youtube.com");
  url.searchParams.set("fmt", "json3");
  const captionResponse = await fetch(url, {
    headers: { "user-agent": client.userAgent, "accept-language": "en-US,en;q=0.9" },
  });
  const captionBody = await captionResponse.text();
  const cues = captionBody.trimStart().startsWith("{") ? parseJson3(captionBody) : [];
  console.log(
    `   lang=${track.languageCode} kind=${track.kind ?? "-"} has_pot=${url.searchParams.has("pot")} ` +
      `caption_status=${captionResponse.status} bytes=${captionBody.length} cues=${cues.length}`,
  );
  if (cues[0]) console.log(`   first=[${cues[0].start.toFixed(2)}-${cues[0].end.toFixed(2)}] ${cues[0].text.slice(0, 70)}`);
}
