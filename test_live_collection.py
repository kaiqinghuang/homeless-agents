import hashlib,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
from live_collection import LiveCollection

def fixture(root):
    (root/'assets').mkdir()
    seeds=[{'id':str(i),'url':f'https://original{i}.example/','display':f'original{i}.example'} for i in range(189)]
    (root/'assets/training-sources.json').write_text(json.dumps({'training_records':189,'sources':seeds}))

def candidate(host='new.example',text='Home\nAbout\nServices\n404 Page not found'):
    return {'url':f'https://{host}/page','display':host,'text':text,'english_share_estimate':.8,
            'warc_file':'crawl-data/CC-MAIN-2026-39/segments/test/warc/sample.warc.gz',
            'warc_offset':123,'warc_length':1234,'snapshot_date':'2026-09-01T00:00:00Z',
            'text_sha256':hashlib.sha256(text.encode()).hexdigest(),'tags':['navigation','error']}

class CollectionTests(unittest.TestCase):
    def test_real_storage_dedup_and_reset_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root)
            original=(root/'assets/training-sources.json').read_bytes()
            c=LiveCollection(root,autostart=False)
            sentinel=root/'data/keep-original.txt';sentinel.write_text('keep')
            self.assertEqual(c.status()['count'],189)
            self.assertTrue(c.publish(candidate()))
            saved=json.loads((c.folder/'records/000001.json').read_text())
            self.assertEqual(saved['text'],candidate()['text']);self.assertFalse(saved['training'])
            self.assertEqual(c.status()['count'],190)
            self.assertFalse(c.publish(candidate()))
            self.assertFalse(c.publish(candidate('another.example')),'duplicate text')
            self.assertFalse(c.publish(candidate(text='Home\nAbout\nServices\nCookies not found')),'duplicate hostname')
            self.assertFalse(c.publish(candidate('original1.example')))
            self.assertEqual(c.status()['count'],190)
            old_run=c.run_id;c.close()
            c=LiveCollection(root,autostart=False)
            self.assertNotEqual(c.run_id,old_run);self.assertEqual(c.status()['count'],189)
            self.assertEqual(list((c.folder/'records').iterdir()),[])
            self.assertEqual(sentinel.read_text(),'keep')
            self.assertEqual((root/'assets/training-sources.json').read_bytes(),original)
            c.close()

    def test_failed_write_and_invalid_candidates_never_increment(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root);c=LiveCollection(root,autostart=False)
            for changes in [{'english_share_estimate':.1},{'text_sha256':'wrong'},{'url':'javascript:alert(1)'}]:
                self.assertFalse(c.publish({**candidate(),**changes}))
            with patch.object(Path,'write_text',side_effect=OSError('disk full')):
                with self.assertRaises(OSError):c.publish(candidate())
            self.assertEqual(c.status()['count'],189);c.close()

    def test_unknown_folder_and_concurrent_owner_are_not_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root);path=root/'data/live-collection';path.mkdir(parents=True)
            keep=path/'user.txt';keep.write_text('untouched')
            with self.assertRaises(ValueError):LiveCollection(root,autostart=False)
            self.assertEqual(keep.read_text(),'untouched')
            keep.unlink();path.rmdir()
            c=LiveCollection(root,autostart=False);c.publish(candidate())
            with self.assertRaises(RuntimeError):LiveCollection(root,autostart=False)
            self.assertEqual(c.status()['count'],190);c.close()

    def test_terminated_worker_pipe_does_not_kill_retry_loop(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root);c=LiveCollection(root,autostart=False)
            worker=MagicMock();worker.poll.return_value=-15
            worker.stdin.close.side_effect=BrokenPipeError('closed pipe')
            c.process=worker;c._terminate(worker)
            worker.stdout.close.assert_called_once()
            self.assertIsNone(c.process);c.close()

    def test_button_restart_clears_only_temporary_round_and_rejects_stale_request(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root);c=LiveCollection(root,autostart=False)
            try:
                original=(root/'assets/training-sources.json').read_bytes()
                sentinel=root/'data/keep.txt';sentinel.write_text('keep')
                c.publish(candidate());old=c.run_id;guard=c.guard
                status=c.restart(old)
                self.assertEqual(status['count'],189);self.assertEqual(status['sequence'],0)
                self.assertNotEqual(status['run_id'],old)
                self.assertEqual(status['interval_ms'],16000)
                self.assertEqual(len(status['entries']),7)
                self.assertEqual(list((c.folder/'records').iterdir()),[])
                self.assertIs(c.guard,guard,'Keep exclusive ownership during restart')
                self.assertEqual(sentinel.read_text(),'keep')
                self.assertEqual((root/'assets/training-sources.json').read_bytes(),original)
                self.assertTrue(c.publish(candidate()),'Previous round dedup entries must be cleared')
                current=c.run_id
                self.assertEqual(c.restart(old)['count'],190,'Stale retries must not clear the new round')
                self.assertEqual(c.run_id,current)
            finally:c.close()

    def test_restart_stops_old_worker_before_starting_new_one(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root)
            with patch.object(LiveCollection,'_launch',side_effect=OSError('offline')):
                c=LiveCollection(root)
                try:
                    old_thread=c.thread;old_run=c.run_id
                    status=c.restart(old_run)
                    self.assertFalse(old_thread.is_alive())
                    self.assertIsNot(c.thread,old_thread)
                    self.assertTrue(c.thread.is_alive())
                    self.assertFalse(c.stopped.is_set())
                    self.assertEqual(status['count'],189)
                finally:c.close()

    def test_network_error_pauses_and_retry_closes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);fixture(root)
            with patch.object(LiveCollection,'_launch',side_effect=OSError('offline')):
                c=LiveCollection(root)
                for _ in range(100):
                    if c.status()['state']=='waiting':break
                    time.sleep(.005)
                self.assertEqual(c.status()['count'],189)
                self.assertEqual(c.status()['state'],'waiting');c.close()

if __name__=='__main__':unittest.main()
