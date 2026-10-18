#!/usr/bin/env python3
"""Real controlling-PTY lifecycle plus scripted-port terminal integration.
The driver uses synthetic model decisions; it is never a live-model quality gate.
"""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "target/release/synapse"
DRIVER = ROOT / "target/release/examples/terminal-driver"

def controlling_terminal():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)

class Terminal:
    def __init__(self, binary, args, env):
        self.master, slave = pty.openpty()
        self.attrs = termios.tcgetattr(self.master)
        self.process = subprocess.Popen([str(binary), *args], stdin=slave, stdout=slave,
                                        stderr=slave, env=env, preexec_fn=controlling_terminal)
        os.close(slave)
        self.output = bytearray()
        self.cursor = 0
    def send(self, text):
        os.write(self.master, text)
    def read(self):
        if select.select([self.master], [], [], 0.05)[0]:
            try:
                part = os.read(self.master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    return False
                raise
            self.output.extend(part)
            return bool(part)
        return self.process.poll() is None
    def until(self, marker, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            index = self.output.find(marker, self.cursor)
            if index >= 0:
                result = bytes(self.output[self.cursor:index+len(marker)])
                self.cursor = index + len(marker)
                return result
            if not self.read():
                break
        raise AssertionError(("PTY marker missing", marker, bytes(self.output)))
    def finish(self, expected):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self.read():
            pass
        assert self.process.wait(timeout=3) == expected, bytes(self.output)
        assert termios.tcgetattr(self.master) == self.attrs, "terminal modes changed"
        return bytes(self.output)
    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        os.close(self.master)

with tempfile.TemporaryDirectory(prefix="synapse-terminal-") as directory:
    base = Path(directory).resolve()
    env = dict(os.environ, HOME=str(base), XDG_STATE_HOME=str(base / "state"),
               NO_COLOR="1", COLUMNS="12")
    root = base / "研究\x1b]8;;evil\x07\u202e.md"
    root.mkdir()
    session = Terminal(BINARY, ["--workspace", str(root)], env)
    try:
        output = session.until(b"synapse> ")
        assert b"Workspace: " in output and b"\x1b" not in output and b"\x07" not in output
        assert b"\\u{1b}" in output and b"\\u{202e}" in output
        session.send(b"/quit\n")
        session.finish(0)
        assert not list(root.iterdir())
        # Starting/quitting a session does not create state or contact a model.
        assert sorted(p.name for p in base.iterdir()) == [root.name]
    finally:
        session.close()
    missing = Terminal(BINARY, ["--workspace", str(base / "secret-missing-root")], env)
    try:
        assert missing.finish(2) == b"INVALID_WORKSPACE\r\n"
    finally:
        missing.close()

    workspace = base / "workspace"
    workspace.mkdir()
    text = "Aurora uses cobalt. \x1b]8;;bad\x07 \u202e研究"
    def note(body, tags="public"):
        return f"---\ndescription: synthetic\ntags: [{tags}]\naliases: []\n---\n{body}\n"
    public = workspace / "研究.md"
    public.write_text(note(text))
    (workspace / "private.md").write_text(note("EXCLUDED_SENTINEL", "private"))
    (workspace / "Synapse").mkdir()
    (workspace / "Synapse/Instructions.md").write_text(note("EXCLUDED_SENTINEL"))
    initial = {str(p.relative_to(workspace)): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in workspace.rglob("*.md")}
    args = ["--workspace", str(workspace), "--exclude-tag", "private"]

    # Product binary, real filesystem, offline search and source inspection.
    session = Terminal(BINARY, args, env)
    try:
        session.until(b"synapse> ")
        session.send(b"/search Aurora\n")
        output = session.until(b"synapse> ")
        assert b":6-6" in output and b"EXCLUDED_SENTINEL" not in output
        assert b"\x1b" not in output and b"\x07" not in output
        session.send(b"/source 1\n")
        assert b":6-6" in session.until(b"synapse> ")
        session.send(b"\x03")  # Real terminal-generated SIGINT, not just a mocked token.
        output = session.finish(130)
        assert b"CANCELLED" in output
    finally:
        session.close()

    native_error = subprocess.run([str(BINARY), "ask", "--workspace", str(base / "secret-absent"), "secret-question", "--json"], env=env, capture_output=True, timeout=5)
    assert native_error.returncode == 2
    assert json.loads(native_error.stdout) == dict(version=1, status="error", code="INVALID_WORKSPACE")
    assert native_error.stderr == b"INVALID_WORKSPACE\n"
    invalid_utf8 = subprocess.run([str(BINARY), "ask", "--workspace", str(workspace), b"bad-\xff-question", "--json"], env=env, capture_output=True, timeout=5)
    assert invalid_utf8.returncode == 2
    assert json.loads(invalid_utf8.stdout) == dict(version=1, status="error", code="USAGE")
    assert invalid_utf8.stderr == b"USAGE\n"
    remote_tty = Terminal(DRIVER, [*args, "--provider", "openrouter", "--model", "test/model"], env)
    try:
        remote_tty.until(b"anything else to refuse:")
        remote_tty.send(b"refuse\n")
        output = remote_tty.finish(3)
        assert b"REMOTE_CONSENT_REQUIRED" in output and b"Verified passages" not in output
    finally:
        remote_tty.close()

    def ask(question, *flags):
        return subprocess.run([str(DRIVER), "ask", *args, question, "--json", *flags],
                              env=env, input=b"Apply\nyes\n", capture_output=True, timeout=10)
    supported = ask("Aurora")
    assert supported.returncode == 0, supported.stderr
    answer = json.loads(supported.stdout)
    assert set(answer) == {"version", "status", "answer", "sources"}
    assert answer["version"] == 1 and answer["status"] == "supported"
    assert answer["sources"][0] == dict(id=1, path="研究.md", start_line=6, end_line=6, text=text)
    assert b"\x1b" not in supported.stdout and "\u202e".encode() not in supported.stdout
    assert b"EXCLUDED_SENTINEL" not in supported.stdout + supported.stderr
    insufficient = ask("unsupported Aurora")
    assert insufficient.returncode == 0
    assert json.loads(insufficient.stdout)["status"] == "insufficient_evidence"
    assert json.loads(insufficient.stdout)["sources"] == []
    invalid = ask("invalid Aurora")
    assert invalid.returncode == 1
    assert json.loads(invalid.stdout) == dict(version=1, status="error", code="MODEL_FORMAT")
    assert b"cobalt" not in invalid.stdout + invalid.stderr
    remote = ask("Aurora", "--provider", "openrouter", "--model", "test/model")
    assert remote.returncode == 3
    assert json.loads(remote.stdout)["code"] == "REMOTE_CONSENT_REQUIRED"
    assert initial == {str(p.relative_to(workspace)): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in workspace.rglob("*.md")}

    # Scripted session exercises the production chat/terminal with real notes and PTY.
    session = Terminal(DRIVER, args, env)
    try:
        session.until(b"synapse> ")
        session.send(b"Aurora\n")
        assert b"Verified passages" in session.until(b"synapse> ")
        # An exclusion edit invalidates the source before local inspection.
        public.write_text(note("EXCLUDED_SENTINEL", "private"))
        session.send(b"/source 1\n")
        output = session.until(b"synapse> ")
        assert b"EVIDENCE_STALE" in output and b"EXCLUDED_SENTINEL" not in output
        public.write_text(note(text))
        session.send(b"delayed Aurora\n")
        session.until(b"MODEL_STARTED")
        session.send(b"\x03")
        tail = session.finish(130)[session.cursor:]
        assert b"CANCELLED" in tail and b"Verified passages" not in tail
    finally:
        session.close()
    cancelled = subprocess.Popen([str(DRIVER), "ask", *args, "delayed Aurora", "--json"],
                                 env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 5
    while True:
        assert time.monotonic() < deadline
        line = cancelled.stderr.readline()
        assert line, "model-start marker missing"
        if b"MODEL_STARTED" in line:
            break
    cancelled.send_signal(signal.SIGINT)
    stdout, stderr = cancelled.communicate(timeout=5)
    assert cancelled.returncode == 130
    assert json.loads(stdout) == dict(version=1, status="error", code="CANCELLED")
    assert b"cobalt" not in stdout + stderr
print("Real PTY chat/search/source/Ctrl-C, scripted piped JSON, exclusion and no-note-write checks passed")
