#!/usr/bin/env python3
"""Opt-in native CLI synthetic smoke. Never start/download/reconfigure a runtime.
Uses the production global lease/state layout and only temporary synthetic notes.
Prints fixed result categories and numeric metrics, never prompts/provider bodies.
"""
import json
import errno
import fcntl
import pty
import select
import termios
import os
from pathlib import Path
import subprocess
import tempfile
import time

if os.environ.get("SYNAPSE_LIVE_BONSAI") != "1":
    raise SystemExit("Set SYNAPSE_LIVE_BONSAI=1 to contact the user-managed loopback runtime")
binary = Path(__file__).resolve().parents[1] / "target/release/synapse"
results = []
terminal = None

def terminal_smoke(workspace):
    def controlling():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    master, slave = pty.openpty()
    attrs = termios.tcgetattr(master)
    process = subprocess.Popen([str(binary), "--workspace", str(workspace)],
                               stdin=slave, stdout=slave, stderr=slave,
                               preexec_fn=controlling, env=dict(os.environ, NO_COLOR="1", COLUMNS="80"))
    os.close(slave)
    output = bytearray()
    cursor = 0
    def until(marker, timeout):
        nonlocal cursor
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            index = output.find(marker, cursor)
            if index >= 0:
                chunk = bytes(output[cursor:index+len(marker)])
                cursor = index + len(marker)
                return chunk
            if select.select([master], [], [], 0.1)[0]:
                try:
                    part = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not part:
                    break
                output.extend(part)
                assert len(output) <= 65536
            elif process.poll() is not None:
                break
        raise AssertionError("terminal probe incomplete")
    started = time.monotonic()
    try:
        until(b"synapse> ", 10)
        os.write(master, b"What metal does Aurora use?\n")
        conversation = until(b"synapse> ", 190)
        cited = b"Verified passages" in conversation and b"Aurora.md:6-6" in conversation and b"Aurora uses cobalt." in conversation
        os.write(master, b"/source 1\n")
        source = until(b"synapse> ", 10)
        inspected = b"Aurora.md:6-6" in source and b"Aurora uses cobalt." in source
        os.write(master, b"\x03")
        until(b"CANCELLED", 10)
        interrupted = process.wait(timeout=5) == 130
        restored = termios.tcgetattr(master) == attrs
        return dict(passed=cited and inspected and interrupted and restored,
                    conversation=cited, source=inspected, interrupt_130=interrupted,
                    terminal_restored=restored, seconds=round(time.monotonic()-started,2))
    except (AssertionError, OSError, subprocess.TimeoutExpired):
        return dict(passed=False, seconds=round(time.monotonic()-started,2))
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)

with tempfile.TemporaryDirectory(prefix="synapse-live-synthetic-") as directory:
    workspace = Path(directory)
    note = "---\ndescription: Synthetic Aurora fixture\ntags: [synthetic]\naliases: []\n---\nAurora uses cobalt.\n"
    source = workspace / "Aurora.md"
    source.write_text(note)
    cases = [("What metal does Aurora use?", "supported"),
             ("What is the launch date?", "insufficient_evidence")]
    for index, (question, expected) in enumerate(cases, 1):
        started = time.monotonic()
        try:
            process = subprocess.run([str(binary), "ask", "--workspace", str(workspace), question, "--json"],
                                     capture_output=True, timeout=190)
            result = json.loads(process.stdout)
            status = result.get("status")
            if status not in {"supported", "insufficient_evidence", "error"}:
                status = "invalid_result"
            valid = process.returncode == 0 and result.get("version") == 1 and status == expected
            if expected == "supported" and valid:
                valid = result["sources"] == [dict(id=1, path="Aurora.md", start_line=6, end_line=6, text="Aurora uses cobalt.")]
            if expected == "insufficient_evidence" and valid:
                valid = result.get("answer") == "" and result.get("sources") == []
            # Error codes originate in the native application; do not print arbitrary strings.
            code = result.get("code")
            if code not in {None, "MODEL_FORMAT", "MODEL_TIMEOUT", "MODEL_OFFLINE", "MODEL_HTTP", "MODEL_BUDGET", "MODEL_LEASE", "CANCELLED", "EVIDENCE_STALE", "CORPUS_LIMIT", "WORKSPACE_ACCESS"}:
                code = "UNEXPECTED_CODE"
            results.append(dict(case=index, exit=process.returncode, status=status, code=code,
                                passed=valid, seconds=round(time.monotonic()-started, 2)))
        except (subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
            results.append(dict(case=index, passed=False, status="probe_failure",
                                seconds=round(time.monotonic()-started, 2)))
        if not results[-1]["passed"]:
            break  # No blind retries or additional requests after a failure.
    if len(results) == 2 and all(r["passed"] for r in results):
        terminal = terminal_smoke(workspace)
    assert source.read_text() == note, "synthetic note changed"
    assert sorted(p.name for p in workspace.iterdir()) == ["Aurora.md"]
print(json.dumps(dict(requested=2, executed=len(results), passed=sum(r["passed"] for r in results), results=results, terminal=terminal)))
raise SystemExit(0 if len(results) == 2 and all(r["passed"] for r in results) and terminal and terminal["passed"] else 1)
