// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent and Node contributors. All rights reserved. MIT license.
// deno-lint-ignore-file

import { EventEmitter } from "events";

function Stream(opts) {
    EventEmitter.call(this, opts);
}

Object.setPrototypeOf(Stream.prototype, EventEmitter.prototype);
Object.setPrototypeOf(Stream, EventEmitter);

// Override eventNames to filter out pre-initialized undefined slots.
// Stream constructors pre-create well-known event properties on _events
// to establish a stable property insertion order. This override ensures
// only events with actual listeners are returned.
Stream.prototype.eventNames = function eventNames() {
    var names = [];
    if (this._eventsCount > 0) {
        var keys = Object.keys(this._events);
        for (var i = 0; i < keys.length; i++) {
            var val = this._events[keys[i]];
            if (typeof val === 'function' || (Array.isArray(val) && val.length > 0)) {
                names.push(keys[i]);
            }
        }
        if (Object.getOwnPropertySymbols) {
            var symbols = Object.getOwnPropertySymbols(this._events);
            for (var j = 0; j < symbols.length; j++) {
                var sval = this._events[symbols[j]];
                if (typeof sval === 'function' || (Array.isArray(sval) && sval.length > 0)) {
                    names.push(symbols[j]);
                }
            }
        }
    }
    return names;
};

Stream.prototype.pipe = function (dest, options) {
    // deno-lint-ignore no-this-alias
    const source = this;

    function ondata(chunk) {
        if (dest.writable && dest.write(chunk) === false && source.pause) {
            source.pause();
        }
    }

    source.on("data", ondata);

    function ondrain() {
        if (source.readable && source.resume) {
            source.resume();
        }
    }

    dest.on("drain", ondrain);

    // If the 'end' option is not supplied, dest.end() will be called when
    // source gets the 'end' or 'close' events.  Only dest.end() once.
    if (!dest._isStdio && (!options || options.end !== false)) {
        source.on("end", onend);
        source.on("close", onclose);
    }

    let didOnEnd = false;
    function onend() {
        if (didOnEnd) return;
        didOnEnd = true;

        dest.end();
    }

    function onclose() {
        if (didOnEnd) return;
        didOnEnd = true;

        if (typeof dest.destroy === "function") dest.destroy();
    }

    // Don't leave dangling pipes when there are errors.
    function onerror(er) {
        cleanup();
        if (EventEmitter.listenerCount(this, "error") === 0) {
            this.emit("error", er);
        }
    }

    prependListener(source, "error", onerror);
    prependListener(dest, "error", onerror);

    // Remove all the event listeners that were added.
    function cleanup() {
        source.removeListener("data", ondata);
        dest.removeListener("drain", ondrain);

        source.removeListener("end", onend);
        source.removeListener("close", onclose);

        source.removeListener("error", onerror);
        dest.removeListener("error", onerror);

        source.removeListener("end", cleanup);
        source.removeListener("close", cleanup);

        dest.removeListener("close", cleanup);
    }

    source.on("end", cleanup);
    source.on("close", cleanup);

    dest.on("close", cleanup);
    dest.emit("pipe", source);

    // Allow for unix-like usage: A.pipe(B).pipe(C)
    return dest;
};

function prependListener(emitter, event, fn) {
    // Sadly this is not cacheable as some libraries bundle their own
    // event emitter implementation with them.
    if (typeof emitter.prependListener === "function") {
        return emitter.prependListener(event, fn);
    }

    // This is a hack to make sure that our error handler is attached before any
    // userland ones.  NEVER DO THIS. This is here only because this code needs
    // to continue to work with older versions of Node.js that do not include
    // the prependListener() method. The goal is to eventually remove this hack.
    if (!emitter._events || !emitter._events[event]) {
        emitter.on(event, fn);
    } else if (Array.isArray(emitter._events[event])) {
        emitter._events[event].unshift(fn);
    } else {
        emitter._events[event] = [fn, emitter._events[event]];
    }
}

export { prependListener, Stream };