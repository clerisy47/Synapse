#!/usr/bin/env python3
"""Conservative scaffold authority check; new capabilities require explicit review."""
import pathlib
import re
import tomllib

root = pathlib.Path(__file__).resolve().parent.parent
expected = {
    'synapse-core': {'serde_yaml_ng'},
    'synapse-adapters': {'synapse-core', 'rustix', 'serde_json', 'ureq'},
    'synapse-terminal': {'synapse-core', 'synapse-adapters'},
}
errors = []
for crate, dependencies in expected.items():
    folder = root / 'crates' / crate
    manifest = tomllib.loads((folder / 'Cargo.toml').read_text())
    if set(manifest.get('dependencies', {})) != dependencies:
        errors.append(f'{crate}: dependency allowlist changed')
    if (folder / 'build.rs').exists():
        errors.append(f'{crate}: unreviewed build script')
    for path in (folder / 'src').rglob('*.rs'):
        text = path.read_text()
        if re.search(r'\bunsafe\b|\b(include!|include_str!|include_bytes!)', text):
            errors.append(f'{crate}: unreviewed code inclusion or unsafe')
        if crate == 'synapse-core' and re.search(r'\b(fs|net|process|io|env|os|thread)\b', text):
            errors.append(f'{crate}: operating-system access')
        # Network and structured model payloads are restricted to one provider adapter.
        if not (crate == 'synapse-adapters' and path.name == 'provider_lease.rs') and re.search(r'\b(mkdirat|renameat|unlinkat|WRONLY|RDWR|CREATE|TRUNC)\b', text):
            errors.append(f'{crate}: unreviewed mutation capability')
        if not (crate == 'synapse-adapters' and path.name == 'provider.rs') and re.search(r'\b(TcpStream|TcpListener|UdpSocket|reqwest|ureq|Command|OpenOptions)\b|\bfs\s*::\s*(write|rename|remove_file|create_dir)', text):
            errors.append(f'{crate}: unreviewed network/process/write capability')
        if not (crate == 'synapse-adapters' and path.name == 'provider.rs') and re.search(r'\b(serde_json|json!|ModelTransport)\b', text):
            errors.append(f'{crate}: unreviewed structured-model boundary')
if errors:
    raise SystemExit('\n'.join(errors))
print('Rust dependency, I/O, network, write and schema capability allowlists passed')
