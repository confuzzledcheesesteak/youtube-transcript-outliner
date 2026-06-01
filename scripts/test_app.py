import json
import subprocess
import time
import urllib.request
import urllib.error

server = subprocess.Popen(['npx', 'next', 'start', '-H', '127.0.0.1', '-p', '3000'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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

    def post(path, payload):
        data = json.dumps(payload).encode()
        req = urllib.request.Request('http://127.0.0.1:3000' + path, data=data, headers={'content-type': 'application/json'}, method='POST')
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
