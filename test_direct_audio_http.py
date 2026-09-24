"""Exercise waveform upload -> direct decision -> mouth plan with no ASR worker."""
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import wave
from unittest.mock import Mock
from http.server import ThreadingHTTPServer
from server import Handler, STATIC_PATHS
from agent_runtime import LocalAgent
from audio_runtime import AudioArchive


class DirectAudioHTTPTests(unittest.TestCase):
    def test_waveform_to_decision_and_mouth(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = AudioArchive(directory)
            agent = LocalAgent(Path(__file__).resolve().parent, archive)
            agent.state = 'ready'
            agent.request = Mock(return_value={'text': json.dumps({'respond': True, 'salience': .9,
                'text': 'I can hear you.', 'reason': 'addressed'}), 'tokens': 30})
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.archive, server.agent = archive, agent
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = 'http://127.0.0.1:' + str(server.server_port)
            def post(path, data, content_type='application/json'):
                payload = data if isinstance(data, bytes) else json.dumps(data).encode()
                request = urllib.request.Request(url + path, data=payload, headers={'Content-Type': content_type})
                with urllib.request.urlopen(request) as response:
                    return json.load(response)
            try:
                # Asset allowlist admits the active and preserved shipped stills, never arbitrary
                # files alongside them or path traversal into recordings.
                for path in sorted(p for p in STATIC_PATHS if '-visemes-v' in p or '/red-eyes-first11/' in p):
                    with urllib.request.urlopen(url + path + '?v=1') as response:
                        self.assertEqual(response.headers.get_content_type(), 'image/png')
                        self.assertTrue(response.read().startswith(b'\x89PNG\r\n\x1a\n'))
                    with urllib.request.urlopen(urllib.request.Request(url + path, method='HEAD')) as response:
                        self.assertGreater(int(response.headers['Content-Length']), 0)
                for path in ('/assets/small-left-visemes-v1/prompts.json', '/assets/red-eyes-first11/manifest.json', '/assets/brown-face-visemes-v1/prompts.json', '/assets/red-eyes-visemes-v1/prompts.json', '/assets/central-visemes-v1/prompts.json', '/assets/central-visemes-v1/../../server.py'):
                    with self.assertRaises(urllib.error.HTTPError) as rejected:
                        urllib.request.urlopen(url + path)
                    self.assertEqual(rejected.exception.code, 404)
                output = io.BytesIO()
                with wave.open(output, 'wb') as audio:
                    audio.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
                    audio.writeframes(b'\x00\x10' * 16000)
                pcm = output.getvalue()
                event = post('/api/audio?source=file&language=en', pcm, 'audio/wav')
                self.assertEqual(event['kind'], 'audio')
                self.assertEqual(event['text'], '')
                self.assertFalse(event['transcription'])
                self.assertEqual((archive.root / event['audio']).read_bytes(), pcm)
                for invalid in ('auto', 'mix'):
                    with self.assertRaises(urllib.error.HTTPError) as rejected:
                        post('/api/audio?language=' + invalid, pcm, 'audio/wav')
                    self.assertEqual(rejected.exception.code, 400)
                self.assertEqual(post('/api/audio?source=file', pcm, 'audio/wav')['language_mode'], 'en')
                decision = post('/api/agent/decide', {'event_id': event['id']})
                self.assertEqual(decision['action'], 'speak')
                self.assertEqual(Path(agent.request.call_args.args[0]['audio_path']).read_bytes(), pcm)
                mouth = post('/api/plan', {'text': decision['text'], 'speed': 1})
                self.assertEqual(mouth['method'], 'phonemes-v1')
                self.assertTrue(mouth['timeline'])
                with urllib.request.urlopen(url + '/api/status') as response:
                    self.assertEqual(json.load(response)['stage'], 4)
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(url + '/data/' + event['audio'])
                self.assertEqual(denied.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                agent.close()

if __name__ == '__main__':
    unittest.main()
