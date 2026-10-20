use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../packages/codex-protocol");
    let lock: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("schema-lock.json")).expect("fixed Codex schema lock"),
    )
    .unwrap();
    let mut generated =
        String::from("pub fn schema(name:&str)->Option<&'static str>{match name {\n");
    for file in lock["files"].as_array().unwrap() {
        let name = file["path"].as_str().unwrap();
        if !name.starts_with("schema/") {
            continue;
        }
        let path = root.join(name);
        let bytes = fs::read(&path).expect("generated stable schema");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            file["sha256"].as_str().unwrap(),
            "schema changed: {name}"
        );
        println!("cargo:rerun-if-changed={}", path.display());
        generated.push_str(&format!(
            "{:?}=>Some(include_str!({:?})),\n",
            name.strip_prefix("schema/")
                .unwrap()
                .trim_end_matches(".json"),
            path.to_string_lossy()
        ));
    }
    generated.push_str("_=>None}}\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("schemas.rs"),
        generated,
    )
    .unwrap();
    println!(
        "cargo:rerun-if-changed={}",
        root.join("schema-lock.json").display()
    );
}
