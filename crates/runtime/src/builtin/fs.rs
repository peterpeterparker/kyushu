use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn unix_timestamp_to_system_time(secs: f64) -> std::io::Result<SystemTime> {
    if !secs.is_finite() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "timestamp must be a finite number",
        ));
    }

    let duration = Duration::from_secs_f64(secs.abs());
    if secs >= 0.0 {
        UNIX_EPOCH.checked_add(duration).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "timestamp out of range")
        })
    } else {
        UNIX_EPOCH.checked_sub(duration).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "timestamp out of range")
        })
    }
}

fn set_file_times(file: &std::fs::File, atime_secs: f64, mtime_secs: f64) -> std::io::Result<()> {
    let atime = unix_timestamp_to_system_time(atime_secs)?;
    let mtime = unix_timestamp_to_system_time(mtime_secs)?;
    let times = std::fs::FileTimes::new()
        .set_accessed(atime)
        .set_modified(mtime);
    file.set_times(times)
}

fn secs_to_wasi_timestamp(secs: f64) -> std::io::Result<wasip2::filesystem::types::NewTimestamp> {
    if !secs.is_finite() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "timestamp must be a finite number",
        ));
    }
    if secs < 0.0 {
        // WASI datetime uses u64 for seconds, can't represent pre-epoch timestamps.
        // Return ENOSYS (raw 52 on WASI) so tests that accept unsupported operations pass.
        return Err(std::io::Error::from_raw_os_error(52));
    }
    let seconds = secs.floor() as u64;
    let nanoseconds = ((secs - secs.floor()) * 1_000_000_000.0) as u32;
    Ok(wasip2::filesystem::types::NewTimestamp::Timestamp(
        wasip2::clocks::wall_clock::Datetime {
            seconds,
            nanoseconds,
        },
    ))
}

fn wasi_fs_error_to_io(e: &wasip2::filesystem::types::ErrorCode) -> std::io::Error {
    use wasip2::filesystem::types::ErrorCode;
    match e {
        ErrorCode::NoEntry => std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()),
        ErrorCode::Access => {
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, e.to_string())
        }
        ErrorCode::NotPermitted => {
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, e.to_string())
        }
        ErrorCode::Exist => std::io::Error::new(std::io::ErrorKind::AlreadyExists, e.to_string()),
        ErrorCode::BadDescriptor => {
            std::io::Error::from_raw_os_error(8) // EBADF on WASI
        }
        ErrorCode::Invalid => std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string()),
        _ => std::io::Error::other(e.to_string()),
    }
}

fn set_path_times(
    path: &str,
    atime_secs: f64,
    mtime_secs: f64,
    follow_symlinks: bool,
) -> std::io::Result<()> {
    let atime = secs_to_wasi_timestamp(atime_secs)?;
    let mtime = secs_to_wasi_timestamp(mtime_secs)?;

    let path_flags = if follow_symlinks {
        wasip2::filesystem::types::PathFlags::SYMLINK_FOLLOW
    } else {
        wasip2::filesystem::types::PathFlags::empty()
    };

    let dirs = wasip2::filesystem::preopens::get_directories();

    // Find the best matching preopened directory (longest prefix)
    let mut best_match: Option<(usize, String)> = None;
    let mut best_prefix_len: usize = 0;

    for (i, (_, dir_path)) in dirs.iter().enumerate() {
        let normalized = dir_path.trim_end_matches('/');
        if normalized == "/" || normalized.is_empty() {
            let relative = path.trim_start_matches('/').to_string();
            let prefix_len = if normalized == "/" { 1 } else { 0 };
            if prefix_len >= best_prefix_len {
                best_prefix_len = prefix_len;
                best_match = Some((i, relative));
            }
        } else if path == normalized {
            let prefix_len = normalized.len();
            if prefix_len >= best_prefix_len {
                best_prefix_len = prefix_len;
                best_match = Some((i, ".".to_string()));
            }
        } else if path.starts_with(normalized)
            && path.as_bytes().get(normalized.len()) == Some(&b'/')
        {
            let prefix_len = normalized.len();
            if prefix_len >= best_prefix_len {
                best_prefix_len = prefix_len;
                best_match = Some((i, path[normalized.len() + 1..].to_string()));
            }
        }
    }

    if let Some((idx, relative)) = best_match {
        dirs[idx]
            .0
            .set_times_at(path_flags, &relative, atime, mtime)
            .map_err(|e| wasi_fs_error_to_io(&e))
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no matching preopened directory",
        ))
    }
}

struct FdTable {
    files: HashMap<i32, std::fs::File>,
    next_fd: i32,
}

impl FdTable {
    fn new() -> Self {
        Self {
            files: HashMap::new(),
            next_fd: 10,
        }
    }

    fn insert(&mut self, file: std::fs::File) -> i32 {
        let fd = self.next_fd;
        self.next_fd += 1;
        self.files.insert(fd, file);
        fd
    }

    fn get_mut(&mut self, fd: i32) -> Option<&mut std::fs::File> {
        self.files.get_mut(&fd)
    }

    fn remove(&mut self, fd: i32) -> Option<std::fs::File> {
        self.files.remove(&fd)
    }
}

static FD_TABLE: LazyLock<Mutex<FdTable>> = LazyLock::new(|| Mutex::new(FdTable::new()));

const MODE_PERMISSION_MASK: u32 = 0o7777;

static PATH_MODE_OVERRIDES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static FD_MODE_OVERRIDES: LazyLock<Mutex<HashMap<i32, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static FD_PATHS: LazyLock<Mutex<HashMap<i32, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static EMULATED_SYMLINKS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn normalize_mode_override(mode: u32) -> u32 {
    mode & MODE_PERMISSION_MASK
}

fn apply_mode_override_to_mode(base_mode: u32, mode_override: u32) -> u32 {
    (base_mode & !MODE_PERMISSION_MASK) | normalize_mode_override(mode_override)
}

fn apply_mode_override_to_stat_obj<'js>(stat_obj: &rquickjs::Object<'js>, mode_override: u32) {
    if let Ok(base_mode) = stat_obj.get::<_, f64>("mode") {
        let adjusted_mode = apply_mode_override_to_mode(base_mode as u32, mode_override);
        stat_obj.set("mode", adjusted_mode as f64).unwrap();
    }
}

