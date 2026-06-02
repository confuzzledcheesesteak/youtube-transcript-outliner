'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, Download, FileText, Loader2, MessageSquareText, Play, RefreshCw, Send, Sparkles, Wand2 } from 'lucide-react';

type Line = { text: string; offset: number; duration: number; time: string };
type Segment = { id: string; title: string; summary: string; start: number; end: number; range: string; keywords: string[]; lines: Line[] };
type ChatMessage = { role: 'user' | 'assistant'; text: string; citations?: Array<{ time: string; text: string; section: string }> };
type View = 'chat' | 'summary' | 'transcript' | 'outline';

type Result = {
  videoId: string | null; url: string | null; title: string; author: string | null; thumbnail: string | null;
  durationLabel: string; transcriptCount: number; wordCount: number; languageNote: string;
  outline: Array<{ id: string; title: string; range: string; summary: string; keywords: string[] }>;
  segments: Segment[]; fullText: string; readableText: string;
  aiSummary: { overview: string; parts: Array<{ title: string; range: string; summary: string; keywords: string[] }> };
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
  return `# ${result.title}\n\nAuthor: ${result.author || 'Unknown'}\nDuration: ${result.durationLabel}\nWords: ${result.wordCount}\n\n## AI summary\n${summaryOverview(result)}\n\n${summaryParts(result).map((part, i) => `${i + 1}. **${part.title}** (${part.range}) — ${part.summary}`).join('\n')}\n\n## Clean paragraph transcript\n${cleanReadableText(result)}\n\n## Outline\n${result.outline.map((s, i) => `${i + 1}. **${s.title}** (${s.range}) — ${s.summary}`).join('\n')}\n\n## Segmented transcript\n${result.segments.map((s) => `### ${s.title} (${s.range})\n${s.summary}\n\n${s.lines.map((l) => `[${l.time}] ${l.text}`).join('\n')}`).join('\n\n')}\n`;
}

