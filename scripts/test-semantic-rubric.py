#!/usr/bin/env python3
"""Oracle and adversarial controls for the additive rubric; no model calls."""
import copy
import pathlib
import json
import subprocess
import sys
import tempfile
import unittest
from semantic_rubric import assess
from vault_validation import validate_result


class RubricTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)

    def result(self, *notes):
        sources = []
        for index, (name, text) in enumerate(notes, 1):
            (self.root / name).write_text(text + '\n', encoding='utf-8')
            sources.append(dict(id=index, path=name, start_line=1,
                                end_line=len(text.splitlines()), text=text))
        return dict(version=1, status='answered', answer='\n\n'.join(s['text'] for s in sources), sources=sources)

    def test_compass_legacy_is_preserved_and_illustration_is_separate(self):
        result = self.result(('compass.md', 'Completion does not measure correctness.'))
        before = copy.deepcopy(result)
        self.assertIn('missing-fact:75 percent', validate_result(result, self.root, facts=['75 percent']))
        rubric = assess(result, self.root, required=[('does not measure correctness', ['compass.md'])],
                        illustrative=[('75 percent', ['compass.md'])])
        self.assertTrue(rubric['correctness'])
        self.assertEqual(rubric['missing_illustrative'], ['75 percent'])
        explicit = assess(result, self.root, required=[('18/24', ['compass.md']), ('75 percent', ['compass.md'])])
        self.assertFalse(explicit['correctness'])
        self.assertEqual(result, before)

    def test_exclusion_is_independent_of_supported_alternative(self):
        result = self.result(('alternative.md', 'Precision is 75 percent; recall is 80 percent.'))
        requirements = [('75 percent', ['alternative.md']), ('80 percent', ['alternative.md'])]
        rubric = assess(result, self.root, required=requirements, forbidden_paths=['excluded.md'], allow_abstention=True)
        self.assertTrue(rubric['correctness'])
        self.assertTrue(rubric['exclusion'])
        self.assertFalse(assess(result, self.root, required=requirements,
                                forbidden_paths=['alternative.md'])['exclusion'])

    def test_no_permitted_alternative_must_abstain(self):
        abstention = dict(version=1, status='insufficient_evidence', answer=None, sources=[])
        self.assertTrue(assess(abstention, self.root, expected='insufficient_evidence')['correctness'])
        unrelated = self.result(('noise.md', 'An unrelated measurement is 75 percent.'))
        self.assertFalse(assess(unrelated, self.root, allow_abstention=True)['correctness'])

    def test_required_fact_cannot_be_borrowed_from_unrelated_source(self):
        for name, value in [('harbor.md', '20 to 4'), ('changed.md', '12 to 3')]:
            with self.subTest(name=name):
                result = self.result((name, 'The incident lasted 24 minutes.'), ('noise.md', value))
                rubric = assess(result, self.root, required=[('24 minutes', [name]), (value, [name])])
                self.assertFalse(rubric['correctness'])
                self.assertFalse(rubric['minimality'])

    def test_oracle_all_parts_and_changed_source_positions(self):
        for body in ['24 minutes\nConcurrency 20 to 4', 'Concurrency 20 to 4\n24 minutes']:
            result = self.result(('renamed.md', body))
            self.assertTrue(assess(result, self.root, required=[
                ('24 minutes', ['renamed.md']), ('20 to 4', ['renamed.md'])])['correctness'])
            result['sources'][0]['text'] += ' fabricated'
            self.assertFalse(assess(result, self.root, required=[('24 minutes', ['renamed.md'])])['correctness'])

    def test_negative_fact_and_missing_measurement_have_distinct_expected_status(self):
        negative = self.result(('e.md', 'The completed trial showed no improvement.'))
        self.assertTrue(assess(negative, self.root, required=[('no improvement', ['e.md'])])['correctness'])
        for text in ['Lifetime was not measured.', 'The trial is planned for November.', 'No marine biology observations.']:
            result = self.result(('e.md', text))
            self.assertFalse(assess(result, self.root, expected='insufficient_evidence')['correctness'])

    def test_executable_report_preserves_inputs_and_legacy_denominator(self):
        legacy = self.root / 'legacy.json'
        rubric = self.root / 'rubric.json'
        output = self.root / 'semantic.json'
        result = self.result(('a.md', 'Completion does not measure correctness.'))
        legacy.write_text(json.dumps(dict(passed=22, total=30, cases=[
            dict(case='compass', passed=False, result=result)])))
        rubric.write_text(json.dumps(dict(version='semantic-v2', cases={'compass': {
            'required': [['does not measure correctness', ['a.md']]],
            'illustrative': [['75 percent', ['a.md']]]}})))
        before = (legacy.read_bytes(), rubric.read_bytes())
        command = [sys.executable, str(pathlib.Path(__file__).with_name('score-semantic-rubric.py')),
                   str(legacy), str(self.root), str(rubric), str(output)]
        subprocess.run(command, check=True, capture_output=True)
        report = json.loads(output.read_text())
        self.assertEqual((report['legacy_passed'], report['legacy_total']), (22, 30))
        self.assertFalse(report['cases'][0]['legacy_passed'])
        self.assertTrue(report['cases'][0]['semantic']['correctness'])
        self.assertEqual(before, (legacy.read_bytes(), rubric.read_bytes()))
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
