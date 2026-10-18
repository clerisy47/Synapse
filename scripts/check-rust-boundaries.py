#!/usr/bin/env python3
"""Fail-closed foundation policy. Extend with reviewed capabilities in later tasks.
Compiler crate edges enforce direction; these lexical guards supplement that check.
They are not a proof of filesystem containment or a Rust parser.
"""
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
EDGES = {
    "synapse-cli": {"synapse-adapters", "synapse-terminal"},
    "synapse-core": set(),
    "synapse-application": {"synapse-core"},
    "synapse-adapters": {"synapse-core"},
    "synapse-terminal": {"synapse-core", "synapse-application"},
}
STD = {
    "rust/main.rs": {"process"},
    "rust/core/src/cancellation.rs": {"sync"},
    "rust/adapters/src/workspace.rs": {"fs", "path"},
    "rust/terminal/src/lib.rs": {"io", "env"},
}

def violations(name, source):
    # Unit tests are not production capabilities. No production items may follow them.
    source = source.split("#[cfg(test)]", 1)[0]
    result = []
    if re.search(r"\b(unsafe|extern)\b|include!|include_str!|include_bytes!|macro_rules!", source):
        result.append("unreviewed code mechanism")
    if re.search(r"std\s*::\s*\{|use\s+std\s*;|use\s+std\s+as", source):
        result.append("unreviewed std alias")
    for module in re.findall(r"std\s*::\s*(\w+)", source):
        if module not in STD.get(name, set()):
            result.append("unreviewed std capability")
    # No model requests or schemas, sockets, processes or note/state writers exist yet.
    # These must enter via reviewed adapter/port additions, never through generic tools.
    if re.search(r"\b(?:TcpStream|TcpListener|UdpSocket|Command|OpenOptions|File)\b", source):
        result.append("unreviewed network/process/write capability")
    if re.search(r"\b(?:write|create|create_new|remove_file|remove_dir|remove_dir_all|rename|copy|set_permissions|hard_link|symlink)\s*\(", source):
        result.append("unreviewed filesystem mutation")
    if re.search(r"\b(?:fetch|reqwest|ureq|serde_json|ModelTransport)\b", source):
        result.append("unreviewed transport/schema")
    return result

def main():
    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--locked", "--format-version", "1"], cwd=ROOT))
    assert {p["name"] for p in metadata["packages"]} == set(EDGES), "dependency inventory changed"
    for package in metadata["packages"]:
        assert {d["name"] for d in package["dependencies"]} == EDGES[package["name"]], "crate boundary changed"
        assert not package["features"], "unreviewed features"
        assert all(t["kind"] != ["custom-build"] for t in package["targets"]), "build script"
        assert package["license"] == "MIT", "license changed"
    errors = []
    for path in sorted((ROOT / "rust").rglob("*.rs")):
        if "tests" in path.parts:
            continue
        name = path.relative_to(ROOT).as_posix()
        errors.extend(f"{name}: {error}" for error in violations(name, path.read_text()))
    # Mutation probes make sure the guards reject prohibited additions.
    for name, source in [
        ("rust/core/src/lib.rs", "use std::fs;"),
        ("rust/application/src/lib.rs", "use std::net::TcpStream;"),
        ("rust/adapters/src/workspace.rs", 'fs::write(path, bytes);'),
        ("rust/terminal/src/lib.rs", 'serde_json::from_str(model);'),
    ]:
        assert violations(name, source), "policy mutation probe failed"
    if errors:
        raise SystemExit("\n".join(errors))
    print("Rust crate, dependency, network, write and absent-model-schema policies passed")

if __name__ == "__main__":
    main()
