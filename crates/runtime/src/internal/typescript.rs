use std::io::Write;
use std::sync::{Arc, Mutex};

use swc_common::{
    FileName, GLOBALS, Globals, SourceMap,
    errors::{HANDLER, Handler},
    sync::Lrc,
};
use swc_ecma_ast::{
    ArrowExpr, AwaitExpr, Decl, EsVersion, ForOfStmt, Function, MetaPropExpr, MetaPropKind,
    ModuleDecl, ModuleItem, ObjectPatProp, Pat, Stmt, UsingDecl, VarDeclKind,
};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax, lexer::Lexer};
use swc_ecma_visit::{Visit, VisitWith};
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

pub(crate) fn source_uses_esm_format(source: &str, filename: &str) -> Result<bool, ()> {
    let source_map: Lrc<SourceMap> = Default::default();
    let source_file = source_map.new_source_file(
        FileName::Custom(filename.to_string()).into(),
        source.to_string(),
    );
    let lexer = Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: filename.ends_with(".tsx"),
            ..Default::default()
        }),
        EsVersion::EsNext,
        StringInput::from(&*source_file),
        None,
    );
    let mut parser = Parser::new_from(lexer);
    let parsed_module = parser.parse_module();
    let module_errors = parser.take_errors();
    let module = match parsed_module {
        Ok(module) if module_errors.is_empty() => module,
        _ => {
            // Node detects an ambiguous .ts file's format after stripping its
            // types. Some valid CommonJS scripts (for example, one binding an
            // identifier named `await`) are not valid ES modules. Accept that
            // distinction here; malformed TypeScript is still rejected later
            // by the transform that owns diagnostics.
            let lexer = Lexer::new(
                Syntax::Typescript(TsSyntax {
                    tsx: filename.ends_with(".tsx"),
                    ..Default::default()
                }),
                EsVersion::EsNext,
                StringInput::from(&*source_file),
                None,
            );
            let mut parser = Parser::new_from(lexer);
            if parser.parse_script().is_ok() && parser.take_errors().is_empty() {
                return Ok(false);
            }
            return Err(());
        }
    };

    if module.body.iter().any(module_item_has_runtime_module_decl) {
        return Ok(true);
    }
    if module
        .body
        .iter()
        .any(module_item_has_cjs_wrapper_lexical_declaration)
    {
        return Ok(true);
    }

    let mut syntax = RuntimeModuleSyntax::default();
    module.visit_with(&mut syntax);
    Ok(syntax.found)
}

const CJS_WRAPPER_BINDINGS: [&str; 5] = ["require", "exports", "module", "__filename", "__dirname"];

fn module_item_has_cjs_wrapper_lexical_declaration(item: &ModuleItem) -> bool {
    let ModuleItem::Stmt(Stmt::Decl(decl)) = item else {
        return false;
    };
    match decl {
        Decl::Class(decl) => !decl.declare && is_cjs_wrapper_binding(decl.ident.sym.as_ref()),
        Decl::Var(decl)
            if !decl.declare && matches!(decl.kind, VarDeclKind::Let | VarDeclKind::Const) =>
        {
            decl.decls
                .iter()
                .any(|declarator| pattern_binds_cjs_wrapper(&declarator.name))
        }
        _ => false,
    }
}

fn pattern_binds_cjs_wrapper(pattern: &Pat) -> bool {
    match pattern {
        Pat::Ident(binding) => is_cjs_wrapper_binding(binding.id.sym.as_ref()),
        Pat::Array(pattern) => pattern
            .elems
            .iter()
            .flatten()
            .any(pattern_binds_cjs_wrapper),
        Pat::Rest(pattern) => pattern_binds_cjs_wrapper(&pattern.arg),
        Pat::Object(pattern) => pattern.props.iter().any(|property| match property {
            ObjectPatProp::KeyValue(property) => pattern_binds_cjs_wrapper(&property.value),
            ObjectPatProp::Assign(property) => is_cjs_wrapper_binding(property.key.id.sym.as_ref()),
            ObjectPatProp::Rest(property) => pattern_binds_cjs_wrapper(&property.arg),
        }),
        Pat::Assign(pattern) => pattern_binds_cjs_wrapper(&pattern.left),
        Pat::Invalid(_) | Pat::Expr(_) => false,
    }
}

fn is_cjs_wrapper_binding(name: &str) -> bool {
    CJS_WRAPPER_BINDINGS.contains(&name)
}

