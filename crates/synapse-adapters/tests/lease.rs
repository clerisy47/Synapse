use std::{
    error::Error,
    io::{BufRead, Read, Write},
    process::{Command, Stdio},
    time::Duration,
};
use synapse_core::Cancellation;
#[test]
fn lease_child() -> Result<(), Box<dyn Error>> {
    let Some(role) = std::env::var_os("SYNAPSE_LEASE_TEST_ROLE") else {
        return Ok(());
    };
    let _lease = synapse_adapters::ProviderLease::acquire(&Cancellation::default())
        .map_err(|_| "lease refused")?;
    println!("leased");
    std::io::stdout().flush()?;
    if role == "hold" {
        std::io::stdin().read_exact(&mut [0])?;
    }
    Ok(())
}
#[test]
fn independent_processes_share_the_same_runtime_slot() -> Result<(), Box<dyn Error>> {
    let home = std::env::temp_dir().join(format!("synapse-lease-{}", std::process::id()));
    std::fs::create_dir(&home)?;
    let canonical = home.canonicalize()?;
    let executable = std::env::current_exe()?;
    let make = |role: &str| {
        let mut command = Command::new(&executable);
        command
            .args(["--exact", "lease_child", "--nocapture"])
            .env("HOME", &canonical)
            .env_remove("XDG_STATE_HOME")
            .env("SYNAPSE_LEASE_TEST_ROLE", role)
            .stdout(Stdio::piped())
            .stdin(Stdio::piped());
        command
    };
    let mut first = make("hold").spawn()?;
    let stdout = first.stdout.take().ok_or("missing child stdout")?;
    let mut reader = std::io::BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        assert_ne!(
            reader.read_line(&mut line)?,
            0,
            "first child exited before acquiring lease"
        );
        if line.trim() == "leased" {
            break;
        }
    }
    let mut second = make("wait").spawn()?;
    std::thread::sleep(Duration::from_millis(100));
    assert!(
        second.try_wait()?.is_none(),
        "second process bypassed the held lease"
    );
    first
        .stdin
        .take()
        .ok_or("missing child stdin")?
        .write_all(b"x")?;
    assert!(first.wait()?.success());
    let output = second.wait_with_output()?;
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("leased"));
    std::fs::remove_dir_all(home)?;
    Ok(())
}
