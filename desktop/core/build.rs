use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};
fn main() {
    // Explicit rerun directives disable Cargo's default package-wide tracking.
    // Keep generated schema entry points in sync with this generator as well.
    println!("cargo:rerun-if-changed=build.rs");
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
    let desktop_lock_path = root.join("versions/0.163.0-alpha.10.2/schema-lock.json");
    let desktop_lock: serde_json::Value = serde_json::from_slice(
        &fs::read(&desktop_lock_path).expect("desktop baseline schema lock"),
    )
    .unwrap();
    assert_eq!(desktop_lock["codexVersion"], "0.163.0-alpha.10.2");
    assert_eq!(desktop_lock["baseCodexVersion"], "0.159.2");
    assert_eq!(desktop_lock["experimental"], false);
    generated.push_str("pub fn desktop_schema(name:&str)->Option<&'static str>{match name {\n");
    for file in desktop_lock["files"].as_array().unwrap() {
        let name = file["name"].as_str().unwrap();
        let source = file["source"].as_str().unwrap();
        assert!(!source.contains("..") && !source.contains('\\'));
        assert!(
            source.starts_with("schema/")
                || source.starts_with("versions/0.163.0-alpha.10.2/schema/")
        );
        let path = root.join(source);
        let bytes = fs::read(&path).expect("desktop schema source");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            file["sha256"].as_str().unwrap(),
            "desktop schema changed: {name}"
        );
        println!("cargo:rerun-if-changed={}", path.display());
        generated.push_str(&format!(
            "{:?}=>Some(include_str!({:?})),\n",
            name,
            path.to_string_lossy()
        ));
    }
    let composer_lock_path = root.join("versions/0.163.0-alpha.10.2/composer-lock.json");
    let composer_lock: serde_json::Value = serde_json::from_slice(
        &fs::read(&composer_lock_path).expect("desktop experimental composer lock"),
    )
    .unwrap();
    assert_eq!(composer_lock["codexVersion"], "0.163.0-alpha.10.2");
    assert_eq!(composer_lock["experimental"], true);
    assert_eq!(composer_lock["files"].as_array().unwrap().len(), 1);
    let composer = &composer_lock["files"][0];
    assert_eq!(
        composer["source"],
        "versions/0.163.0-alpha.10.2/experimental/TurnStartParams.json"
    );
    let composer_path = root.join(composer["source"].as_str().unwrap());
    let bytes = fs::read(&composer_path).expect("desktop experimental composer schema");
    assert_eq!(
        format!("{:x}", Sha256::digest(&bytes)),
        composer["sha256"].as_str().unwrap()
    );
    generated.push_str(&format!(
        "\"experimental/TurnStartParams\"=>Some(include_str!({:?})),\n",
        composer_path.to_string_lossy()
    ));
    let projects_lock_path = root.join("versions/0.163.0-alpha.10.2/projects-lock.json");
    let projects_lock: serde_json::Value = serde_json::from_slice(
        &fs::read(&projects_lock_path).expect("desktop project schema lock"),
    )
    .unwrap();
    assert_eq!(projects_lock["codexVersion"], "0.163.0-alpha.10.2");
    assert_eq!(projects_lock["experimental"], true);
    let project_files = projects_lock["files"].as_array().unwrap();
    assert_eq!(project_files.len(), 2);
    for name in ["ProjectListParams", "ProjectListResponse"] {
        let file = project_files
            .iter()
            .find(|file| file["name"] == name)
            .expect("required project schema");
        let source = format!("versions/0.163.0-alpha.10.2/experimental/{name}.json");
        assert_eq!(file["source"], source);
        let path = root.join(source);
        let bytes = fs::read(&path).expect("desktop experimental project schema");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            file["sha256"].as_str().unwrap()
        );
        generated.push_str(&format!(
            "{:?}=>Some(include_str!({:?})),\n",
            format!("experimental/{name}"),
            path.to_string_lossy()
        ));
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rerun-if-changed={}", projects_lock_path.display());
    let queue_lock_path = root.join("versions/0.163.0-alpha.10.2/queue-lock.json");
    let queue_lock: serde_json::Value =
        serde_json::from_slice(&fs::read(&queue_lock_path).expect("native queue schema lock"))
            .unwrap();
    assert_eq!(queue_lock["codexVersion"], "0.163.0-alpha.10.2");
    assert_eq!(queue_lock["experimental"], true);
    assert_eq!(queue_lock["files"].as_array().unwrap().len(), 10);
    for operation in ["Add", "List", "Update", "Delete", "Reorder"] {
        for kind in ["Params", "Response"] {
            let name = format!("ThreadQueue{operation}{kind}");
            let file = queue_lock["files"]
                .as_array()
                .unwrap()
                .iter()
                .find(|file| file["name"] == name)
                .expect("queue contract");
            let source = format!("versions/0.163.0-alpha.10.2/experimental/{name}.json");
            assert_eq!(file["source"], source);
            let path = root.join(source);
            let bytes = fs::read(&path).expect("generated queue schema");
            assert_eq!(
                format!("{:x}", Sha256::digest(&bytes)),
                file["sha256"].as_str().unwrap()
            );
            generated.push_str(&format!(
                "{:?}=>Some(include_str!({:?})),\n",
                format!("experimental/{name}"),
                path.to_string_lossy()
            ));
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    println!("cargo:rerun-if-changed={}", queue_lock_path.display());
    let start_lock_path = root.join("versions/0.163.0-alpha.10.2/queue-start-lock.json");
    let start_lock: serde_json::Value =
        serde_json::from_slice(&fs::read(&start_lock_path).expect("queue start lock")).unwrap();
    assert_eq!(start_lock["codexVersion"], "0.163.0-alpha.10.2");
    assert_eq!(start_lock["experimental"], true);
    assert_eq!(start_lock["files"].as_array().unwrap().len(), 2);
    for kind in ["Params", "Response"] {
        let name = format!("ThreadQueueStart{kind}");
        let file = start_lock["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["name"] == name)
            .expect("queue start contract");
        let source = format!("versions/0.163.0-alpha.10.2/experimental/{name}.json");
        assert_eq!(file["source"], source);
        let path = root.join(source);
        assert_eq!(
            format!("{:x}", Sha256::digest(fs::read(&path).unwrap())),
            file["sha256"].as_str().unwrap()
        );
        generated.push_str(&format!(
            "{:?}=>Some(include_str!({:?})),\n",
            format!("experimental/{name}"),
            path.to_string_lossy()
        ));
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rerun-if-changed={}", start_lock_path.display());
    generated.push_str("_=>None}}\n");
    println!("cargo:rerun-if-changed={}", composer_path.display());
    println!("cargo:rerun-if-changed={}", composer_lock_path.display());
    println!("cargo:rerun-if-changed={}", desktop_lock_path.display());
    let composer_schema = root.join("experimental/TurnStartParams.json");
    let composer_bytes = fs::read(&composer_schema).expect("pinned composer schema");
    assert_eq!(
        format!("{:x}", Sha256::digest(&composer_bytes)),
        "07771223642e1b61bd9aac0069fc0f98143a1c047724ca02c7ceb13653442738",
        "Codex 0.159.2 experimental turn schema changed"
    );
    println!("cargo:rerun-if-changed={}", composer_schema.display());
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
