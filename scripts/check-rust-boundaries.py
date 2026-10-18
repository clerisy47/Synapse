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
    "synapse-adapters": {"synapse-core", "rustix", "ureq", "serde_json"},
    "synapse-terminal": {"synapse-core", "synapse-application"},
}
STD = {
    "rust/main.rs": {"process"},
    "rust/adapters/src/corpus.rs": {"fs", "io", "os", "path"},
    "rust/application/src/corpus.rs": {"sync", "collections"},
    "rust/core/src/cancellation.rs": {"sync"},
    "rust/application/src/jobs.rs": {"sync", "collections", "time"},
    "rust/adapters/src/model.rs": {"time"},
    "rust/adapters/src/model_lease.rs": {"fs", "path", "thread", "time"},
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
    allowed_flags = {"RDONLY", "DIRECTORY", "NOFOLLOW", "CLOEXEC", "NONBLOCK"}
    if name == "rust/adapters/src/model_lease.rs":
        allowed_flags |= {"RDWR", "CREATE"}
    if any(flag not in allowed_flags for flag in re.findall(r"OFlags::(\w+)", source)):
        result.append("unreviewed filesystem open mode")
    if re.search(r"\b(?:unlinkat|renameat|mkdirat|symlinkat|linkat|ftruncate|fchmod|pwrite|writev)\b", source):
        result.append("unreviewed filesystem syscall mutation")
    # Only the reviewed provider and fixed-basename lease adapters gain new I/O.
    # Corpus reads, domain code and terminal retain their existing capabilities.
    if re.search(r"\b(?:TcpStream|TcpListener|UdpSocket|Command|OpenOptions)\b", source) or (name not in {"rust/adapters/src/corpus.rs", "rust/adapters/src/model_lease.rs"} and re.search(r"\b(?:File|openat|statat|rustix)\b", source)):
        result.append("unreviewed network/process/write capability")
    if re.search(r"\b(?:write|create|create_new|remove_file|remove_dir|remove_dir_all|rename|copy|set_permissions|hard_link|symlink)\s*\(", source):
        result.append("unreviewed filesystem mutation")
    if re.search(r"\b(?:fetch|reqwest)\b", source) or (name != "rust/adapters/src/model.rs" and re.search(r"\b(?:ureq|serde_json)\b", source)) or (name not in {"rust/core/src/model.rs", "rust/core/src/lib.rs", "rust/application/src/jobs.rs", "rust/adapters/src/model.rs"} and re.search(r"\bModelTransport\b", source)):
        result.append("unreviewed transport/schema")
    if re.search(r"rustix\s*::\s*(?!fs\b|fd\b|io\b)\w+", source):
        result.append("unreviewed syscall capability")
    if "serde_yaml_ng" in source and name != "rust/core/src/corpus.rs":
        result.append("unreviewed YAML boundary")
    if name == "rust/adapters/src/model_lease.rs":
        if re.findall(r'const LOCK_NAME: &str = "([^"]+)"', source) != ["bonsai-127-0-0-1-18080.lock"]:
            result.append("lease lock destination changed")
        if re.search(r"\b(?:TRUNC|APPEND|write_all|write_at)\b", source):
            result.append("lease must not write content")
    if name == "rust/adapters/src/model.rs":
        urls = re.findall(r'https?://[^"\s]+', source)
        if urls != ["http://127.0.0.1:18080/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"]:
            result.append("provider allowlist changed")
        for required in [".proxy(None)", ".max_redirects(0)", ".limit(MAX_RESPONSE_BYTES as u64)", "request.check_budget("]:
            if required not in source:
                result.append("transport guard missing")
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
        ("rust/adapters/src/corpus.rs", "OFlags::CREATE"),
        ("rust/core/src/model.rs", "use ureq::Agent;"),
        ("rust/adapters/src/model_lease.rs", "OFlags::TRUNC"),
        ("rust/adapters/src/model.rs", "use std::fs;"),
        ("rust/application/src/lib.rs", "use std::net::TcpStream;"),
        ("rust/adapters/src/workspace.rs", 'fs::write(path, bytes);'),
        ("rust/terminal/src/lib.rs", 'serde_json::from_str(model);'),
    ]:
        assert violations(name, source), "policy mutation probe failed"
    if errors:
        raise SystemExit("\n".join(errors))
    print("Rust crate, reviewed dependency, allowlisted provider, lease-only write and structured-schema policies passed")

if __name__ == "__main__":
    main()
