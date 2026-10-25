#!/usr/bin/env python3
"""Offline adversarial tests for the live-vault result validator."""
import ast
import contextlib
import copy
import io
import json
import runpy
import subprocess
import sys
from unittest import mock
import pathlib
import tempfile
import unittest
from vault_validation import validate_result


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / 'workspace'
        self.root.mkdir()
        (self.root / 'bread.md').write_text('Water: 350 g.\n')
        self.valid = {'version': 1, 'status': 'answered', 'answer': 'Water: 350 g.',
                      'sources': [{'id': 1, 'path': 'bread.md', 'start_line': 1,
                                   'end_line': 1, 'text': 'Water: 350 g.'}]}

    def check(self, value):
        return validate_result(value, self.root, facts=['350 g'], paths=['bread.md'],
                               fact_sources={'350 g': ['bread.md']})

    def test_stats_flag_is_only_supplied_to_ask(self):
        script=pathlib.Path(__file__).with_name('test-rust-vault.py').resolve()
        tree=ast.parse(script.read_text())
        prompts=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='EXPECTED_QUERIES' for target in node.targets))
        vault=pathlib.Path(self.temp.name)/'instrumentation-vault';vault.mkdir()
        header='---\ndescription: Synthetic instrumentation fixture\ntags: [fixture]\naliases: []\n---\n'
        (vault/'Test Queries.md').write_text(header+'| Question |\n| --- |\n'+''.join('| '+question+' |\n' for question in prompts))
        (vault/'note.md').write_text(header+'Synthetic fact.\n')
        binary=pathlib.Path(self.temp.name)/'synthetic-binary';binary.write_bytes(b'synthetic test executable')
        calls=[]
        def execute(command,**kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command,0,json.dumps({'version':1,'status':'insufficient_evidence','answer':None,'sources':[]}).encode(),b'')
        with mock.patch.object(sys,'argv',[str(script),str(binary),str(vault),str(pathlib.Path(self.temp.name)/'instrumentation.json')]),mock.patch('subprocess.run',side_effect=execute),mock.patch('urllib.request.urlopen',side_effect=OSError),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):runpy.run_path(str(script),run_name='__main__')
        self.assertTrue(any(command[1]=='search' for command in calls))
        self.assertTrue(any(command[1]=='ask' for command in calls))
        for command in calls:self.assertEqual('--stats' in command,command[1]=='ask')

    def test_valid(self):
        self.assertEqual(self.check(self.valid), [])

    def test_answer_must_be_nonblank_source_projection(self):
        for answer in (None, '', '   ', 7, 'Invented answer'):
            with self.subTest(answer=answer):
                self.assertTrue(self.check(dict(self.valid, answer=answer)))

    def test_report_survives_source_disappearance(self):
        script = pathlib.Path(__file__).with_name('test-rust-vault.py').resolve()
        tree = ast.parse(script.read_text(encoding='utf-8'))
        prompts = next(ast.literal_eval(node.value) for node in tree.body
                       if isinstance(node, ast.Assign)
                       and any(isinstance(target, ast.Name) and target.id == 'EXPECTED_QUERIES'
                               for target in node.targets))
        vault = pathlib.Path(self.temp.name) / 'synthetic-vault'
        vault.mkdir()
        victim = vault / 'victim.md'
        victim.write_text('Synthetic removable fixture.\n', encoding='utf-8')
        (vault / 'Test Queries.md').write_text('| Question |\n| --- |\n' +
            ''.join('| ' + question + ' |\n' for question in prompts), encoding='utf-8')
        fake = pathlib.Path(self.temp.name) / 'fake-synapse'
        fake.write_text('#!' + sys.executable + '\n'
            'import json, pathlib, sys\n'
            'root = pathlib.Path(sys.argv[sys.argv.index("--workspace") + 1])\n'
            '(root / "victim.md").unlink(missing_ok=True)\n'
            'print(json.dumps({"version":1,"status":"insufficient_evidence","answer":None,"sources":[]}))\n',
            encoding='utf-8')
        fake.chmod(0o700)
        report = pathlib.Path(self.temp.name) / 'report.json'
        with mock.patch.object(sys, 'argv', [str(script), str(fake), str(vault), str(report)]), \
             mock.patch('urllib.request.urlopen', side_effect=OSError), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as exit_status:
                runpy.run_path(str(script), run_name='__main__')
        self.assertEqual(exit_status.exception.code, 1)
        result = json.loads(report.read_text(encoding='utf-8'))
        self.assertFalse(result['source_vault_unchanged'])
        self.assertEqual(result['original_missing_metadata'], 2)
        self.assertIn('victim.md', result['original_sha256'])
        self.assertEqual(len(result['documented_prompts']), 10)

    def harness_failure_report(self, failure, corrupt_baseline=False):
        script = pathlib.Path(__file__).with_name('test-rust-vault.py').resolve()
        tree = ast.parse(script.read_text(encoding='utf-8'))
        prompts = next(ast.literal_eval(node.value) for node in tree.body
                       if isinstance(node, ast.Assign)
                       and any(isinstance(target, ast.Name) and target.id == 'EXPECTED_QUERIES'
                               for target in node.targets))
        with tempfile.TemporaryDirectory(dir=self.temp.name) as base:
            base = pathlib.Path(base)
            vault = base / 'vault'
            vault.mkdir()
            (vault / 'Test Queries.md').write_text('| Question |\n| --- |\n' +
                ''.join('| ' + question + ' |\n' for question in prompts), encoding='utf-8')
            if corrupt_baseline:
                (vault / 'invalid.md').write_bytes(b'\xff\xfe')
            before = {p.name: p.read_bytes() for p in vault.iterdir()}
            binary = base / 'fake-binary'
            binary.write_bytes(b'synthetic executable identity')
            report = base / 'report.json'
            patch_options = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
            with mock.patch.object(sys, 'argv', [str(script), str(binary), str(vault), str(report)]), \
                 mock.patch('urllib.request.urlopen', side_effect=OSError), \
                 mock.patch('subprocess.run', **patch_options) as execution, \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit_status:
                    runpy.run_path(str(script), run_name='__main__')
            self.assertEqual(exit_status.exception.code, 1)
            result = json.loads(report.read_text(encoding='utf-8'))
            self.assertTrue(result['source_vault_unchanged'])
            self.assertTrue(result['prepared_copy_unchanged'])
            self.assertEqual(before, {p.name: p.read_bytes() for p in vault.iterdir()})
            self.assertTrue(result['cases'])
            self.assertLess(result['passed'], result['total'])
            self.assertEqual(set(result['original_sha256']), set(before))
            if corrupt_baseline:
                execution.assert_not_called()
            else:
                execution.assert_called()
            return result

    def test_harness_retains_report_for_invalid_utf8_output(self):
        result = self.harness_failure_report(subprocess.CompletedProcess([], 0, b'\xff', b''))
        self.assertTrue(any('invalid-json' in row['failures'] for row in result['cases']))
        self.assertGreater(len(result['cases']), 1)

    def test_harness_retains_report_for_timeout(self):
        result = self.harness_failure_report(subprocess.TimeoutExpired('synthetic', 90))
        self.assertTrue(any('timeout' in row['failures'] for row in result['cases']))
        self.assertGreater(len(result['cases']), 1)

    def test_harness_retains_report_for_launch_failure(self):
        result = self.harness_failure_report(OSError('PRIVATE_ERROR_SENTINEL'))
        self.assertTrue(any('harness-error' in row['failures'] for row in result['cases']))
        self.assertNotIn('PRIVATE_ERROR_SENTINEL', json.dumps(result))

    def test_harness_retains_report_for_invalid_utf8_baseline(self):
        result = self.harness_failure_report(subprocess.CompletedProcess([], 0, b'{}', b''),
                                             corrupt_baseline=True)
        self.assertTrue(any('harness-error' in row['failures'] for row in result['cases']))

    def test_bool_version_and_source_id_are_rejected(self):
        self.assertIn('version', self.check(dict(self.valid, version=True)))
        result = copy.deepcopy(self.valid)
        result['sources'][0]['id'] = True
        self.assertIn('source-id', self.check(result))

    def test_invalid_utf8_cited_note(self):
        (self.root / 'bread.md').write_bytes(b'\xff\xfe')
        self.assertIn('source-unreadable', self.check(self.valid))

    def test_symlink_ancestor_is_rejected_before_read(self):
        outside = pathlib.Path(self.temp.name) / 'outside'
        outside.mkdir()
        (outside / 'bread.md').write_text('Water: 350 g.', encoding='utf-8')
        (self.root / 'linked').symlink_to(outside, target_is_directory=True)
        result = copy.deepcopy(self.valid)
        result['sources'][0]['path'] = 'linked/bread.md'
        with mock.patch.object(pathlib.Path, 'read_text', side_effect=AssertionError('outside read')):
            self.assertIn('unsafe-path', self.check(result))

    def test_malformed_results(self):
        for value in (None, [], 42, 'bad'):
            with self.subTest(value=value):
                self.assertIn('result-shape', self.check(value))
        for sources in (None, {}, 'bad', 42):
            value = dict(self.valid, sources=sources)
            self.assertIn('sources-shape', self.check(value))
        self.assertIn('source-shape', self.check(dict(self.valid, sources=[None])))

    def test_malformed_source_fields(self):
        for field, values in {'start_line': [True, '1', None, 0],
                              'end_line': [False, '1', None, 20],
                              'path': [None, 7, '../outside.md', '/outside.md', './bread.md'],
                              'text': [None, 9, 'wrong']}.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    result = copy.deepcopy(self.valid)
                    result['sources'][0][field] = value
                    self.assertTrue(self.check(result))
        for field in self.valid['sources'][0]:
            result = copy.deepcopy(self.valid)
            del result['sources'][0][field]
            self.assertTrue(self.check(result))

    def test_missing_and_outside_symlink(self):
        outside = pathlib.Path(self.temp.name) / 'outside.md'
        outside.write_text('OUTSIDE_SENTINEL')
        (self.root / 'link.md').symlink_to(outside)
        for path, failure in [('missing.md', 'source-unreadable'), ('link.md', 'unsafe-path')]:
            result = copy.deepcopy(self.valid)
            result['sources'][0]['path'] = path
            self.assertIn(failure, self.check(result))

    def test_exclusions_and_controls(self):
        for path in ('Research.md', 'Instructions.md', '.private.md', 'bread.txt'):
            result = copy.deepcopy(self.valid)
            result['sources'][0]['path'] = path
            self.assertIn('excluded-path', self.check(result))
        self.assertIn('excluded-path', validate_result(self.valid, self.root,
                                                      forbidden_prefix='bread'))

    def test_wrong_source_fact(self):
        (self.root / 'bread.md').write_text('Bread ferments slowly.\n')
        (self.root / 'unrelated.md').write_text('Water: 350 g.\n')
        result = copy.deepcopy(self.valid)
        result['sources'][0]['text'] = 'Bread ferments slowly.'
        result['sources'].append({'id': 2, 'path': 'unrelated.md', 'start_line': 1,
                                  'end_line': 1, 'text': 'Water: 350 g.'})
        self.assertIn('unsupported-fact:350 g', self.check(result))

    def test_counterexample_requires_context_in_its_own_verified_passage(self):
        content = '# Hazard\nThis describes an unsafe anti-pattern.\n- Dangerous example.\n'
        (self.root / 'hazard.md').write_text(content)
        requirement = [{'name': 'hazard', 'path': 'hazard.md',
                        'triggers': ['Dangerous example.'],
                        'required': ['# Hazard', 'This describes an unsafe anti-pattern.']}]
        def source(start, end, ordinal=1):
            return {'id': ordinal, 'path': 'hazard.md', 'start_line': start,
                    'end_line': end, 'text': '\n'.join(content.splitlines()[start-1:end])}
        def result(sources):
            return {'version': 1, 'status': 'answered',
                    'answer': '\n\n'.join(item['text'] for item in sources), 'sources': sources}
        for sources in ([source(3, 3)], [source(1, 2), source(3, 3, 2)]):
            self.assertIn('missing-context:hazard', validate_result(
                result(sources), self.root, context_requirements=requirement))
        self.assertEqual(validate_result(result([source(1, 3)]), self.root,
                                        context_requirements=requirement), [])
        self.assertEqual(validate_result(result([source(1, 2)]), self.root,
                                        context_requirements=requirement), [])

    def test_abstention_requires_no_content(self):
        result = {'version': 1, 'status': 'insufficient_evidence', 'answer': None, 'sources': []}
        self.assertEqual(validate_result(result, self.root, 'insufficient_evidence'), [])
        result['answer'] = 'Unsupported answer'
        self.assertIn('unsupported-content', validate_result(result, self.root, 'insufficient_evidence'))


if __name__ == '__main__':
    unittest.main()
