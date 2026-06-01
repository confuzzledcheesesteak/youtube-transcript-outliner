'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Clipboard, Download, FileText, Layers3, Loader2, MessageSquareText, Play, RefreshCw, Sparkles, Wand2 } from 'lucide-react';

type Line = { text: string; offset: number; duration: number; time: string };
type Segment = { id: string; title: string; summary: string; start: number; end: number; range: string; keywords: string[]; lines: Line[] };
type Result = {
  videoId: string | null; url: string | null; title: string; author: string | null; thumbnail: string | null;
  durationLabel: string; transcriptCount: number; wordCount: number; languageNote: string;
  outline: Array<{ id: string; title: string; range: string; summary: string; keywords: string[] }>;
  segments: Segment[]; fullText: string; readableText?: string;
  aiSummary?: { overview: string; parts: Array<{ title: string; range: string; summary: string; keywords: string[] }> };
};

const EXAMPLE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SAMPLE_TRANSCRIPT = `[0:00] Welcome back. Today we are going to break down how a clean transcript can become a useful outline.\n[0:10] First, preserve the timestamps because they let readers jump back to the exact moment in the video.\n[0:22] Next, group nearby captions into sections based on topic shifts and natural pauses.\n[0:36] Each section should have a title, a short summary, and the original transcript text.\n[0:48] Finally, make the result easy to copy, download, and scan on a phone or laptop.`;

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function summaryParts(result: Result) {
  return result.aiSummary?.parts?.length
    ? result.aiSummary.parts
    : result.segments.map((segment) => ({ title: segment.title, range: segment.range, summary: segment.summary, keywords: segment.keywords || [] }));
}

function summaryOverview(result: Result) {
  return result.aiSummary?.overview || result.segments.map((segment) => segment.summary).filter(Boolean).join(' ') || 'Summary unavailable.';
}

function cleanReadableText(result: Result) {
  return result.readableText || result.segments.map((s) => s.lines.map((l) => l.text).join(' ')).join(' ');
}

