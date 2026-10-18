#!/usr/bin/env python3
"""Real POSIX PTY root validation and malicious filename display checks."""
import errno
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "target/release/synapse"

def invoke(root):
    master, slave = pty.openpty()
    process = subprocess.Popen([str(BINARY), "--workspace", str(root)],
                               stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    output = bytearray()
    deadline = time.monotonic() + 10
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    part = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not part:
                    break
                output.extend(part)
            elif process.poll() is not None:
                break
        else:
            process.kill()
            raise AssertionError("PTY subprocess timed out")
        return process.wait(timeout=5), bytes(output)
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.wait()

with tempfile.TemporaryDirectory(prefix="synapse-pty-") as directory:
    root = Path(directory) / "研究\x1b]8;;evil\x07\u202e.md"
    root.mkdir()
    before = os.stat(root).st_mtime_ns
    code, output = invoke(root)
    assert code == 1 and b"NOT_IMPLEMENTED" in output, output
    assert b"Workspace: " in output and b"\x1b" not in output and b"\x07" not in output
    assert b"\\u{1b}" in output and b"\\u{202e}" in output
    assert os.stat(root).st_mtime_ns == before and not list(root.iterdir())
    code, output = invoke(Path(directory) / "secret-missing-root")
    assert code == 2 and output == b"INVALID_WORKSPACE\r\n", output
print("Real PTY root validation, sanitization and no-write smoke passed")
