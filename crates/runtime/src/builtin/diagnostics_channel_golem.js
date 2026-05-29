// Golem Context integration for diagnostics_channel
// Registers internal subscribers that create Golem spans for TracingChannel operations
import { start_span, set_span_attribute, finish_span } from '__wasm_rquickjs_builtin/diagnostics_channel_native';
import { channel } from 'node:diagnostics_channel';

// Internal registry to correlate context objects with span handles
const _contextSpans = new WeakMap();

// Deduplication set to prevent multiple subscriber installs for the same channel
const _wired = new Set();

// Helper to create a Golem-integrated subscriber set for any TracingChannel
export function _installGolemTracing(channelName) {
    const key = String(channelName);
    if (_wired.has(key)) return;
    _wired.add(key);

    const startCh = channel(`tracing:${key}:start`);
    const endCh = channel(`tracing:${key}:end`);
    const errorCh = channel(`tracing:${key}:error`);
    const asyncEndCh = channel(`tracing:${key}:asyncEnd`);

    function onStart(context) {
        try {
            const handle = start_span(key);
            _contextSpans.set(context, { handle });
            for (const [k, value] of Object.entries(context)) {
                if (k !== 'result' && k !== 'error' && value !== undefined && value !== null) {
                    try {
                        set_span_attribute(handle, k, String(value));
                    } catch (_) {}
                }
            }
        } catch (_) {}
    }
    onStart._internal = true;
    startCh.subscribe(onStart);

    function onError(context) {
        try {
            const entry = _contextSpans.get(context);
            if (entry) {
                set_span_attribute(entry.handle, 'error', 'true');
                if (context.error) {
                    set_span_attribute(entry.handle, 'error.message', String(context.error.message || context.error));
                }
            }
        } catch (_) {}
    }
    onError._internal = true;
    errorCh.subscribe(onError);

    function onEnd(context) {
        try {
            const entry = _contextSpans.get(context);
            if (entry && !context.__dc_async) {
                if (context.result !== undefined) {
                    set_span_attribute(entry.handle, 'result', String(context.result));
                }
                finish_span(entry.handle);
                _contextSpans.delete(context);
            }
        } catch (_) {}
    }
    onEnd._internal = true;
    endCh.subscribe(onEnd);

    function onAsyncEnd(context) {
        try {
            const entry = _contextSpans.get(context);
            if (entry) {
                if (context.result !== undefined) {
                    set_span_attribute(entry.handle, 'result', String(context.result));
                }
                finish_span(entry.handle);
                _contextSpans.delete(context);
            }
        } catch (_) {}
    }
    onAsyncEnd._internal = true;
    asyncEndCh.subscribe(onAsyncEnd);

}
