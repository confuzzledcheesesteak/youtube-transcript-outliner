import json
import os
import subprocess
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = '3017'
GROQ_PORT = 3027
BASE = 'http://127.0.0.1:' + PORT

class MockGroqHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        body = json.loads(self.rfile.read(length).decode() or '{}')
        assert self.headers.get('authorization') == 'Bearer test-groq-key'
        assert body.get('model') == 'llama-3.3-70b-versatile'
        transcript_prompt = json.dumps(body.get('messages', []))
        assert 'transcript segmentation test' in transcript_prompt.lower()
        payload = {
            'choices': [{
                'message': {
                    'content': 'Groq mocked answer: the setup steps are hello, transcript segmentation test, and outline creation.'
                }
            }]
        }
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass

groq_server = HTTPServer(('127.0.0.1', GROQ_PORT), MockGroqHandler)
groq_thread = threading.Thread(target=groq_server.serve_forever, daemon=True)
groq_thread.start()

env = os.environ.copy()
env['GROQ_API_KEY'] = 'test-groq-key'
env['GROQ_API_BASE'] = f'http://127.0.0.1:{GROQ_PORT}/openai/v1'
env['GROQ_MODEL'] = 'llama-3.3-70b-versatile'
server = subprocess.Popen(['npx', 'next', 'start', '-H', '127.0.0.1', '-p', PORT], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
try:
    ready = False
    logs = []
    start = time.time()
    while time.time() - start < 25:
        line = server.stdout.readline()
        if line:
            logs.append(line.rstrip())
            if 'Ready' in line:
                ready = True
                break
        if server.poll() is not None:
            break
    if not ready:
        raise SystemExit('Server did not become ready. Logs:\n' + '\n'.join(logs))

    with urllib.request.urlopen(BASE, timeout=10) as resp:
        html = resp.read().decode()
    assert 'AI summary' in html
    assert 'clean paragraph transcript' in html
    assert 'Ask the video' in html
    assert 'How it handles captions' not in html
    assert 'Primary path' not in html
    assert 'Designed around YouTube' not in html
    assert 'View:' in html

    def post(path, payload):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(BASE + path, data=data, headers={'content-type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=35) as resp:
                return resp.status, json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {'raw': body}
            return e.code, parsed

    manual_status, manual_data = post('/api/manual', {'title': 'Manual smoke test', 'transcript': '[0:00] Hello and welcome.\n[0:10] This is a transcript segmentation test.\n[0:25] It should create an outline and transcript lines.'})
    print('MANUAL_STATUS', manual_status)
    print('MANUAL_SECTIONS', len(manual_data.get('segments', [])))
    print('MANUAL_TITLE', manual_data.get('title'))
    readable_text = manual_data.get('readableText', '')
    ai_summary = manual_data.get('aiSummary', {})
    print('MANUAL_READABLE_HAS_TIMESTAMPS', '[' in readable_text or '0:00' in readable_text)
    print('MANUAL_READABLE_TEXT', readable_text)
    print('MANUAL_AI_OVERVIEW', ai_summary.get('overview'))
    print('MANUAL_AI_PARTS', len(ai_summary.get('parts', [])))
    assert readable_text == 'Hello and welcome. This is a transcript segmentation test. It should create an outline and transcript lines.'
    assert ai_summary.get('overview')
    assert len(ai_summary.get('parts', [])) == len(manual_data.get('segments', []))
    assert all(part.get('range') and part.get('summary') for part in ai_summary.get('parts', []))

    chat_status, chat_data = post('/api/chat', {
        'question': 'What are the setup steps?',
        'title': manual_data.get('title'),
        'segments': manual_data.get('segments'),
        'readableText': manual_data.get('readableText')
    })
    print('CHAT_STATUS', chat_status)
    print('CHAT_PROVIDER', chat_data.get('provider'))
    print('CHAT_ANSWER', chat_data.get('answer'))
    print('CHAT_CITATIONS', len(chat_data.get('citations', [])))
    assert chat_status == 200
    assert chat_data.get('provider') == 'groq'
    assert 'groq mocked answer' in chat_data.get('answer', '').lower()
    assert chat_data.get('citations')

    yt_status, yt_data = post('/api/transcript', {'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})
    print('YOUTUBE_STATUS', yt_status)
    if yt_status == 200:
        print('YOUTUBE_TITLE', yt_data.get('title'))
        print('YOUTUBE_SECTIONS', len(yt_data.get('segments', [])))
        print('YOUTUBE_LINES', yt_data.get('transcriptCount'))
    else:
        print('YOUTUBE_ERROR', yt_data.get('error'))
        print('YOUTUBE_DETAIL', yt_data.get('detail'))
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    groq_server.shutdown()
