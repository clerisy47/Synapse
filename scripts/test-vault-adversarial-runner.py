#!/usr/bin/env python3
"""Offline failure-reporting checks; no model or network request is made."""
import contextlib
import io
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

RUNNER = pathlib.Path(__file__).with_name('test-rust-vault-adversarial.py')

class RunnerFailureTests(unittest.TestCase):
    def run_case(self, process):
        with tempfile.TemporaryDirectory(prefix='synapse-runner-test-') as temp:
            root = pathlib.Path(temp)
            binary = root / 'binary'
            binary.write_bytes(b'fixture')
            vault = root / 'vault'
            vault.mkdir()
            (vault / 'note.md').write_text('original')
            report = root / 'report.json'
            with patch.object(sys, 'argv', [str(RUNNER), str(binary), str(report), str(vault)]), \
                 patch('urllib.request.urlopen', side_effect=OSError('offline')), \
                 patch('subprocess.run', side_effect=process), \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as stop:
                    runpy.run_path(str(RUNNER), run_name='__main__')
            self.assertEqual(stop.exception.code, 1)
            result = json.loads(report.read_text())
            self.assertEqual(result['total'], 11)
            self.assertEqual(result['passed'], 0)
            self.assertTrue(result['source_vault_unchanged'])
            self.assertFalse(result['runtime']['thinking_requested'])
            self.assertEqual(len(result['binary_sha256']), 64)
            return result

    def test_missing_process_is_recorded(self):
        result = self.run_case(OSError('missing'))
        self.assertTrue(all(row['failures'] == ['process-error'] for row in result['cases']))

    def test_timeout_is_recorded(self):
        result = self.run_case(subprocess.TimeoutExpired('fixture', 90))
        self.assertTrue(all(row['failures'] == ['timeout'] for row in result['cases']))

    def test_malformed_json_is_recorded(self):
        result = self.run_case(lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, b'bad', b''))
        self.assertTrue(all(row['failures'] == ['invalid-response'] for row in result['cases']))

    def test_missing_note_preserves_report(self):
        def process(command, **kwargs):
            root = pathlib.Path(command[command.index('--workspace') + 1])
            (root / 'Evidence.md').unlink()
            return subprocess.CompletedProcess(command, 0, b'{}', b'')
        result = self.run_case(process)
        self.assertTrue(all('note-unreadable-after-run' in row['failures'] for row in result['cases']))

if __name__ == '__main__':
    unittest.main()
