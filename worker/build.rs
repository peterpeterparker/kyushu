use std::process::Command;

fn main() {
    for package in &["kyushu-types", "kyushu-worker"] {
        let watch_path = format!("../packages/{}/src", package.replace("kyushu-", ""));
        println!("cargo:rerun-if-changed={watch_path}");

        let dist_path = format!("../packages/{}/dist", package.replace("kyushu-", ""));
        let dist = std::path::Path::new(&dist_path);
        if !dist.exists() {
            println!("cargo:rerun-if-changed=");
        }

        let status = Command::new("pnpm")
            .args(["--filter", package, "build"])
            .status()
            .expect(&format!("failed to run pnpm build for {package}"));

        assert!(status.success(), "{package} build failed");
    }
}
