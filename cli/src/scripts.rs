use crate::config::ScriptsConfig;
use anyhow::Result;

pub fn run_prebuild_scripts(scripts_config: &Option<ScriptsConfig>) -> Result<()> {
    if let Some(config) = scripts_config {
        run_scripts(config.prebuild.as_deref().unwrap_or(&[]))?;
    }
    Ok(())
}

pub fn run_postbuild_scripts(scripts_config: &Option<ScriptsConfig>) -> Result<()> {
    if let Some(config) = scripts_config {
        run_scripts(config.postbuild.as_deref().unwrap_or(&[]))?;
    }
    Ok(())
}

fn run_scripts(hooks: &[String]) -> Result<()> {
    for hook in hooks {
        run_script(hook)?;
    }

    Ok(())
}

struct ShellCommand(std::process::Command);

impl ShellCommand {
    #[cfg(target_os = "windows")]
    fn new(cmd: &str) -> Self {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", cmd]);
        Self(c)
    }

    #[cfg(not(target_os = "windows"))]
    fn new(cmd: &str) -> Self {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", cmd]);
        Self(c)
    }

    fn run(mut self) -> Result<std::process::ExitStatus> {
        Ok(self.0.status()?)
    }
}

fn run_script(script: &str) -> Result<()> {
    println!("Running: {}", script);

    let status = ShellCommand::new(script).run()?;

    if !status.success() {
        return Err(anyhow::anyhow!("Script failed: {}", script));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_scripts_empty() {
        assert!(run_scripts(&[]).is_ok());
    }

    #[test]
    fn test_run_scripts_success() {
        assert!(run_scripts(&["echo hello".to_string()]).is_ok());
    }

    #[test]
    fn test_run_scripts_failure() {
        assert!(run_scripts(&["exit 1".to_string()]).is_err());
    }

    #[test]
    fn test_run_scripts_multiple() {
        assert!(run_scripts(&["echo one".to_string(), "echo two".to_string()]).is_ok());
    }

    #[test]
    fn test_run_scripts_stops_on_failure() {
        let result = run_scripts(&["exit 1".to_string(), "echo unreachable".to_string()]);
        assert!(result.is_err());
    }
}
