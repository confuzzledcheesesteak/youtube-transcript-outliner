# Transcript Outliner

A polished web app that turns a YouTube link into an outlined, segmented transcript. Instead of dumping raw captions on a page, it groups transcript lines into timestamped sections with titles, summaries, an outline, and copy/download options.

## Live app

Deployment URL: https://youtube-transcript-outliner.vercel.app

GitHub repository: https://github.com/confuzzledcheesesteak/youtube-transcript-outliner

## Features

- Paste a YouTube URL and fetch public captions server-side.
- Clean, responsive interface inspired by Vercel/Geist design patterns.
- Timestamp-preserving transcript output.
- Automatic topic-style segmentation into sections.
- Section title, timestamp range, summary, keywords, and transcript lines for every segment.
- Copy or download the outlined transcript as Markdown.
- Manual transcript fallback mode for videos where captions are unavailable or blocked.
- Clear error states for invalid URLs, unavailable videos, disabled captions, and cloud/IP blocking.

## Tech stack

- Next.js App Router
- React
- TypeScript
- `youtube-transcript` for public caption fetching
- Vercel for deployment
- GitHub as the source of truth

## How it works

1. The app extracts the YouTube video ID from normal YouTube URLs, short links, Shorts, embeds, live URLs, or raw video IDs.
2. A Next.js API route fetches public captions server-side.
3. The transcript is normalized while preserving timestamps.
4. Captions are grouped into readable sections using duration, pauses, sentence boundaries, and transcript length.
5. Each section receives a lightweight title, summary, keywords, and timestamp range.
6. The final result is rendered as an outline, segmented transcript, and downloadable Markdown.

## Running locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Building

```bash
npm run build
npm start
```

## Known limitations

- YouTube captions are only available when the video exposes public captions or auto-captions.
- Some videos disable transcripts, are private, age-restricted, region-restricted, or otherwise unavailable.
- YouTube can block transcript requests from datacenter/serverless IP ranges, including Vercel. When that happens, the manual transcript fallback still works.
- Auto-generated captions can contain speech-recognition errors.
- Section titles and summaries are deterministic and based only on transcript text; the app does not fabricate missing transcript content.
- This app does not download video/audio or perform speech-to-text itself.

## Research notes

Existing transcript tools usually support URL paste, timestamps, exports, and summaries. Libraries such as `youtube-transcript`, `youtube-transcript-api`, and `yt-dlp` can extract captions, but most rely on YouTube's public/undocumented caption endpoints and may be blocked from cloud IPs. This app chooses a simple Next.js + Vercel path for free deployment, while adding manual transcript mode as the practical fallback for unavailable captions or production blocking.

## License

MIT


## Self-hosted transcript proxy

Some YouTube videos expose transcripts in the YouTube UI but block transcript requests from Vercel/datacenter IPs with `LOGIN_REQUIRED` bot checks. This repo includes a small optional proxy in `self-hosted-proxy/` that can run on a Raspberry Pi or other trusted machine and expose `POST /transcript` via Cloudflare Tunnel.

Current production build falls back to `TRANSCRIPT_PROXY_URL` when direct Vercel extraction fails. If no environment variable is set, the API route has a Cloudflare quick-tunnel fallback URL embedded for the current Hermes Pi tunnel. Quick tunnels are convenient but not permanent; for production, replace it with a named Cloudflare Tunnel URL or another stable self-hosted endpoint.

Local proxy commands:

```bash
cd self-hosted-proxy
npm install
PORT=3791 npm start
```

Expected endpoints:

- `GET /health`
- `POST /transcript` with `{ "url": "https://www.youtube.com/watch?v=..." }` or `{ "videoId": "..." }`