export default function Home() {
  const [mode, setMode] = useState<'youtube' | 'manual'>('youtube');
  const [view, setView] = useState<View>('chat');
  const [url, setUrl] = useState('');
  const [manual, setManual] = useState('');
  const [manualTitle, setManualTitle] = useState('Manual transcript');
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'ok' | 'warn'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const markdown = useMemo(() => result ? resultAsMarkdown(result) : '', [result]);

  async function submit() {
    setLoading(true); setResult(null); setChatMessages([]); setChatQuestion(''); setStatus({ kind: 'info', text: 'Generating…' });
    try {
      const endpoint = mode === 'youtube' ? '/api/transcript' : '/api/manual';
      const body = mode === 'youtube' ? { url } : { transcript: manual, title: manualTitle };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data); setView('chat'); setStatus({ kind: 'ok', text: 'Ready. Ask questions, read the summary, or export notes.' });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { setLoading(false); }
  }

  function copyMarkdown() {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown);
    setStatus({ kind: 'ok', text: 'Copied Markdown.' });
  }

  async function askVideo(preset?: string) {
    if (!result || chatLoading) return;
    const question = (preset || chatQuestion).trim();
    if (!question) return;
    setChatQuestion(''); setChatLoading(true);
    setChatMessages((messages) => [...messages, { role: 'user', text: question }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, title: result.title, segments: result.segments, readableText: cleanReadableText(result) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to answer from this transcript.');
      setChatMessages((messages) => [...messages, { role: 'assistant', text: data.answer, citations: data.citations || [] }]);
    } catch (error) {
      setChatMessages((messages) => [...messages, { role: 'assistant', text: error instanceof Error ? error.message : String(error) }]);
    } finally { setChatLoading(false); }
  }

  const canSubmit = mode === 'youtube' ? url.trim() : manual.trim();
  const tabs: Array<[View, string]> = [['chat', 'Ask the video'], ['summary', 'AI summary'], ['transcript', 'Clean transcript'], ['outline', 'Outline']];

  return (
    <main className="page">
      <nav className="nav"><div className="nav-inner"><div className="brand"><span className="logo">▶</span> Transcript Outliner</div><div className="nav-links"><span>View:</span><a href="#tool">Generate</a><a href="#results">Results</a></div></div></nav>

      <section className="hero compact">
        <h1>Transcript Outliner</h1>
        <p>Paste a YouTube link or transcript. Get a clean summary, searchable chat, readable transcript, and exportable notes.</p>
      </section>

      <section id="tool" className="tool-card panel">
        <div className="mode-row"><button className={mode === 'youtube' ? 'active' : ''} onClick={() => setMode('youtube')}>YouTube URL</button><button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Paste transcript</button></div>
        <div className="input-area">
          {mode === 'youtube' ? <>
            <input className="url-input" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-primary" disabled={loading || !canSubmit} onClick={submit}>{loading ? <span className="loader"/> : <Wand2 size={17}/>} Generate</button>
            <button className="btn btn-ghost" onClick={() => setUrl(EXAMPLE)}><Play size={16}/> Example</button>
          </> : <>
            <input className="url-input" placeholder="Title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
            <textarea className="manual-input" placeholder="Paste transcript text…" value={manual} onChange={(e) => setManual(e.target.value)} />
            <button className="btn btn-primary" disabled={loading || !canSubmit} onClick={submit}>{loading ? <span className="loader"/> : <Sparkles size={17}/>} Generate</button>
            <button className="btn btn-ghost" onClick={() => setManual(SAMPLE_TRANSCRIPT)}><FileText size={16}/> Sample</button>
          </>}
        </div>
        {status && <div className={`status ${status.kind}`}>{status.kind === 'error' ? <AlertTriangle size={18}/> : status.kind === 'ok' ? <CheckCircle2 size={18}/> : <Loader2 size={18}/>}<span>{status.text}</span></div>}
      </section>

      <section className="results" id="results">
        {!result && <div className="panel empty"><Sparkles size={26}/><h2>Results will appear here.</h2><p>Ask the video, read the AI summary, view the clean paragraph transcript, or open the outline.</p></div>}
        {result && <>
          <div className="panel result-head">
            <div><h2>{result.title}</h2><p>{result.author || 'Unknown author'} · {result.durationLabel} · {result.transcriptCount} lines · {result.wordCount.toLocaleString()} words</p></div>
            <div className="actions"><button className="btn btn-blue" onClick={copyMarkdown}><Clipboard size={16}/>Copy</button><button className="btn btn-ghost" onClick={() => downloadText('transcript-outline.md', markdown)}><Download size={16}/>Download</button><button className="btn btn-ghost" onClick={() => { setResult(null); setChatMessages([]); setStatus(null); }}><RefreshCw size={16}/>New</button></div>
          </div>

          <div className="view-tabs">{tabs.map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</div>

          {view === 'chat' && <article className="panel section-card" id="video-chat"><div className="section-top"><h3>Ask the video</h3><MessageSquareText size={18}/></div><div className="chat-body"><div className="chat-suggestions"><button onClick={() => askVideo('What are the main things or steps in this video?')}>List the main things</button><button onClick={() => askVideo('Turn the video into a checklist.')}>Make a checklist</button><button onClick={() => askVideo('What are the key takeaways?')}>Key takeaways</button></div><div className="chat-log">{chatMessages.length === 0 ? <div className="chat-empty">Ask anything about the transcript.</div> : chatMessages.map((message, i) => <div className={`chat-message ${message.role}`} key={i}><div className="chat-bubble">{message.text.split('\n').map((line, j) => <p key={j}>{line}</p>)}</div>{message.citations?.length ? <div className="citations">{message.citations.map((citation, j) => <div className="citation" key={`${citation.time}-${j}`}><time>{citation.time}</time><span>{citation.text}</span></div>)}</div> : null}</div>)}</div><div className="chat-input-row"><input className="url-input" placeholder="Ask something about this video…" value={chatQuestion} onChange={(e) => setChatQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') askVideo(); }} /><button className="btn btn-blue" disabled={chatLoading || !chatQuestion.trim()} onClick={() => askVideo()}>{chatLoading ? <span className="loader"/> : <Send size={16}/>}Ask</button></div></div></article>}

          {view === 'summary' && <article className="panel section-card" id="summary"><div className="section-top"><h3>AI summary</h3><span>{result.durationLabel}</span></div><p className="overview">{summaryOverview(result)}</p><div className="part-list">{summaryParts(result).map((part, i) => <div className="part-card" key={`${part.range}-${i}`}><div><strong>{part.title}</strong><time>{part.range}</time></div><p>{part.summary}</p></div>)}</div></article>}

          {view === 'transcript' && <article className="panel section-card" id="clean-transcript"><div className="section-top"><h3>Clean paragraph transcript</h3><span>No timestamps</span></div><div className="readable-transcript">{cleanReadableText(result).split(/(?<=[.!?])\s+/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div></article>}

          {view === 'outline' && <div className="outline-list" id="outline">{result.segments.map((segment) => <article className="panel section-card compact-section" id={segment.id} key={segment.id}><div className="section-top"><h3>{segment.title}</h3><span>{segment.range}</span></div><p className="summary">{segment.summary}</p><details><summary>Timestamped transcript</summary><div className="transcript">{segment.lines.map((line, i) => <p className="caption-line" key={`${segment.id}-${i}`}><time>{line.time}</time>{line.text}</p>)}</div></details></article>)}</div>}
        </>}
      </section>

      <footer className="footer">Free transcript notes powered by your video captions.</footer>
    </main>
  );
}