function resultAsMarkdown(result: Result) {
  return `# ${result.title}

Author: ${result.author || 'Unknown'}
Duration: ${result.durationLabel}
Words: ${result.wordCount}

## AI summary
${summaryOverview(result)}

${summaryParts(result).map((part, i) => `${i + 1}. **${part.title}** (${part.range}) — ${part.summary}`).join('\n')}

## Clean paragraph transcript
${cleanReadableText(result)}

## Outline
${result.outline.map((s, i) => `${i + 1}. **${s.title}** (${s.range}) — ${s.summary}`).join('\n')}

## Segmented transcript
${result.segments.map((s) => `### ${s.title} (${s.range})
${s.summary}

${s.lines.map((l) => `[${l.time}] ${l.text}`).join('\n')}`).join('\n\n')}
`;
}
export default function Home() {
  const [mode, setMode] = useState<'youtube' | 'manual'>('youtube');
  const [url, setUrl] = useState('');
  const [manual, setManual] = useState('');
  const [manualTitle, setManualTitle] = useState('Manual transcript');
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'ok' | 'warn'; text: string } | null>({ kind: 'info', text: 'Paste a YouTube URL or use manual mode if captions are unavailable.' });
  const [loading, setLoading] = useState(false);

  const markdown = useMemo(() => result ? resultAsMarkdown(result) : '', [result]);

  async function submit() {
    setLoading(true); setResult(null); setStatus({ kind: 'info', text: mode === 'youtube' ? 'Fetching captions from YouTube and building topic sections…' : 'Parsing your pasted transcript and creating sections…' });
    try {
      const endpoint = mode === 'youtube' ? '/api/transcript' : '/api/manual';
      const body = mode === 'youtube' ? { url } : { transcript: manual, title: manualTitle };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data); setStatus({ kind: 'ok', text: `Created ${data.outline.length} timestamped sections from ${data.transcriptCount} caption lines.` });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setLoading(false); }
  }

  function copyMarkdown() {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown);
    setStatus({ kind: 'ok', text: 'Copied outlined transcript as Markdown.' });
  }

  return (
    <main className="page">
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand"><div className="logo">▶</div> Transcript Outliner</div>
          <div className="nav-links"><a href="#tool">Tool</a><a href="#summary">AI Summary</a><a href="#clean-transcript">Clean transcript</a><a href="#outline">Outline</a><a href="#limits">Limitations</a></div>
        </div>
      </nav>

      <section className="hero">
        <div className="badge-row"><span className="badge">YouTube captions → study notes</span><span className="badge pink">Timestamped sections</span><span className="badge red">Manual fallback</span></div>
        <h1>Turn a YouTube video into an outlined transcript.</h1>
        <p>Paste a link and get clean chapters, an AI-style summary of each part, a timestamp-free paragraph transcript, copyable Markdown, and downloadable notes. No word soup.</p>
      </section>

      <section id="tool" className="app-shell">
        <div className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">Generate transcript outline</h2><p className="panel-sub">Fetch public captions or paste your own transcript.</p></div>
            <div className="toggle"><button className={mode === 'youtube' ? 'active' : ''} onClick={() => setMode('youtube')}>YouTube URL</button><button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Manual</button></div>
          </div>
          <div className="panel-pad input-wrap">
            {mode === 'youtube' ? <>
              <input className="url-input" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
              <div className="actions"><button className="btn btn-primary" disabled={loading || !url.trim()} onClick={submit}>{loading ? <span className="loader"/> : <Wand2 size={17}/>} Generate transcript</button><button className="btn btn-ghost" onClick={() => setUrl(EXAMPLE)}><Play size={16}/>Try example URL</button></div>
            </> : <>
              <input className="url-input" placeholder="Title for pasted transcript" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
              <textarea className="manual-input" placeholder="Paste transcript lines. Timestamps like [3:24] are preserved; plain lines also work." value={manual} onChange={(e) => setManual(e.target.value)} />
              <div className="actions"><button className="btn btn-primary" disabled={loading || !manual.trim()} onClick={submit}>{loading ? <span className="loader"/> : <Sparkles size={17}/>} Outline pasted text</button><button className="btn btn-ghost" onClick={() => setManual(SAMPLE_TRANSCRIPT)}><FileText size={16}/>Load sample</button></div>
            </>}
            {status && <div className={`status ${status.kind}`}>{status.kind === 'error' ? <AlertTriangle size={18}/> : status.kind === 'ok' ? <CheckCircle2 size={18}/> : loading ? <Loader2 size={18}/> : <BookOpen size={18}/>}<span>{status.text}</span></div>}
            <div className="feature-grid">
              <div className="feature"><Layers3 size={18}/><strong>Segmented</strong><span>Groups captions into scan-friendly sections with timestamp ranges.</span></div>
              <div className="feature"><Sparkles size={18}/><strong>AI summary</strong><span>Highlights the main idea and summarizes each part of the video.</span></div>
              <div className="feature"><MessageSquareText size={18}/><strong>Clean transcript</strong><span>Shows the transcript as normal paragraphs without noisy timestamps.</span></div>
            </div>
          </div>
        </div>

        <aside className="panel">
          <div className="panel-head"><div><h2 className="panel-title">How it handles captions</h2><p className="panel-sub">Designed around YouTube’s real-world limits.</p></div></div>
          <div className="panel-pad meta-grid" id="limits">
            <div className="meta-card"><div className="meta-label">Primary path</div><div className="meta-value">Public YouTube captions</div><p className="tiny">Uses server-side caption fetching so browsers do not hit CORS issues.</p></div>
            <div className="meta-card"><div className="meta-label">Fallback</div><div className="meta-value">Manual transcript mode</div><p className="tiny">If a video has captions disabled or YouTube blocks cloud requests, paste subtitles/transcript text directly.</p></div>
            <div className="meta-card"><div className="meta-label">Output</div><div className="meta-value">Summary + clean transcript + Markdown</div><p className="tiny">No fabricated transcript text. Summaries are based only on returned or pasted captions.</p></div>
          </div>
        </aside>
      </section>

      <section className="results" id="outline">
        {!result && <div className="panel empty"><Sparkles size={28}/><h2>Your outlined transcript will appear here.</h2><p>Expect a video header, AI summary, clean paragraph transcript, clickable outline, and timestamped transcript lines.</p></div>}
        {result && <>
          <div className="panel panel-pad video-head">
            <div><h2 className="video-title">{result.title}</h2><div className="kpis"><span className="kpi">{result.author || 'Unknown author'}</span><span className="kpi">{result.durationLabel}</span><span className="kpi">{result.wordCount.toLocaleString()} keywords/words</span><span className="kpi">{result.transcriptCount} caption lines</span></div><p className="tiny">{result.languageNote}</p></div>
            <div className="actions"><button className="btn btn-blue" onClick={copyMarkdown}><Clipboard size={16}/>Copy Markdown</button><button className="btn btn-ghost" onClick={() => downloadText('transcript-outline.md', markdown)}><Download size={16}/>Download</button><button className="btn btn-ghost" onClick={() => { setResult(null); setStatus({ kind: 'info', text: 'Ready for another video.' }); }}><RefreshCw size={16}/>Reset</button></div>
          </div>
          <div className="section-grid">
            <aside className="outline panel panel-pad"><div className="meta-label">Jump to</div><a href="#summary"><time>Overview</time>AI summary</a><a href="#clean-transcript"><time>No timestamps</time>Clean paragraph transcript</a>{result.outline.map((s) => <a key={s.id} href={`#${s.id}`}><time>{s.range}</time>{s.title}</a>)}</aside>
            <div className="segments">
              <article className="segment summary-panel" id="summary"><div className="segment-top"><h3>AI summary</h3><span className="time-pill">{result.durationLabel}</span></div><div className="summary overview">{summaryOverview(result)}</div><div className="part-list">{summaryParts(result).map((part, i) => <div className="part-card" key={`${part.range}-${i}`}><div><strong>{part.title}</strong><time>{part.range}</time></div><p>{part.summary}</p>{part.keywords?.length ? <div className="keyword-row">{part.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}</div>)}</div></article>
              <article className="segment" id="clean-transcript"><div className="segment-top"><h3>Clean paragraph transcript</h3><span className="time-pill">No timestamps</span></div><div className="readable-transcript">{cleanReadableText(result).split(/(?<=[.!?])\s+/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div></article>
              {result.segments.map((segment) => <article className="segment" id={segment.id} key={segment.id}><div className="segment-top"><h3>{segment.title}</h3><span className="time-pill">{segment.range}</span></div><div className="summary">{segment.summary}</div><div className="transcript">{segment.lines.map((line, i) => <p className="caption-line" key={`${segment.id}-${i}`}><time>{line.time}</time>{line.text}</p>)}</div></article>)}
            </div>
          </div>
        </>}
      </section>

      <footer className="footer">Built as a free, public Next.js + Vercel app. YouTube captions are only available when the video exposes them; serverless hosts may occasionally be blocked by YouTube, so manual mode is included as a reliable fallback.</footer>
    </main>
  );
}
