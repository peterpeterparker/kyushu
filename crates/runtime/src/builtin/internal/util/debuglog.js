// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.

// `debugImpls` and `testEnabled` are deliberately not initialized so any call
// to `debuglog()` before `initializeDebugEnv()` is called will throw.

import { env } from "node:process";

let debugImpls;
let testEnabled;

// `debugEnv` is initial value of process.env.NODE_DEBUG
function initializeDebugEnv(debugEnv) {
    debugImpls = Object.create(null);
    if (debugEnv) {
        // This is run before any user code, it's OK not to use primordials.
        debugEnv = debugEnv.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
            .replaceAll("*", ".*")
            .replaceAll(",", "$|^");
        const debugEnvRegex = new RegExp(`^${debugEnv}$`, "i");
        testEnabled = (str) => debugEnvRegex.exec(str) !== null;
    } else {
        testEnabled = () => false;
    }
}

// Emits warning when user sets
// NODE_DEBUG=http or NODE_DEBUG=http2.
function emitWarningIfNeeded(set) {
    if ("HTTP" === set || "HTTP2" === set) {
        console.warn(
            "Setting the NODE_DEBUG environment variable " +
            "to '" + set.toLowerCase() + "' can expose sensitive " +
            "data (such as passwords, tokens and authentication headers) " +
            "in the resulting log.",
        );
    }
}

function pad(value) {
    return String(value).padStart(2, "0");
}

const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

export function formatTime(ms) {
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (ms >= kSecond) {
        if (ms >= kMinute) {
            if (ms >= kHour) {
                hours = Math.floor(ms / kHour);
                ms = ms % kHour;
            }
            minutes = Math.floor(ms / kMinute);
            ms = ms % kMinute;
        }
        seconds = ms / kSecond;
    }

    if (hours !== 0 || minutes !== 0) {
        ({ 0: seconds, 1: ms } = seconds.toFixed(3).split(".", 2));
        const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
        return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
    }

    if (seconds !== 0) {
        return `${seconds.toFixed(3)}s`;
    }

    return `${Number(ms.toFixed(3))}ms`;
}

const noop = () => { };

function debuglogImpl(enabled, set) {
    if (debugImpls[set] === undefined) {
        if (enabled) {
            emitWarningIfNeeded(set);
            debugImpls[set] = function debug(...args) {
                const msg = args.map((arg) => JSON.stringify(arg)).join(" ");
                console.error(`${set} ${String(Deno.pid)}: ${msg}`);
            };
        } else {
            debugImpls[set] = noop;
        }
    }

    return debugImpls[set];
}

// debuglogImpl depends on process.pid and process.env.NODE_DEBUG,
// so it needs to be called lazily in top scopes of internal modules
// that may be loaded before these run time states are allowed to
// be accessed.
export function debuglog(set, cb) {
    function init() {
        set = set.toUpperCase();
        enabled = testEnabled(set);
    }

    let debug = (...args) => {
        init();
        // Only invokes debuglogImpl() when the debug function is
        // called for the first time.
        debug = debuglogImpl(enabled, set);

        if (typeof cb === "function") {
            cb(debug);
        }

        return debug(...args);
    };

    let enabled;
    let test = () => {
        init();
        test = () => enabled;
        return enabled;
    };

    const logger = (...args) => debug(...args);

    Object.defineProperty(logger, "enabled", {
        get() {
            return test();
        },
        configurable: true,
        enumerable: true,
    });

    return logger;
}

let debugEnv = env["NODE_DEBUG"] ?? "";

initializeDebugEnv(debugEnv);

export default { debuglog, formatTime };
