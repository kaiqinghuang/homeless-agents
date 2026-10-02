"""Regression coverage for looping text and symbol/emoji animation."""
import unittest
from unittest.mock import patch
from residue_loop import LoopGuard
from residue_plan import residue_plan
from mouth_plan import plan


class RecoveryTests(unittest.TestCase):
    def test_loop_across_chunk_boundaries(self):
        g = LoopGuard()
        self.assertIsNone(g.accept(')!\n)! )!'))
        self.assertEqual(g.accept(' )!\n)! )!'), 'repeated-text')
        self.assertEqual(g.recent, '')
        self.assertIsNone(g.accept('Home about /// January 17'))
        self.assertIsNone(g.accept('home home home'))

    def test_sentence_loops_and_empty_output(self):
        self.assertTrue(LoopGuard().repeating('Please wait. ' * 6))
        g = LoopGuard()
        for _ in range(3):
            self.assertIsNone(g.accept('\n '))
        self.assertEqual(g.accept(''), 'empty-output')
        self.assertIsNone(g.accept(''))

    def check_plan(self, text):
        p = residue_plan(text)
        self.assertEqual(''.join(w['text'] for w in p['words']), text.strip())
        self.assertEqual(p['timeline'][0]['start'], 0)
        self.assertEqual(p['timeline'][-1]['end'], p['duration'])
        for a, b in zip(p['timeline'], p['timeline'][1:]):
            self.assertEqual(a['end'], b['start'])
        for cue in p['timeline']:
            self.assertGreater(cue['end'], cue['start'])
            self.assertTrue(-1 <= cue['word'] < len(p['words']))
        return p

    def test_symbols_always_move(self):
        for text in [')! )! )! )!', '!!! /// 🙂', '👩🏽\u200d💻', '🇬🇧', '1️⃣', '🙂🙂🙂', ')!' * 50]:
            p = self.check_plan(text)
            self.assertTrue(all(c['shape'] in 'BCDEFGH' for c in p['timeline']))
            self.assertLess(p['duration'], 5)

    def test_embedded_emoji_get_separate_visible_cues(self):
        for text in ['Hello🙂world.', 'Hello 🙂 world.', 'Hello👩🏽\u200d💻again', 'Room 1️⃣ waits.', '你好 🙂 hello !!! next']:
            p = self.check_plan(text)
            visuals = [c for c in p['timeline'] if c.get('visual')]
            self.assertTrue(visuals)
            self.assertTrue(all(c['shape'] != 'X' for c in visuals))
            self.assertTrue(any(c['phoneme'] for c in p['timeline']))

    def test_english_timing_unchanged(self):
        text = 'Make a face. You move through the room.'
        old, new = plan(text), residue_plan(text)
        for key in ['timeline', 'duration', 'words']:
            self.assertEqual(old[key], new[key])

    def test_validation_and_engine_errors_are_not_hidden(self):
        for speed in [0, True, float('nan'), 10]:
            with self.assertRaises(ValueError):
                residue_plan('🙂', speed)
        with patch('residue_plan.plan', side_effect=ValueError('engine failure')):
            with self.assertRaisesRegex(ValueError, 'engine failure'):
                residue_plan('Hello')


if __name__ == '__main__':
    unittest.main()
