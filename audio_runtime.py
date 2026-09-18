"""Local Whisper worker and dated audio/event archive. No cloud API calls."""
import array
import datetime as dt
import io
import json
import math
import os
import re
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.request
import uuid
import wave
from pathlib import Path


class AudioArchive:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, day TEXT, created_at TEXT, kind TEXT, payload TEXT)')
            db.execute('CREATE INDEX IF NOT EXISTS events_date ON events(day, created_at)')

    def connect(self):
        return sqlite3.connect(str(self.root / 'events.sqlite3'), timeout=10)

    def save(self, event, audio=None):
        now = dt.datetime.now().astimezone()
        event = {**event, 'id': uuid.uuid4().hex, 'created_at': now.isoformat(), 'day': now.date().isoformat(), 'schema': 1}
        directory = self.root / event['day']
        directory.mkdir(exist_ok=True)
        if audio:
            name = event['id'] + '.wav'
            (directory / name).write_bytes(audio)
            event['audio'] = event['day'] + '/' + name
        payload = json.dumps(event, ensure_ascii=False, allow_nan=False)
        with self.lock:
            with self.connect() as db:
                db.execute('INSERT INTO events VALUES (?,?,?,?,?)', (event['id'], event['day'], event['created_at'], event['kind'], payload))
            with (directory / 'events.jsonl').open('a', encoding='utf-8') as output:
                output.write(payload + '\n')
        return event

    def recent(self):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM events WHERE kind IN ('audio','speech','environment','silence','error') ORDER BY created_at DESC LIMIT 20").fetchall()
        return [json.loads(row[0]) for row in rows]

    def get(self, event_id):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM events WHERE id=?', (event_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def decisions(self):
        with self.connect() as db:
            rows = db.execute("SELECT payload FROM events WHERE kind='decision' ORDER BY created_at DESC LIMIT 20").fetchall()
        return [json.loads(row[0]) for row in rows]

    def decision_for(self, source_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM events WHERE kind='decision' AND json_extract(payload, '$.source_id')=? ORDER BY created_at DESC LIMIT 1", (source_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def agent_memory(self, session, prompt_version=None, language=None):
        if not session:
            return []
        memory = []
        for decision in self.decisions():
            if language is not None and decision.get('language') != language:
                continue
            if prompt_version is not None and decision.get('prompt_version') != prompt_version:
                continue
            if decision.get('session') != session or decision.get('source') == 'text-test' or decision['action'] != 'speak':
                continue
            source = self.get(decision['source_id'])
            if source:
                memory.append({'heard': source.get('text', ''), 'generated_reply': decision['text']})
            if len(memory) == 4:
                break
        return memory[::-1]

    def today(self):
        day = dt.datetime.now().astimezone().date().isoformat()
        with self.connect() as db:
            rows = db.execute('SELECT kind, count(*) FROM events WHERE day=? GROUP BY kind', (day,)).fetchall()
        return {'day': day, 'counts': dict(rows)}


def audio_features(payload):
    try:
        with wave.open(io.BytesIO(payload), 'rb') as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                raise ValueError('Audio must be mono PCM16 WAV at 16 kHz.')
            count = audio.getnframes()
            if not 4000 <= count <= 240000:
                raise ValueError('Audio clips must be 0.25–15 seconds long.')
            pcm = audio.readframes(count)
            if len(pcm) != count * 2:
                raise ValueError('Truncated WAV data.')
    except (wave.Error, EOFError) as error:
        raise ValueError('Invalid WAV audio.') from error
    samples = array.array('h', pcm)
    if os.sys.byteorder != 'little':
        samples.byteswap()
    rms = math.sqrt(sum(x * x for x in samples) / len(samples)) / 32768
    peak = max(abs(x) for x in samples) / 32768
    crossing = sum((a < 0) != (b < 0) for a, b in zip(samples, samples[1:])) / len(samples)
    frames = [math.sqrt(sum(x * x for x in samples[i:i + 1600]) / len(samples[i:i + 1600])) / 32768
              for i in range(0, len(samples), 1600)]
    variation = (max(frames) - min(frames)) / max(rms, 1e-6)
    return {'duration': round(len(samples) / 16000, 3), 'rms_dbfs': round(20 * math.log10(max(rms, 1e-5)), 1),
            'peak_dbfs': round(20 * math.log10(max(peak, 1e-5)), 1), 'zero_crossing_rate': round(crossing, 4),
            'texture': 'changing' if variation > 1.5 else 'steady'}


class WhisperEngine:
    def __init__(self, root):
        self.root = Path(root)
        self.process = None
        self.log = None
        self.state = 'idle'
        self.error = ''
        self.port = None
        self.start_lock = threading.Lock()
        self.inference_lock = threading.Lock()
        self.closed = False
        self.backend = 'Metal'

    def start(self):
        with self.start_lock:
            if self.state in ('loading', 'ready') or self.closed:
                return
            self.state, self.error = 'loading', ''
            threading.Thread(target=self._boot, daemon=True).start()

    def _boot(self):
        binary = self.root / 'vendor/whisper.cpp/build/bin/whisper-server'
        model = self.root / 'models/ggml-small.bin'
        vad = self.root / 'models/ggml-silero-v6.2.0.bin'
        try:
            if not all(p.is_file() for p in (binary, model, vad)):
                raise RuntimeError('Local speech components are missing. Run Setup.command first.')
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                self.port = reservation.getsockname()[1]
            (self.root / 'data').mkdir(exist_ok=True)
            self.log = (self.root / 'data/whisper.log').open('w')
            args = [str(binary), '-m', str(model), '--host', '127.0.0.1', '--port', str(self.port),
                    '-l', 'auto', '-t', '4', '-bs', '1', '-bo', '1', '-nf', '-nlp',
                    '--vad', '-vm', str(vad), '-vt', '0.6', '-vp', '180', '-vsd', '350']
            if self.backend == 'CPU':
                args.append('-ng')
            with self.start_lock:
                if self.closed:
                    return
                self.process = subprocess.Popen(args, cwd=self.root, stdout=self.log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline and not self.closed:
                if self.process.poll() is not None:
                    log_text = (self.root / 'data/whisper.log').read_text(errors='replace')
                    if self.backend == 'Metal' and ('Metal buffer' in log_text or 'ggml_metal' in log_text):
                        self.backend = 'CPU'
                        self.log.close()
                        return self._boot()
                    raise RuntimeError('The local speech worker exited. See data/whisper.log.')
                try:
                    with urllib.request.urlopen(self.url + '/health', timeout=1) as response:
                        if response.status == 200:
                            self.state = 'ready'
                            return
                except (OSError, ValueError):
                    time.sleep(.3)
            if not self.closed:
                raise RuntimeError('Speech model loading timed out. See data/whisper.log.')
        except Exception as error:
            self.state, self.error = 'error', str(error)
            if self.process and self.process.poll() is None:
                self.process.terminate()

    @property
    def url(self):
        return 'http://127.0.0.1:' + str(self.port)

    def status(self):
        if self.state == 'ready' and self.process and self.process.poll() is not None:
            self.state, self.error = 'error', 'The speech worker stopped. Restart the local app.'
        return {'state': self.state, 'error': self.error, 'model': 'Whisper small · multilingual', 'vad': 'Silero 6.2', 'backend': self.backend, 'local': True}

    def transcribe(self, audio, language):
        if self.status()['state'] != 'ready':
            raise RuntimeError(self.error or 'The local speech model is still loading.')
        boundary = 'afterimage-' + uuid.uuid4().hex
        body = []
        fields = {'language': language, 'response_format': 'verbose_json', 'temperature': '0',
                  'temperature_inc': '0', 'translate': 'false', 'no_context': 'true',
                  'no_language_probabilities': 'true', 'token_timestamps': 'false', 'vad': 'true'}
        for key, value in fields.items():
            body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        body.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
        body.extend([audio, f'\r\n--{boundary}--\r\n'.encode()])
        request = urllib.request.Request(self.url + '/inference', data=b''.join(body),
                                         headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        accepted = []
        for segment in result.get('segments', []):
            text = segment.get('text', '').strip()
            if segment.get('no_speech_prob', 0) > .65 or segment.get('avg_logprob', 0) < -1.1:
                continue
            if not text or re.fullmatch(r'[\[（(].*?[\]）)]', text):
                continue
            accepted.append(text)
        text = ' '.join(accepted).strip()
        detected = result.get('language', '').lower()
        detected = {'english': 'en', 'chinese': 'zh', 'mandarin': 'zh'}.get(detected, detected)
        return {'text': text, 'language': detected if text else None,
                'raw_text': result.get('text', '').strip(), 'segments': result.get('segments', [])}

    def close(self):
        with self.start_lock:
            self.closed = True
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.log:
            self.log.close()
