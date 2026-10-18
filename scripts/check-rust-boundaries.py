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
    "synapse-core": {"serde_yaml_ng"},
    "synapse-application": {"synapse-core"},
    "synapse-adapters": {"synapse-core", "rustix"},
    "synapse-terminal": {"synapse-core", "synapse-application"},
}
STD = {
    "rust/main.rs": {"process"},
    "rust/adapters/src/corpus.rs": {"fs", "io", "os", "path"},
    "rust/application/src/corpus.rs": {"sync", "collections"},
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
    if any(flag not in {"RDONLY", "DIRECTORY", "NOFOLLOW", "CLOEXEC", "NONBLOCK"} for flag in re.findall(r"OFlags::(\w+)", source)):
        result.append("unreviewed filesystem open mode")
    if re.search(r"\b(?:unlinkat|renameat|mkdirat|symlinkat|linkat|ftruncate|fchmod|pwrite|writev)\b", source):
        result.append("unreviewed filesystem syscall mutation")
    # No model requests or schemas, sockets, processes or note/state writers exist yet.
    # These must enter via reviewed adapter/port additions, never through generic tools.
    if re.search(r"\b(?:TcpStream|TcpListener|UdpSocket|Command|OpenOptions)\b", source) or (name != "rust/adapters/src/corpus.rs" and re.search(r"\b(?:File|openat|statat|rustix)\b", source)):
        result.append("unreviewed network/process/write capability")
    if re.search(r"\b(?:write|create|create_new|remove_file|remove_dir|remove_dir_all|rename|copy|set_permissions|hard_link|symlink)\s*\(", source):
        result.append("unreviewed filesystem mutation")
    if re.search(r"\b(?:fetch|reqwest|ureq|serde_json|ModelTransport)\b", source):
        result.append("unreviewed transport/schema")
    if re.search(r"rustix\s*::\s*(?!fs\b)\w+", source):
        result.append("unreviewed syscall capability")
    if "serde_yaml_ng" in source and name != "rust/core/src/corpus.rs":
        result.append("unreviewed YAML boundary")
    return result

def main():
    metadata = json.loads(subprocess.check_output(
        ["cargo", "metadata", "--locked", "--format-version", "1"], cwd=ROOT))
    local = [p for p in metadata["packages"] if p["source"] is None]
    assert {p["name"] for p in local} == set(EDGES), "local package inventory changed"
    for package in local:
        assert {d["name"] for d in package["dependencies"] if d["kind"] != "dev"} == EDGES[package["name"]], "crate boundary changed"
        assert {d["name"] for d in package["dependencies"] if d["kind"] == "dev"} == ({"synapse-application"} if package["name"] == "synapse-adapters" else set()), "dev dependency boundary changed"
        assert not package["features"], "unreviewed local features"
        assert all(t["kind"] != ["custom-build"] for t in package["targets"]), "local build script"
        assert package["license"] == "MIT", "local license changed"
    reviewed = json.loads((ROOT / "scripts/rust-dependencies.json").read_text())
    actual = []
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    for package in metadata["packages"]:
        if package["source"] is None:
            continue
        actual.append({"name": package["name"], "version": package["version"], "license": package["license"],
                       "features": nodes[package["id"]]["features"],
                       "build_script": any(t["kind"] == ["custom-build"] for t in package["targets"])})
    assert actual == reviewed, "external dependency/feature/license/build-script inventory changed"
    errors = []
    for path in sorted((ROOT / "rust").rglob("*.rs")):
        if "tests" in path.parts:
            continue
        name = path.relative_to(ROOT).as_posix()
        errors.extend(f"{name}: {error}" for error in violations(name, path.read_text()))
    # Mutation probes make sure the guards reject prohibited additions.
    for name, source in [
        ("rust/core/src/lib.rs", "use std::fs;"),
        ("rust/adapters/src/corpus.rs", "OFlags::WRONLY"),
        ("rust/adapters/src/corpus.rs", "use rustix::net::socket;"),
        ("rust/adapters/src/corpus.rs", "unlinkat(root, path);"),
        ("rust/application/src/lib.rs", "use std::net::TcpStream;"),
        ("rust/adapters/src/workspace.rs", 'fs::write(path, bytes);'),
        ("rust/terminal/src/lib.rs", 'serde_json::from_str(model);'),
    ]:
        assert violations(name, source), "policy mutation probe failed"
    if errors:
        raise SystemExit("\n".join(errors))
    print("Rust crate, reviewed dependency, network, write and absent-model-schema policies passed")

if __name__ == "__main__":
    main()
