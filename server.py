#!/usr/bin/env python3
"""Local listening with phoneme-driven, silent mouth animation."""
import argparse
import json
import math
import time
import signal
from urllib.parse import urlsplit, parse_qs
from audio_runtime import AudioArchive, WhisperEngine, audio_features
from mouth_plan import plan
from agent_runtime import LocalAgent
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        if urlsplit(self.path).path not in ('/api/status', '/api/room'):
            super().log_message(format, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def respond(self, payload, status=200):
        encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/status':
            self.respond({'stage': 3, 'engine': self.server.engine.status(), 'agent': self.server.agent.status(), 'archive': self.server.archive.today()})
        elif path == '/api/events':
            self.respond({'events': self.server.archive.recent()})
        elif path == '/api/decisions':
            self.respond({'decisions': self.server.archive.decisions()})
        elif path in ('/', '/index.html', '/app.js', '/agent.js', '/listening.js', '/audio-capture.js', '/listening.css', '/assets/portrait.png'):
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        if urlsplit(self.path).path in ('/', '/index.html', '/app.js', '/agent.js', '/listening.js', '/audio-capture.js', '/listening.css', '/assets/portrait.png'):
            super().do_HEAD()
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlsplit(self.path)
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            self.respond({'error': 'Only the local app can submit recordings.'}, 403)
            return
        if parsed.path not in ('/api/plan', '/api/audio', '/api/room', '/api/engine/start', '/api/agent/start', '/api/agent/decide', '/api/agent/test'):
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            maximum = 500000 if parsed.path == '/api/audio' else 16000
            if not 0 < size <= maximum:
                raise ValueError('Invalid request size.')
            payload = self.rfile.read(size)
            if parsed.path == '/api/audio':
                self.handle_audio(payload, parse_qs(parsed.query))
                return
            data = json.loads(payload)
            if not isinstance(data, dict):
                raise ValueError('Expected an object.')
            if parsed.path == '/api/plan':
                if not isinstance(data.get('text'), str):
                    raise ValueError('Text is required.')
                result = plan(data['text'], data.get('speed', 1))
            elif parsed.path == '/api/engine/start':
                self.server.engine.start()
                result = self.server.engine.status()
            elif parsed.path == '/api/agent/start':
                self.server.agent.start()
                result = self.server.agent.status()
            elif parsed.path in ('/api/agent/decide', '/api/agent/test'):
                if parsed.path == '/api/agent/test':
                    phrase = data.get('text')
                    if not isinstance(phrase, str) or not 1 <= len(phrase.strip()) <= 500:
                        raise ValueError('Enter a test message of 1–500 characters.')
                    event = self.server.archive.save({'kind': 'text_input', 'source': 'text-test',
                                                     'text': phrase.strip(), 'session': 'text-test'})
                else:
                    event_id = data.get('event_id')
                    if not isinstance(event_id, str):
                        raise ValueError('An archived sound event ID is required.')
                    event = self.server.archive.get(event_id)
                    if not event:
                        raise ValueError('Sound event not found.')
                result = self.server.agent.decide(event, data.get('threshold'))
            else:
                features = {}
                for key, low, high in [('rms_dbfs', -100, 1), ('peak_dbfs', -100, 1), ('brightness_hz', 0, 24000)]:
                    value = float(data.get(key, low))
                    if not math.isfinite(value) or not low <= value <= high:
                        raise ValueError('Invalid room feature: ' + key)
                    features[key] = round(value, 2)
                result = self.server.archive.save({'kind': 'room', 'features': features, 'session': str(data.get('session', ''))[:64]})
            self.respond(result)
        except (ValueError, KeyError, TypeError) as error:
            self.respond({'error': str(error)}, 400)
        except Exception as error:
            print('Request failed:', str(error), flush=True)
            self.respond({'error': 'Local processing failed. Check the app terminal.'}, 500)

    def handle_audio(self, payload, query):
        language = query.get('language', ['auto'])[0]
        source = query.get('source', ['candidate'])[0]
        if language not in ('auto', 'en', 'zh') or source not in ('candidate', 'ambient', 'file'):
            raise ValueError('Unsupported language or audio source.')
        features = audio_features(payload)
        engine = self.server.engine
        if not engine.inference_lock.acquire(blocking=False):
            self.respond({'error': 'Speech worker is busy. This clip was not archived.'}, 429)
            return
        try:
            began = time.monotonic()
            event = {'source': source, 'session': query.get('session', [''])[0][:64], 'features': features,
                     'model': 'whisper-small', 'vad': 'silero-v6.2.0', 'language_mode': language}
            if features['rms_dbfs'] < -65:
                event.update(kind='silence', text='', language=None)
            else:
                try:
                    result = engine.transcribe(payload, language)
                    event.update(result, kind='speech' if result['text'] else 'environment')
                except Exception as error:
                    event.update(kind='error', text='', error=str(error), language=None)
            event['processing_seconds'] = round(time.monotonic() - began, 2)
            saved = self.server.archive.save(event, payload)
            self.respond(saved, 503 if event['kind'] == 'error' else 200)
        finally:
            engine.inference_lock.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        raise SystemExit(f'Cannot start on port {args.port}: {error}. Close the previous app terminal and try again.')
    server.engine = WhisperEngine(ROOT)
    server.archive = AudioArchive(args.data_dir)
    server.agent = LocalAgent(ROOT, server.archive)
    server.engine.start()
    server.agent.start()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    print(f'Afterimage · Listening: http://127.0.0.1:{server.server_port}', flush=True)
    print('Microphone starts only when you click Start listening. Archive: ' + str(args.data_dir), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.engine.close()
        server.agent.close()
