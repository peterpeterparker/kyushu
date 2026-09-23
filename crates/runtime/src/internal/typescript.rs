use std::io::Write;
use std::sync::{Arc, Mutex};

use swc_common::{
    GLOBALS, Globals, SourceMap,
    errors::{HANDLER, Handler},
    sync::Lrc,
};
use swc_ts_fast_strip::{ErrorCode, Mode, Options, operate};

#[derive(Copy, Clone)]
pub(crate) enum TypeScriptMode {
    Strip,
    Transform,
}

pub(crate) fn runtime_mode() -> TypeScriptMode {
    if cfg!(feature = "typescript-transform-runtime") {
        TypeScriptMode::Transform
    } else {
        TypeScriptMode::Strip
    }
}

pub(crate) fn transform_module(
    source: String,
    filename: &str,
    source_map: bool,
    module: Option<bool>,
) -> Result<TypeScriptOutput, TypeScriptError> {
    if std::path::Path::new(filename)
        .components()
        .any(|component| component.as_os_str() == "node_modules")
    {
        return Err(TypeScriptError {
            code: "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
            kind: TypeScriptErrorKind::Error,
            message: format!(
                "Stripping types is currently unsupported for files under node_modules, for \"{filename}\""
            ),
        });
    }
    transform(source, filename, runtime_mode(), source_map, module)
}

#[derive(Debug)]
pub(crate) struct TypeScriptOutput {
    pub(crate) code: String,
    pub(crate) source_map: Option<String>,
}

#[derive(Debug)]
pub(crate) struct TypeScriptError {
    pub(crate) code: &'static str,
    pub(crate) kind: TypeScriptErrorKind,
    pub(crate) message: String,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum TypeScriptErrorKind {
    Error,
    SyntaxError,
}

struct DiagnosticWriter(Arc<Mutex<Vec<u8>>>);

impl Write for DiagnosticWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .expect("diagnostic buffer poisoned")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(crate) fn transform(
    source: String,
    filename: &str,
    mode: TypeScriptMode,
    source_map: bool,
    module: Option<bool>,
) -> Result<TypeScriptOutput, TypeScriptError> {
    let source_map_owner: Lrc<SourceMap> = Default::default();
    let diagnostics = Arc::new(Mutex::new(Vec::new()));
    let handler = Handler::with_emitter_writer(
        Box::new(DiagnosticWriter(diagnostics.clone())),
        Some(source_map_owner.clone()),
    );
    let options = Options {
        module,
        filename: Some(filename.to_string()),
        mode: match mode {
            TypeScriptMode::Strip => Mode::StripOnly,
            TypeScriptMode::Transform => Mode::Transform,
        },
        source_map,
        deprecated_ts_module_as_error: Some(true),
        ..Default::default()
    };
    let result = GLOBALS.set(&Globals::default(), || {
        HANDLER.set(&handler, || {
            operate(&source_map_owner, &handler, source, options)
        })
    });
    match result {
        Ok(output) => Ok(TypeScriptOutput {
            code: output.code,
            source_map: output.map,
        }),
        Err(error) => {
            let diagnostics = diagnostics.lock().expect("diagnostic buffer poisoned");
            let message = String::from_utf8_lossy(&diagnostics).trim().to_string();
            if message.is_empty() {
                Err(TypeScriptError {
                    code: typescript_error_code(error.code),
                    kind: TypeScriptErrorKind::SyntaxError,
                    message: error.to_string(),
                })
            } else {
                Err(TypeScriptError {
                    code: typescript_error_code(error.code),
                    kind: TypeScriptErrorKind::SyntaxError,
                    message,
                })
            }
        }
    }
}

fn typescript_error_code(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::UnsupportedSyntax => "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX",
        ErrorCode::InvalidSyntax | ErrorCode::Unknown => "ERR_INVALID_TYPESCRIPT_SYNTAX",
        _ => "ERR_INVALID_TYPESCRIPT_SYNTAX",
    }
}

#[cfg(test)]
mod tests {
    use super::{TypeScriptMode, transform};

    #[test]
    fn strip_preserves_source_positions() {
        let output = transform(
            "const value: number = 1;".to_string(),
            "input.ts",
            TypeScriptMode::Strip,
            false,
            Some(true),
        )
        .expect("strip should succeed");
        assert_eq!(output.code, "const value         = 1;");
        assert!(output.source_map.is_none());
    }

    #[test]
    fn transform_supports_runtime_typescript_syntax() {
        let output = transform(
            "enum Direction { Up, Down }\nexport default Direction.Up;".to_string(),
            "input.ts",
            TypeScriptMode::Transform,
            true,
            Some(true),
        )
        .expect("transform should succeed");
        assert!(output.code.contains("Direction"));
        assert!(output.source_map.is_some());
    }

    #[test]
    fn strip_rejects_runtime_typescript_syntax() {
        let error = transform(
            "enum Direction { Up, Down }".to_string(),
            "input.ts",
            TypeScriptMode::Strip,
            false,
            Some(true),
        )
        .expect_err("strip-only mode must reject enums");
        assert_eq!(error.code, "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
        assert_eq!(error.kind, super::TypeScriptErrorKind::SyntaxError);
        assert!(
            error
                .message
                .contains("TypeScript enum is not supported in strip-only mode")
        );
    }
}
