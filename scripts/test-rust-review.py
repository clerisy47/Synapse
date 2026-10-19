#!/usr/bin/env python3
"""Real TTY preview test: full paging, acceptance, and zero note mutations."""
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

binary = str(pathlib.Path(sys.argv[1]).resolve())

def preview(arguments, env, apply=False, before_apply=None, expected_status=0, expected_text=None):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    child = subprocess.Popen([binary, *arguments], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
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
                elif b'next / skip> ' in pending:
                    pending = b''
                    os.write(master, b'next\n')
                elif b'Apply / cancel> ' in pending:
                    pending = b''
                    if before_apply:
                        before_apply()
                    os.write(master, b'Apply\n')
                elif b'accept / skip> ' in pending:
                    pending = b''
                    os.write(master, b'accept\n')
        assert child.poll() == expected_status, f'preview process failed: {transcript!r}'
        assert b'\x1b' not in transcript, 'control sequence escaped review renderer'
        expected = expected_text if expected_text is not None else (b'Applied files:' if apply else b'Preview complete. No notes changed.')
        assert expected in transcript, f'review completion missing: {transcript!r}'
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
    denied = subprocess.run([binary, 'setup', '--workspace', str(workspace)], input=b'Apply\n', env=env, capture_output=True)
    assert denied.returncode == 2, 'piped input was accepted for setup'
    transcript = preview(['setup', '--workspace', str(workspace), '--preview'], env)
    assert b'Create folder: Synapse' in transcript, 'folder creation was not reviewed'
    assert not list(workspace.iterdir()), 'setup generation mutated workspace'
    (workspace / 'Research.md').write_text('The synthetic reactor uses 42 units per cycle.\n')
    before = (workspace / 'Research.md').read_bytes()
    captured = subprocess.run([binary, 'research', 'capture', '--workspace', str(workspace), '--file', 'Research.md', '--lines', '1:1'], env=env, capture_output=True)
    assert captured.returncode == 0, 'capture failed'
    assert (workspace / 'Research.md').read_bytes() == before, 'capture consumed inbox'
    if '--live' in sys.argv[2:]:
        (workspace / 'Synapse').mkdir()
        (workspace / 'Synapse/Instructions.md').write_text("---\nsynapse-instructions: 1\ntimezone: UTC\ndestinations:\n  - id: notes\n    path: Notes.md\ndaily: null\n---\nKeep the single research paragraph concise.\n")
        preview(['research', 'review', '--workspace', str(workspace), '--capture', '1', '--preview'], env)
        assert not (workspace / 'Notes.md').exists(), 'research generation wrote a note'
        note = workspace / 'missing.md'
        note.write_bytes(b'---\r\nexisting: preserve\r\n---\r\n# Synthetic reactor\r\nThe reactor uses 42 units per cycle.\r\n')
        metadata_before = note.read_bytes()
        preview(['metadata', 'review', '--workspace', str(workspace), '--file', 'missing.md', '--preview'], env)
        assert note.read_bytes() == metadata_before, 'metadata generation wrote a note'
        assert (workspace / 'Research.md').read_bytes() == before, 'review consumed inbox'
    applied_workspace = base / 'apply-workspace'
    applied_workspace.mkdir()
    preview(['setup', '--workspace', str(applied_workspace)], env, apply=True)
    assert (applied_workspace / 'Synapse/Instructions.md').exists(), 'setup did not install starter'
    assert (applied_workspace / 'Research.md').exists(), 'setup did not install inbox'
    assert (workspace / 'Research.md').read_bytes() == before, 'setup overwrote existing inbox'
    stale_workspace = base / 'stale-workspace'
    stale_workspace.mkdir()
    preview(['setup', '--workspace', str(stale_workspace)], env,
            before_apply=lambda: (stale_workspace / 'Research.md').write_text('External edit\n'),
            expected_status=3, expected_text=b'conflict')
    assert not (stale_workspace / 'Synapse/Instructions.md').exists(), 'stale review wrote a file'
    if '--live' in sys.argv[2:]:
        preview(['metadata', 'review', '--workspace', str(workspace), '--file', 'missing.md'], env, apply=True)
        assert note.read_bytes() != metadata_before, 'metadata Apply made no change'
        history = preview(['recovery', '--workspace', str(workspace)], env, expected_text=b'applied')
        record_id = re.search(rb'([0-9a-f]{64}) applied missing.md', history)
        assert record_id, 'applied recovery record missing'
        preview(['recovery', '--workspace', str(workspace), '--revert', record_id[1].decode()], env, apply=True)
        assert note.read_bytes() == metadata_before, 'revert did not restore exact bytes'
    preview(['data', 'clear', '--workspace', str(applied_workspace)], env, expected_text=b'Local history cleared.')
    assert (applied_workspace / 'Research.md').exists(), 'clear changed a note'

print('Real TTY previews, per-page/per-file acceptance, piped refusal, capture and unchanged notes passed')
