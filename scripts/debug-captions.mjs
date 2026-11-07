import { getCaptionTracks } from "../lib/youtube/innertube.ts";

const id = process.argv[2] ?? "dQw4w9WgXcQ";
const tracks = await getCaptionTracks(id);
console.log(`tracks=${tracks.length}`);

for (const track of tracks.slice(0, 3)) {
  console.log(`lang=${track.languageCode} kind=${track.kind ?? "-"} name=${track.name ?? "-"}`);
  console.log(`  url=${track.baseUrl.slice(0, 160)}...`);
}

const track = tracks[0];
if (track) {
  for (const fmt of [null, "json3", "vtt"]) {
    const url = new URL(track.baseUrl);
    if (fmt) url.searchParams.set("fmt", fmt);
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      },
    });
    const body = await response.text();
    console.log(
      `fmt=${fmt ?? "none"} status=${response.status} bytes=${body.length} head=${JSON.stringify(body.slice(0, 90))}`,
    );
  }
}