fn module_item_has_runtime_module_decl(item: &ModuleItem) -> bool {
    let ModuleItem::ModuleDecl(decl) = item else {
        return false;
    };
    match decl {
        ModuleDecl::Import(import) => !import.type_only,
        ModuleDecl::ExportAll(export) => !export.type_only,
        ModuleDecl::ExportNamed(export) => !export.type_only,
        ModuleDecl::ExportDecl(export) => declaration_has_runtime(&export.decl),
        ModuleDecl::ExportDefaultDecl(export) => {
            !matches!(export.decl, swc_ecma_ast::DefaultDecl::TsInterfaceDecl(_))
        }
        ModuleDecl::ExportDefaultExpr(_) => true,
        ModuleDecl::TsNamespaceExport(_) => true,
        ModuleDecl::TsImportEquals(_) | ModuleDecl::TsExportAssignment(_) => false,
    }
}

fn declaration_has_runtime(decl: &Decl) -> bool {
    match decl {
        Decl::Class(decl) => !decl.declare,
        Decl::Fn(decl) => !decl.declare,
        Decl::Var(decl) => !decl.declare,
        Decl::Using(_) => true,
        Decl::TsInterface(_) | Decl::TsTypeAlias(_) => false,
        Decl::TsEnum(decl) => !decl.declare,
        Decl::TsModule(decl) => !decl.declare,
    }
}

#[derive(Default)]
struct RuntimeModuleSyntax {
    found: bool,
    function_depth: usize,
}

impl Visit for RuntimeModuleSyntax {
    fn visit_meta_prop_expr(&mut self, expression: &MetaPropExpr) {
        if expression.kind == MetaPropKind::ImportMeta {
            self.found = true;
        }
    }

    fn visit_await_expr(&mut self, expression: &AwaitExpr) {
        if self.function_depth == 0 {
            self.found = true;
        }
        expression.visit_children_with(self);
    }

    fn visit_for_of_stmt(&mut self, statement: &ForOfStmt) {
        if self.function_depth == 0 && statement.is_await {
            self.found = true;
        }
        statement.visit_children_with(self);
    }

    fn visit_using_decl(&mut self, declaration: &UsingDecl) {
        if self.function_depth == 0 && declaration.is_await {
            self.found = true;
        }
        declaration.visit_children_with(self);
    }

    fn visit_function(&mut self, function: &Function) {
        self.function_depth += 1;
        function.visit_children_with(self);
        self.function_depth -= 1;
    }

    fn visit_arrow_expr(&mut self, expression: &ArrowExpr) {
        self.function_depth += 1;
        expression.visit_children_with(self);
        self.function_depth -= 1;
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
    use super::{TypeScriptMode, source_uses_esm_format, transform};

    #[test]
    fn module_format_uses_typescript_ast_semantics() {
        for source in [
            "import type { Missing } from './missing.mts'; module.exports = 42;",
            "export type Answer = number; module.exports = 42;",
            "export interface Options { value: number } module.exports = 42;",
            "export declare const phantom: number; module.exports = 42;",
            "declare namespace Example { type Answer = number } module.exports = 42;",
            "const await: number = 42; module.exports = await;",
        ] {
            assert_eq!(source_uses_esm_format(source, "input.ts"), Ok(false));
        }
        for source in [
            "import { type Missing } from './missing.mts'; module.exports = 42;",
            "export { type Missing }; module.exports = 42;",
            "import type { Missing } from './missing.mts'; export default 42;",
            "globalThis.url = import.meta.url;",
            "await Promise.resolve();",
            "for await (const item of items) { consume(item); }",
            "await using resource = acquire();",
            "const { value: module } = input;",
            "class exports {}",
        ] {
            assert_eq!(source_uses_esm_format(source, "input.ts"), Ok(true));
        }
        assert_eq!(
            source_uses_esm_format(
                "async function run() { await Promise.resolve(); }",
                "input.ts"
            ),
            Ok(false)
        );
        assert_eq!(
            source_uses_esm_format(
                "async function run() { for await (const item of items) { consume(item); } }",
                "input.ts"
            ),
            Ok(false)
        );
        assert_eq!(
            source_uses_esm_format(
                "async function run() { await using resource = acquire(); }",
                "input.ts"
            ),
            Ok(false)
        );
        assert_eq!(
            source_uses_esm_format("var require = load;", "input.ts"),
            Ok(false)
        );
        assert_eq!(
            source_uses_esm_format(
                "declare const require: unknown; module.exports = 42;",
                "input.ts"
            ),
            Ok(false)
        );
        assert_eq!(
            source_uses_esm_format("declare class module {} module.exports = 42;", "input.ts"),
            Ok(false)
        );
    }

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
