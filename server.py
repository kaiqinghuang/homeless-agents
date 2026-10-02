#!/usr/bin/env python3
"""Local continuous text with phoneme-driven, silent mouth animation."""
import argparse
import json
import math
import time
import signal
from urllib.parse import urlsplit, parse_qs
from audio_runtime import AudioArchive, audio_features
from mouth_plan import plan
from agent_runtime import LocalAgent
from residue_runtime import ResidueGenerator
from residue_plan import residue_plan
from environment_monitor import EnvironmentMonitor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC_PATHS = {'/artwork-overlay.css', '/artwork-overlay.js', '/environment-monitor.js', '/assets/training-sources.json', '/', '/index.html', '/app.js', '/residue.js', '/agent.js', '/listening.js', '/audio-capture.js', '/listening.css', '/assets/portrait.png'}
STATIC_PATHS.update('/assets/' + folder + '/' + name + '.png'
    for folder in ('central-visemes-v1', 'red-eyes-visemes-v1', 'brown-face-visemes-v1', 'small-left-visemes-v1', 'lower-hood-visemes-v1', 'clay-lower-visemes-v1', 'left-profile-visemes-v1', 'upper-left-visemes-v1', 'right-large-visemes-v1', 'white-upper-visemes-v1', 'tiny-right-visemes-v1', 'ruffle-right-visemes-v1', 'upper-right-visemes-v1', 'wrapped-visemes-v1', 'far-right-visemes-v1', 'wig-left-visemes-v1', 'lower-left-visemes-v1', 'far-upper-left-visemes-v1', 'wicker-left-visemes-v1', 'far-left-visemes-v1', 'top-black-visemes-v1')
    for name in ('00-rest', '01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.add('/assets/far-right-visemes-v1/09-skew-initial.png')
STATIC_PATHS.update('/assets/red-eyes-first11/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted-initial', '04-open', '05-oh', '06-oo-initial', '07-fold', '08-skew-initial', '09-oo-expression', '10-parted-expression', '11-skew-expression', '12-wide-expression'))

STATIC_PATHS.update('/assets/lower-hood-visemes-v1/' + name + '.png' for name in ('09-wide-initial', '10-open-initial', '11-oh-initial', '12-fold-initial', '13-fold-intermediate'))

STATIC_PATHS.update('/assets/left-profile-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.update('/assets/upper-left-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.update('/assets/upper-left-visemes-v3/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))

STATIC_PATHS.update('/assets/right-large-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '05-oh', '06-oo', '07-fold', '08-skew'))

STATIC_PATHS.update('/assets/white-upper-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.update('/assets/tiny-right-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.update('/assets/ruffle-right-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))
STATIC_PATHS.update('/assets/upper-right-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))

STATIC_PATHS.update('/assets/far-upper-left-visemes-v2/' + name + '.png' for name in ('01-pressed', '02-wide', '03-parted', '04-open', '05-oh', '06-oo', '07-fold', '08-skew'))

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
        if path == '/api/environment/status':
            self.respond(self.server.monitor.status())
        elif path == '/api/environment/devices':
            try:
                self.respond({'devices': self.server.monitor.devices()})
            except Exception as error:
                self.respond({'error': str(error)}, 503)
        elif path == '/api/artwork/info':
            cfg = self.server.residue.config
            training = json.loads((ROOT / 'training/residue-qwen05-20261001/config.json').read_text())
            self.respond({'base_model': 'Qwen2.5-0.5B', 'steps': 180,
                          'learning_rate': training['learning_rate'], 'rank': training['lora_parameters']['rank'],
                          'scale': training['lora_parameters']['scale'], 'temperature': cfg['temperature'],
                          'top_p': cfg['top_p'], 'context_tokens': cfg['context_tokens']})
        elif path == '/api/residue/status':
            self.respond(self.server.residue.status())
        elif path == '/api/status':
            self.respond({'stage': 5, 'engine': self.server.agent.status(), 'agent': self.server.agent.status(), 'archive': self.server.archive.today()})
        elif path == '/api/events':
            self.respond({'events': self.server.archive.recent()})
        elif path == '/api/decisions':
            self.respond({'decisions': self.server.archive.decisions()})
        elif path in STATIC_PATHS:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        if urlsplit(self.path).path in STATIC_PATHS:
            super().do_HEAD()
        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlsplit(self.path)
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            self.respond({'error': 'Only the local app can submit recordings.'}, 403)
            return
        if parsed.path not in ('/api/environment/start', '/api/environment/stop', '/api/environment/observe', '/api/residue/start', '/api/residue/next', '/api/residue/stop', '/api/plan', '/api/audio', '/api/room', '/api/engine/start', '/api/agent/start', '/api/agent/decide', '/api/agent/test'):
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            maximum = 500000 if parsed.path in ('/api/audio', '/api/environment/observe') else 16000
            if not 0 < size <= maximum:
                raise ValueError('Invalid request size.')
            payload = self.rfile.read(size)
            if parsed.path == '/api/environment/observe':
                if self.server.agent.status()['state'] != 'ready':
                    self.respond({'error': self.server.agent.error or 'Audio model is loading.'}, 503)
                    return
                result = self.server.agent.observe(payload)
                self.respond(result, 409 if result.get('busy') else 200)
                return
            if parsed.path == '/api/audio':
                self.handle_audio(payload, parse_qs(parsed.query))
                return
            data = json.loads(payload)
            if not isinstance(data, dict):
                raise ValueError('Expected an object.')
            if parsed.path == '/api/environment/start':
                result = self.server.monitor.start(data.get('device', 'builtin'), data.get('session'))
            elif parsed.path == '/api/environment/stop':
                session = data.get('session')
                if not isinstance(session, str) or not session:
                    raise ValueError('A monitor session is required.')
                result = self.server.monitor.stop(session)
            elif parsed.path == '/api/residue/start':
                result = self.server.residue.start()
            elif parsed.path == '/api/residue/next':
                result = self.server.residue.next(data.get('session'))
            elif parsed.path == '/api/residue/stop':
                result = self.server.residue.stop(data.get('session'))
            elif parsed.path == '/api/plan':
                if not isinstance(data.get('text'), str):
                    raise ValueError('Text is required.')
                result = (residue_plan if data.get('mode') == 'residue' else plan)(data['text'], data.get('speed', 1))
            elif parsed.path == '/api/engine/start':
                self.server.agent.start()
                result = self.server.agent.status()
            elif parsed.path == '/api/agent/start':
                self.server.agent.start(restart=data.get('restart') is True)
                result = self.server.agent.status()
            elif parsed.path in ('/api/agent/decide', '/api/agent/test'):
                if parsed.path == '/api/agent/test':
                    phrase = data.get('text')
                    if not isinstance(phrase, str) or not 1 <= len(phrase.strip()) <= 500:
                        raise ValueError('Enter a test message of 1–500 characters.')
                    language = data.get('language', 'en')
                    if language != 'en':
                        raise ValueError('Environment mode uses English only.')
                    event = self.server.archive.save({'language_mode': language, 'kind': 'text_input', 'source': 'text-test',
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
        language = query.get('language', ['en'])[0]
        source = query.get('source', ['candidate'])[0]
        if language != 'en' or source not in ('candidate', 'ambient', 'file'):
            raise ValueError('Unsupported language or audio source.')
        features = audio_features(payload)
        # Archive the waveform directly; no ASR, VAD or sound-to-text conversion.
        event = {'source': source, 'session': query.get('session', [''])[0][:64],
                 'features': features, 'language_mode': language, 'language': None,
                 'kind': 'silence' if features['rms_dbfs'] < -65 else 'audio',
                 'text': '', 'transcription': False, 'processing_seconds': 0}
        self.respond(self.server.archive.save(event, payload))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        raise SystemExit(f'Cannot start on port {args.port}: {error}. Close the previous app terminal and try again.')
    server.archive = AudioArchive(args.data_dir)
    server.agent = LocalAgent(ROOT, server.archive)
    server.residue = ResidueGenerator(ROOT, args.data_dir / 'residue')
    server.monitor = EnvironmentMonitor(ROOT, server.agent)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    print(f'Afterimage · Continuous text: http://127.0.0.1:{server.server_port}', flush=True)
    print('Click Start generating. Environment monitor displays audio observations without training. Text logs: ' + str(args.data_dir / 'residue'), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.monitor.close()
        server.agent.close()
        server.residue.close()
