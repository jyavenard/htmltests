// Twitch MSE replay harness — shared logic.
// Parses sb-dump .tsv + .mp4, replays appends as captured, instruments events.

export const DEFAULT_MIME = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';

const VIDEO_EVENTS = [
  'loadstart', 'loadedmetadata', 'loadeddata',
  'canplay', 'canplaythrough',
  'play', 'playing', 'pause',
  'waiting', 'stalled',
  'seeking', 'seeked',
  'ratechange', 'durationchange', 'ended', 'emptied',
  'error', 'abort', 'resize',
];

const MS_EVENTS = ['sourceopen', 'sourceended', 'sourceclose'];
const SB_EVENTS = ['updatestart', 'update', 'updateend', 'error', 'abort'];

export function qs(sel) { return document.querySelector(sel); }

export function pad(n, w) { return String(n).padStart(w, '0'); }

export function nowStr() {
  const d = new Date();
  return `${pad(d.getHours(),2)}:${pad(d.getMinutes(),2)}:${pad(d.getSeconds(),2)}.${pad(d.getMilliseconds(),3)}`;
}

export function bufferedStr(tr) {
  try {
    if (!tr || !tr.length) return '(empty)';
    const parts = [];
    for (let i = 0; i < tr.length; i++) parts.push(`[${tr.start(i).toFixed(3)}..${tr.end(i).toFixed(3)}]`);
    return parts.join(' ');
  } catch (e) { return '(err:' + e.message + ')'; }
}

const READY_STATE = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT', 'HAVE_FUTURE', 'HAVE_ENOUGH'];
export function rsName(n) { return READY_STATE[n] ?? ('?' + n); }

export function makeLogger(panelEl) {
  const rows = [];
  const start = performance.now();
  function log(kind, msg, cls = 'info') {
    const t = performance.now() - start;
    const row = { t, kind, msg, cls, wall: nowStr() };
    rows.push(row);
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = `[${row.wall}] +${(t / 1000).toFixed(3)}s  ${kind.padEnd(14)}  ${msg}`;
    panelEl.appendChild(line);
    panelEl.scrollTop = panelEl.scrollHeight;
    return row;
  }
  log.rows = rows;
  log.export = () => {
    const header = 'wallClock\telapsedMs\tkind\tmessage';
    const body = rows.map(r => `${r.wall}\t${r.t.toFixed(3)}\t${r.kind}\t${r.msg}`).join('\n');
    return header + '\n' + body + '\n';
  };
  return log;
}

export async function parseManifest(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
  const text = await resp.text();
  const lines = text.trim().split('\n');
  const header = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split('\t');
    const entry = {};
    for (let j = 0; j < header.length; j++) entry[header[j]] = vals[j];
    entry.seq = parseInt(entry.seq, 10);
    entry.offset = parseInt(entry.offset, 10);
    entry.size = parseInt(entry.size, 10);
    entry.currentTime = parseFloat(entry.currentTime);
    entry.timestampOffset = parseFloat(entry.timestampOffset);
    entry.appendWindowStart = parseFloat(entry.appendWindowStart);
    entry.appendWindowEnd = entry.appendWindowEnd === 'Infinity' ? Infinity : parseFloat(entry.appendWindowEnd);
    entry.abortCount = parseInt(entry.abortCount, 10);
    entry.samples = parseInt(entry.samples, 10);
    entry.dropped = parseInt(entry.dropped, 10);
    rows.push(entry);
  }
  return rows;
}