fn set_mode_override_for_path(path: &str, mode: u32) {
    PATH_MODE_OVERRIDES
        .lock()
        .unwrap()
        .insert(path.to_string(), normalize_mode_override(mode));
}

fn get_mode_override_for_path(path: &str) -> Option<u32> {
    PATH_MODE_OVERRIDES.lock().unwrap().get(path).copied()
}

fn remove_mode_override_for_path(path: &str) {
    PATH_MODE_OVERRIDES.lock().unwrap().remove(path);
}

fn move_mode_override_for_path(old_path: &str, new_path: &str) {
    let mut overrides = PATH_MODE_OVERRIDES.lock().unwrap();
    if let Some(mode_override) = overrides.remove(old_path) {
        overrides.insert(new_path.to_string(), mode_override);
    }
}

fn set_mode_override_for_fd(fd: i32, mode: u32) {
    FD_MODE_OVERRIDES
        .lock()
        .unwrap()
        .insert(fd, normalize_mode_override(mode));
}

fn get_mode_override_for_fd(fd: i32) -> Option<u32> {
    FD_MODE_OVERRIDES.lock().unwrap().get(&fd).copied()
}

fn remove_mode_override_for_fd(fd: i32) {
    FD_MODE_OVERRIDES.lock().unwrap().remove(&fd);
}

fn remember_fd_path(fd: i32, path: &str) {
    FD_PATHS.lock().unwrap().insert(fd, path.to_string());
}

fn get_fd_path(fd: i32) -> Option<String> {
    FD_PATHS.lock().unwrap().get(&fd).cloned()
}

fn forget_fd_path(fd: i32) {
    FD_PATHS.lock().unwrap().remove(&fd);
}

fn rename_fd_path(old_path: &str, new_path: &str) {
    let mut fd_paths = FD_PATHS.lock().unwrap();
    for path in fd_paths.values_mut() {
        if path == old_path {
            *path = new_path.to_string();
        }
    }
}

fn set_emulated_symlink(path: &str, target: &str) {
    EMULATED_SYMLINKS
        .lock()
        .unwrap()
        .insert(path.to_string(), target.to_string());
}

fn get_emulated_symlink_target(path: &str) -> Option<String> {
    EMULATED_SYMLINKS.lock().unwrap().get(path).cloned()
}

fn remove_emulated_symlink(path: &str) {
    EMULATED_SYMLINKS.lock().unwrap().remove(path);
}

fn remove_emulated_symlinks_under(dir: &str) {
    let prefix = if dir.ends_with('/') {
        dir.to_string()
    } else {
        format!("{dir}/")
    };
    EMULATED_SYMLINKS
        .lock()
        .unwrap()
        .retain(|k, _| !k.starts_with(&prefix));
}

fn move_emulated_symlink(old_path: &str, new_path: &str) {
    let mut symlinks = EMULATED_SYMLINKS.lock().unwrap();
    if let Some(target) = symlinks.remove(old_path) {
        symlinks.insert(new_path.to_string(), target);
    }
}

fn apply_emulated_symlink_to_stat_obj<'js>(stat_obj: &rquickjs::Object<'js>) {
    stat_obj.set("isFile", false).unwrap();
    stat_obj.set("isDirectory", false).unwrap();
    stat_obj.set("isSymlink", true).unwrap();
}

/// Resolve emulated symlinks in a path by walking each component and following
/// symlink chains. Returns an ELOOP error if too many symlinks are followed.
fn resolve_emulated_symlinks_checked(path: &str) -> std::io::Result<String> {
    if EMULATED_SYMLINKS.lock().unwrap().is_empty() {
        return Ok(path.to_string());
    }

    const MAX_SYMLINK_FOLLOWS: usize = 40;
    let mut symlink_count = 0;

    // Build absolute path
    let abs_path = if path.starts_with('/') {
        path.to_string()
    } else if let Ok(cwd) = std::env::current_dir() {
        format!("{}/{}", cwd.to_string_lossy(), path)
    } else {
        path.to_string()
    };

    // Split into segments to process
    let mut todo: Vec<String> = abs_path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let mut resolved: Vec<String> = Vec::new();
    let mut i = 0;

    while i < todo.len() {
        let seg = todo[i].clone();

        if seg == "." {
            i += 1;
            continue;
        }

        if seg == ".." {
            resolved.pop();
            i += 1;
            continue;
        }

        resolved.push(seg);
        let current = format!("/{}", resolved.join("/"));

        if let Some(target) = get_emulated_symlink_target(&current) {
            symlink_count += 1;
            if symlink_count > MAX_SYMLINK_FOLLOWS {
                return Err(std::io::Error::other("too many levels of symbolic links"));
            }

            // Remove the symlink component
            resolved.pop();

            // Collect remaining segments after the symlink
            let remaining: Vec<String> = todo[i + 1..].to_vec();

            // Parse target into segments
            let target_segments: Vec<String> = target
                .split('/')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();

            if target.starts_with('/') {
                // Absolute target: clear resolved, restart from root
                resolved.clear();
                todo = target_segments;
                todo.extend(remaining);
            } else {
                // Relative target: prepend to remaining
                todo = target_segments;
                todo.extend(remaining);
            }
            i = 0;
        } else {
            i += 1;
        }
    }

    if resolved.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(format!("/{}", resolved.join("/")))
    }
}

/// Resolve emulated symlinks in a path. Falls back to the original path on error.
fn resolve_emulated_symlinks(path: &str) -> String {
    resolve_emulated_symlinks_checked(path).unwrap_or_else(|_| path.to_string())
}

