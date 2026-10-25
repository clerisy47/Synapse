#!/usr/bin/env python3
"""Conservative scaffold authority check; new capabilities require explicit review."""
import pathlib
import re
import tomllib

root = pathlib.Path(__file__).resolve().parent.parent
expected = {
    'synapse-core': {'serde_yaml_ng', 'serde', 'sha2', 'chrono', 'chrono-tz', 'unicode-normalization', 'unicode-casefold', 'pulldown-cmark'},
    'synapse-adapters': {'synapse-core', 'rustix', 'serde_json', 'ureq', 'ctrlc', 'getrandom', 'serde', 'rmcp', 'tokio', 'http', 'http-body-util', 'bytes', 'tracing', 'rusqlite', 'notify'},
    'synapse-terminal': {'synapse-core', 'synapse-adapters', 'serde_json', 'unicode-width'},
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
        if not (crate == 'synapse-adapters' and path.name in {'state_store.rs', 'workspace.rs', 'search_index.rs'}) and re.search(r'\b(mkdirat|renameat|unlinkat|WRONLY|RDWR|CREATE|TRUNC)\b', text):
            errors.append(f'{crate}: unreviewed mutation capability')
        if re.search(r'\b(Command|execve|execveat)\b', text):
            errors.append(f'{crate}: process execution capability')
        if not (crate == 'synapse-adapters' and path.name in {'provider.rs', 'mcp_listener.rs'}) and re.search(r'\b(TcpStream|TcpListener|UdpSocket|reqwest|ureq)\b', text):
            errors.append(f'{crate}: unreviewed network capability')
        if not (crate == 'synapse-adapters' and path.name in {'state_store.rs', 'workspace.rs'}) and re.search(r'\bOpenOptions\b|\bFile\s*::\s*create\b|\bfs\s*::\s*(write|rename|remove_file|create_dir)', text):
            errors.append(f'{crate}: unreviewed filesystem mutation capability')
        if not ((crate == 'synapse-adapters' and path.name in {'provider.rs', 'state_store.rs', 'approved_write.rs', 'mcp_grants.rs', 'mcp_submit.rs', 'mcp_handler.rs', 'mcp_listener.rs', 'strict_json.rs', 'search_index.rs'}) or (crate == 'synapse-terminal' and path.name == 'output.rs')) and re.search(r'\b(serde_json|json!|ModelTransport)\b', text):
            errors.append(f'{crate}: unreviewed structured-model boundary')
if errors:
    raise SystemExit('\n'.join(errors))
print('Rust dependency, I/O, network, write and schema capability allowlists passed')
