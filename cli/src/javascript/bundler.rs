use anyhow::{Result, anyhow};
use rolldown::{
    AddonOutputOption, Bundler, BundlerOptions, InputItem, OutputFormat, Platform, RawMinifyOptions,
};

/// Bundle the developer's JS/TS entry point into a single ESM string.
pub async fn bundle(entry: &str) -> Result<String> {
    let mut bundler = Bundler::new(BundlerOptions {
        input: Some(vec![InputItem {
            import: entry.to_string(),
            ..Default::default()
        }]),
        platform: Some(Platform::Node),
        format: Some(OutputFormat::Esm),
        minify: Some(RawMinifyOptions::Bool(true)),
        // import.meta.url must be defined or the createRequire polyfill throws. rolldown's define
        // option  is buggy and does not handle this meta-property, so we have to inject it via a banner instead.
        banner: Some(AddonOutputOption::String(Some(
            "Object.defineProperty(import.meta, 'url', { value: 'file:///virtual/kyushu-pseudo-module.js' });".to_string()
        ))),
        ..Default::default()
    })
    .map_err(|e| anyhow!("Failed to create bundler: {:?}", e))?;

    let output = bundler
        .generate()
        .await
        .map_err(|e| anyhow!("Bundle failed: {:?}", e))?;

    // TODO: https://github.com/rolldown/rolldown/issues/9540
    // let errors: Vec<_> = output.warnings
    //     .iter()
    //     .filter(|d| d.severity() == Severity::Error)
    //     .collect();
    //
    // if !errors.is_empty() {
    //     return Err(anyhow!(
    //     "Bundle errors:\n{}",
    //     errors.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("\n")
    // ));
    // }

    for warning in &output.warnings {
        eprintln!("[WARN] {}", warning);
    }

    let code = output
        .assets
        .into_iter()
        .map(|asset| String::from_utf8_lossy(asset.content_as_bytes()).into_owned())
        .collect::<Vec<String>>()
        .join("\n");

    if code.is_empty() {
        return Err(anyhow!("Bundle produced no output"));
    }

    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_bundle_simple() {
        let entry = format!("{}/fixtures/hello.ts", env!("CARGO_MANIFEST_DIR"));
        let result = bundle(&entry).await;
        assert!(result.is_ok());

        let code = result.unwrap();
        let expected_code = "var e={async fetch(e){return{status:200,body:`hello world`,headers:{\"content-type\":`text/plain`}}}};export{e as default};";
        assert_eq!(code.trim(), expected_code);
    }

    #[tokio::test]
    async fn test_bundle_invalid_entry() {
        let result = bundle("nonexistent.ts").await;
        assert!(result.is_err());
    }
}
