import {
    arch as arch_native,
    available_parallelism as available_parallelism_native,
    endianness as endianness_native,
    homedir as homedir_native,
    hostname as hostname_native,
    machine as machine_native,
    platform as platform_native,
    release as release_native,
    type_ as type_native,
    uptime as uptime_native,
    version as version_native
} from '__wasm_rquickjs_builtin/os_native';

import { ERR_SYSTEM_ERROR } from '__wasm_rquickjs_builtin/internal/errors';
import { validateInt32 } from '__wasm_rquickjs_builtin/internal/validators';

export const EOL = '\n';

export function arch() { return arch_native(); }

const _endianness = endianness_native();
export function endianness() { return _endianness; }
export function hostname() { return hostname_native(); }
export function machine() { return machine_native(); }
export function platform() { return platform_native(); }
export function release() { return release_native(); }
export function uptime() { return uptime_native(); }
export function version() { return version_native(); }

const _availableParallelism = available_parallelism_native();
export function availableParallelism() {
    return _availableParallelism;
}

export function tmpdir() {
    const env = globalThis.process ? globalThis.process.env : {};
    let dir = env.TMPDIR || env.TMP || env.TEMP || '/tmp';
    if (dir.length > 1 && dir.endsWith('/')) {
        dir = dir.slice(0, -1);
    }
    return dir;
}

export function homedir() {
    const binding = globalThis.__wasm_rquickjs_internal_os_binding;
    if (binding && typeof binding.getHomeDirectory === 'function') {
        const ctx = {};
        binding.getHomeDirectory(ctx);
        if (ctx.code !== undefined) {
            throw new Error(`A system error occurred: ${ctx.syscall} returned ${ctx.code} (${ctx.message})`);
        }
    }
    if (globalThis.process && globalThis.process.env && globalThis.process.env.HOME) {
        return globalThis.process.env.HOME;
    }
    return homedir_native();
}

export function freemem() { return 268435456; }
export function totalmem() { return 536870912; }

export { type_ as type };
function type_() { return type_native(); }

export const constants = {
    signals: {
        SIGHUP: 1,
        SIGINT: 2,
        SIGQUIT: 3,
        SIGILL: 4,
        SIGTRAP: 5,
        SIGABRT: 6,
        SIGBUS: 7,
        SIGFPE: 8,
        SIGKILL: 9,
        SIGUSR1: 10,
        SIGSEGV: 11,
        SIGUSR2: 12,
        SIGPIPE: 13,
        SIGALRM: 14,
        SIGTERM: 15,
        SIGCHLD: 17,
        SIGCONT: 18,
        SIGSTOP: 19,
        SIGTSTP: 20,
        SIGTTIN: 21,
        SIGTTOU: 22,
        SIGURG: 23,
        SIGXCPU: 24,
        SIGXFSZ: 25,
        SIGVTALRM: 26,
        SIGPROF: 27,
        SIGWINCH: 28,
        SIGIO: 29,
        SIGPWR: 30,
        SIGSYS: 31,
    },
    errno: {
        E2BIG: 7,
        EACCES: 13,
        EADDRINUSE: 98,
        EADDRNOTAVAIL: 99,
        EAFNOSUPPORT: 97,
        EAGAIN: 11,
        EALREADY: 114,
        EBADF: 9,
        EBADMSG: 74,
        EBUSY: 16,
        ECANCELED: 125,
        ECHILD: 10,
        ECONNABORTED: 103,
        ECONNREFUSED: 111,
        ECONNRESET: 104,
        EDEADLK: 35,
        EDESTADDRREQ: 89,
        EDOM: 33,
        EDQUOT: 122,
        EEXIST: 17,
        EFAULT: 14,
        EFBIG: 27,
        EHOSTUNREACH: 113,
        EIDRM: 43,
        EILSEQ: 84,
        EINPROGRESS: 115,
        EINTR: 4,
        EINVAL: 22,
        EIO: 5,
        EISCONN: 106,
        EISDIR: 21,
        ELOOP: 40,
        EMFILE: 24,
        EMLINK: 31,
        EMSGSIZE: 90,
        EMULTIHOP: 72,
        ENAMETOOLONG: 36,
        ENETDOWN: 100,
        ENETRESET: 102,
        ENETUNREACH: 101,
        ENFILE: 23,
        ENOBUFS: 105,
        ENODATA: 61,
        ENODEV: 19,
        ENOENT: 2,
        ENOEXEC: 8,
        ENOLCK: 37,
        ENOLINK: 67,
        ENOMEM: 12,
        ENOMSG: 42,
        ENOPROTOOPT: 92,
        ENOSPC: 28,
        ENOSR: 63,
        ENOSTR: 60,
        ENOSYS: 38,
        ENOTCONN: 107,
        ENOTDIR: 20,
        ENOTEMPTY: 39,
        ENOTSOCK: 88,
        ENOTSUP: 95,
        ENOTTY: 25,
        ENXIO: 6,
        EOPNOTSUPP: 95,
        EOVERFLOW: 75,
        EPERM: 1,
        EPIPE: 32,
        EPROTO: 71,
        EPROTONOSUPPORT: 93,
        EPROTOTYPE: 91,
        ERANGE: 34,
        EROFS: 30,
        ESPIPE: 29,
        ESRCH: 3,
        ESTALE: 116,
        ETIME: 62,
        ETIMEDOUT: 110,
        ETXTBSY: 26,
        EWOULDBLOCK: 11,
        EXDEV: 18,
    },
    priority: {
        PRIORITY_LOW: 19,
        PRIORITY_BELOW_NORMAL: 10,
        PRIORITY_NORMAL: 0,
        PRIORITY_ABOVE_NORMAL: -7,
        PRIORITY_HIGH: -14,
        PRIORITY_HIGHEST: -20,
    },
};

