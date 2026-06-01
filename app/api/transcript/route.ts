import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export const runtime = 'nodejs';

type TranscriptItem = { text: string; duration: number; offset: number };
type CaptionTrack = { baseUrl: string; languageCode?: string; kind?: string; name?: { simpleText?: string; runs?: Array<{ text: string }> } };

type Segment = {
  id: string;
  title: string;
  summary: string;
  start: number;
  end: number;
  lines: TranscriptItem[];
  keywords: string[];
};

const STOPWORDS = new Set('the a an and or but so because to of in on for with from at by is are was were be been being i you we they he she it this that these those as into about like not no do does did can could should would will just if than then there their our your my me us them his her its what when where why how which who also more most some any all one two three get got going really actually right okay kind sort think know make made see use using used new first next last very over under up down out'.split(' '));
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const INNERTUBE_CLIENTS = [
  {
    label: 'android',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    client: { clientName: 'ANDROID', clientVersion: '20.10.38' },
  },
  {
    label: 'ios',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X;)',
    client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2' },
  },
  {
    label: 'tvhtml5',
    userAgent: 'Mozilla/5.0 SMART-TV; Tizen 6.5 AppleWebKit/537.36 YouTube/7.20240501.00.00',
    client: { clientName: 'TVHTML5', clientVersion: '7.20240501.00.00' },
  },
];

function extractVideoId(input: string) {
  const raw = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0];
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    const markers = ['embed', 'shorts', 'live', 'watch'];
    for (const marker of markers) {
      const i = parts.indexOf(marker);
      if (i >= 0 && parts[i + 1]) return parts[i + 1];
    }
    const maybe = parts.find((part) => /^[a-zA-Z0-9_-]{11}$/.test(part));
    if (maybe) return maybe;
  } catch {}
  return null;
}

