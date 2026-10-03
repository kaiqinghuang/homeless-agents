import io
import json
import unittest
from unittest.mock import Mock, patch
from pathlib import Path
import numpy as np
from noise_sampling import AcousticFeatures, NoiseSampling, validated_sampling
from environment_monitor import EnvironmentMonitor
from residue_runtime import ResidueGenerator

class NoiseTests(unittest.TestCase):
    def test_bounds_smoothing_and_stale_fallback(self):
        n=NoiseSampling()
        n.update(-20,1,now=0)
        first=n.snapshot(now=0)
        self.assertTrue(.9<first['temperature']<1.15)
        for t in range(1,100):n.update(-20,1,now=t)
        high=n.snapshot(now=99)
        self.assertAlmostEqual(high['temperature'],1.15,places=3)
        self.assertAlmostEqual(high['top_p'],.98,places=3)
        for t in range(100,200):n.update(-100,0,now=t)
        low=n.snapshot(now=199)
        self.assertAlmostEqual(low['temperature'],.75,places=3)
        self.assertAlmostEqual(low['top_p'],.88,places=3)
        self.assertEqual(n.snapshot(now=210)['temperature'],.9)
        self.assertEqual(n.snapshot(active=False,now=199)['top_p'],.95)
        for bad in [float('nan'),float('inf'),True]:
            with self.assertRaises(ValueError):validated_sampling({'temperature':bad})

    def test_amplitude_and_change_are_separate(self):
        t=np.arange(16000)/16000
        quiet=.005*np.sin(2*np.pi*400*t)
        loud=.2*np.sin(2*np.pi*400*t)
        q=AcousticFeatures().measure(quiet);l=AcousticFeatures().measure(loud)
        self.assertGreater(l['rms_dbfs']-q['rms_dbfs'],30)
        self.assertLess(l['change'],.01)
        alternating=np.concatenate([.2*np.sin(2*np.pi*(400 if i%2 else 2000)*t[:1600]) for i in range(10)])
        self.assertGreater(AcousticFeatures().measure(alternating)['change'],.8)
        self.assertEqual(AcousticFeatures().measure(np.zeros(16000))['change'],0)

    def test_light_capture_never_loads_or_calls_model(self):
        agent=Mock();m=EnvironmentMonitor(Path(__file__).parent,agent)
        m.active=True;m.revision=1;m.interpret=False
        proc=Mock();proc.poll.return_value=0
        def lines():
            yield json.dumps({'ready':True,'device':'test'})
            yield json.dumps({'features':{'rms_dbfs':-30,'change':.8}})
            self.assertEqual(m.sampling()['source'],'noise')
            m.active=False
        proc.stdout=iter(lines())
        # Use a file-like iterator with close(), as Popen supplies.
        class Stream:
            def __iter__(self):return iter(lines())
            def close(self):pass
        proc.stdout=Stream()
        with patch('environment_monitor.subprocess.Popen',return_value=proc) as popen:
            m._capture(1,'builtin',Mock())
        self.assertIn('--features-only',popen.call_args.args[0])
        self.assertEqual(agent.mock_calls,[])
        self.assertEqual(m.sampling()['source'],'default')

    def test_runtime_passes_parameters_without_logging_sound_metadata(self):
        # Exercise the real next() method without booting a model or writing logs.
        import threading
        r=ResidueGenerator.__new__(ResidueGenerator);r.lock=threading.RLock();r.session='x';r.logger=Mock()
        settings={'temperature':1.1,'top_p':.97,'source':'noise'}
        r._request=Mock(return_value={'session':'x','text':'Test','sampling':settings})
        result=r.next('x',settings)
        self.assertEqual(r._request.call_args.args[0]['sampling'],settings)
        self.assertEqual(result['sampling'],settings)
        self.assertNotIn('sampling',json.loads(r.logger.info.call_args.args[0]))

if __name__=='__main__':unittest.main()
