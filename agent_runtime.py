"""Direct local audio decisions. No ASR, cloud calls, or training."""
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

SCHEMA = {'type': 'object', 'properties': {
    'respond': {'type': 'boolean'}, 'salience': {'type': 'number'},
    'text': {'type': 'string'}, 'reason': {'type': 'string', 'enum': [
        'addressed', 'question', 'ambient_change', 'background', 'unclear']}},
    'required': ['respond', 'salience', 'text', 'reason'], 'additionalProperties': False}


def response_language(event):
    language = event.get('language_mode', 'en')
    if language not in ('en', 'zh'):
        raise ValueError('Choose English or 中文; automatic language mode is no longer supported.')
    return language


class LocalAgent:
    def __init__(self, root, archive):
        self.root, self.archive = Path(root), archive
        self.config = json.loads((self.root / 'agent_config.json').read_text())
        self.prompt = (self.root / 'agent_prompt.txt').read_text()
        self.prompt_hash = hashlib.sha256(self.prompt.encode()).hexdigest()[:16]
        self.state, self.error = 'idle', ''
        self.digest = self.config['revision']
        self.lock, self.start_lock = threading.Lock(), threading.Lock()
        self.process, self.log, self.closed = None, None, False
        self.responses = queue.Queue()
        self.last_reply, self.last_environment = -math.inf, -math.inf
        self.busy = False

    def start(self, restart=False):
        with self.start_lock:
            if restart and not self.busy and self.state != 'loading':
                self.state = 'idle'
            if self.closed or self.state in ('loading', 'ready'):
                return
            self.state, self.error = 'loading', ''
        threading.Thread(target=self._boot, daemon=True).start()

    @staticmethod
    def _read(process, responses):
        try:
            for line in process.stdout:
                try:
                    responses.put(json.loads(line))
                except json.JSONDecodeError:
                    continue
        finally:
            responses.put({'error': 'The audio model stopped. Restart Start.command.'})

    def _terminate(self):
        process = self.process
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if process:
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
        if self.log:
            self.log.close()
            self.log = None

    def _boot(self):
        try:
            with self.start_lock:
                if self.closed:
                    return
                self._terminate()
                python = self.root / '.venv-audio/bin/python'
                weights = self.root / 'models/qwen2-audio-7b-4bit'
                if not python.is_file() or not list(weights.glob('*.safetensors')):
                    raise RuntimeError('Run Setup.command to install the local audio model.')
                self.log = (self.archive.root / 'direct-audio.log').open('a')
                self.responses = queue.Queue()
                env = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1',
                       'HF_HUB_DISABLE_TELEMETRY': '1', 'HF_HOME': str(self.root / 'models/.hf-cache')}
                self.process = subprocess.Popen([str(python), '-u', str(self.root / 'direct_audio_worker.py')],
                    cwd=self.root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=self.log, text=True, bufsize=1)
                threading.Thread(target=self._read, args=(self.process, self.responses), daemon=True).start()
            ready = self.responses.get(timeout=180)
            if not ready.get('ready'):
                raise RuntimeError(ready.get('error', 'Audio model failed to load.'))
            if not self.closed:
                self.state = 'ready'
        except Exception as error:
            self.state = 'error'
            self.error = str(error) or 'Audio model loading timed out.'
            if 'Metal' in self.error:
                self.error = 'GPU unavailable here. Open Start.command from Finder. / 请从访达打开 Start.command。'
            with self.start_lock:
                self._terminate()

    def status(self):
        if self.state == 'ready' and self.process and self.process.poll() is not None:
            self.state, self.error = 'error', 'Audio model stopped. Reconnect the model.'
        return {'state': self.state, 'error': self.error, 'model': self.config['model'],
                'backend': 'MLX · Metal', 'input': 'direct_audio', 'transcription': False,
                'busy': self.busy, 'local': True, 'training': False,
                'threshold': self.config['threshold'], 'digest': self.digest,
                'language_modes': ['en', 'zh'], 'default_language': 'en'}

    def request(self, payload):
        if not self.process or self.process.poll() is not None:
            raise RuntimeError('Audio model is not running. Reconnect the model.')
        self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + '\n')
        self.process.stdin.flush()
        try:
            result = self.responses.get(timeout=180)
        except queue.Empty as error:
            # Kill timed-out inference so its late output cannot satisfy a later request.
            self._terminate()
            raise RuntimeError('Audio inference timed out. Reconnect the model.') from error
        if result.get('error'):
            raise RuntimeError(result['error'])
        return result

    def audio_path(self, event):
        path = (self.archive.root / event['audio']).resolve()
        if not path.is_relative_to(self.archive.root.resolve()) or not path.is_file() or path.suffix != '.wav':
            raise ValueError('Archived recording is missing or invalid.')
        return str(path)

    def decide(self, event, threshold=None):
        threshold = self.config['threshold'] if threshold is None else threshold
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError('Response threshold must be between 0 and 1.')
        if event.get('kind') not in ('audio', 'speech', 'environment', 'silence', 'text_input'):
            raise ValueError('This event cannot be used as a model observation.')
        if not self.lock.acquire(blocking=False):
            return {'action': 'deferred', 'reason': 'model_busy', 'text': '', 'source_id': event['id']}
        try:
            previous = self.archive.decision_for(event['id'])
            if previous:
                return {**previous, 'reused': True}
            self.busy = True
            began = time.monotonic()
            is_test = event.get('source') == 'text-test'
            language = response_language(event)
            result = {'kind': 'decision', 'source_id': event['id'], 'source_kind': event['kind'],
                      'session': event.get('session', ''), 'source': event.get('source', ''),
                      'model': self.config['model'], 'model_digest': self.digest,
                      'prompt_version': self.prompt_hash, 'threshold': threshold,
                      'language': language, 'text': '', 'salience': None,
                      'action': 'silent', 'decision_by': 'gate', 'training': False,
                      'input_representation': 'text_test' if is_test else 'audio_embeddings', 'transcription': False}
            ambient = event.get('source') == 'ambient' or event['kind'] == 'environment'
            if event['kind'] == 'silence':
                result['reason'] = 'quiet'
            elif not is_test and began - self.last_reply < self.config['cooldown_seconds']:
                result.update(action='deferred', reason='cooldown')
            elif ambient and began - self.last_environment < self.config['environment_interval_seconds']:
                result.update(action='deferred', reason='environment_interval')
            else:
                try:
                    if self.state != 'ready':
                        raise RuntimeError(self.error or 'Local audio model is loading. Please wait.')
                    memory = self.archive.agent_memory(event.get('session', ''), self.prompt_hash, language) if not is_test else []
                    # Previous transcript fields never enter the direct-audio prompt.
                    context = {'response_language': language,
                               'previous_generated_replies': [m['generated_reply'] for m in memory]}
                    if is_test:
                        context['test_message'] = event['text']
                    payload = {'system': self.prompt, 'prompt': json.dumps(context, ensure_ascii=False),
                               'max_tokens': self.config['num_predict'], 'temperature': self.config['temperature']}
                    if not is_test:
                        payload['audio_path'] = self.audio_path(event)
                    if ambient:
                        self.last_environment = began
                    response = self.request(payload)
                    if response.get('truncated'):
                        raise ValueError('Model response exceeded its token budget.')
                    raw = response['text'].strip()
                    result['raw_model_output'] = raw
                    if raw.startswith('```') and raw.endswith('```'):
                        raw = re.sub(r'^```(?:json)?\s*', '', raw)[:-3].strip()
                    generated = json.loads(raw)
                    self.validate(generated, language)
                    result.update(decision_by='model', salience=generated['salience'], reason=generated['reason'],
                                  generation_options={'temperature': payload['temperature'], 'max_tokens': payload['max_tokens']},
                                  model_decision=generated)
                    if generated['respond'] and generated['salience'] >= threshold:
                        reply = generated['text'].strip()
                        result.update(action='speak', text=reply,
                                      language=language)
                        if not is_test:
                            self.last_reply = time.monotonic()
                    elif generated['respond']:
                        result['reason'] = 'below_threshold'
                    result['tokens'] = response.get('tokens')
                except Exception as error:
                    result.update(action='error', reason='model_error', error=str(error))
                    if isinstance(error, (OSError, RuntimeError)):
                        self.state, self.error = 'error', str(error)
            result['processing_seconds'] = round(time.monotonic() - began, 2)
            return self.archive.save(result)
        finally:
            self.busy = False
            self.lock.release()

    @staticmethod
    def validate(value, language):
        if not isinstance(value, dict) or type(value.get('respond')) is not bool:
            raise ValueError('Invalid model decision.')
        score = value.get('salience')
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError('Invalid model salience.')
        reply = value.get('text')
        if not isinstance(reply, str) or len(reply) > 200 or value.get('reason') not in SCHEMA['properties']['reason']['enum']:
            raise ValueError('Invalid model reply.')
        if value['respond']:
            han = bool(re.search(r'[\u3400-\u9fff]', reply))
            if not reply.strip() or (language == 'zh' and not han) or (language == 'en' and han):
                raise ValueError('The reply did not follow the requested language.')
        elif reply.strip():
            raise ValueError('A silent decision must have an empty reply.')

    def close(self):
        with self.start_lock:
            self.closed = True
            self._terminate()
