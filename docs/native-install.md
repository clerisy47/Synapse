# Native installation and supported platforms

Validation and packaging scripts require Python 3.12 or later; the installed executable does not.

Build edition 2024 with pinned Rust/MSRV 1.85.1 and Cargo.lock. Building requires a C toolchain for ring. Installed binaries need neither Rust, Cargo, Node, npm nor a separately installed native library. The model runtime and weights are user-managed and are not bundled.

Qualified local target: macOS 26.6.2, Apple Silicon (`aarch64-apple-darwin`). Linux GNU x86_64 and macOS Intel are experimental until their exact native gates run. Windows is unsupported. CI defines Linux/macOS development checks; an unrun workflow is not qualification evidence. Archives are development artifacts until publication is explicitly authorized.

From source:

```
cargo install --locked --path crates/synapse-terminal
```

For a native archive, verify the archive checksum and the per-file SHA-256 manifest against your trusted build. Unpack into a fresh directory. Copy `bin/synapse` into a user-owned directory already on PATH (for example `~/.local/bin`) and set executable permission. Keep LICENSE and THIRD_PARTY_LICENSES.txt with redistributed copies. No automatic installer, elevated privileges, service registration or model downloads are used. On macOS, locally built unsigned artifacts may require the user's normal OS trust decision; no signing/notarization claim is made.

To upgrade, stop a foreground Synapse service, verify the new artifact, stage the new executable in the same installation directory and atomically replace the old executable. Version 0.1.0 uses explicit versioned state formats and never imports historical TypeScript state. Different-version migration is not implemented; incompatible state is refused. The qualification smoke repeats a same-version replacement and verifies preserved synthetic notes/state; it does not claim a cross-version migration test.

To uninstall, stop Synapse, remove only the installed executable and documentation. Workspace notes and external application state remain. To discard captures/recovery/deduplication and revoke MCP credentials first, run `synapse data clear --workspace ROOT` in a local terminal and review the warning. External/synced backups require separate deletion. Provider keys remain in your environment/OS credential mechanism; uninstall does not alter them.

`python3 scripts/package-rust.py` builds an explicit native-only archive and dependency notices. `scripts/test-rust-package.py ARCHIVE` performs clean extraction, checksum checks, install, same-version replacement and uninstall in an isolated temporary directory with no Rust/Node in PATH. `scripts/clean-legacy-output.py` removes only verified untracked legacy compiled outputs; it refuses unexpected content. Neither tool publishes a release.
