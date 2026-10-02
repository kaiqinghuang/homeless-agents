import unittest
from audio_decision import parse_object


class DecisionParsingTests(unittest.TestCase):
    def test_observed_formats(self):
        expected = {'respond': False, 'salience': 0}
        for raw in ['{"respond":false,"salience":0}',
                    "{'respond': False, 'salience': 0}",
                    '```json\n{"respond":false,"salience":0}\n```',
                    r'{\"respond\":false,\"salience\":0}']:
            self.assertEqual(parse_object(raw), expected)

    def test_no_code_execution_or_non_object(self):
        for raw in ["__import__('os').system('echo should-not-run')", '[1,2]', 'invalid']:
            with self.assertRaises((ValueError, SyntaxError)):
                parse_object(raw)

if __name__ == '__main__':
    unittest.main()