function fmt(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function decodeEntities(text: string) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function cleanText(text: string) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function words(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function topKeywords(text: string, n = 5) {
  const counts = new Map<string, number>();
  for (const w of words(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function sentenceSummary(text: string, maxWords = 34) {
  const cleaned = cleanText(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const candidate = sentences.find((s) => s.split(/\s+/).length >= 8) || sentences[0] || cleaned;
  const list = candidate.split(/\s+/).slice(0, maxWords).join(' ');
  return list + (candidate.split(/\s+/).length > maxWords ? '…' : '');
}

function titleFor(text: string, index: number) {
  const keys = topKeywords(text, 4);
  if (!keys.length) return `Section ${index + 1}`;
  const pretty = keys.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(' · ');
  const prefixes = ['Opening', 'Focus', 'Deep dive', 'Key ideas', 'Examples', 'Takeaways'];
  return `${prefixes[Math.min(index, prefixes.length - 1)]}: ${pretty}`;
}

function makeSegments(items: TranscriptItem[]) {
  const totalDuration = Math.max(...items.map((item) => item.offset + item.duration), 0);
  const targetSections = totalDuration > 3600 ? 10 : totalDuration > 1800 ? 8 : totalDuration > 900 ? 6 : 4;
  const minSeconds = Math.max(90, totalDuration / (targetSections + 2));
  const maxSeconds = Math.max(210, totalDuration / Math.max(3, targetSections - 1));
  const segments: TranscriptItem[][] = [];
  let current: TranscriptItem[] = [];
  let start = items[0]?.offset || 0;

  items.forEach((item, idx) => {
    current.push(item);
    const next = items[idx + 1];
    const elapsed = item.offset + item.duration - start;
    const gap = next ? next.offset - (item.offset + item.duration) : 0;
    const text = current.map((x) => x.text).join(' ');
    const endsSentence = /[.!?]$/.test(text.trim());
    const longEnough = elapsed >= minSeconds && (gap > 2.5 || endsSentence || elapsed >= maxSeconds);
    const tooLong = elapsed >= maxSeconds * 1.35;
    if ((longEnough || tooLong || idx === items.length - 1) && current.length) {
      segments.push(current);
      current = [];
      start = next?.offset || 0;
    }
  });

  return segments.map((lines, index) => {
    const text = lines.map((x) => x.text).join(' ');
    const start = lines[0].offset;
    const last = lines[lines.length - 1];
    const end = last.offset + last.duration;
    const keywords = topKeywords(text, 6);
    return {
      id: `section-${index + 1}`,
      title: titleFor(text, index),
      summary: sentenceSummary(text),
      start,
      end,
      lines,
      keywords,
    } satisfies Segment;
  });
}

async function fetchTitle(videoId: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    return { title: data.title as string, author: data.author_name as string, thumbnail: data.thumbnail_url as string };
  } catch {
    return null;
  }
}

function msOrSeconds(value: unknown) {
  const n = Number(value || 0);
  return n > 10000 ? n / 1000 : n;
}

function normalizePackageItems(rawTranscript: unknown[]) {
  return (rawTranscript || [])
    .map((item: any) => ({ text: cleanText(String(item.text || '')), duration: msOrSeconds(item.duration), offset: msOrSeconds(item.offset) }))
    .filter((item: TranscriptItem) => item.text);
}

function chooseTrack(tracks: CaptionTrack[]) {
  return tracks.find((track) => track.languageCode === 'en' && track.kind !== 'asr')
    || tracks.find((track) => track.languageCode === 'en')
    || tracks.find((track) => track.languageCode?.startsWith('en'))
    || tracks[0];
}

async function getCaptionTracks(videoId: string) {
  const errors: string[] = [];
  for (const candidate of INNERTUBE_CLIENTS) {
    try {
      const res = await fetch(INNERTUBE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': candidate.userAgent,
          'accept-language': 'en-US,en;q=0.9',
          'x-youtube-client-name': candidate.client.clientName === 'ANDROID' ? '3' : candidate.client.clientName === 'IOS' ? '5' : '7',
          'x-youtube-client-version': candidate.client.clientVersion,
        },
        body: JSON.stringify({ context: { client: candidate.client }, videoId }),
      });
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length) return tracks as CaptionTrack[];
      errors.push(`${candidate.label}: ${data?.playabilityStatus?.status || res.status} ${data?.playabilityStatus?.reason || 'no tracks'}`);
    } catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No caption tracks returned by YouTube clients. ${errors.join(' | ')}`);
}

function parseJson3(data: any): TranscriptItem[] {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.map((event: any) => {
    const text = (event.segs || []).map((seg: any) => seg.utf8 || '').join('').replace(/\n/g, ' ');
    return { text: cleanText(text), offset: Number(event.tStartMs || 0) / 1000, duration: Number(event.dDurationMs || 0) / 1000 };
  }).filter((item: TranscriptItem) => item.text);
}

function parseXml(xml: string): TranscriptItem[] {
  const srv3: TranscriptItem[] = [];
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const inner = pMatch[3];
    const text = cleanText(inner.replace(/<[^>]+>/g, ''));
    if (text) srv3.push({ text, offset: Number(pMatch[1]) / 1000, duration: Number(pMatch[2]) / 1000 });
  }
  if (srv3.length) return srv3;

  const classic: TranscriptItem[] = [];
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = cleanText(match[3]);
    if (text) classic.push({ text, offset: Number(match[1]), duration: Number(match[2]) });
  }
  return classic;
}

async function fetchViaMobileInnerTube(videoId: string) {
  const tracks = await getCaptionTracks(videoId);
  const track = chooseTrack(tracks);
  if (!track?.baseUrl) throw new Error('Caption track did not include a timedtext URL.');

  const jsonUrl = new URL(track.baseUrl);
  jsonUrl.searchParams.set('fmt', 'json3');
  let res = await fetch(jsonUrl.toString(), { headers: { 'user-agent': INNERTUBE_CLIENTS[0].userAgent, 'accept-language': 'en-US,en;q=0.9' } });
  if (res.ok) {
    const data = await res.json();
    const items = parseJson3(data);
    if (items.length) return items;
  }

  res = await fetch(track.baseUrl, { headers: { 'user-agent': INNERTUBE_CLIENTS[0].userAgent, 'accept-language': 'en-US,en;q=0.9' } });
  if (!res.ok) throw new Error(`Timedtext request failed with HTTP ${res.status}.`);
  const xml = await res.text();
  const items = parseXml(xml);
  if (!items.length) throw new Error('Timedtext returned no readable transcript lines.');
  return items;
}

async function fetchTranscriptItems(videoId: string) {
  try {
    const rawTranscript = await YoutubeTranscript.fetchTranscript(videoId);
    const items = normalizePackageItems(rawTranscript as unknown[]);
    if (items.length) return { items, source: 'youtube-transcript package' };
  } catch (error) {
    // Some videos expose transcripts in YouTube's UI but the library reports
    // "disabled" from web scraping. Fall through to mobile InnerTube clients,
    // which mirror the approach used by robust transcript tools.
  }

  const items = await fetchViaMobileInnerTube(videoId);
  return { items, source: 'mobile InnerTube timedtext fallback' };
}

function errorMessage(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/disabled|no transcript|not available|Transcript is disabled|No caption tracks/i.test(msg)) return 'This video does not expose captions/transcripts to this environment. Try another video or paste a transcript manually.';
  if (/private|unavailable|Video unavailable|LOGIN_REQUIRED/i.test(msg)) return 'This video appears private, unavailable, age-restricted, region-restricted, or blocked by YouTube bot checks.';
  if (/blocked|captcha|429|too many|IP|bot/i.test(msg)) return 'YouTube blocked transcript requests from this hosting environment. The manual transcript fallback still works.';
  return msg || 'Unable to fetch transcript.';
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') return NextResponse.json({ error: 'Paste a YouTube URL first.' }, { status: 400 });
    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: 'That does not look like a valid YouTube URL or video ID.' }, { status: 400 });

    const [transcriptResult, meta] = await Promise.all([
      fetchTranscriptItems(videoId),
      fetchTitle(videoId),
    ]);

    const items = transcriptResult.items;
    if (!items.length) return NextResponse.json({ error: 'No caption text was returned for this video.' }, { status: 404 });

    const segments = makeSegments(items);
    const fullText = items.map((item) => `[${fmt(item.offset)}] ${item.text}`).join('\n');
    const duration = Math.max(...items.map((item) => item.offset + item.duration), 0);

    return NextResponse.json({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: meta?.title || `YouTube video ${videoId}`,
      author: meta?.author || null,
      thumbnail: meta?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration,
      durationLabel: fmt(duration),
      transcriptCount: items.length,
      wordCount: words(items.map((x) => x.text).join(' ')).length,
      languageNote: `Fetched from YouTube captions via ${transcriptResult.source}. Auto-generated captions may contain recognition errors.`,
      outline: segments.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, range: `${fmt(s.start)}–${fmt(s.end)}`, summary: s.summary, keywords: s.keywords })),
      segments: segments.map((s) => ({ ...s, range: `${fmt(s.start)}–${fmt(s.end)}`, lines: s.lines.map((line) => ({ ...line, time: fmt(line.offset) })) })),
      fullText,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error), detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
