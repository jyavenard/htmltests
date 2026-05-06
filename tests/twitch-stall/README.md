# Twitch MSE content→ad handoff — portable test page

Self-contained repro of a Safari MSE behavior difference at a content→ad boundary.
Upload these files to any static web server and open `combined.html` in Safari and
Chrome side-by-side.

## Files

| file | size | purpose |
| --- | --- | --- |
| `combined.html`  | ~8 KB  | the test page; loads via ES module |
| `common.js`      | ~8 KB  | shared TSV parser, fetch, instrumentation |
| `content.mp4`    | ~22 MB | first 60 s of the Twitch content SourceBuffer capture (trimmed from the full 218 MB) |
| `content.tsv`    | ~13 KB | manifest of 132 appends; columns `seq / offset / size / currentTime / timestampOffset / appendWindow{Start,End} / abortCount / samples / dropped / min+max raw+adj PTS` |
| `ad-2.mp4`       | ~6 MB  | ad-side SourceBuffer capture (full) |
| `ad-2.tsv`       | ~6 KB  | 62 appends |

`content.mp4` is a byte-exact concatenation of every `SourceBuffer.appendBuffer(...)` the
Twitch page made, in order; each row in `content.tsv` gives `[offset, size)` into that blob
plus the `timestampOffset`/`appendWindow*`/`abortCount` set before each append.

## How to use

Serve the directory over HTTP (MSE + `fetch` ArrayBuffer don't work over `file://`). Any
static server works; the simplest on localhost:

```bash
python3 -m http.server 8123
```

Then open `http://<host>:8123/combined.html` in Safari and Chrome. Click **Run replay** —
content starts buffering and playback begins after ~15 appends. Click **Append ad NOW** to
skip remaining content appends, issue `sb.changeType()`, and append the ad segments. Watch
the status bar and the log.

## What to compare

The status bar shows `t=` (`currentTime`), `rs=` (readyState), `buffered=`, `paused=`.
Observed so far:

- **Chrome:** `buffered=[0.067..~last_content_end]` — a single contiguous range. Playback
  advances past where the ad was inserted, readyState climbs to HAVE_ENOUGH.
- **Safari:** `buffered=[0.079..10.078] [12.067..last_content_end]` — two ranges with a
  ~2 s gap between ad end (10.078) and the next content audio RAP (12.067).
  `currentTime` sits at 10.078, `readyState=HAVE_CURRENT`, playback stalled at the gap edge.

Likely mechanism: content's AAC audio marks only every 2 s frame as `sync`; inter-sync
frames are flagged non-sync. When the ad appends overlap the content audio sample at 10.067
(sync), WebKit's coded-frame-removal cascades forward through the dependent non-sync
samples until the next sync at 12.067. Chrome does not cascade (AAC-LC is independently
decodable per frame).

## Controls

- **Run replay** — starts phase 1 (content appends). Replay calls `video.play()` after ~15
  appends so playback is actually running when more data arrives.
- **Stop** — aborts replay and tears down the `<video>` / `MediaSource`.
- **Append ad NOW** — breaks out of the remaining content loop and immediately runs phase 2
  (`sb.changeType()` + ad appends). Useful to test the handoff without waiting.
- **Download log** — dumps the event log as a TSV for offline diffing (`events-combined-*.tsv`,
  tagged with the browser name).

## Config

Codecs default to what was captured (content = `avc1.4d401e,mp4a.40.2` Main 3.0; ad =
`avc1.4d4028,mp4a.40.2` Main 4.0). Both fields are editable inputs on the page.

## Not replicated

The test page deliberately does **not** replicate Twitch's JS teardown (`video.pause()` +
`video.load()` + reassign `src`). That behavior is downstream of the buffered-range issue
and reproducing it is a null experiment across browsers.
