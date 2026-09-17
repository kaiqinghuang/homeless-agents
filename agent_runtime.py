"""Local-only Ollama decisions; no model training, cloud calls, or tool execution."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request

SCHEMA = {'type': 'object', 'properties': {
    'respond': {'type': 'boolean'}, 'salience': {'type': 'number'},
    'text': {'type': 'string'}, 'reason': {'type': 'string', 'enum': [
        'addressed', 'question', 'ambient_change', 'background', 'unclear']}},
    'required': ['respond', 'salience', 'text', 'reason'], 'additionalProperties': False}


def response_language(event):
    if event.get('language') in ('en', 'zh'):
        return event['language']
    text = event.get('text', '')
    return 'zh' if len(re.findall(r'[\u3400-\u9fff]', text)) > len(re.findall(r'[A-Za-z]+', text)) else 'en'


class LocalAgent:
    def __init__(self, root, archive):
        self.root, self.archive = Path(root), archive
        self.config = json.loads((self.root / 'agent_config.json').read_text())
        self.prompt = (self.root / 'agent_prompt.txt').read_text()
        self.prompt_hash = hashlib.sha256(self.prompt.encode()).hexdigest()[:16]
        self.url = 'http://127.0.0.1:11434'
        self.state, self.error, self.digest = 'idle', '', ''
        self.lock, self.start_lock = threading.Lock(), threading.Lock()
        self.process, self.log, self.closed = None, None, False
        self.last_reply, self.last_environment = -math.inf, -math.inf
        self.busy = False
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, path, data=None, timeout=4):
        request = urllib.request.Request(self.url + path,
            data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
            headers={'Content-Type': 'application/json'})
        try:
            with self.http.open(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read(2048).decode(errors='replace')
            raise RuntimeError('Local model request failed: ' + detail[:300]) from error

    def start(self):
        with self.start_lock:
            if self.closed or self.state in ('loading', 'ready'):
                return
            self.state, self.error = 'loading', ''
        threading.Thread(target=self._boot, daemon=True).start()

    def _boot(self):
        try:
            try:
                self.request('/api/version')
            except (OSError, urllib.error.URLError):
                binary = shutil.which('ollama') or '/Applications/Ollama.app/Contents/Resources/ollama'
                if not Path(binary).is_file():
                    raise RuntimeError('Open or install Ollama, then retry. / 请先打开或安装 Ollama。')
                with self.start_lock:
                    if self.closed:
                        return
                    self.log = (self.archive.root / 'ollama.log').open('a')
                    env = {**os.environ, 'OLLAMA_HOST': '127.0.0.1:11434',
                           'OLLAMA_NO_CLOUD': '1', 'OLLAMA_NOPRUNE': '1'}
                    self.process = subprocess.Popen([binary, 'serve'], env=env, cwd=self.root,
                                                    stdout=self.log, stderr=subprocess.STDOUT)
                deadline = time.monotonic() + 20
                while not self.closed:
                    try:
                        self.request('/api/version')
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() > deadline or self.process.poll() is not None:
                            raise RuntimeError('Ollama could not start. Open the Ollama app and retry.')
                        time.sleep(.3)
            models = self.request('/api/tags')['models']
            match = next((m for m in models if m['name'] == self.config['model']), None)
            if not match:
                raise RuntimeError('Local model missing. Run: ollama pull ' + self.config['model'])
            details = self.request('/api/show', {'model': self.config['model']})
            if details.get('remote_host') or details.get('remote_model') or match.get('details', {}).get('format') != 'gguf':
                raise RuntimeError('This installation requires locally stored GGUF weights; cloud models are disabled.')
            self.digest = match.get('digest', '')
            if not self.closed:
                self.state, self.error = 'ready', ''
        except Exception as error:
            self.state, self.error = 'error', str(error)

    def status(self):
        return {'state': self.state, 'error': self.error, 'model': self.config['model'],
                'busy': self.busy, 'local': True, 'training': False,
                'threshold': self.config['threshold'], 'digest': self.digest}

    def decide(self, event, threshold=None):
        threshold = self.config['threshold'] if threshold is None else threshold
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError('Response threshold must be between 0 and 1.')
        if event.get('kind') not in ('speech', 'environment', 'silence', 'text_input'):
            raise ValueError('This event cannot be used as a model observation.')
        if not self.lock.acquire(blocking=False):
            return {'action': 'deferred', 'reason': 'model_busy', 'text': '', 'source_id': event['id']}
        try:
            previous = self.archive.decision_for(event['id'])
            if previous:
                return {**previous, 'reused': True}
            self.busy = True
            began = time.monotonic()
            result = {'kind': 'decision', 'source_id': event['id'], 'source_kind': event['kind'],
                      'session': event.get('session', ''), 'source': event.get('source', ''),
                      'model': self.config['model'], 'model_digest': self.digest,
                      'prompt_version': self.prompt_hash, 'threshold': threshold,
                      'language': response_language(event), 'text': '', 'salience': None,
                      'action': 'silent', 'decision_by': 'gate', 'training': False}
            is_test = event.get('source') == 'text-test'
            if event['kind'] == 'silence':
                result['reason'] = 'quiet'
            elif not is_test and began - self.last_reply < self.config['cooldown_seconds']:
                result.update(action='deferred', reason='cooldown')
            elif event['kind'] == 'environment' and began - self.last_environment < self.config['environment_interval_seconds']:
                result.update(action='deferred', reason='environment_interval')
            else:
                if self.state != 'ready':
                    raise RuntimeError(self.error or 'Local language model is loading. Please wait.')
                if event['kind'] == 'environment':
                    self.last_environment = began
                # Short context only: generated replies are identified as generated,
                # not claimed to have been played. Tests never enter this context.
                memory = self.archive.agent_memory(event.get('session', ''), self.prompt_hash) if not is_test else []
                observation = {'kind': event['kind'], 'transcript': event.get('text', ''),
                    'audio_features': event.get('features'), 'response_language': result['language'],
                    'recent_observations_and_generated_responses': memory}
                params = {'model': self.config['model'], 'stream': False, 'think': False,
                    'format': SCHEMA, 'keep_alive': '10m',
                    'options': {k: self.config[k] for k in ('temperature', 'num_ctx', 'num_predict')},
                    'messages': [{'role': 'system', 'content': self.prompt},
                                 {'role': 'user', 'content': json.dumps(observation, ensure_ascii=False)}]}
                try:
                    response = self.request('/api/chat', params, timeout=90)
                    if response.get('done_reason') == 'length':
                        raise ValueError('Model response exceeded its token budget.')
                    generated = json.loads(response['message']['content'])
                    self.validate(generated, result['language'])
                    result.update(decision_by='model', salience=generated['salience'], reason=generated['reason'],
                                  generation_options=params['options'], model_decision=generated)
                    if generated['respond'] and generated['salience'] >= threshold:
                        result.update(action='speak', text=generated['text'].strip())
                        if not is_test:
                            self.last_reply = time.monotonic()
                    elif generated['respond']:
                        result['reason'] = 'below_threshold'
                    result['tokens'] = response.get('eval_count')
                except Exception as error:
                    result.update(action='error', reason='model_error', error=str(error))
                    if isinstance(error, (OSError, urllib.error.URLError, RuntimeError)):
                        self.state = 'error'
                        self.error = 'Open Ollama and reconnect. / 请打开 Ollama 后重连。 ' + str(error)[:200]
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
        # Never stop an Ollama instance owned by the user or another application.
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.log:
            self.log.close()
