export const runtime = 'edge';

type ChatLine = { text?: string; time?: string; offset?: number };
type ChatSegment = { title?: string; summary?: string; range?: string; keywords?: string[]; lines?: ChatLine[] };
type Citation = { time: string; text: string; section: string };
type RankedUnit = { text: string; source: string; score: number; segmentTitle: string };

const STOPWORDS = new Set('the a an and or but so because to of in on for with from at by is are was were be been being i you we they he she it this that these those as into about like not no do does did can could should would will just if than then there their our your my me us them his her its what when where why how which who also more most some any all get got going really actually right okay kind sort think know make made see use using used new first next last very over under up down out video transcript tell ask answer list things thing steps step items item'.split(' '));
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_BASE = (process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function words(text: string) {
  return clean(text).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function wantedCount(question: string) {
  const digit = question.match(/\b(\d{1,2})\b/);
  if (digit) return Math.min(Number(digit[1]), 30);
  const wordCounts: Record<string, number> = { ten: 10, twelve: 12, twenty: 20, twentyfour: 24, 'twenty-four': 24 };
  const normalized = question.toLowerCase().replace(/\s+/g, '');
  for (const [word, count] of Object.entries(wordCounts)) if (normalized.includes(word.replace('-', ''))) return count;
  return /\blist\b|\bthings\b|\bsteps\b|\bitems\b|\bwhat are\b/i.test(question) ? 12 : 5;
}

function sentenceSplit(text: string) {
  return clean(text).match(/[^.!?]+[.!?]*/g)?.map((part) => clean(part)).filter(Boolean) || [];
}

function lineTime(line: ChatLine, fallback: string) {
  if (line.time) return line.time;
  if (typeof line.offset === 'number') {
    const total = Math.max(0, Math.floor(line.offset));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return fallback;
}

function collectUnits(segments: ChatSegment[]) {
  const units: RankedUnit[] = [];
  for (const segment of segments) {
    const title = clean(segment.title || 'Transcript section');
    const range = clean(segment.range || '');
    const lines = Array.isArray(segment.lines) ? segment.lines : [];
    if (lines.length) {
      for (const line of lines) {
        const text = clean(line.text || '');
        if (text) units.push({ text, source: lineTime(line, range), score: 0, segmentTitle: title });
      }
    } else {
      for (const sentence of sentenceSplit(`${segment.summary || ''}`)) {
        units.push({ text: sentence, source: range, score: 0, segmentTitle: title });
      }
    }
  }
  return units;
}

function rankUnits(question: string, segments: ChatSegment[], readableText = '') {
  const qWords = words(question);
  const qSet = new Set(qWords);
  const units = collectUnits(segments);
  if (!units.length && readableText) {
    for (const sentence of sentenceSplit(readableText)) units.push({ text: sentence, source: 'clean transcript', score: 0, segmentTitle: 'Transcript' });
  }

  for (const unit of units) {
    const unitWords = words(`${unit.segmentTitle} ${unit.text}`);
    const overlap = unitWords.filter((word) => qSet.has(word)).length;
    const phraseBoost = qWords.some((word) => clean(unit.text).toLowerCase().includes(word)) ? 1 : 0;
    unit.score = overlap * 3 + phraseBoost + Math.min(unitWords.length / 20, 2);
  }

  const sorted = [...units].sort((a, b) => b.score - a.score);
  const directMatches = sorted.filter((unit) => unit.score > 0);
  return directMatches.length ? directMatches : sorted;
}

function citationsFromUnits(units: RankedUnit[], limit = 8): Citation[] {
  return units.slice(0, limit).map((unit) => ({ time: unit.source, text: unit.text, section: unit.segmentTitle }));
}

function transcriptForPrompt(segments: ChatSegment[], readableText = '') {
  const lines: string[] = [];
  for (const segment of segments) {
    const title = clean(segment.title || 'Transcript section');
    const range = clean(segment.range || '');
    lines.push(`\n## ${title}${range ? ` (${range})` : ''}`);
    const segmentLines = Array.isArray(segment.lines) ? segment.lines : [];
    if (segmentLines.length) {
      for (const line of segmentLines) {
        const text = clean(line.text || '');
        if (text) lines.push(`[${lineTime(line, range)}] ${text}`);
      }
    } else if (segment.summary) {
      lines.push(clean(segment.summary));
    }
  }
  const prompt = lines.join('\n').trim() || readableText;
  return prompt.length > 22000 ? `${prompt.slice(0, 22000)}\n\n[Transcript trimmed to fit the model context.]` : prompt;
}

function answerFromTranscript(question: string, segments: ChatSegment[], readableText = '') {
  const ranked = rankUnits(question, segments, readableText);
  const count = wantedCount(question);
  const selected = ranked.slice(0, Math.max(1, Math.min(count, ranked.length)));
  const citations = citationsFromUnits(selected);
  if (!selected.length) {
    return {
      answer: 'I could not find enough transcript text to answer that. Try generating a transcript first or ask a more specific question.',
      citations: [],
      suggestions: ['Summarize the video', 'What are the key takeaways?', 'List the main steps'],
      provider: 'local',
    };
  }

  const listLike = /\blist\b|\bthings\b|\bsteps\b|\bitems\b|\bwhat are\b|\bwhat should\b/i.test(question);
  const answer = listLike
    ? `Based only on the transcript, here are the most relevant items I found:\n\n${selected.map((unit, index) => `${index + 1}. ${unit.text}`).join('\n')}`
    : `Based only on the transcript: ${selected.map((unit) => unit.text).join(' ')}`;

  return {
    answer,
    citations,
    suggestions: ['What are the key takeaways?', 'Turn this into a checklist', 'Where does the video talk about setup?'],
    provider: 'local',
  };
}

async function answerWithGroq(question: string, title: string, segments: ChatSegment[], readableText = '') {
  if (!process.env.GROQ_API_KEY) return null;
  const ranked = rankUnits(question, segments, readableText);
  const citations = citationsFromUnits(ranked);
  const transcript = transcriptForPrompt(segments, readableText);
  if (!transcript) return null;

  const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 1100,
      messages: [
        {
          role: 'system',
          content: 'You are the AI chat for Transcript Outliner. Answer using only the provided YouTube transcript. If the answer is not in the transcript, say you cannot find it in the transcript. Be specific and useful. If the user asks for a list, checklist, steps, or numbered items, format the answer clearly with bullets or numbers. Do not invent details outside the transcript.',
        },
        {
          role: 'user',
          content: `Video title: ${title || 'Untitled video'}\n\nTranscript:\n${transcript}\n\nQuestion: ${question}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Groq failed with ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const data = await response.json();
  const answer = clean(data?.choices?.[0]?.message?.content || '');
  if (!answer) throw new Error('Groq returned an empty answer.');
  return {
    answer,
    citations,
    suggestions: ['What are the key takeaways?', 'Turn this into a checklist', 'Where does the video talk about setup?'],
    provider: 'groq',
    model: GROQ_MODEL,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const question = clean(body.question);
  const segments = Array.isArray(body.segments) ? body.segments as ChatSegment[] : [];
  const readableText = clean(body.readableText || '');
  const title = clean(body.title || 'Transcript');
  if (!question) return Response.json({ error: 'Ask a question about the video first.' }, { status: 400 });
  if (!segments.length && !readableText) return Response.json({ error: 'Generate a transcript before asking questions.' }, { status: 400 });

  try {
    const groqAnswer = await answerWithGroq(question, title, segments, readableText);
    if (groqAnswer) return Response.json({ question, title, ...groqAnswer });
  } catch (error) {
    const fallback = answerFromTranscript(question, segments, readableText);
    return Response.json({ question, title, ...fallback, provider: 'local-fallback', providerError: error instanceof Error ? error.message : String(error) });
  }

  return Response.json({ question, title, ...answerFromTranscript(question, segments, readableText) });
}
