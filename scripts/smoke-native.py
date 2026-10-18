#!/usr/bin/env python3
"""Install and run a native executable outside the source tree; no Node needed."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="synapse-install-") as directory:
    install = Path(directory)
    subprocess.run(["cargo", "install", "--locked", "--offline", "--path", str(ROOT),
                    "--root", str(install / "installed")], check=True, cwd=install)
    binary = install / "installed/bin/synapse"
    assert binary.is_file()
    # PATH contains no Node, Cargo or Rust; the executable must stand alone.
    env = {"PATH": str(install / "empty"), "HOME": str(install), "NO_COLOR": "1"}
    for flag in ["--help", "--version"]:
        result = subprocess.run([str(binary), flag], cwd=install, env=env, capture_output=True)
        assert result.returncode == 0 and not result.stderr, result
    refused = subprocess.run([str(binary), "--workspace", str(install)], cwd=install,
                             env=env, input=b"Apply\nyes\n", capture_output=True)
    assert refused.returncode == 3 and refused.stdout == b""
    assert refused.stderr == b"INTERACTIVE_REQUIRED\n"
    # No workspace/config writes or model downloads at startup.
    assert sorted(p.name for p in install.iterdir()) == ["installed"]
print("Clean native installation and redirected-input smoke passed")