fn map_error_code(err: &std::io::Error) -> (&'static str, i32, &'static str) {
    match err.kind() {
        std::io::ErrorKind::NotFound => ("ENOENT", -2, "no such file or directory"),
        std::io::ErrorKind::AlreadyExists => ("EEXIST", -17, "file already exists"),
        std::io::ErrorKind::PermissionDenied => ("EACCES", -13, "permission denied"),
        std::io::ErrorKind::InvalidInput => ("EINVAL", -22, "invalid argument"),
        _ => {
            let err_text = err.to_string().to_lowercase();
            if err_text.contains("too many levels of symbolic links") || err_text.contains("eloop")
            {
                return ("ELOOP", -40, "too many levels of symbolic links");
            }
            if err_text.contains("file exists") {
                return ("EEXIST", -17, "file already exists");
            }
            if err_text.contains("no such file") || err_text.contains("not found") {
                return ("ENOENT", -2, "no such file or directory");
            }
            if err_text.contains("not a directory") {
                return ("ENOTDIR", -20, "not a directory");
            }
            if err_text.contains("directory not empty") {
                return ("ENOTEMPTY", -39, "directory not empty");
            }
            if err_text.contains("bad file descriptor") {
                return ("EBADF", -9, "bad file descriptor");
            }
            if err_text.contains("name too long") || err_text.contains("path too long") {
                return ("ENAMETOOLONG", -36, "name too long");
            }

            if let Some(raw) = err.raw_os_error() {
                match raw {
                    44 => ("ENOENT", -2, "no such file or directory"),
                    20 => ("EEXIST", -17, "file already exists"),
                    54 => ("ENOTDIR", -20, "not a directory"),
                    55 => ("ENOTEMPTY", -39, "directory not empty"),
                    8 => ("EBADF", -9, "bad file descriptor"),
                    52 => ("ENOSYS", -38, "function not implemented"),
                    63 | 1 => ("EPERM", -1, "operation not permitted"),
                    18 => ("EXDEV", -18, "cross-device link not permitted"),
                    28 => ("EINVAL", -22, "invalid argument"),
                    31 => ("EISDIR", -21, "illegal operation on a directory"),
                    _ => ("EIO", -5, "input/output error"),
                }
            } else {
                ("EIO", -5, "input/output error")
            }
        }
    }
}

fn make_fs_error<'js>(
    ctx: &rquickjs::Ctx<'js>,
    err: &std::io::Error,
    syscall: &str,
    path: Option<&str>,
) -> rquickjs::Object<'js> {
    make_fs_error_with_dest(ctx, err, syscall, path, None)
}

fn make_fs_error_with_dest<'js>(
    ctx: &rquickjs::Ctx<'js>,
    err: &std::io::Error,
    syscall: &str,
    path: Option<&str>,
    dest: Option<&str>,
) -> rquickjs::Object<'js> {
    let obj = rquickjs::Object::new(ctx.clone()).unwrap();
    let (code, errno, description) = map_error_code(err);
    obj.set("errno", errno).unwrap();
    obj.set("code", code).unwrap();
    obj.set("syscall", syscall).unwrap();
    let msg = if let Some(p) = path {
        if let Some(d) = dest {
            format!("{code}: {description}, {syscall} '{p}' -> '{d}'")
        } else {
            format!("{code}: {description}, {syscall} '{p}'")
        }
    } else {
        format!("{code}: {description}, {syscall}")
    };
    obj.set("message", msg.clone()).unwrap();
    if let Some(p) = path {
        obj.set("path", p).unwrap();
    }
    if let Some(d) = dest {
        obj.set("dest", d).unwrap();
    }
    obj
}

fn make_badf_error<'js>(ctx: &rquickjs::Ctx<'js>, syscall: &str) -> rquickjs::Object<'js> {
    let obj = rquickjs::Object::new(ctx.clone()).unwrap();
    obj.set("errno", -9).unwrap();
    obj.set("code", "EBADF").unwrap();
    obj.set("syscall", syscall).unwrap();
    let msg = format!("EBADF: bad file descriptor, {syscall}");
    obj.set("message", msg).unwrap();
    obj
}

/// Synthesize an ENOENT std::io::Error without ever touching wasi-libc.
///
/// Used to short-circuit path-based fs operations during Wizer pre-init so
/// that wasi-libc's lazy preopen-cache initialization never runs against the
/// (empty) wizer environment. See `crate::internal::is_wizer_active` and
/// issue #91.
fn wizer_enoent_io() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "ENOENT during wizer pre-initialization",
    )
}

fn wizer_enoent_obj<'js>(
    ctx: &rquickjs::Ctx<'js>,
    syscall: &str,
    path: Option<&str>,
) -> rquickjs::Object<'js> {
    make_fs_error(ctx, &wizer_enoent_io(), syscall, path)
}

fn is_dev_stdio_path(path: &str) -> bool {
    matches!(path, "/dev/stdin" | "/dev/stdout" | "/dev/stderr")
}

fn stdio_stat_obj<'js>(ctx: &rquickjs::Ctx<'js>) -> rquickjs::Object<'js> {
    let obj = rquickjs::Object::new(ctx.clone()).unwrap();
    obj.set("dev", 0_f64).unwrap();
    obj.set("ino", 0_f64).unwrap();
    obj.set("mode", 8592_f64).unwrap(); // 0o20620 = S_IFCHR | 0620
    obj.set("nlink", 1_f64).unwrap();
    obj.set("uid", 0_f64).unwrap();
    obj.set("gid", 0_f64).unwrap();
    obj.set("rdev", 0_f64).unwrap();
    obj.set("blksize", 0_f64).unwrap();
    obj.set("blocks", 0_f64).unwrap();
    obj.set("size", 0_f64).unwrap();
    obj.set("atimeMs", 0_f64).unwrap();
    obj.set("mtimeMs", 0_f64).unwrap();
    obj.set("ctimeMs", 0_f64).unwrap();
    obj.set("birthtimeMs", 0_f64).unwrap();
    obj.set("isFile", false).unwrap();
    obj.set("isDirectory", false).unwrap();
    obj.set("isSymlink", false).unwrap();
    obj
}

