export function setTimeout(delay, value, options) {
    if (options && options.signal && options.signal.aborted) {
        return Promise.reject(options.signal.reason);
    }
    return new Promise((resolve, reject) => {
        let onAbort;
        const id = globalThis.setTimeout(() => {
            if (onAbort) options.signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, delay);
        if (options && options.signal) {
            onAbort = () => {
                globalThis.clearTimeout(id);
                reject(options.signal.reason);
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export function setImmediate(value, options) {
    return setTimeout(0, value, options);
}

export async function* setInterval(delay, value, options) {
    if (options && options.signal && options.signal.aborted) {
        throw options.signal.reason;
    }
    let aborted = false;
    let rejectCurrent;
    if (options && options.signal) {
        options.signal.addEventListener('abort', () => {
            aborted = true;
            if (rejectCurrent) rejectCurrent(options.signal.reason);
        }, { once: true });
    }
    while (!aborted) {
        await new Promise((resolve, reject) => {
            rejectCurrent = reject;
            globalThis.setTimeout(() => { rejectCurrent = null; resolve(); }, delay);
        });
        yield value;
    }
}

export default { setTimeout, setImmediate, setInterval };
