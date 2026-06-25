#![allow(warnings)]

// Empty file, to be generated

pub mod builtin;
pub mod internal;
mod modules;
pub mod wrappers;

static JS_EXPORT_MODULE_NAME: &str = "bundle/script_module";
static JS_EXPORT_MODULE_SOURCE: &str = include_str!("bundle_script_module.js");

fn js_export_module() -> &'static str {
    JS_EXPORT_MODULE_SOURCE
}

type GetModuleFn = Box<dyn (Fn() -> String) + Send + Sync>;

// We patch JS_ADDITIONAL_MODULES to allow consumers to register modules at Wizer
// pre-init time before the runtime is initialized.
static JS_ADDITIONAL_MODULES: std::sync::LazyLock<Vec<(&'static str, GetModuleFn)>> =
    std::sync::LazyLock::new(|| _PENDING_MODULES.lock().unwrap().drain(..).collect());

static _PENDING_MODULES: std::sync::LazyLock<std::sync::Mutex<Vec<(&'static str, GetModuleFn)>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

pub fn add_additional_module(name: &'static str, get_module: GetModuleFn) {
    _PENDING_MODULES.lock().unwrap().push((name, get_module));
}

// We add JS_ADDITIONAL_FUNCTIONS to allow consumers to register global JS functions
// at Wizer pre-init time before the runtime is initialized. Each function receives
// the QuickJS context and is responsible for wiring itself into globalThis.
type InitFn = Box<dyn (Fn(&rquickjs::Ctx) -> rquickjs::Result<()>) + Send + Sync>;

static JS_ADDITIONAL_FUNCTIONS: std::sync::LazyLock<Vec<InitFn>> =
    std::sync::LazyLock::new(|| _PENDING_FUNCTIONS.lock().unwrap().drain(..).collect());

static _PENDING_FUNCTIONS: std::sync::LazyLock<std::sync::Mutex<Vec<InitFn>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

pub fn add_additional_function(f: InitFn) {
    _PENDING_FUNCTIONS.lock().unwrap().push(f);
}