fn metadata_to_obj<'js>(
    ctx: &rquickjs::Ctx<'js>,
    meta: &std::fs::Metadata,
) -> rquickjs::Object<'js> {
    let obj = rquickjs::Object::new(ctx.clone()).unwrap();

    obj.set("dev", 0_f64).unwrap();
    obj.set("ino", 0_f64).unwrap();
    let mode: f64 = if meta.is_dir() {
        16877.0 // 0o40755
    } else {
        33188.0 // 0o100644
    };
    obj.set("mode", mode).unwrap();
    obj.set("nlink", 1_f64).unwrap();
    obj.set("uid", 0_f64).unwrap();
    obj.set("gid", 0_f64).unwrap();
    obj.set("rdev", 0_f64).unwrap();
    obj.set("blksize", 4096_f64).unwrap();
    obj.set("blocks", meta.len().div_ceil(512) as f64).unwrap();

    obj.set("size", meta.len() as f64).unwrap();

    let atime_ms = meta
        .accessed()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let ctime_ms = mtime_ms; // ctime not directly available, use mtime
    let birthtime_ms = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);

    obj.set("atimeMs", atime_ms).unwrap();
    obj.set("mtimeMs", mtime_ms).unwrap();
    obj.set("ctimeMs", ctime_ms).unwrap();
    obj.set("birthtimeMs", birthtime_ms).unwrap();

    obj.set("isFile", meta.is_file()).unwrap();
    obj.set("isDirectory", meta.is_dir()).unwrap();
    obj.set("isSymlink", meta.is_symlink()).unwrap();

    obj
}

#[cfg(feature = "encoding")]
fn read_file_with_encoding_impl(
    path: &str,
    encoding: &str,
) -> rquickjs::prelude::List<(Option<String>, Option<String>)> {
    use rquickjs::prelude::List;
    let path = std::path::Path::new(path);
    match std::fs::read(path) {
        Ok(bytes) => match encoding_rs::Encoding::for_label(encoding.as_bytes()) {
            Some(enc) => {
                let (decoded, _) = enc.decode_with_bom_removal(&bytes);
                List((Some(decoded.into_owned()), None))
            }
            None => List((None, Some(format!("Unsupported encoding: {encoding}")))),
        },
        Err(err) => List((None, Some(format!("Failed to read file {path:?}: {err}")))),
    }
}

#[cfg(not(feature = "encoding"))]
fn read_file_with_encoding_impl(
    path: &str,
    encoding: &str,
) -> rquickjs::prelude::List<(Option<String>, Option<String>)> {
    use rquickjs::prelude::List;
    let path_obj = std::path::Path::new(path);
    let label = encoding.trim().to_ascii_lowercase();
    if !matches!(label.as_str(), "utf-8" | "utf8" | "unicode-1-1-utf-8") {
        return List((
            None,
            Some(format!(
                "Encoding \"{encoding}\" is not supported (encoding feature is not enabled, only UTF-8 is available)"
            )),
        ));
    }
    match std::fs::read(path_obj) {
        Ok(bytes) => List((Some(String::from_utf8_lossy(&bytes).into_owned()), None)),
        Err(err) => List((
            None,
            Some(format!("Failed to read file {path_obj:?}: {err}")),
        )),
    }
}

#[rquickjs::module(rename_vars = "camelCase")]
pub mod native_module {

    use rquickjs::prelude::List;
    use rquickjs::{Array, Ctx, Object, TypedArray, Value};
    use std::path::Path;

    const MAX_STACK_DEPTH_FOR_READDIR: isize = 384;
    const STACK_DEPTH_SCAN_LIMIT: isize = 1024;

    fn has_excessive_js_stack_depth(ctx: &Ctx<'_>) -> bool {
        for depth in 0..STACK_DEPTH_SCAN_LIMIT {
            if ctx.script_or_module_name(depth).is_none() {
                return false;
            }

            if depth >= MAX_STACK_DEPTH_FOR_READDIR {
                return true;
            }
        }

        true
    }

    // --- Existing functions (unchanged) ---

    #[rquickjs::function]
    pub fn read_file_with_encoding(
        path: String,
        encoding: String,
    ) -> List<(Option<String>, Option<String>)> {
        super::read_file_with_encoding_impl(&path, &encoding)
    }

    #[rquickjs::function]
    pub fn read_file(
        path: String,
        ctx: Ctx<'_>,
    ) -> List<(Option<TypedArray<'_, u8>>, Option<String>)> {
        let path = Path::new(&path);
        match std::fs::read(path) {
            Ok(bytes) => {
                let typed_array =
                    TypedArray::new_copy(ctx.clone(), &bytes).expect("Failed to create TypedArray");
                List((Some(typed_array), None))
            }
            Err(err) => {
                let error_message = format!("Failed to read file {path:?}: {err}");
                List((None, Some(error_message)))
            }
        }
    }

    #[rquickjs::function]
    pub fn write_file_with_encoding(
        path: String,
        encoding: String,
        content: String,
    ) -> Option<String> {
        if encoding != "utf8" {
            Some("Only 'utf8' encoding is supported".to_string())
        } else {
            let bytes = content.as_bytes();
            let path = Path::new(&path);
            if let Some(parent) = path.parent()
                && let Err(err) = std::fs::create_dir_all(parent)
            {
                return Some(format!(
                    "Failed to create directory {}: {}",
                    parent.display(),
                    err
                ));
            }
            if let Err(err) = std::fs::write(path, bytes) {
                Some(format!("Failed to write file {path:?}: {err}"))
            } else {
                None // Success
            }
        }
    }

    #[rquickjs::function]
    pub fn write_file(path: String, content: TypedArray<'_, u8>) -> Option<String> {
        if let Some(bytes) = content.as_bytes() {
            let path = Path::new(&path);
            if let Some(parent) = path.parent()
                && let Err(err) = std::fs::create_dir_all(parent)
            {
                return Some(format!(
                    "Failed to create directory {}: {}",
                    parent.display(),
                    err
                ));
            }
            if let Err(err) = std::fs::write(path, bytes) {
                Some(format!("Failed to write file {path:?}: {err}"))
            } else {
                None // Success
            }
        } else {
            Some("The typed array has been detached".to_string())
        }
    }