export function cpus() {
    return [{
        model: 'WASM',
        speed: 0,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    }];
}

export const devNull = "/dev/null";

let _currentPriority = 0;

export function getPriority(pid) {
    if (pid !== undefined) {
        validateInt32(pid, 'pid');
    }

    const id = (pid === undefined || pid === 0) ? 0 : pid;

    if (id !== 0 && id !== (globalThis.process ? globalThis.process.pid : 0)) {
        throw new ERR_SYSTEM_ERROR({
            code: 'ESRCH',
            syscall: 'uv_os_getpriority',
            message: 'no such process',
            errno: -3,
        });
    }

    return _currentPriority;
}

export function loadavg() {
    return [0, 0, 0];
}

export function networkInterfaces() {
    return {};
}

export function setPriority(pid, priority) {
    if (priority === undefined) {
        priority = pid;
        pid = 0;
    }
    validateInt32(pid, 'pid');
    validateInt32(priority, 'priority', constants.priority.PRIORITY_HIGHEST, constants.priority.PRIORITY_LOW);
    _currentPriority = priority;
}

export { userinfo as userInfo };

export function userinfo(options) {
    const homeDir = homedir();
    if (options && options.encoding === "buffer") {
        return {
            uid: -1,
            gid: -1,
            username: Buffer.from("unknown"),
            homedir: Buffer.from(homeDir),
            shell: Buffer.from("/bin/sh"),
        };
    } else {
        return {
            uid: -1,
            gid: -1,
            username: "unknown",
            homedir: homeDir,
            shell: "/bin/sh",
        };
    }
}

const stringFns = [arch, endianness, hostname, homedir, machine, platform, release, tmpdir, type_, version];
for (const fn of stringFns) {
    fn[Symbol.toPrimitive] = () => fn();
}

const numberFns = [freemem, totalmem, uptime, availableParallelism];
for (const fn of numberFns) {
    fn[Symbol.toPrimitive] = () => fn();
}

const osModule = {
    arch,
    availableParallelism,
    constants,
    cpus,
    devNull,
    endianness,
    freemem,
    getPriority,
    homedir,
    hostname,
    loadavg,
    machine,
    networkInterfaces,
    platform,
    release,
    setPriority,
    tmpdir,
    totalmem,
    type: type_,
    uptime,
    userInfo: userinfo,
    userinfo,
    version,
};

Object.defineProperty(osModule, 'EOL', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: EOL,
});

export default osModule;
