use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use synapse_adapters::NativeWorkspace;
use synapse_core::WorkspaceReadPort;

#[test]
fn validates_only_explicit_directory_and_resolves_selected_root_symlink() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("synapse-root-{}-{unique}", std::process::id()));
    fs::create_dir(&temp).unwrap_or_else(|e| panic!("fixture: {e}"));
    let file = temp.join("note.md");
    fs::write(&file, "synthetic").unwrap_or_else(|e| panic!("fixture: {e}"));
    let reader = NativeWorkspace;
    assert!(reader.validate_root(&temp.to_string_lossy()).is_ok());
    assert!(reader.validate_root(&file.to_string_lossy()).is_err());
    assert!(
        reader
            .validate_root(&temp.join("missing").to_string_lossy())
            .is_err()
    );
    #[cfg(unix)]
    {
        let alias = temp.join("selected-link");
        std::os::unix::fs::symlink(&temp, &alias).unwrap_or_else(|e| panic!("fixture: {e}"));
        let root = reader
            .validate_root(&alias.to_string_lossy())
            .unwrap_or_else(|_| panic!("root"));
        assert_eq!(
            root.canonical_display,
            fs::canonicalize(&temp)
                .unwrap_or_default()
                .to_string_lossy()
        );
    }
    fs::remove_dir_all(&temp).unwrap_or_else(|e| panic!("cleanup: {e}"));
}