    #[rquickjs::function]
    pub fn unlink(ctx: Ctx<'_>, path: String) -> Option<Object<'_>> {
        match std::fs::remove_file(Path::new(&path)) {
            Ok(_) => {
                super::remove_mode_override_for_path(&path);
                super::remove_emulated_symlink(&path);
                None
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "unlink", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn rename(ctx: Ctx<'_>, old_path: String, new_path: String) -> Option<Object<'_>> {
        match std::fs::rename(Path::new(&old_path), Path::new(&new_path)) {
            Ok(_) => {
                super::move_mode_override_for_path(&old_path, &new_path);
                super::rename_fd_path(&old_path, &new_path);
                super::move_emulated_symlink(&old_path, &new_path);
                None
            }
            Err(err) => Some(super::make_fs_error_with_dest(
                &ctx,
                &err,
                "rename",
                Some(&old_path),
                Some(&new_path),
            )),
        }
    }

    #[rquickjs::function]
    pub fn mkdir(path: String, recursive: bool) -> Option<String> {
        let path = Path::new(&path);
        let result = if recursive {
            std::fs::create_dir_all(path)
        } else {
            std::fs::create_dir(path)
        };
        match result {
            Ok(_) => None,
            Err(err) => Some(format!("Failed to create directory {path:?}: {err}")),
        }
    }

    // --- New functions ---

    #[rquickjs::function]
    pub fn fs_open(ctx: Ctx<'_>, path: String, flags: i32, mode: i32) -> Object<'_> {
        use std::fs::OpenOptions;
        use std::io::{Seek, SeekFrom};

        let result = Object::new(ctx.clone()).unwrap();

        if crate::internal::is_wizer_active() {
            result
                .set("error", super::wizer_enoent_obj(&ctx, "open", Some(&path)))
                .unwrap();
            return result;
        }

        let fs_path = super::resolve_emulated_symlinks(&path);

        let mut opts = OpenOptions::new();

        let read = flags & 2 != 0 || flags & 1 == 0; // O_RDWR or O_RDONLY
        let write = flags & 1 != 0 || flags & 2 != 0; // O_WRONLY or O_RDWR
        let creating = flags & 64 != 0; // O_CREAT

        opts.read(read);
        opts.write(write);

        if creating {
            opts.create(true); // O_CREAT
        }
        if flags & 128 != 0 {
            opts.create_new(true); // O_EXCL
        }
        if flags & 512 != 0 {
            opts.truncate(true); // O_TRUNC
        }
        if flags & 1024 != 0 {
            opts.append(true); // O_APPEND
        }

        match opts.open(&fs_path) {
            Ok(mut file) => {
                // If O_APPEND, seek to end
                if flags & 1024 != 0 {
                    let _ = file.seek(SeekFrom::End(0));
                }
                let fd = super::FD_TABLE.lock().unwrap().insert(file);
                super::remember_fd_path(fd, &path);
                if creating {
                    super::set_mode_override_for_path(&path, mode as u32);
                    super::set_mode_override_for_fd(fd, mode as u32);
                } else if let Some(mode_override) = super::get_mode_override_for_path(&path) {
                    super::set_mode_override_for_fd(fd, mode_override);
                }
                result.set("fd", fd).unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "open", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_close(ctx: Ctx<'_>, fd: i32) -> Option<Object<'_>> {
        let removed = super::FD_TABLE.lock().unwrap().remove(fd);
        if removed.is_some() {
            super::forget_fd_path(fd);
            super::remove_mode_override_for_fd(fd);
            None
        } else {
            Some(super::make_badf_error(&ctx, "close"))
        }
    }

    #[rquickjs::function]
    pub fn fs_read<'js>(
        ctx: Ctx<'js>,
        fd: i32,
        length: usize,
        position: Value<'js>,
    ) -> Object<'js> {
        use std::io::{Read, Seek, SeekFrom};

        let result = Object::new(ctx.clone()).unwrap();
        let mut table = super::FD_TABLE.lock().unwrap();

        match table.get_mut(fd) {
            Some(file) => {
                if !position.is_null()
                    && !position.is_undefined()
                    && let Some(pos) = position.as_number()
                {
                    let pos = pos as u64;
                    if let Err(err) = file.seek(SeekFrom::Start(pos)) {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "read", None))
                            .unwrap();
                        return result;
                    }
                }

                let mut buf = vec![0u8; length];
                match file.read(&mut buf) {
                    Ok(bytes_read) => {
                        buf.truncate(bytes_read);
                        let typed_array = TypedArray::new_copy(ctx.clone(), &buf)
                            .expect("Failed to create TypedArray");
                        result.set("bytesRead", bytes_read as f64).unwrap();
                        result.set("buffer", typed_array).unwrap();
                    }
                    Err(err) => {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "read", None))
                            .unwrap();
                    }
                }
            }
            None => {
                result
                    .set("error", super::make_badf_error(&ctx, "read"))
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_write_buffer<'js>(
        ctx: Ctx<'js>,
        fd: i32,
        buffer: TypedArray<'js, u8>,
        offset: usize,
        length: usize,
        position: Value<'js>,
    ) -> Object<'js> {
        use std::io::{Seek, SeekFrom, Write};

        let result = Object::new(ctx.clone()).unwrap();

        let Some(bytes) = buffer.as_bytes() else {
            result
                .set(
                    "error",
                    super::make_fs_error(
                        &ctx,
                        &std::io::Error::new(std::io::ErrorKind::InvalidInput, "detached buffer"),
                        "write",
                        None,
                    ),
                )
                .unwrap();
            return result;
        };

        let end = (offset + length).min(bytes.len());
        let data = &bytes[offset..end];

        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => {
                if !position.is_null()
                    && !position.is_undefined()
                    && let Some(pos) = position.as_number()
                {
                    let pos = pos as u64;
                    if let Err(err) = file.seek(SeekFrom::Start(pos)) {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "write", None))
                            .unwrap();
                        return result;
                    }
                }
                match file.write_all(data) {
                    Ok(()) => {
                        result.set("bytesWritten", data.len() as f64).unwrap();
                    }
                    Err(err) => {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "write", None))
                            .unwrap();
                    }
                }
            }
            None => {
                result
                    .set("error", super::make_badf_error(&ctx, "write"))
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_write_string<'js>(
        ctx: Ctx<'js>,
        fd: i32,
        data: String,
        position: Value<'js>,
    ) -> Object<'js> {
        use std::io::{Seek, SeekFrom, Write};

        let result = Object::new(ctx.clone()).unwrap();
        let mut table = super::FD_TABLE.lock().unwrap();

        match table.get_mut(fd) {
            Some(file) => {
                if !position.is_null()
                    && !position.is_undefined()
                    && let Some(pos) = position.as_number()
                {
                    let pos = pos as u64;
                    if let Err(err) = file.seek(SeekFrom::Start(pos)) {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "write", None))
                            .unwrap();
                        return result;
                    }
                }
                let bytes = data.as_bytes();
                match file.write_all(bytes) {
                    Ok(()) => {
                        result.set("bytesWritten", bytes.len() as f64).unwrap();
                    }
                    Err(err) => {
                        result
                            .set("error", super::make_fs_error(&ctx, &err, "write", None))
                            .unwrap();
                    }
                }
            }
            None => {
                result
                    .set("error", super::make_badf_error(&ctx, "write"))
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_ftruncate(ctx: Ctx<'_>, fd: i32, len: f64) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => {
                if let Err(err) = file.set_len(len as u64) {
                    Some(super::make_fs_error(&ctx, &err, "ftruncate", None))
                } else {
                    None
                }
            }
            None => Some(super::make_badf_error(&ctx, "ftruncate")),
        }
    }

