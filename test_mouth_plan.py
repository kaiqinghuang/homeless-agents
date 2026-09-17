"""Offline regression checks. Run: python3 -m unittest test_mouth_plan.py"""
import concurrent.futures
import unittest
from mouth_plan import plan, pose_sequence


class MouthPlanTests(unittest.TestCase):
    def test_pronunciation_changes_spelling_errors(self):
        p = plan('Make a face. You move through the room.')
        make = p['words'][0]
        self.assertIn('eɪ', ''.join(make['phonemes']))
        cues = [c for c in p['timeline'] if c['word'] == 0]
        self.assertEqual([c['shape'] for c in cues if 'eɪ' in c['phoneme']], ['C', 'B'])
        self.assertEqual(cues[0]['shape'], 'A')  # /m/ closes lips
        self.assertNotIn('D', [c['shape'] for c in cues])  # no spelling-derived AH

    def test_silent_letters_and_distinct_vowels(self):
        p = plan('knight boot book')
        knight, boot, book = p['words']
        self.assertNotIn('k', knight['phonemes'])
        self.assertIn('aɪ', ''.join(knight['phonemes']))
        self.assertIn('uː', ''.join(boot['phonemes']))
        self.assertIn('ʊ', ''.join(book['phonemes']))

    def test_vowel_paths_and_lip_closures(self):
        for ipa, shapes in [('ˈeɪ', ['C', 'B']), ('oʊ', ['E', 'F']),
                            ('ˈɑu', ['D', 'F']), ('iɛ', ['B', 'C']),
                            ('uː', ['F']), ('y', ['F']), ('ph', ['A']),
                            ('m', ['A']), ('v', ['G']), ('', ['X'])]:
            self.assertEqual(pose_sequence(ipa), shapes)

    def test_chinese_phrase_and_rounded_vowel(self):
        p = plan('你好，妈妈。女儿，绿。')
        self.assertEqual(p['words'][0]['text'], '你好，')
        mama = next(w for w in p['words'] if '妈妈' in w['text'])
        self.assertEqual(mama['phonemes'].count('m'), 2)
        self.assertTrue(any('y' in c['phoneme'] and c['shape'] == 'F' for c in p['timeline']))

    def test_exact_text_and_timeline(self):
        for text in ['Make a face. You move through the room.', '你好，我听见了风。',
                     'Hello，你好吗？2026。', 'She’s here. It costs $12.50.',
                     '“Hello!” 你好，世界。', '你好 Hello 你好', '2026',
                     'Hello\nworld.', 'Hello 😊 world.']:
            with self.subTest(text=text):
                p = plan(text)
                self.assertEqual(''.join(w['text'] for w in p['words']), text)
                self.assertEqual(p['method'], 'phonemes-v1')
                self.assertEqual(p['timeline'][0]['start'], 0)
                self.assertEqual(p['timeline'][-1]['end'], p['duration'])
                for previous, current in zip(p['timeline'], p['timeline'][1:]):
                    self.assertEqual(previous['end'], current['start'])
                for cue in p['timeline']:
                    self.assertGreater(cue['end'], cue['start'])
                    self.assertIn(cue['shape'], 'XABCDEFGH')
                    self.assertTrue(-1 <= cue['word'] < len(p['words']))
                    if cue['phoneme']:
                        self.assertIn(cue['phoneme'], p['words'][cue['word']]['phonemes'])

    def test_speed_does_not_change_phonemes_or_cached_plans(self):
        a, b = plan('Hello，你好。'), plan('Hello，你好。', 2)
        self.assertAlmostEqual(a['duration'] / 2, b['duration'], places=5)
        self.assertEqual(a['words'], b['words'])
        a['words'][0]['phonemes'].clear()
        self.assertTrue(plan('Hello，你好。')['words'][0]['phonemes'])

    def test_concurrent_requests_keep_their_own_language(self):
        texts = ['Make me move.', '妈妈在这里。', 'Hello，你好。', 'One two three.']
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(plan, texts))
        for text, result in zip(texts, results):
            self.assertEqual(''.join(w['text'] for w in result['words']), text)

    def test_invalid_input(self):
        for text in ['', '...', 'a' * 1001, None]:
            with self.assertRaises(ValueError):
                plan(text)
        for speed in [0, True, float('nan'), float('inf')]:
            with self.assertRaises(ValueError):
                plan('Hello', speed)


if __name__ == '__main__':
    unittest.main()