export async function fetchBlob(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
  const total = parseInt(resp.headers.get('content-length') || '0', 10);
  if (!resp.body || !total || !onProgress) return resp.arrayBuffer();
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

export function instrumentVideo(video, log) {
  let lastTU = 0;
  for (const ev of VIDEO_EVENTS) {
    video.addEventListener(ev, () => {
      let extra = '';
      if (ev === 'error' && video.error) extra = ` code=${video.error.code} msg="${video.error.message}"`;
      if (ev === 'ratechange') extra = ` rate=${video.playbackRate}`;
      if (ev === 'durationchange') extra = ` duration=${video.duration}`;
      if (ev === 'resize') extra = ` ${video.videoWidth}x${video.videoHeight}`;
      log(`video:${ev}`,
          `t=${video.currentTime.toFixed(3)} rs=${rsName(video.readyState)} paused=${video.paused} seeking=${video.seeking}${extra}`,
          ev === 'error' ? 'error' : (ev === 'waiting' || ev === 'stalled') ? 'warn' : 'info');
    });
  }
  video.addEventListener('timeupdate', () => {
    const t = performance.now();
    if (t - lastTU < 500) return; // throttle 2Hz
    lastTU = t;
    log('video:timeupdate', `t=${video.currentTime.toFixed(3)} rs=${rsName(video.readyState)}`, 'dim');
  });

  // readyState transition watcher (poll)
  let lastRS = video.readyState;
  const poll = setInterval(() => {
    if (video.readyState !== lastRS) {
      log('video:readyState', `${rsName(lastRS)} -> ${rsName(video.readyState)} @ t=${video.currentTime.toFixed(3)}`, 'warn');
      lastRS = video.readyState;
    }
  }, 50);
  return () => clearInterval(poll);
}

export function instrumentMediaSource(ms, log) {
  for (const ev of MS_EVENTS) {
    ms.addEventListener(ev, () => log(`ms:${ev}`, `readyState=${ms.readyState}`, 'ms'));
  }
}

export function instrumentSourceBuffer(sb, log) {
  for (const ev of SB_EVENTS) {
    sb.addEventListener(ev, () => {
      let extra = '';
      if (ev === 'updateend') extra = ` buffered=${bufferedStr(sb.buffered)} tso=${sb.timestampOffset}`;
      log(`sb:${ev}`, `updating=${sb.updating}${extra}`, ev === 'error' ? 'error' : 'sb');
    });
  }
}

export function appendOnce(sb) {
  return new Promise((resolve, reject) => {
    const end = () => { cleanup(); resolve(); };
    const err = () => { cleanup(); reject(new Error('SourceBuffer error')); };
    const cleanup = () => {
      sb.removeEventListener('updateend', end);
      sb.removeEventListener('error', err);
    };
    sb.addEventListener('updateend', end);
    sb.addEventListener('error', err);
  });
}

export async function replayOne(sb, blob, entry, state, log) {
  if (entry.abortCount > state.abortCount) {
    if (sb.updating) { try { sb.abort(); log('sb:abort()', `${state.abortCount}->${entry.abortCount}`, 'warn'); } catch (e) { log('sb:abort()', 'err ' + e.message, 'error'); } }
    state.abortCount = entry.abortCount;
  }
  if (state.tso !== entry.timestampOffset) {
    try { sb.timestampOffset = entry.timestampOffset; }
    catch (e) { log('sb:tsoSetErr', e.message, 'error'); }
    state.tso = entry.timestampOffset;
  }
  if (state.aws !== entry.appendWindowStart) {
    try { sb.appendWindowStart = entry.appendWindowStart; } catch (e) {}
    state.aws = entry.appendWindowStart;
  }
  if (state.awe !== entry.appendWindowEnd) {
    try { sb.appendWindowEnd = entry.appendWindowEnd; } catch (e) {}
    state.awe = entry.appendWindowEnd;
  }
  const slice = blob.slice(entry.offset, entry.offset + entry.size);
  const done = appendOnce(sb);
  try { sb.appendBuffer(slice); }
  catch (e) { log('sb:appendBuffer', `seq${entry.seq} threw ${e.message}`, 'error'); throw e; }
  await done;
}

export function makeStatusTicker(video, sb, el) {
  return setInterval(() => {
    const r = video.readyState;
    el.textContent = [
      `t=${video.currentTime.toFixed(3)}`,
      `rs=${rsName(r)}`,
      `paused=${video.paused}`,
      `seeking=${video.seeking}`,
      `buffered=${bufferedStr(video.buffered)}`,
      `sb.buf=${bufferedStr(sb?.buffered)}`,
      `sb.upd=${sb?.updating ?? '-'}`,
      `tso=${sb?.timestampOffset ?? '-'}`,
    ].join(' | ');
  }, 200);
}

export function makeExportButton(logger, filename) {
  const a = document.createElement('button');
  a.textContent = 'Download log';
  a.onclick = () => {
    const blob = new Blob([logger.export()], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  return a;
}
