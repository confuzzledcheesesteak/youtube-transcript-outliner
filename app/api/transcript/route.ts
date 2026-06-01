import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export const runtime = 'nodejs';

type TranscriptItem = { text: string; duration: number; offset: number };

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

function cleanText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
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

function errorMessage(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/disabled|no transcript|not available|Transcript is disabled/i.test(msg)) return 'This video does not expose captions/transcripts. Try another video or paste a transcript manually.';
  if (/private|unavailable|Video unavailable/i.test(msg)) return 'This video appears private, unavailable, age-restricted, or region-restricted.';
  if (/blocked|captcha|429|too many|IP/i.test(msg)) return 'YouTube blocked transcript requests from this hosting environment. The manual transcript fallback still works.';
  return msg || 'Unable to fetch transcript.';
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') return NextResponse.json({ error: 'Paste a YouTube URL first.' }, { status: 400 });
    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: 'That does not look like a valid YouTube URL or video ID.' }, { status: 400 });

    const [rawTranscript, meta] = await Promise.all([
      YoutubeTranscript.fetchTranscript(videoId),
      fetchTitle(videoId),
    ]);

    const items = (rawTranscript || [])
      .map((item: any) => ({ text: cleanText(String(item.text || '')), duration: Number(item.duration || 0) / (Number(item.duration || 0) > 1000 ? 1000 : 1), offset: Number(item.offset || 0) / (Number(item.offset || 0) > 10000 ? 1000 : 1) }))
      .filter((item: TranscriptItem) => item.text);

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
      languageNote: 'Fetched from YouTube captions when publicly available. Auto-generated captions may contain recognition errors.',
      outline: segments.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, range: `${fmt(s.start)}–${fmt(s.end)}`, summary: s.summary, keywords: s.keywords })),
      segments: segments.map((s) => ({ ...s, range: `${fmt(s.start)}–${fmt(s.end)}`, lines: s.lines.map((line) => ({ ...line, time: fmt(line.offset) })) })),
      fullText,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error), detail: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
