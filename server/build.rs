use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build-admin-locales.mjs");
    println!("cargo:rerun-if-changed=admin-locales.ts");
    println!("cargo:rerun-if-changed=../web/src/i18n");
    println!("cargo:rerun-if-changed=../web/package.json");
    println!("cargo:rerun-if-changed=../.node-version");
    let status = Command::new("node")
        .arg("build-admin-locales.mjs")
        .status()
        .expect("building admin locales requires Node.js (see .node-version)");
    assert!(status.success(), "could not build admin locales: {status}");
}
