"""Display-only audio must never enter archived events or training pairs."""
import io,json,tempfile,unittest,wave
from pathlib import Path
from unittest.mock import Mock
from agent_runtime import LocalAgent

ROOT=Path(__file__).resolve().parent

def clip():
    out=io.BytesIO()
    with wave.open(out,'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0\0'*16000)
    return out.getvalue()

class MonitorTests(unittest.TestCase):
    def test_no_archive_or_training_on_success_and_error(self):
        for fail in (False,True):
            archive=Mock();agent=LocalAgent(ROOT,archive);agent.state='ready';paths=[]
            def request(payload):
                path=Path(payload['audio_path']);paths.append(path)
                self.assertTrue(path.is_file());self.assertEqual(path.read_bytes(),clip())
                if fail:raise RuntimeError('test failure')
                return {'text':json.dumps({'respond':True,'salience':1,'text':'A distant hum.','reason':'ambient_change'}),'truncated':False}
            agent.request=request
            if fail:
                with self.assertRaises(RuntimeError):agent.observe(clip())
            else:
                result=agent.observe(clip());self.assertEqual(result['text'],'A distant hum.')
                self.assertFalse(result['training']);self.assertFalse(result['archived'])
            self.assertEqual(archive.mock_calls,[])
            self.assertFalse(paths[0].exists());self.assertFalse(agent.busy)
            self.assertTrue(agent.lock.acquire(blocking=False));agent.lock.release()
    def test_bad_generated_response_does_not_disable_live_worker(self):
        agent=LocalAgent(ROOT,Mock());agent.state='ready';agent.process=Mock();agent.process.poll.return_value=None
        agent.request=Mock(side_effect=RuntimeError('Expected a short English environment response.'))
        with self.assertRaises(RuntimeError):agent.observe(clip())
        self.assertEqual(agent.state,'ready');self.assertFalse(agent.busy)
        agent.request=Mock(return_value={'text':json.dumps({'respond':True,'salience':1,'text':'A low humming noise.','reason':'ambient_change'})})
        self.assertEqual(agent.observe(clip())['text'],'A low humming noise.')

    def test_recording_limits_generation_and_accepts_short_fragments(self):
        agent=LocalAgent(ROOT,Mock());agent.state='ready'
        for raw,truncated in [('A quiet room with a low hum.',False),('A quiet room with',True)]:
            agent.request=Mock(return_value={'text':json.dumps({'respond':True,'salience':1,'text':raw,'reason':'ambient_change'}),'truncated':truncated})
            result=agent.observe(clip())
            self.assertEqual(result['text'],raw)  # No word trimming or invented ellipsis.
            sent=agent.request.call_args.args[0]
            self.assertEqual(sent['max_tokens'],14)
            self.assertTrue(json.loads(sent['prompt'])['brief_observation'])
            self.assertNotIn('observation_max_words',sent)
            self.assertEqual(agent.archive.mock_calls,[])
        self.assertEqual(agent.config['num_predict'],48)  # Legacy audio decision budget unchanged.

    def test_busy_has_no_queue_or_archive(self):
        archive=Mock();agent=LocalAgent(ROOT,archive);agent.lock.acquire()
        self.assertTrue(agent.observe(clip())['busy']);self.assertEqual(archive.mock_calls,[])
        agent.lock.release()
    def test_invalid_audio_is_rejected(self):
        archive=Mock();agent=LocalAgent(ROOT,archive)
        with self.assertRaises(ValueError):agent.observe(b'not audio')
        self.assertEqual(archive.mock_calls,[])

if __name__=='__main__':unittest.main()
