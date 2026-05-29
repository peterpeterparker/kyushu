use std::process::Command;

fn main() {
    let watch_path = "../packages/types/src";
    println!("cargo:rerun-if-changed={watch_path}");

    let dist = std::path::Path::new("../packages/types/dist");
    if !dist.exists() {
        println!("cargo:rerun-if-changed=");
    }

    let status = Command::new("pnpm")
        .args(["--filter", "kyushu-types", "build"])
        .status()
        .expect("failed to run pnpm build");

    assert!(status.success(), "kyushu-types build failed");
}
