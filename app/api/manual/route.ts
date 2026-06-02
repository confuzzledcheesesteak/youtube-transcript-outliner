export const runtime = 'edge';

type ManualLine = { text: string; offset: number; duration: number; time?: string };

const STOPWORDS = new Set('the a an and or but so because to of in on for with from at by is are was were be been being i im you we they he she it this that these those as into about like not no do does did can could should would will just if than then there their our your my me us them his her its what when where why how which who also more most some any all one two three get got going really actually right okay kind sort think know make made see use using used new first next last very over under up down out its thats theres youre were theyre ill youll well theyll ive youve weve id youd wed dont doesnt didnt cant couldnt shouldnt wouldnt wont isnt arent wasnt werent'.split(' '));

function fmt(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function parseTime(token: string) {
  const parts = token.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}
function clean(text: string) { return text.replace(/\s+/g, ' ').trim(); }
function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[’']/g, '').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}
function words(text: string) {
  return text.split(/\s+/).map(normalizeWord).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}
function topKeywords(text: string, n = 5) {
  const counts = new Map<string, number>();
  for (const w of words(text)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}
function ideaLabel(text: string, index: number) {
  const ordered = Array.from(new Set(words(clean(text).split(/[.!?]/)[0] || text))).slice(0, 6);
  const keys = ordered.length ? ordered : topKeywords(text, 6);
  const label = keys.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(' ');
  const prefixes = ['Opening', 'Focus', 'Deep dive', 'Key ideas', 'Examples', 'Takeaways'];
  return label ? `${prefixes[Math.min(index, prefixes.length - 1)]}: ${label}` : `Section ${index + 1}`;
}
function readableTranscript(lines: { text: string }[]) {
  return clean(lines.map((line) => line.text).join(' '));
}

function buildAiSummary(segments: Array<{ title: string; summary: string; range: string; keywords?: string[]; lines: { text: string }[] }>) {
  const combined = segments.map((segment) => segment.lines.map((line) => line.text).join(' ')).join(' ');
  return {
    overview: summary(combined || segments.map((segment) => segment.summary).join(' ')),
    parts: segments.map((segment) => ({
      title: segment.title,
      range: segment.range,
      summary: segment.summary,
      keywords: segment.keywords || [],
    })),
  };
}
function summary(text: string) {
  const s = clean(text).match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [clean(text)];
  const picked = s.find((x) => x.split(/\s+/).length >= 8) || s[0] || '';
  return picked.split(/\s+/).slice(0, 34).join(' ') + (picked.split(/\s+/).length > 34 ? '…' : '');
}
function title(text: string, i: number) { return ideaLabel(text, i); }
function parseManual(text: string) {
  const rows = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let fallback = 0;
  return rows.map((row) => {
    const match = row.match(/^\[?((?:\d+:)?\d{1,2}:\d{2}|\d{1,5})\]?\s*[-–—:]?\s*(.*)$/);
    if (match) {
      const parsed = parseTime(match[1]);
      if (parsed !== null) {
        fallback = parsed + 8;
        return { offset: parsed, duration: 8, text: clean(match[2] || row) };
      }
    }
    const item = { offset: fallback, duration: 8, text: clean(row) };
    fallback += 8;
    return item;
  }).filter((x) => x.text);
}
function segment(lines: ManualLine[]) {
  const groups: ManualLine[][] = [];
  let current: ManualLine[] = [];
  let start = 0;
  const duration = Math.max(...lines.map((x) => x.offset + x.duration), 0);
  const target = duration > 1800 ? 8 : duration > 900 ? 6 : 4;
  const min = Math.max(80, duration / (target + 1));
  lines.forEach((line, idx) => {
    if (!current.length) start = line.offset;
    current.push(line);
    const elapsed = line.offset + line.duration - start;
    if ((elapsed >= min && /[.!?]$/.test(line.text)) || idx === lines.length - 1) {
      groups.push(current); current = [];
    }
  });
  return groups.map((g, i) => {
    const text = g.map((x) => x.text).join(' ');
    const last = g[g.length - 1];
    const start = g[0].offset;
    const end = last.offset + last.duration;
    return { id: `section-${i + 1}`, title: title(text, i), summary: summary(text), start, end, range: `${fmt(start)}–${fmt(end)}`, keywords: topKeywords(text, 6), lines: g.map((line) => ({ ...line, time: fmt(line.offset) })) };
  });
}

export async function POST(request: Request) {
  const { transcript, title = 'Manual transcript' } = await request.json();
  if (!transcript || typeof transcript !== 'string') return Response.json({ error: 'Paste transcript text first.' }, { status: 400 });
  const lines = parseManual(transcript);
  if (!lines.length) return Response.json({ error: 'No transcript lines found.' }, { status: 400 });
  const segments = segment(lines);
  const duration = Math.max(...lines.map((x) => x.offset + x.duration), 0);
  const readableText = readableTranscript(lines);
  const aiSummary = buildAiSummary(segments);
  return Response.json({
    videoId: null,
    url: null,
    title,
    author: 'Manual input',
    thumbnail: null,
    duration,
    durationLabel: fmt(duration),
    transcriptCount: lines.length,
    wordCount: words(lines.map((x) => x.text).join(' ')).length,
    languageNote: 'Generated from pasted transcript text. Timestamps are preserved if present; otherwise approximate timestamps are assigned.',
    outline: segments.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, range: s.range, summary: s.summary, keywords: s.keywords })),
    segments,
    fullText: lines.map((line) => `[${fmt(line.offset)}] ${line.text}`).join('\n'),
    readableText,
    aiSummary,
  });
}
