"""Deterministic policy/archival tests; no Ollama or microphone required."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from agent_runtime import LocalAgent
from audio_runtime import AudioArchive


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.archive = AudioArchive(self.temp.name)
        self.agent = LocalAgent(Path(__file__).resolve().parent, self.archive)
        self.agent.state = 'ready'
        self.agent.request = Mock(return_value=self.output())

    def tearDown(self):
        self.agent.close()
        self.temp.cleanup()

    @staticmethod
    def output(text='I am here.', respond=True, score=.9):
        return {'message': {'content': json.dumps({'respond': respond, 'salience': score,
                'text': text, 'reason': 'question' if respond else 'background'})}, 'done_reason': 'stop'}

    def event(self, **changes):
        return self.archive.save({'kind': 'speech', 'text': 'Are you here?', 'language': 'en',
                                  'session': 'test-room', 'source': 'candidate', **changes})

    def test_speak_and_idempotent_archive(self):
        event = self.event()
        result = self.agent.decide(event)
        self.assertEqual(result['action'], 'speak')
        self.assertEqual(self.agent.decide(event)['id'], result['id'])
        self.assertEqual(self.agent.request.call_count, 1)
        self.assertEqual(len(self.archive.decisions()), 1)
        self.assertEqual(len(self.archive.recent()), 1)
        self.assertEqual(self.archive.agent_memory('test-room')[0]['generated_reply'], 'I am here.')

    def test_model_silence_and_threshold(self):
        self.agent.request.return_value = self.output('', False, .1)
        result = self.agent.decide(self.event(kind='environment', text='', language=None))
        self.assertEqual((result['action'], result['decision_by']), ('silent', 'model'))
        self.agent.request.return_value = self.output(score=.5)
        result = self.agent.decide(self.event(), threshold=.8)
        self.assertEqual((result['action'], result['text'], result['reason']), ('silent', '', 'below_threshold'))

    def test_quiet_cooldown_and_environment_gates(self):
        result = self.agent.decide(self.event(kind='silence', text=''))
        self.assertEqual(result['decision_by'], 'gate')
        self.agent.request.assert_not_called()
        self.agent.decide(self.event())
        result = self.agent.decide(self.event())
        self.assertEqual(result['reason'], 'cooldown')
        self.agent.last_reply = -float('inf')
        self.agent.request.return_value = self.output('', False, .1)
        self.agent.decide(self.event(kind='environment', text=''))
        result = self.agent.decide(self.event(kind='environment', text=''))
        self.assertEqual(result['reason'], 'environment_interval')

    def test_errors_are_not_reported_as_silence(self):
        for output in [self.output('English only.'), {'message': {'content': 'not JSON'}},
                       {**self.output(), 'done_reason': 'length'}]:
            self.agent.request.return_value = output
            result = self.agent.decide(self.event(text='你好', language='zh'))
            self.assertEqual(result['action'], 'error')
            self.assertEqual(result['text'], '')

    def test_chinese_language_and_test_isolation(self):
        self.agent.request.return_value = self.output('我在这里。')
        result = self.agent.decide(self.event(kind='text_input', source='text-test', text='你好吗？', language=None))
        self.assertEqual(result['language'], 'zh')
        self.assertEqual(result['action'], 'speak')
        self.assertEqual(self.archive.agent_memory('test-room'), [])
        self.assertEqual(self.archive.recent(), [])

    def test_busy_and_validation(self):
        with self.agent.lock:
            self.assertEqual(self.agent.decide(self.event())['reason'], 'model_busy')
        for value in [True, float('nan'), 2, -1, '0.5']:
            with self.assertRaises(ValueError):
                self.agent.decide(self.event(), value)
        with self.assertRaises(ValueError):
            self.agent.decide(self.event(kind='room'))
        for output in [{'respond': 'true'}, {'respond': True, 'salience': float('nan')}]:
            with self.assertRaises(ValueError):
                self.agent.validate(output, 'en')

    def test_connection_failure_exposes_reconnect_state(self):
        self.agent.request.side_effect = OSError('connection refused')
        result = self.agent.decide(self.event())
        self.assertEqual(result['action'], 'error')
        self.assertEqual(self.agent.status()['state'], 'error')
        self.assertIn('reconnect', self.agent.status()['error'])

    def test_new_prompt_does_not_inherit_old_persona(self):
        old_input = self.event()
        self.archive.save({'kind': 'decision', 'source_id': old_input['id'], 'session': 'test-room',
                           'source': 'candidate', 'action': 'speak', 'text': 'A ripple.',
                           'prompt_version': 'previous-persona'})
        self.agent.decide(self.event())
        payload = self.agent.request.call_args.args[1]
        observation = json.loads(payload['messages'][1]['content'])
        self.assertEqual(observation['recent_observations_and_generated_responses'], [])
        self.assertEqual(len(self.archive.decisions()), 2)
        self.assertEqual(len(self.archive.agent_memory('test-room', self.agent.prompt_hash)), 1)


if __name__ == '__main__':
    unittest.main()
