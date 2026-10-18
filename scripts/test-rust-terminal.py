#!/usr/bin/env python3
"""Real POSIX PTY lifecycle smoke; synthetic empty workspace, no model required."""
import fcntl
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

binary = str(pathlib.Path(sys.argv[1]).resolve())

def until(fd, marker, timeout=5):
    output = b''
    deadline = time.monotonic() + timeout
    while marker not in output and time.monotonic() < deadline:
        if select.select([fd], [], [], 0.05)[0]:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            assert len(output) < 65536, 'unbounded terminal output'
    assert marker in output, 'terminal marker missing'
    return output

with tempfile.TemporaryDirectory(prefix='synapse-pty-') as workspace:
    for action, expected in [(b'/quit\n', 0), (b'\x03', 130), (b'\x04', 0)]:
        master, slave = pty.openpty()
        original = termios.tcgetattr(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 16, 0, 0))
        child = subprocess.Popen([binary, '--workspace', workspace], stdin=slave, stdout=slave, stderr=slave, start_new_session=True, env={**os.environ, 'NO_COLOR': '1'})
        try:
            startup = until(master, b'synapse> ')
            assert b'Workspace: ' in startup
            os.write(master, 'unmatched 界界\n'.encode())
            answer = until(master, b'synapse> ')
            assert b'Insufficient evidence' in answer
            assert b'\x1b' not in startup + answer
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 8, 0, 0))
            os.write(master, b'still unknown\n')
            assert b'Insufficient evidence' in until(master, b'synapse> ')
            if action == b'\x03':
                child.send_signal(signal.SIGINT)
            else:
                os.write(master, action)
            deadline = time.monotonic() + 3
            tail = b''
            while child.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.02)[0]:
                    try:
                        tail += os.read(master, 4096)
                    except OSError:
                        time.sleep(0.01)
                    assert len(tail) < 65536, 'unbounded shutdown output'
            assert child.poll() == expected, f'terminal exit failed for {action!r}' 
            assert termios.tcgetattr(slave) == original, 'terminal state changed'
        finally:
            if child.poll() is None:
                child.kill()
                os.close(master)
                master = -1
                child.wait(timeout=3)
            if master != -1:
                os.close(master)
            os.close(slave)
print('Real PTY: Unicode, narrow resize, NO_COLOR, conversation, quit, Ctrl-C, EOF and terminal restoration passed')

if '--live' in sys.argv[2:]:
    with tempfile.TemporaryDirectory(prefix='synapse-pty-live-') as base:
        base = pathlib.Path(base).resolve()
        home, workspace = base / 'home', base / 'workspace'
        home.mkdir()
        workspace.mkdir()
        note = workspace / 'moon.md'
        note.write_text('---\ndescription: Synthetic astronomy\ntags: [fixture]\naliases: []\nvault-synapse: keep\n---\nThe synthetic moon orbits at 42 units.\n\x1b]52;c;synthetic\x07\u202e\n')
        master, slave = pty.openpty()
        original = termios.tcgetattr(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
        env = {**os.environ, 'HOME': str(home), 'NO_COLOR': '1'}
        env.pop('XDG_STATE_HOME', None)
        child = subprocess.Popen([binary, '--workspace', str(workspace)], stdin=slave, stdout=slave, stderr=slave, start_new_session=True, env=env)
        try:
            startup = until(master, b'synapse> ')
            os.write(master, b'At what distance does the synthetic moon orbit?\n')
            answer = until(master, b'synapse> ', timeout=80)
            assert b'42 units' in answer and b'moon.md:7-' in answer, 'live grounded answer missing'
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 16, 0, 0))
            os.write(master, b'/source 1\n')
            inspected = until(master, b'synapse> ')
            assert b'42 units' in inspected.replace(b'\r\n', b''), 'source inspection missing'
            assert b'\x1b' not in startup + answer + inspected and b'\x07' not in answer + inspected, 'terminal controls escaped boundary'
            assert '\u202e'.encode() not in answer + inspected, 'direction control escaped boundary'
            note.write_text(note.read_text().replace('vault-synapse: keep', 'vault-synapse: ignore'))
            os.write(master, b'/source 1\n')
            refused = until(master, b'synapse> ')
            assert b'access_refused' in refused and b'42 units' not in refused, 'stale source leaked after exclusion'
            os.write(master, b'/quit\n')
            deadline = time.monotonic() + 3
            while child.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.02)[0]:
                    try:
                        os.read(master, 4096)
                    except OSError:
                        pass
            assert child.poll() == 0, 'session did not exit after refused source'
            assert termios.tcgetattr(slave) == original, 'live terminal state changed'
        finally:
            if child.poll() is None:
                child.kill()
            os.close(master)
            os.close(slave)
            child.wait(timeout=3)
    print('Live PTY: Bonsai grounded answer, source inspection, resize, malicious controls and exclusion invalidation passed')
