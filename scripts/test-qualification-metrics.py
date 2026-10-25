#!/usr/bin/env python3
"""Offline qualification-accounting controls; no provider requests."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('qualification_metrics', pathlib.Path(__file__).with_name('summarize-evidence-qualification.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AccountingTests(unittest.TestCase):
    def test_errors_are_separate_from_false_abstentions_and_unsupported_answers(self):
        rows = [dict(expected=expected, status=status, passed=passed, seconds=i + 1)
                for i, (expected, status, passed) in enumerate([
                    ('answered', 'insufficient_evidence', False),
                    ('answered', 'error', False),
                    ('insufficient_evidence', 'answered', False),
                    ('insufficient_evidence', 'insufficient_evidence', True)])]
        result = module.summarize(rows)
        self.assertEqual(result['false_abstentions'], 1)
        self.assertEqual(result['unsupported_answered'], 1)
        self.assertEqual(result['unsupported_answered_rate'], .5)
        self.assertEqual(result['errors'], 1)
        self.assertEqual(result['semantic_failures'], 3)
        self.assertEqual(result['latency_p95_seconds'], 4)

    def test_unknown_usage_is_not_reported_as_measured_zero(self):
        rows = [dict(expected='answered', status='answered', passed=True, seconds=2,
                     usage=dict(calls=4, prompt_tokens=1100, completion_tokens=97)),
                dict(expected='answered', status='error', passed=False, seconds=45, usage=None)]
        result = module.summarize(rows)
        self.assertEqual(result['calls_max'], 4)
        self.assertEqual(result['prompt_tokens_recorded'], 1100)
        self.assertEqual(result['completion_tokens_recorded'], 97)
        self.assertIn('unknown', result['usage_limit'])


if __name__ == '__main__':
    unittest.main()
