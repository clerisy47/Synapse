# Upstream license copies missing from crate archives

The rmcp 0.8.5 and rmcp-macros 0.8.5 crate archives omit their workspace MIT license. Both `.cargo_vcs_info.json` files identify commit `941300acbe368a0edd9bb4921fb885b4c0763342`. `rmcp-0.8.5-MIT.txt` is copied verbatim from that commit's [root LICENSE](https://raw.githubusercontent.com/modelcontextprotocol/rust-sdk/941300acbe368a0edd9bb4921fb885b4c0763342/LICENSE).

unicode-casefold 0.2.0 declares `MIT/Apache-2.0` in its published Cargo.toml; its archive and upstream repository contain no license/notice file. Distribution selects Apache-2.0. `unicode-casefold-0.2.0-APACHE.txt` is the unmodified [Apache 2.0 license](https://www.apache.org/licenses/LICENSE-2.0.txt). No source modifications or upstream NOTICE file are involved. The package tool includes these copies alongside every enabled dependency's ordinary license texts.
