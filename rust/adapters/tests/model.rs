#![cfg(unix)]
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
use synapse_adapters::{LocalModelLease, ProviderTransport};
use synapse_application::{JobPriority, JobQueue};
use synapse_core::{
    Cancellation, ModelError, ModelLeasePort, ModelRequest, ModelResponse, Provider,
};
struct Fixture {
    base: PathBuf,
    state: PathBuf,
    workspace: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_else(|_| panic!("synthetic fixture failed"))
            .as_nanos();
        let base = std::env::temp_dir()
            .canonicalize()
            .unwrap_or_else(|_| panic!("synthetic fixture failed"))
            .join(format!(
                "synapse-model-{}-{nonce}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
        let state = base.join("state");
        let workspace = base.join("workspace");
        fs::create_dir_all(&state).unwrap_or_else(|_| panic!("synthetic fixture failed"));
        fs::create_dir(&workspace).unwrap_or_else(|_| panic!("synthetic fixture failed"));
        fs::set_permissions(&state, fs::Permissions::from_mode(0o700))
            .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        Self {
            base,
            state,
            workspace,
        }
    }
    fn lease(&self) -> LocalModelLease {
        LocalModelLease::open(&self.state, &self.workspace)
            .unwrap_or_else(|_| panic!("synthetic fixture failed"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.base).unwrap_or_else(|_| panic!("synthetic fixture failed"));
    }
}
#[test]
fn state_and_lock_safety_and_cancellation() {
    let fixture = Fixture::new();
    assert!(LocalModelLease::open(&fixture.workspace, &fixture.workspace).is_err());
    let alias = fixture.base.join("alias");
    symlink(&fixture.state, &alias).unwrap_or_else(|_| panic!("synthetic fixture failed"));
    assert!(LocalModelLease::open(&alias, &fixture.workspace).is_err());
    let lease = fixture.lease();
    let cancel = Cancellation::default();
    let first = lease
        .acquire(&cancel)
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    let second = fixture.lease();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| second.acquire(&cancel));
        std::thread::sleep(Duration::from_millis(50));
        cancel.cancel();
        assert!(matches!(
            worker
                .join()
                .unwrap_or_else(|_| panic!("synthetic fixture failed")),
            Err(ModelError::Cancelled)
        ));
    });
    drop(first);
    assert!(second.acquire(&Cancellation::default()).is_ok());
    let lock = fixture.state.join("bonsai-127-0-0-1-18080.lock");
    fs::remove_file(&lock).unwrap_or_else(|_| panic!("synthetic fixture failed"));
    symlink(fixture.workspace.join("note.md"), &lock)
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    assert!(matches!(
        lease.acquire(&Cancellation::default()),
        Err(ModelError::Lease)
    ));
    assert!(!fixture.workspace.join("note.md").exists());
    fs::rename(&fixture.state, fixture.base.join("old-state"))
        .unwrap_or_else(|_| panic!("fixture"));
    fs::create_dir(&fixture.state).unwrap_or_else(|_| panic!("fixture"));
    fs::set_permissions(&fixture.state, fs::Permissions::from_mode(0o700))
        .unwrap_or_else(|_| panic!("fixture"));
    assert!(matches!(
        lease.acquire(&Cancellation::default()),
        Err(ModelError::Lease)
    ));
    assert!(!fixture.state.join("bonsai-127-0-0-1-18080.lock").exists());
}
#[test]
#[ignore = "subprocess helper"]
fn lease_child() {
    let state = PathBuf::from(
        std::env::var_os("SYNAPSE_TEST_STATE")
            .unwrap_or_else(|| panic!("synthetic fixture failed")),
    );
    let workspace = PathBuf::from(
        std::env::var_os("SYNAPSE_TEST_WORKSPACE")
            .unwrap_or_else(|| panic!("synthetic fixture failed")),
    );
    let lease = LocalModelLease::open(&state, &workspace)
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    let cancel = Cancellation::default();
    if std::env::var_os("SYNAPSE_TEST_CANCEL").is_some() {
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(100));
                cancel.cancel();
            });
            assert!(matches!(lease.acquire(&cancel), Err(ModelError::Cancelled)));
        });
    } else {
        let _guard = lease
            .acquire(&cancel)
            .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        println!("LEASED");
        std::io::stdout()
            .flush()
            .unwrap_or_else(|_| panic!("synthetic fixture failed"));
        std::thread::sleep(Duration::from_secs(10));
    }
}
#[test]
fn cross_process_exclusion_and_crash_release() {
    let fixture = Fixture::new();
    let lease = fixture.lease();
    let guard = lease
        .acquire(&Cancellation::default())
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    let mut child = Command::new(
        std::env::current_exe().unwrap_or_else(|_| panic!("synthetic fixture failed")),
    );
    child
        .args(["--exact", "lease_child", "--ignored", "--nocapture"])
        .env("SYNAPSE_TEST_STATE", &fixture.state)
        .env("SYNAPSE_TEST_WORKSPACE", &fixture.workspace)
        .env("SYNAPSE_TEST_CANCEL", "1");
    assert!(
        child
            .output()
            .unwrap_or_else(|_| panic!("synthetic fixture failed"))
            .status
            .success()
    );
    drop(guard);
    child
        .env_remove("SYNAPSE_TEST_CANCEL")
        .stdout(Stdio::piped());
    let mut running = child
        .spawn()
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    let mut output = BufReader::new(
        running
            .stdout
            .take()
            .unwrap_or_else(|| panic!("synthetic fixture failed")),
    );
    let mut line = String::new();
    while !line.contains("LEASED") {
        line.clear();
        assert!(
            output
                .read_line(&mut line)
                .unwrap_or_else(|_| panic!("synthetic fixture failed"))
                > 0
        );
    }
    running
        .kill()
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    running
        .wait()
        .unwrap_or_else(|_| panic!("synthetic fixture failed"));
    assert!(lease.acquire(&Cancellation::default()).is_ok());
}
#[test]
#[ignore = "opt-in synthetic health against user-managed Bonsai at 127.0.0.1:18080"]
fn live_bonsai_health() {
    assert_eq!(std::env::var("SYNAPSE_LIVE_BONSAI").as_deref(), Ok("1"));
    let fixture = Fixture::new();
    let state = PathBuf::from(
        std::env::var_os("SYNAPSE_LIVE_STATE_ROOT")
            .unwrap_or_else(|| panic!("configured global state root required")),
    );
    let lease = LocalModelLease::open(&state, &fixture.workspace)
        .unwrap_or_else(|_| panic!("global model lease refused"));
    let result = JobQueue::default().run(
        &ProviderTransport::new(None).unwrap_or_else(|_| panic!("synthetic fixture failed")),
        &lease,
        &ModelRequest::health(Provider::bonsai()),
        JobPriority::Interactive,
        &Cancellation::default(),
    );
    assert_eq!(result, Ok(ModelResponse::Healthy));
}
