import { getCaptionTracks } from "../lib/youtube/innertube.ts";
import { fetchCuesForTrack, pickTrack } from "../lib/youtube/captions.ts";

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: node scripts/verify-captions.mjs <videoId...>");
  process.exit(2);
}

let failures = 0;
for (const id of ids) {
  try {
    const tracks = await getCaptionTracks(id);
    const track = pickTrack(tracks, "en");
    const cues = track ? await fetchCuesForTrack(track) : [];
    const duration = cues.length > 0 ? cues[cues.length - 1].end : 0;
    console.log(
      `OK id=${id} tracks=${tracks.length} picked=${track?.languageCode ?? "none"}` +
        `${track?.kind ? `/${track.kind}` : ""} cues=${cues.length} duration=${duration.toFixed(1)}s`,
    );
    if (cues[0]) console.log(`   first= [${cues[0].start.toFixed(2)}-${cues[0].end.toFixed(2)}] ${cues[0].text.slice(0, 70)}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL id=${id} :: ${error.name}: ${error.message}`);
  }
}
console.log(failures === 0 ? "ALL OK" : `failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
