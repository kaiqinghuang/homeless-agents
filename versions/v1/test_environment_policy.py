import unittest
from environment_policy import normalize_response
class EnvironmentPolicyTests(unittest.TestCase):
    def test_preserves_generated_words_and_repetition(self):
        for text in ('footsteps footsteps', 'silence', 'room, room, room', 'Hum.'):
            value=normalize_response(text)
            self.assertEqual(value['text'],text)
            self.assertTrue(value['respond'])
    def test_only_explicit_marker_means_silence(self):
        for text in ('[silence]','[ Silence ]'):
            self.assertFalse(normalize_response(text)['respond'])
    def test_invalid_output_is_not_replaced(self):
        for text in ('','你好','{}','123','x'*201):
            with self.assertRaises(ValueError):normalize_response(text)
