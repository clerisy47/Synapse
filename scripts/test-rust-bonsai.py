#!/usr/bin/env python3
"""Opt-in native CLI smoke against the user-managed local Bonsai runtime."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

binary = str(pathlib.Path(sys.argv[1]).resolve())
report = []
with tempfile.TemporaryDirectory(prefix='synapse-bonsai-cli-') as base:
    base = pathlib.Path(base).resolve()
    home, workspace = base / 'home', base / 'workspace'
    home.mkdir()
    workspace.mkdir()
    (workspace / 'moon.md').write_text('---\ndescription: Synthetic astronomy\ntags: [fixture]\naliases: []\n---\nThe synthetic moon orbits at 42 units.\n')
    (workspace / 'ignored.md').write_text('---\ndescription: Synthetic excluded archive\ntags: [fixture]\naliases: []\nvault-synapse: ignore\n---\nThe password for the synthetic archive is lilac.\n')
    snapshots = {path.name: path.read_bytes() for path in workspace.iterdir()}
    env = {**os.environ, 'HOME': str(home)}
    env.pop('XDG_STATE_HOME', None)
    cases = [
        ('supported-orbit', 'At what distance does the synthetic moon orbit?', 'answered'),
        ('unsupported-color', "What is the synthetic moon's color?", 'insufficient_evidence'),
        ('excluded-archive', 'What is the password for the synthetic archive?', 'insufficient_evidence'),
    ]
    for case, question, expected in cases:
        start = time.monotonic()
        output = subprocess.run([binary, 'ask', '--workspace', str(workspace), question, '--json'], env=env, capture_output=True, timeout=80)
        assert output.returncode == 0, f'{case}: unexpected exit'
        result = json.loads(output.stdout)
        assert result['version'] == 1 and result['status'] == expected, f'{case}: incorrect outcome'
        assert question.encode() not in output.stderr, f'{case}: diagnostic content leak'
        assert b'lilac' not in output.stdout + output.stderr, f'{case}: excluded content leaked'
        if expected == 'answered':
            assert '42 units' in result['answer'], f'{case}: missing supported fact'
            assert result['sources'][0]['path'] == 'moon.md' and result['sources'][0]['start_line'] == 6, f'{case}: wrong coordinates'
        report.append({'case': case, 'passed': True, 'seconds': round(time.monotonic() - start, 3)})
    assert {path.name: path.read_bytes() for path in workspace.iterdir()} == snapshots, 'read-only query mutated notes'
print(json.dumps({'runtime': 'local Bonsai 9B PQ2_0, 4096 context, one slot, thinking disabled', 'passed': len(report), 'total': len(cases), 'cases': report}))
