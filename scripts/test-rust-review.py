#!/usr/bin/env python3
"""TTY and non-TTY checks for preview dry-run and automatic note apply."""
import argparse
import json
import fcntl
import struct
import termios
import os
import pathlib
import pty
import select
import re
import subprocess
import sys
import tempfile
import time

from qualification_provider import add_provider_arguments, provider_options, provider_metadata
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary')
parser.add_argument('--live', action='store_true')
add_provider_arguments(parser)
args = parser.parse_args()
options = provider_options(parser, args)
binary = str(pathlib.Path(args.binary).resolve())

def run_tty(arguments, env, expected_status=0, expected_text=None):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    child = subprocess.Popen([binary, *arguments, *options], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
    pending = b''
    transcript = b''
    deadline = time.monotonic() + 80
    try:
        while child.poll() is None and time.monotonic() < deadline:
            if select.select([master], [], [], 0.05)[0]:
                try:
                    chunk = os.read(master, 4096)
                except OSError:
                    break
                pending += chunk
                transcript += chunk
                assert len(transcript) < 2_000_000, 'preview output exceeded bound'
                if b'Type Clear to confirm:' in pending:
                    pending = b''
                    os.write(master, b'Clear\n')
        assert child.poll() == expected_status, f'process failed: {transcript!r}'
        assert b'\x1b' not in transcript, 'control sequence escaped review renderer'
        assert b'Apply / cancel> ' not in transcript, 'Apply prompt must not appear'
        assert b'accept / skip> ' not in transcript, 'accept prompt must not appear'
        if expected_text is not None:
            assert expected_text in transcript, f'expected text missing: {transcript!r}'
        return transcript
    finally:
        if child.poll() is None:
            child.kill()
        os.close(master)
        os.close(slave)
        child.wait(timeout=3)

with tempfile.TemporaryDirectory(prefix='synapse-review-') as base:
    base = pathlib.Path(base).resolve()
    home, workspace = base / 'home', base / 'workspace'
    home.mkdir()
    workspace.mkdir()
    env = {**os.environ, 'HOME': str(home), 'NO_COLOR': '1'}
    env.pop('XDG_STATE_HOME', None)
    preview = subprocess.run([binary, 'setup', '--workspace', str(workspace), '--preview'], env=env, capture_output=True)
    assert preview.returncode == 0, f'setup preview failed: {preview.stderr!r}'
    assert b'Preview complete. No notes changed.' in preview.stdout, 'setup preview completion missing'
    assert not list(workspace.iterdir()), 'setup preview mutated workspace'
    for name, data, status in [
        ('malformed.md', b'---\ntags: [\n---\nprivate malformed sentinel\n', 2),
        ('invalid.md', b'---\ndescription: 17\n---\nprivate invalid sentinel\n', 2),
        ('oversized.md', b'x' * 6001, 1),
    ]:
        candidate = workspace / name
        candidate.write_bytes(data)
        refused = subprocess.run([binary, 'metadata', 'review', '--workspace', str(workspace), '--file', name, '--preview'], env=env, capture_output=True)
        assert refused.returncode == status, f'manual repair status for {name}'
        assert b'This note needs manual metadata repair' in refused.stdout
        assert data not in refused.stdout and data not in refused.stderr, 'manual-repair diagnostics disclosed note body'
        assert candidate.read_bytes() == data, 'manual-repair refusal changed bytes'
        candidate.unlink()
    (workspace / 'Research.md').write_text('The synthetic reactor uses 42 units per cycle.\n')
    before = (workspace / 'Research.md').read_bytes()
    captured = subprocess.run([binary, 'research', 'capture', '--workspace', str(workspace), '--file', 'Research.md', '--lines', '1:1', *options], env=env, capture_output=True)
    assert captured.returncode == 0, 'capture failed'
    assert (workspace / 'Research.md').read_bytes() == before, 'capture consumed inbox'
    contradictions = subprocess.run([binary, 'contradictions', '--workspace', str(workspace), '--json'], env=env, capture_output=True)
    assert contradictions.returncode == 0, 'contradictions listing failed'
    flags = json.loads(contradictions.stdout)
    assert flags['version'] == 1 and flags['flags'] == [], 'unexpected contradiction flags'
    if args.live:
        (workspace / 'Synapse').mkdir()
        (workspace / 'Synapse/Instructions.md').write_text("---\nsynapse-instructions: 1\ntimezone: UTC\ndestinations:\n  - id: notes\n    path: Notes.md\ndaily: null\n---\nKeep the single research paragraph concise.\n")
        preview_research = subprocess.run([binary, 'research', 'apply', '--workspace', str(workspace), '--capture', '1', '--preview', *options], env=env, capture_output=True)
        assert preview_research.returncode == 0, preview_research.stderr
        assert not (workspace / 'Notes.md').exists(), 'research preview wrote a note'
        note = workspace / 'missing.md'
        note.write_bytes(b'---\r\nexisting: preserve\r\n---\r\n# Synthetic reactor\r\nThe reactor uses 42 units per cycle.\r\n')
        metadata_before = note.read_bytes()
        reviewed = subprocess.run([binary, 'metadata', 'review', '--workspace', str(workspace), '--file', 'missing.md', '--preview', *options], env=env, capture_output=True)
        assert reviewed.returncode == 0, reviewed.stderr
        for required in [b'Target: missing.md', b'Full before bytes', b'Full after bytes', b'existing: preserve', b'description:', b'tags:', b'aliases:']:
            assert required in reviewed.stdout, f'metadata preview omitted {required!r}'
        assert note.read_bytes() == metadata_before, 'metadata preview wrote a note'
        assert (workspace / 'Research.md').read_bytes() == before, 'review consumed inbox'
    applied_workspace = base / 'apply-workspace'
    applied_workspace.mkdir()
    applied = subprocess.run([binary, 'setup', '--workspace', str(applied_workspace)], env=env, capture_output=True)
    assert applied.returncode == 0, f'auto setup failed: {applied.stderr!r}{applied.stdout!r}'
    assert b'Applied files:' in applied.stdout, 'auto setup completion missing'
    assert (applied_workspace / 'Synapse/Instructions.md').exists(), 'setup did not install starter'
    assert (applied_workspace / 'Research.md').exists(), 'setup did not install inbox'
    assert (workspace / 'Research.md').read_bytes() == before, 'setup overwrote existing inbox'
    if args.live:
        applied_meta = subprocess.run([binary, 'metadata', 'review', '--workspace', str(workspace), '--file', 'missing.md', *options], env=env, capture_output=True)
        assert applied_meta.returncode == 0, applied_meta.stderr
        assert note.read_bytes() != metadata_before, 'metadata auto-apply made no change'
        assert b'existing: preserve\r\n' in note.read_bytes(), 'metadata lost existing frontmatter'
        assert note.read_bytes().endswith(b'# Synthetic reactor\r\nThe reactor uses 42 units per cycle.\r\n'), 'metadata changed body bytes'
        history = subprocess.run([binary, 'recovery', '--workspace', str(workspace)], env=env, capture_output=True)
        assert history.returncode == 0 and b'applied' in history.stdout, 'recovery listing failed'
        record_id = re.search(rb'([0-9a-f]{64}) applied missing.md', history.stdout)
        assert record_id, 'applied recovery record missing'
        revert = subprocess.run([binary, 'recovery', '--workspace', str(workspace), '--revert', record_id[1].decode()], env=env, capture_output=True)
        assert revert.returncode == 0, revert.stderr
        assert note.read_bytes() == metadata_before, 'revert did not restore exact bytes'
    indexed = applied_workspace / 'indexed.md'
    indexed_bytes = b'---\ndescription: Synthetic cache clearing fixture\ntags: [fixture]\naliases: []\n---\nThe synthetic snapshot marker is present.\n'
    indexed.write_bytes(indexed_bytes)
    searched = subprocess.run([binary, 'search', '--workspace', str(applied_workspace), 'snapshot', '--json', *options], env=env, capture_output=True)
    assert searched.returncode == 0 and json.loads(searched.stdout)['sources'], 'index fixture search failed'
    index_files = list(home.rglob('index-v1.sqlite3*'))
    assert index_files, 'persistent index was not created'
    journals = [(path, json.loads(path.read_text())) for path in home.rglob('journal-v1.json')]
    journal_path, journal = next((path, value) for path, value in journals if any(record['proposal']['target']['path'] == 'Synapse/Instructions.md' for record in value['records']))
    uncertain_id = journal['records'][0]['id']
    journal['records'][0]['outcome'] = 'Unknown'
    journal_path.write_text(json.dumps(journal))
    run_tty(['data', 'clear', '--workspace', str(applied_workspace)], env, expected_text=b'Local history cleared.')
    assert all(not path.exists() for path in index_files), 'clear retained index database or sidecars'
    assert indexed.read_bytes() == indexed_bytes, 'clear changed an indexed note'
    retained = json.loads(journal_path.read_text())
    assert [record['id'] for record in retained['records']] == [uncertain_id], 'clear discarded unresolved recovery or kept resolved history'
    assert retained['epoch'] > journal['epoch'], 'clear did not bump journal epoch'
    assert (applied_workspace / 'Research.md').exists(), 'clear changed a note'

print('Preview dry-run, auto-apply setup, capture and contradiction listing passed')
