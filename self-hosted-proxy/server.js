import http from 'node:http';
import { YoutubeTranscript } from 'youtube-transcript';

const PORT = Number(process.env.PORT || 3791);
const MAX_BODY = 16 * 1024;
const RE_YOUTUBE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS, GET',
    'access-control-allow-headers': 'content-type, authorization',
    'cache-control': 'public, max-age=300',
  });
  res.end(body);
}

function extractVideoId(input) {
  const raw = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  const match = raw.match(RE_YOUTUBE);
  if (match) return match[1];
  try {
    const url = new URL(raw);
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const found = url.pathname.split('/').find((part) => /^[a-zA-Z0-9_-]{11}$/.test(part));
    if (found) return found;
  } catch {}
  return null;
}

function normalize(rawTranscript) {
  const rows = (rawTranscript || []).map((item) => ({
    text: String(item.text || '').replace(/\s+/g, ' ').trim(),
    offsetRaw: Number(item.offset || 0),
    durationRaw: Number(item.duration || 0),
    lang: item.lang || null,
  })).filter((item) => item.text);
  // The current youtube-transcript package returns offsets/durations in milliseconds.
  // Keep a fallback for libraries that already return seconds.
  const maxOffset = Math.max(...rows.map((item) => item.offsetRaw), 0);
  const scale = maxOffset > 1000 ? 1000 : 1;
  return rows.map((item) => ({
    text: item.text,
    offset: item.offsetRaw / scale,
    duration: item.durationRaw / scale,
    lang: item.lang,
  }));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function handleTranscript(req, res) {
  const started = Date.now();
  const body = await readJson(req);
  const videoId = extractVideoId(body.url || body.videoId || body.id);
  if (!videoId) return send(res, 400, { error: 'Invalid YouTube URL or video ID.' });

  const raw = await YoutubeTranscript.fetchTranscript(videoId, body.lang ? { lang: body.lang } : undefined);
  const items = normalize(raw);
  if (!items.length) return send(res, 404, { error: 'No transcript lines returned.', videoId });
  send(res, 200, {
    ok: true,
    videoId,
    source: 'self-hosted hermes-pi youtube-transcript proxy',
    transcriptCount: items.length,
    duration: Math.max(...items.map((item) => item.offset + item.duration), 0),
    items,
    elapsedMs: Date.now() - started,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 'youtube-transcript-proxy', host: 'hermes-pi' });
    if (req.method === 'POST' && req.url === '/transcript') return await handleTranscript(req, res);
    send(res, 404, { error: 'Not found. Use POST /transcript or GET /health.' });
  } catch (error) {
    send(res, 502, { error: error?.message || 'Transcript proxy failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`youtube-transcript-proxy listening on http://127.0.0.1:${PORT}`);
});
