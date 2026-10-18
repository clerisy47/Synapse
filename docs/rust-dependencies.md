# Rust dependency review

2026-10-18, RUST-T02 in progress. Cargo.lock pins the exact dependency graph. No network transport, terminal framework, shell facility or model runtime is adopted by these dependencies.

- `rustix` 1.1.5, MIT / Apache-2.0 / Apache-2.0 with LLVM exception: safe descriptor-relative filesystem APIs. Defaults disabled; enabled `std`, `fs`, `use-libc`. Its build script detects compiler/target capabilities and emits configuration; no network or external commands. The libc backend avoids direct Linux assembly in application policy. Application code forbids unsafe; rustix/libc contain audited-by-upstream unsafe syscall wrappers. macOS uses system libc; Linux GNU is the intended next platform.
- `serde_yaml_ng` 0.10.0, MIT / Apache-2.0: YAML metadata parser. Default package features only. This admits serde, indexmap/hashbrown, equivalent, itoa, ryu and unsafe-libyaml. The latter is a Rust translation of libyaml, with unsafe internals; no external libyaml installation or native compilation is required. YAML values are validated before retrieval; arbitrary YAML is never configuration authority.
- Transitive rustix dependencies include bitflags, errno/libc and target-specific Linux/Windows bindings. Windows entries in Cargo.lock do not constitute Windows support. Serde and platform build scripts emit compiler/target cfg information. Proc-macro entries may appear in the lockfile through optional dependency resolution; no application derive macros are used yet.

The compiler and Clippy checks run on the pinned MSRV. `cargo tree --locked -e features` is the feature review command. These are adoption notes, not a comprehensive vulnerability audit or a filesystem safety proof. No TypeScript/Koffi dependency participates in the Rust build. Dependency changes require renewed review and boundary tests.

## Provider adoption in progress — 2026-10-19

`serde_json` 1.0.145 provides fixed structured request construction and bounded response parsing. `ureq` 3.1.2 is adopted with defaults disabled and only `rustls`/`json`; cookie/proxy/native-TLS/compression features are not requested. Runtime configuration explicitly disables environment proxies and redirects. Rustls/webpki use root certificates for the fixed OpenRouter host. Ring 0.17.14 introduces native C/assembly compilation through its reviewed upstream `cc` build helper; the installed binary has no ring runtime installation requirement, but build machines need a supported C toolchain. This is a new native build requirement relative to the foundation.

Cargo.lock contains optional cookie/URL/ICU/time resolution entries because ureq declares optional dependencies. Those entries are not evidence that optional features are enabled; inspect the actual `cargo tree --locked -e features` output. Rustix's `process` feature is enabled solely to verify state ownership with the real UID. No product process-launch API is introduced. Local inference never invokes a process or downloads models.

Provider tests, active cancellation/deadline behavior, cross-process lease regressions and synthetic live compatibility are still under verification. Initial synthetic selection runs failed because the local schema envelope was incompatible. The local builder now uses llama.cpp native `json_object` with `schema`; OpenRouter retains its provider-specific `json_schema` envelope. A subsequent synthetic health/selection run passed. Cancellation and deadline changes require a final check before task acceptance.

## Terminal adoption — 2026-10-19

`ctrlc` 3.4.7 installs the OS interrupt handler in the platform adapter; its callback only sets the shared cancellation flag. It adds upstream nix/target signal dependencies. Rustix `termios`/`event` features provide safe terminal width and ready-input polling. Application code continues to forbid unsafe Rust. `unicode-width` 0.2.2 (MIT / Apache-2.0) is terminal-only and supplies display-cell widths for wrapping. `serde_json` is also used at the separate versioned CLI output boundary; it does not grant model-schema authority to terminal logic.

Serde 1.0.229 is now a direct core dependency for a budgeted YAML deserialization seed; this reuses the already-reviewed transitive package without derive macros. Unknown/aliased metadata cannot expand beyond explicit node/string/depth budgets.
