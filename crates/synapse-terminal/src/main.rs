fn main() -> std::process::ExitCode {
    synapse_terminal::run(std::env::args_os().skip(1).collect())
}