    #[rquickjs::function]
    pub fn fs_fsync(ctx: Ctx<'_>, fd: i32) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => {
                if let Err(err) = file.sync_all() {
                    Some(super::make_fs_error(&ctx, &err, "fsync", None))
                } else {
                    None
                }
            }
            None => Some(super::make_badf_error(&ctx, "fsync")),
        }
    }

    #[rquickjs::function]
    pub fn fs_fdatasync(ctx: Ctx<'_>, fd: i32) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => {
                if let Err(err) = file.sync_data() {
                    Some(super::make_fs_error(&ctx, &err, "fdatasync", None))
                } else {
                    None
                }
            }
            None => Some(super::make_badf_error(&ctx, "fdatasync")),
        }
    }

    #[rquickjs::function]
    pub fn fs_stat(ctx: Ctx<'_>, path: String) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        if super::is_dev_stdio_path(&path) {
            let stat = super::stdio_stat_obj(&ctx);
            result.set("stat", stat).unwrap();
            return result;
        }

        if crate::internal::is_wizer_active() {
            result
                .set("error", super::wizer_enoent_obj(&ctx, "stat", Some(&path)))
                .unwrap();
            return result;
        }

        let fs_path = super::resolve_emulated_symlinks(&path);

        match std::fs::metadata(&fs_path) {
            Ok(meta) => {
                let stat_obj = super::metadata_to_obj(&ctx, &meta);
                if let Some(mode_override) = super::get_mode_override_for_path(&path) {
                    super::apply_mode_override_to_stat_obj(&stat_obj, mode_override);
                }
                result.set("stat", stat_obj).unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "stat", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_lstat(ctx: Ctx<'_>, path: String) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        if super::is_dev_stdio_path(&path) {
            let stat = super::stdio_stat_obj(&ctx);
            result.set("stat", stat).unwrap();
            return result;
        }

        if crate::internal::is_wizer_active() {
            result
                .set("error", super::wizer_enoent_obj(&ctx, "lstat", Some(&path)))
                .unwrap();
            return result;
        }

        // For lstat: if the path itself is an emulated symlink, use the
        // original path (we'll mark it as symlink below). Otherwise resolve
        // intermediate symlinks so paths through symlinks work.
        let fs_path = if super::get_emulated_symlink_target(&path).is_some() {
            path.clone()
        } else {
            super::resolve_emulated_symlinks(&path)
        };

        match std::fs::symlink_metadata(&fs_path) {
            Ok(meta) => {
                let stat_obj = super::metadata_to_obj(&ctx, &meta);
                if let Some(mode_override) = super::get_mode_override_for_path(&path) {
                    super::apply_mode_override_to_stat_obj(&stat_obj, mode_override);
                }
                if super::get_emulated_symlink_target(&path).is_some() {
                    super::apply_emulated_symlink_to_stat_obj(&stat_obj);
                }
                result.set("stat", stat_obj).unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "lstat", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_fstat(ctx: Ctx<'_>, fd: i32) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        // Handle stdin/stdout/stderr (fd 0, 1, 2) which are not in FD_TABLE
        if (0..=2).contains(&fd) {
            let stat = super::stdio_stat_obj(&ctx);
            result.set("stat", stat).unwrap();
            return result;
        }

        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => match file.metadata() {
                Ok(meta) => {
                    let stat_obj = super::metadata_to_obj(&ctx, &meta);
                    let mode_override = super::get_mode_override_for_fd(fd).or_else(|| {
                        super::get_fd_path(fd)
                            .and_then(|path| super::get_mode_override_for_path(&path))
                    });
                    if let Some(mode_override) = mode_override {
                        super::apply_mode_override_to_stat_obj(&stat_obj, mode_override);
                    }
                    result.set("stat", stat_obj).unwrap();
                }
                Err(err) => {
                    result
                        .set("error", super::make_fs_error(&ctx, &err, "fstat", None))
                        .unwrap();
                }
            },
            None => {
                result
                    .set("error", super::make_badf_error(&ctx, "fstat"))
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_readdir(ctx: Ctx<'_>, path: String, with_file_types: bool) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        if has_excessive_js_stack_depth(&ctx) {
            result.set("stackOverflow", true).unwrap();
            return result;
        }

        if crate::internal::is_wizer_active() {
            result
                .set(
                    "error",
                    super::wizer_enoent_obj(&ctx, "scandir", Some(&path)),
                )
                .unwrap();
            return result;
        }

        let fs_path = super::resolve_emulated_symlinks(&path);

        match std::fs::read_dir(&fs_path) {
            Ok(entries) => {
                let arr = Array::new(ctx.clone()).unwrap();
                let mut idx = 0usize;
                for entry in entries {
                    match entry {
                        Ok(entry) => {
                            if with_file_types {
                                let obj = Object::new(ctx.clone()).unwrap();
                                let name = entry.file_name().to_string_lossy().to_string();
                                obj.set("name", name).unwrap();
                                let ft = entry.file_type();
                                let file_type = match ft {
                                    Ok(ft) if ft.is_file() => "file",
                                    Ok(ft) if ft.is_dir() => "directory",
                                    Ok(ft) if ft.is_symlink() => "symlink",
                                    _ => "unknown",
                                };
                                obj.set("fileType", file_type).unwrap();
                                arr.set(idx, obj).unwrap();
                            } else {
                                let name = entry.file_name().to_string_lossy().to_string();
                                arr.set(idx, name).unwrap();
                            }
                            idx += 1;
                        }
                        Err(_) => continue,
                    }
                }
                result.set("entries", arr).unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "scandir", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_access(ctx: Ctx<'_>, path: String, _mode: i32) -> Option<Object<'_>> {
        if crate::internal::is_wizer_active() {
            return Some(super::wizer_enoent_obj(&ctx, "access", Some(&path)));
        }

        let fs_path = super::resolve_emulated_symlinks(&path);

        // For WASI, just check if the path exists (and is accessible)
        match std::fs::metadata(&fs_path) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error(&ctx, &err, "access", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_realpath(ctx: Ctx<'_>, path: String) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        if super::is_dev_stdio_path(&path) {
            result.set("result", path).unwrap();
            return result;
        }

        if crate::internal::is_wizer_active() {
            result
                .set(
                    "error",
                    super::wizer_enoent_obj(&ctx, "realpath", Some(&path)),
                )
                .unwrap();
            return result;
        }

        // Use chain-resolving emulated symlink resolution
        match super::resolve_emulated_symlinks_checked(&path) {
            Ok(resolved_path) => {
                // Verify the final resolved path exists
                match std::fs::symlink_metadata(&resolved_path) {
                    Ok(_) => {
                        result.set("result", resolved_path).unwrap();
                    }
                    Err(err) => {
                        result
                            .set(
                                "error",
                                super::make_fs_error(&ctx, &err, "realpath", Some(&path)),
                            )
                            .unwrap();
                    }
                }
            }
            Err(err) => {
                // ELOOP or other resolution error
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "realpath", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_truncate(ctx: Ctx<'_>, path: String, len: f64) -> Option<Object<'_>> {
        match std::fs::OpenOptions::new().write(true).open(&path) {
            Ok(file) => {
                if let Err(err) = file.set_len(len as u64) {
                    Some(super::make_fs_error(&ctx, &err, "truncate", Some(&path)))
                } else {
                    None
                }
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "truncate", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_copy_file(ctx: Ctx<'_>, src: String, dest: String) -> Option<Object<'_>> {
        match std::fs::copy(&src, &dest) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error_with_dest(
                &ctx,
                &err,
                "copyfile",
                Some(&src),
                Some(&dest),
            )),
        }
    }

    #[rquickjs::function]
    pub fn fs_link(ctx: Ctx<'_>, existing_path: String, new_path: String) -> Option<Object<'_>> {
        match std::fs::hard_link(&existing_path, &new_path) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error_with_dest(
                &ctx,
                &err,
                "link",
                Some(&existing_path),
                Some(&new_path),
            )),
        }
    }

    #[rquickjs::function]
    pub fn fs_symlink(ctx: Ctx<'_>, target: String, path: String) -> Option<Object<'_>> {
        if Path::new(&path).exists() {
            let err = std::io::Error::new(std::io::ErrorKind::AlreadyExists, "file already exists");
            return Some(super::make_fs_error_with_dest(
                &ctx,
                &err,
                "symlink",
                Some(&target),
                Some(&path),
            ));
        }

        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(_) => {
                super::set_emulated_symlink(&path, &target);
                None
            }
            Err(err) => Some(super::make_fs_error_with_dest(
                &ctx,
                &err,
                "symlink",
                Some(&target),
                Some(&path),
            )),
        }
    }

    #[rquickjs::function]
    pub fn fs_readlink(ctx: Ctx<'_>, path: String) -> Object<'_> {
        let result = Object::new(ctx.clone()).unwrap();

        if let Some(target) = super::get_emulated_symlink_target(&path) {
            result.set("result", target).unwrap();
            return result;
        }

        if crate::internal::is_wizer_active() {
            result
                .set(
                    "error",
                    super::wizer_enoent_obj(&ctx, "readlink", Some(&path)),
                )
                .unwrap();
            return result;
        }

        match std::fs::read_link(&path) {
            Ok(target) => {
                result
                    .set("result", target.to_string_lossy().to_string())
                    .unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "readlink", Some(&path)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_chmod(ctx: Ctx<'_>, path: String, mode: u32) -> Option<Object<'_>> {
        // chmod is not supported on WASI; verify path exists
        match std::fs::metadata(&path) {
            Ok(_) => {
                super::set_mode_override_for_path(&path, mode);
                None
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "chmod", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_fchmod(ctx: Ctx<'_>, fd: i32, mode: u32) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(_) => {
                // fchmod is not supported on WASI; emulate it in stat/fstat.
                super::set_mode_override_for_fd(fd, mode);
                if let Some(path) = super::get_fd_path(fd) {
                    super::set_mode_override_for_path(&path, mode);
                }
                None
            }
            None => Some(super::make_badf_error(&ctx, "fchmod")),
        }
    }

    #[rquickjs::function]
    pub fn fs_chown(ctx: Ctx<'_>, path: String, _uid: u32, _gid: u32) -> Option<Object<'_>> {
        // chown is not supported on WASI; just verify path exists
        match std::fs::metadata(&path) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error(&ctx, &err, "chown", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_fchown(ctx: Ctx<'_>, fd: i32, _uid: u32, _gid: u32) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(_) => None,
            None => Some(super::make_badf_error(&ctx, "fchown")),
        }
    }

    #[rquickjs::function]
    pub fn fs_lchown(ctx: Ctx<'_>, path: String, _uid: u32, _gid: u32) -> Option<Object<'_>> {
        match std::fs::symlink_metadata(&path) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error(&ctx, &err, "lchown", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_utimes(
        ctx: Ctx<'_>,
        path: String,
        atime_secs: f64,
        mtime_secs: f64,
    ) -> Option<Object<'_>> {
        match super::set_path_times(&path, atime_secs, mtime_secs, true) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error(&ctx, &err, "utime", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_lutimes(
        ctx: Ctx<'_>,
        path: String,
        atime_secs: f64,
        mtime_secs: f64,
    ) -> Option<Object<'_>> {
        match super::set_path_times(&path, atime_secs, mtime_secs, false) {
            Ok(_) => None,
            Err(err) => Some(super::make_fs_error(&ctx, &err, "lutime", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_futimes(
        ctx: Ctx<'_>,
        fd: i32,
        atime_secs: f64,
        mtime_secs: f64,
    ) -> Option<Object<'_>> {
        let mut table = super::FD_TABLE.lock().unwrap();
        match table.get_mut(fd) {
            Some(file) => match super::set_file_times(file, atime_secs, mtime_secs) {
                Ok(_) => None,
                Err(err) => Some(super::make_fs_error(&ctx, &err, "futime", None)),
            },
            None => Some(super::make_badf_error(&ctx, "futime")),
        }
    }

    #[rquickjs::function]
    pub fn fs_mkdir(ctx: Ctx<'_>, path: String, recursive: bool, mode: u32) -> Option<Object<'_>> {
        let p = Path::new(&path);
        let mode = mode & 0o7777;

        let existed_before = p.exists();

        let result = if recursive {
            std::fs::create_dir_all(p)
        } else {
            std::fs::create_dir(p)
        };

        match result {
            Ok(_) => {
                if !recursive || !existed_before {
                    super::set_mode_override_for_path(&path, mode);
                }
                None
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "mkdir", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_rmdir(ctx: Ctx<'_>, path: String) -> Option<Object<'_>> {
        match std::fs::remove_dir(&path) {
            Ok(_) => {
                super::remove_mode_override_for_path(&path);
                None
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "rmdir", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_rm(ctx: Ctx<'_>, path: String, recursive: bool, force: bool) -> Option<Object<'_>> {
        let meta = std::fs::symlink_metadata(&path);
        match meta {
            Ok(m) => {
                if m.is_dir() {
                    let result = if recursive {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_dir(&path)
                    };
                    match result {
                        Ok(_) => {
                            super::remove_mode_override_for_path(&path);
                            super::remove_emulated_symlinks_under(&path);
                            None
                        }
                        Err(err) => Some(super::make_fs_error(&ctx, &err, "rm", Some(&path))),
                    }
                } else {
                    match std::fs::remove_file(&path) {
                        Ok(_) => {
                            super::remove_mode_override_for_path(&path);
                            super::remove_emulated_symlink(&path);
                            None
                        }
                        Err(err) => Some(super::make_fs_error(&ctx, &err, "rm", Some(&path))),
                    }
                }
            }
            Err(err) => {
                if force && err.kind() == std::io::ErrorKind::NotFound {
                    None
                } else {
                    Some(super::make_fs_error(&ctx, &err, "lstat", Some(&path)))
                }
            }
        }
    }

    #[rquickjs::function]
    pub fn fs_mkdtemp(ctx: Ctx<'_>, prefix: String) -> Object<'_> {
        use rand::Rng;

        let result = Object::new(ctx.clone()).unwrap();
        let mut rng = rand::rng();
        let chars: Vec<char> = (0..6)
            .map(|_| {
                let idx: u32 = rng.random_range(0..36);
                if idx < 10 {
                    (b'0' + idx as u8) as char
                } else {
                    (b'a' + (idx - 10) as u8) as char
                }
            })
            .collect();
        let suffix: String = chars.into_iter().collect();
        let dir_path = format!("{prefix}{suffix}");

        match std::fs::create_dir(&dir_path) {
            Ok(_) => {
                result.set("result", dir_path).unwrap();
            }
            Err(err) => {
                result
                    .set(
                        "error",
                        super::make_fs_error(&ctx, &err, "mkdtemp", Some(&prefix)),
                    )
                    .unwrap();
            }
        }
        result
    }

    #[rquickjs::function]
    pub fn fs_append_file<'js>(
        ctx: Ctx<'js>,
        path: String,
        data: TypedArray<'js, u8>,
    ) -> Option<Object<'js>> {
        let Some(bytes) = data.as_bytes() else {
            return Some(super::make_fs_error(
                &ctx,
                &std::io::Error::new(std::io::ErrorKind::InvalidInput, "detached buffer"),
                "appendFile",
                Some(&path),
            ));
        };

        let file = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path);

        match file {
            Ok(mut f) => {
                use std::io::Write;
                if let Err(err) = f.write_all(bytes) {
                    Some(super::make_fs_error(&ctx, &err, "appendFile", Some(&path)))
                } else {
                    None
                }
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "open", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_append_file_string(ctx: Ctx<'_>, path: String, data: String) -> Option<Object<'_>> {
        let file = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path);

        match file {
            Ok(mut f) => {
                use std::io::Write;
                if let Err(err) = f.write_all(data.as_bytes()) {
                    Some(super::make_fs_error(&ctx, &err, "appendFile", Some(&path)))
                } else {
                    None
                }
            }
            Err(err) => Some(super::make_fs_error(&ctx, &err, "open", Some(&path))),
        }
    }

    #[rquickjs::function]
    pub fn fs_exists(path: String) -> bool {
        let fs_path = super::resolve_emulated_symlinks(&path);

        std::path::Path::new(&fs_path).exists()
    }
}

// JS functions for the fs implementation
pub const FS_JS: &str = include_str!("fs.js");

pub const FS_PROMISES_JS: &str = include_str!("fs_promises.js");

// Re-exports for aliases
pub const REEXPORT_JS: &str = r#"export * from 'node:fs'; export { default } from 'node:fs';"#;
pub const REEXPORT_PROMISES_JS: &str =
    r#"export * from 'node:fs/promises'; export { default } from 'node:fs/promises';"#;
