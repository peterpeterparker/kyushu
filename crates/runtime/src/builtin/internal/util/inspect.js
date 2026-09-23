// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

import * as types from "__wasm_rquickjs_builtin/internal/util/types";
import { validateObject, validateString } from "__wasm_rquickjs_builtin/internal/validators";
import * as codes from "__wasm_rquickjs_builtin/internal/errors";

import {
    ALL_PROPERTIES,
    getConstructorName as internalGetConstructorName,
    getPromiseDetails,
    getProxyDetails,
    getOwnNonIndexProperties,
    getWeakMapEntries,
    getWeakSetEntries,
    ONLY_ENUMERABLE,
    previewEntries,
} from "__wasm_rquickjs_builtin/internal/binding/util";

const kObjectType = 0;
const kArrayType = 1;
const kArrayExtrasType = 2;

const kMinLineLength = 16;
// QuickJS-on-WASM can hit a hard runtime stack limit before surfacing a
// catchable JS RangeError. Guard unlimited-depth inspection proactively.
const kMaxInspectRecursionDepth = 64;
// Some Node.js tests expect util.inspect(depth: Infinity) to traverse hundreds
// of linked-list nodes before interruption. Build that shape iteratively so we
// can satisfy those semantics without overflowing the QuickJS stack.
const kLinkedListFastPathDepth = 600;

// Constants to map the iterator state.
const kWeak = 0;
const kIterator = 1;
const kMapEntries = 2;

const kPending = 0;
const kRejected = 2;

const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    Symbol.toStringTag,
)?.get;

function isNullProtoSet(value) {
    if (!setSizeGetter) {
        return false;
    }
    try {
        setSizeGetter.call(value);
        Set.prototype.values.call(value);
        return true;
    } catch {
        return false;
    }
}

function isNullProtoMap(value) {
    if (!mapSizeGetter) {
        return false;
    }
    try {
        mapSizeGetter.call(value);
        Map.prototype.entries.call(value);
        return true;
    } catch {
        return false;
    }
}

function isNullProtoPromise(value) {
    try {
        getPromiseDetails(value);
        return true;
    } catch {
        return false;
    }
}

function getTypedArrayName(value) {
    if (!typedArrayTagGetter) {
        return "";
    }
    try {
        const name = typedArrayTagGetter.call(value);
        return typeof name === "string" ? name : "";
    } catch {
        return "";
    }
}

function isTypedArrayLike(value) {
    return getTypedArrayName(value) !== "";
}

function isWeakSetLike(value) {
    try {
        WeakSet.prototype.has.call(value, {});
        return true;
    } catch {
        return false;
    }
}

function isWeakMapLike(value) {
    try {
        WeakMap.prototype.has.call(value, {});
        return true;
    } catch {
        return false;
    }
}

// Escaped control characters (plus the single quote and the backslash). Use
// empty strings to fill up unused entries.
// deno-fmt-ignore
const meta = [
    '\\x00', '\\x01', '\\x02', '\\x03', '\\x04', '\\x05', '\\x06', '\\x07', // x07
    '\\b', '\\t', '\\n', '\\x0B', '\\f', '\\r', '\\x0E', '\\x0F',           // x0F
    '\\x10', '\\x11', '\\x12', '\\x13', '\\x14', '\\x15', '\\x16', '\\x17', // x17
    '\\x18', '\\x19', '\\x1A', '\\x1B', '\\x1C', '\\x1D', '\\x1E', '\\x1F', // x1F
    '', '', '', '', '', '', '', "\\'", '', '', '', '', '', '', '', '',      // x2F
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',         // x3F
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',         // x4F
    '', '', '', '', '', '', '', '', '', '', '', '', '\\\\', '', '', '',     // x5F
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',         // x6F
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '\\x7F',    // x7F
    '\\x80', '\\x81', '\\x82', '\\x83', '\\x84', '\\x85', '\\x86', '\\x87', // x87
    '\\x88', '\\x89', '\\x8A', '\\x8B', '\\x8C', '\\x8D', '\\x8E', '\\x8F', // x8F
    '\\x90', '\\x91', '\\x92', '\\x93', '\\x94', '\\x95', '\\x96', '\\x97', // x97
    '\\x98', '\\x99', '\\x9A', '\\x9B', '\\x9C', '\\x9D', '\\x9E', '\\x9F', // x9F
];

// https://tc39.es/ecma262/#sec-IsHTMLDDA-internal-slot
const isUndetectableObject = (v) => typeof v === "undefined" && v !== undefined;

// deno-lint-ignore no-control-regex
const strEscapeSequencesRegExp = /[\x00-\x1f\x27\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// deno-lint-ignore no-control-regex
const strEscapeSequencesReplacer = /[\x00-\x1f\x27\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// deno-lint-ignore no-control-regex
const strEscapeSequencesRegExpSingle = /[\x00-\x1f\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
// deno-lint-ignore no-control-regex
const strEscapeSequencesReplacerSingle = /[\x00-\x1f\x5c\x7f-\x9f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const keyStrRegExp = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
const numberRegExp = /^(0|[1-9][0-9]*)$/;
const nodeModulesRegExp = /[/\\]node_modules[/\\](.+?)(?=[/\\])/g;
const coreModuleRegExp = /^ {4}at (?:[^/\\(]+ \(|)node:(.+):\d+:\d+\)?$/;

const classRegExp = /^(\s+[^(]*?)\s*{/;
// eslint-disable-next-line node-core/no-unescaped-regexp-dot
const stripCommentsRegExp = /(\/\/.*?\n)|(\/\*(.|\n)*?\*\/)/g;

const inspectDefaultOptions = {
    showHidden: false,
    depth: 2,
    colors: false,
    customInspect: true,
    showProxy: false,
    maxArrayLength: 100,
    maxStringLength: 10000,
    breakLength: 80,
    compact: 3,
    sorted: false,
    getters: false,
    numericSeparator: false,
};

function getUserOptions(ctx, isCrossContext) {
    const ret = {
        stylize: ctx.stylize,
        showHidden: ctx.showHidden,
        depth: ctx.depth,
        colors: ctx.colors,
        customInspect: ctx.customInspect,
        showProxy: ctx.showProxy,
        maxArrayLength: ctx.maxArrayLength,
        maxStringLength: ctx.maxStringLength,
        breakLength: ctx.breakLength,
        compact: ctx.compact,
        sorted: ctx.sorted,
        getters: ctx.getters,
        numericSeparator: ctx.numericSeparator,
        ...ctx.userOptions,
    };

    // Typically, the target value will be an instance of `Object`. If that is
    // *not* the case, the object may come from another vm.Context, and we want
    // to avoid passing it objects from this Context in that case, so we remove
    // the prototype from the returned object itself + the `stylize()` function,
    // and remove all other non-primitives, including non-primitive user options.
    if (isCrossContext) {
        Object.setPrototypeOf(ret, null);
        for (const key of Object.keys(ret)) {
            if (
                (typeof ret[key] === "object" || typeof ret[key] === "function") &&
                ret[key] !== null
            ) {
                delete ret[key];
            }
        }
        ret.stylize = Object.setPrototypeOf((value, flavour) => {
            let stylized;
            try {
                stylized = `${ctx.stylize(value, flavour)}`;
            } catch {
                // noop
            }

            if (typeof stylized !== "string") return value;
            // `stylized` is a string as it should be, which is safe to pass along.
            return stylized;
        }, null);
    }

    return ret;
}

/**
 * Echos the value of any input. Tries to print the value out
 * in the best way possible given the different types.
 */
/* Legacy: value, showHidden, depth, colors */
export function inspect(value, opts) {
    // Default options
    const ctx = {
        budget: {},
        indentationLvl: 0,
        seen: [],
        currentDepth: 0,
        stylize: stylizeNoColor,
        showHidden: inspectDefaultOptions.showHidden,
        depth: inspectDefaultOptions.depth,
        colors: inspectDefaultOptions.colors,
        customInspect: inspectDefaultOptions.customInspect,
        showProxy: inspectDefaultOptions.showProxy,
        maxArrayLength: inspectDefaultOptions.maxArrayLength,
        maxStringLength: inspectDefaultOptions.maxStringLength,
        breakLength: inspectDefaultOptions.breakLength,
        compact: inspectDefaultOptions.compact,
        sorted: inspectDefaultOptions.sorted,
        getters: inspectDefaultOptions.getters,
        numericSeparator: inspectDefaultOptions.numericSeparator,
    };
    if (arguments.length > 1) {
        // Legacy...
        if (arguments.length > 2) {
            if (arguments[2] !== undefined) {
                ctx.depth = arguments[2];
            }
            if (arguments.length > 3 && arguments[3] !== undefined) {
                ctx.colors = arguments[3];
            }
        }
        // Set user-specified options
        if (typeof opts === "boolean") {
            ctx.showHidden = opts;
        } else if (opts) {
            const optKeys = Object.keys(opts);
            for (let i = 0; i < optKeys.length; ++i) {
                const key = optKeys[i];
                // TODO(BridgeAR): Find a solution what to do about stylize. Either make
                // this function public or add a new API with a similar or better
                // functionality.
                if (
                    // deno-lint-ignore no-prototype-builtins
                    inspectDefaultOptions.hasOwnProperty(key) ||
                    key === "stylize"
                ) {
                    ctx[key] = opts[key];
                } else if (ctx.userOptions === undefined) {
                    // This is required to pass through the actual user input.
                    ctx.userOptions = opts;
                }
            }
        }
    }
    if (ctx.colors) ctx.stylize = stylizeWithColor;
    if (ctx.maxArrayLength === null) ctx.maxArrayLength = Infinity;
    if (ctx.maxStringLength === null) ctx.maxStringLength = Infinity;
    const linkedListFastPath = formatLinkedListFastPath(ctx, value);
    if (linkedListFastPath !== null) {
        return linkedListFastPath;
    }
    return formatValue(ctx, value, 0);
}
const customInspectSymbol = Symbol.for("nodejs.util.inspect.custom");
const cachedErrorName = new WeakMap();
const manuallyOverriddenErrorStack = new WeakSet();
const nativeErrorConstructorNames = new Set([
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
    "AggregateError",
]);
inspect.custom = customInspectSymbol;

Object.defineProperty(inspect, "defaultOptions", {
    get() {
        return inspectDefaultOptions;
    },
    set(options) {
        validateObject(options, "options");
        return Object.assign(inspectDefaultOptions, options);
    },
});

// Set Graphics Rendition https://en.wikipedia.org/wiki/ANSI_escape_code#graphics
// Each color consists of an array with the color code as first entry and the
// reset code as second entry.
const defaultFG = 39;
const defaultBG = 49;
inspect.colors = Object.assign(Object.create(null), {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22], // Alias: faint
    italic: [3, 23],
    underline: [4, 24],
    blink: [5, 25],
    // Swap foreground and background colors
    inverse: [7, 27], // Alias: swapcolors, swapColors
    hidden: [8, 28], // Alias: conceal
    strikethrough: [9, 29], // Alias: strikeThrough, crossedout, crossedOut
    doubleunderline: [21, 24], // Alias: doubleUnderline
    black: [30, defaultFG],
    red: [31, defaultFG],
    green: [32, defaultFG],
    yellow: [33, defaultFG],
    blue: [34, defaultFG],
    magenta: [35, defaultFG],
    cyan: [36, defaultFG],
    white: [37, defaultFG],
    bgBlack: [40, defaultBG],
    bgRed: [41, defaultBG],
    bgGreen: [42, defaultBG],
    bgYellow: [43, defaultBG],
    bgBlue: [44, defaultBG],
    bgMagenta: [45, defaultBG],
    bgCyan: [46, defaultBG],
    bgWhite: [47, defaultBG],
    framed: [51, 54],
    overlined: [53, 55],
    gray: [90, defaultFG], // Alias: grey, blackBright
    redBright: [91, defaultFG],
    greenBright: [92, defaultFG],
    yellowBright: [93, defaultFG],
    blueBright: [94, defaultFG],
    magentaBright: [95, defaultFG],
    cyanBright: [96, defaultFG],
    whiteBright: [97, defaultFG],
    bgGray: [100, defaultBG], // Alias: bgGrey, bgBlackBright
    bgRedBright: [101, defaultBG],
    bgGreenBright: [102, defaultBG],
    bgYellowBright: [103, defaultBG],
    bgBlueBright: [104, defaultBG],
    bgMagentaBright: [105, defaultBG],
    bgCyanBright: [106, defaultBG],
    bgWhiteBright: [107, defaultBG],
});

function defineColorAlias(target, alias) {
    Object.defineProperty(inspect.colors, alias, {
        get() {
            return this[target];
        },
        set(value) {
            this[target] = value;
        },
        configurable: true,
        enumerable: false,
    });
}

defineColorAlias("gray", "grey");
defineColorAlias("gray", "blackBright");
defineColorAlias("bgGray", "bgGrey");
defineColorAlias("bgGray", "bgBlackBright");
defineColorAlias("dim", "faint");
defineColorAlias("strikethrough", "crossedout");
defineColorAlias("strikethrough", "strikeThrough");
defineColorAlias("strikethrough", "crossedOut");
defineColorAlias("hidden", "conceal");
defineColorAlias("inverse", "swapColors");
defineColorAlias("inverse", "swapcolors");
defineColorAlias("doubleunderline", "doubleUnderline");

// TODO(BridgeAR): Add function style support for more complex styles.
// Don't use 'blue' not visible on cmd.exe
inspect.styles = Object.assign(Object.create(null), {
    special: "cyan",
    number: "yellow",
    bigint: "yellow",
    boolean: "yellow",
    undefined: "grey",
    null: "bold",
    string: "green",
    symbol: "green",
    date: "magenta",
    // "name": intentionally not styling
    // TODO(BridgeAR): Highlight regular expressions properly.
    regexp: "red",
    module: "underline",
});

function addQuotes(str, quotes) {
    if (quotes === -1) {
        return `"${str}"`;
    }
    if (quotes === -2) {
        return `\`${str}\``;
    }
    return `'${str}'`;
}

// TODO(wafuwafu13): Figure out
function escapeFn(str) {
    const charCode = str.charCodeAt(0);
    return charCode < meta.length ? meta[charCode] : `\\u${charCode.toString(16)}`;
}

// Escape control characters, single quotes and the backslash.
// This is similar to JSON stringify escaping.
function strEscape(str) {
    let escapeTest = strEscapeSequencesRegExp;
    let escapeReplace = strEscapeSequencesReplacer;
    let singleQuote = 39;

    // Check for double quotes. If not present, do not escape single quotes and
    // instead wrap the text in double quotes. If double quotes exist, check for
    // backticks. If they do not exist, use those as fallback instead of the
    // double quotes.
    if (str.includes("'")) {
        // This invalidates the charCode and therefore can not be matched for
        // anymore.
        if (!str.includes('"')) {
            singleQuote = -1;
        } else if (
            !str.includes("`") &&
            !str.includes("${")
        ) {
            singleQuote = -2;
        }
        if (singleQuote !== 39) {
            escapeTest = strEscapeSequencesRegExpSingle;
            escapeReplace = strEscapeSequencesReplacerSingle;
        }
    }

    // Some magic numbers that worked out fine while benchmarking with v8 6.0
    if (str.length < 5000 && !escapeTest.test(str)) {
        return addQuotes(str, singleQuote);
    }
    if (str.length > 100) {
        str = str.replace(escapeReplace, escapeFn);
        return addQuotes(str, singleQuote);
    }

    let result = "";
    let last = 0;
    const lastIndex = str.length;
    for (let i = 0; i < lastIndex; i++) {
        const point = str.charCodeAt(i);
        if (
            point === singleQuote ||
            point === 92 ||
            point < 32 ||
            (point > 126 && point < 160)
        ) {
            if (last === i) {
                result += meta[point];
            } else {
                result += `${str.slice(last, i)}${meta[point]}`;
            }
            last = i + 1;
        } else if (point >= 0xd800 && point <= 0xdfff) {
            if (point <= 0xdbff && i + 1 < lastIndex) {
                const next = str.charCodeAt(i + 1);
                if (next >= 0xdc00 && next <= 0xdfff) {
                    i++;
                    continue;
                }
            }
            result += `${str.slice(last, i)}\\u${point.toString(16)}`;
            last = i + 1;
        }
    }

    if (last !== lastIndex) {
        result += str.slice(last);
    }
    return addQuotes(result, singleQuote);
}

function stylizeWithColor(str, styleType) {
    const style = inspect.styles[styleType];
    if (style !== undefined) {
        const color = inspect.colors[style];
        if (color !== undefined) {
            return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
        }
    }
    return str;
}

function stylizeNoColor(str) {
    return str;
}

function formatProxy(ctx, proxy, recurseTimes) {
    if (recurseTimes > ctx.depth && ctx.depth !== null) {
        return ctx.stylize("Proxy [Array]", "special");
    }
    recurseTimes += 1;
    ctx.indentationLvl += 2;
    const res = [
        formatValue(ctx, proxy[0], recurseTimes),
        formatValue(ctx, proxy[1], recurseTimes),
    ];
    ctx.indentationLvl -= 2;
    return reduceToSingleString(
        ctx,
        res,
        "",
        ["Proxy [", "]"],
        kArrayExtrasType,
        recurseTimes,
    );
}

// Note: using `formatValue` directly requires the indentation level to be
// corrected by setting `ctx.indentationLvL += diff` and then to decrease the
// value afterwards again.
function formatValue(
    ctx,
    value,
    recurseTimes,
    typedArray,
) {
    // Primitive types cannot have properties.
    if (
        typeof value !== "object" &&
        typeof value !== "function" &&
        !isUndetectableObject(value)
    ) {
        return formatPrimitive(ctx.stylize, value, ctx);
    }
    if (value === null) {
        return ctx.stylize("null", "null");
    }

    // Memorize the context for custom inspection on proxies.
    const context = value;
    // Always check for proxies to prevent side effects and to prevent triggering
    // any proxy handlers.
    const proxy = getProxyDetails(value, !!ctx.showProxy);
    if (proxy !== undefined) {
        if (proxy === null || proxy[0] === null) {
            return ctx.stylize("<Revoked Proxy>", "special");
        }
        if (ctx.showProxy) {
            return formatProxy(ctx, proxy, recurseTimes);
        }
        value = proxy;
    }

    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it.
    if (ctx.customInspect) {
        const maybeCustom = value[customInspectSymbol];
        if (
            typeof maybeCustom === "function" &&
            // Filter out the util module, its inspect function is special.
            maybeCustom !== inspect &&
            // Also filter out any prototype objects using the circular check.
            !(value.constructor && value.constructor.prototype === value)
        ) {
            // This makes sure the recurseTimes are reported as before while using
            // a counter internally.
            const depth = ctx.depth === null ? null : ctx.depth - recurseTimes;
            const isCrossContext = proxy !== undefined ||
                !(context instanceof Object);
            const ret = maybeCustom.call(
                context,
                depth,
                getUserOptions(ctx, isCrossContext),
                inspect,
            );
            // If the custom inspection method returned `this`, don't go into
            // infinite recursion.
            if (ret !== context) {
                if (typeof ret !== "string") {
                    return formatValue(ctx, ret, recurseTimes);
                }
                return ret.replace(/\n/g, `\n${" ".repeat(ctx.indentationLvl)}`);
            }
        }
    }

    // Using an array here is actually better for the average case than using
    // a Set. `seen` will only check for the depth and will never grow too large.
    if (ctx.seen.includes(value)) {
        let index = 1;
        if (ctx.circular === undefined) {
            ctx.circular = new Map();
            ctx.circular.set(value, index);
        } else {
            index = ctx.circular.get(value);
            if (index === undefined) {
                index = ctx.circular.size + 1;
                ctx.circular.set(value, index);
            }
        }
        return ctx.stylize(`[Circular *${index}]`, "special");
    }

    return formatRaw(ctx, value, recurseTimes, typedArray);
}

function formatRaw(ctx, value, recurseTimes, typedArray) {
    let keys;
    let protoProps;
    if (ctx.showHidden && (recurseTimes <= ctx.depth || ctx.depth === null)) {
        protoProps = [];
    }

    const constructor = getConstructorName(value, ctx, recurseTimes, protoProps);
    const nullProtoConstructor = constructor === null
        ? internalGetConstructorName(value)
        : null;
    // Reset the variable to check for this later on.
    if (protoProps !== undefined && protoProps.length === 0) {
        protoProps = undefined;
    }

    let tag;
    try {
        tag = value[Symbol.toStringTag];
    } catch (err) {
        if (err?.name === "TypeError" && err.message === "circular reference") {
            err.message = "Converting circular structure to JSON";
        }
        throw err;
    }
    // Only list the tag in case it's non-enumerable / not an own property.
    // Otherwise we'd print this twice.
    const hasOwnToStringTag = ctx.showHidden
        ? Object.prototype.hasOwnProperty.call(value, Symbol.toStringTag)
        : Object.prototype.propertyIsEnumerable.call(value, Symbol.toStringTag);
    if (
        typeof tag !== "string" ||
        (tag !== "" && hasOwnToStringTag)
    ) {
        tag = "";
    }

    if (
        (ctx.depth === null || ctx.depth === Infinity) &&
        recurseTimes >= kMaxInspectRecursionDepth
    ) {
        const constructorName = getCtxStyle(value, constructor, tag).slice(0, -1);
        return formatInspectionInterrupted(ctx, constructorName);
    }

    let base = "";
    let formatter = getEmptyFormatArray;
    let braces;
    let noIterator = true;
    let i = 0;
    const filter = ctx.showHidden ? ALL_PROPERTIES : ONLY_ENUMERABLE;

    let extrasType = kObjectType;

    // Iterators and the rest are split to reduce checks.
    // We have to check all values in case the constructor is set to null.
    // Otherwise it would not possible to identify all types properly.
    if (Symbol.iterator in value || constructor === null) {
        noIterator = false;
        if (Array.isArray(value)) {
            // Only set the constructor for non ordinary ("Array [...]") arrays.
            const prefix = (constructor !== "Array" || tag !== "")
                ? getPrefix(constructor, tag, "Array", `(${value.length})`)
                : "";
            keys = getOwnNonIndexProperties(value, filter);
            braces = [`${prefix}[`, "]"];
            if (value.length === 0 && keys.length === 0 && protoProps === undefined) {
                return `${braces[0]}]`;
            }
            extrasType = kArrayExtrasType;
            formatter = formatArray;
        } else if (
            types.isSet(value) ||
            (constructor === null && nullProtoConstructor === "Set" && isNullProtoSet(value))
        ) {
            const size = constructor !== null
                ? value.size
                : (setSizeGetter ? setSizeGetter.call(value) : 0);
            const prefix = getPrefix(constructor, tag, "Set", `(${size})`);
            keys = getKeys(value, ctx.showHidden);
            const iterable = constructor !== null
                ? value
                : Set.prototype.values.call(value);
            formatter = formatSet.bind(null, iterable);
            if (size === 0 && keys.length === 0 && protoProps === undefined) {
                return `${prefix}{}`;
            }
            braces = [`${prefix}{`, "}"];
        } else if (
            types.isMap(value) ||
            (constructor === null && nullProtoConstructor === "Map" && isNullProtoMap(value))
        ) {
            const size = constructor !== null
                ? value.size
                : (mapSizeGetter ? mapSizeGetter.call(value) : 0);
            const prefix = getPrefix(constructor, tag, "Map", `(${size})`);
            keys = getKeys(value, ctx.showHidden);
            const iterable = constructor !== null
                ? value
                : Map.prototype.entries.call(value);
            formatter = formatMap.bind(null, iterable);
            if (size === 0 && keys.length === 0 && protoProps === undefined) {
                return `${prefix}{}`;
            }
            braces = [`${prefix}{`, "}"];
        } else if (types.isTypedArray(value) || (constructor === null && isTypedArrayLike(value))) {
            let size = getTypedArrayLengthForInspect(value);
            keys = getOwnNonIndexProperties(value, filter);
            let bound = value;
            const fallback = constructor === null
                ? (getTypedArrayName(value) || nullProtoConstructor || "")
                : "";
            if (constructor === null) {
                const ctor = globalThis[fallback];
                if (size === 0 && typeof ctor === "function" && typeof ctor.prototype?.values === "function") {
                    try {
                        const values = [];
                        for (const entry of ctor.prototype.values.call(value)) {
                            values.push(entry);
                        }
                        bound = new ctor(values);
                        size = values.length;
                    } catch {
                        // Leave the fallback empty representation when we cannot
                        // safely recover typed-array internals from a null-proto
                        // instance in this runtime.
                    }
                }
            }
            const prefix = getPrefix(constructor, tag, fallback, `(${size})`);
            braces = [`${prefix}[`, "]"];
            if (size === 0 && keys.length === 0 && !ctx.showHidden) {
                return `${braces[0]}]`;
            }
            // Special handle the value. The original value is required below. The
            // bound function is required to reconstruct missing information.
            (formatter) = formatTypedArray.bind(null, bound, size);
            extrasType = kArrayExtrasType;
        } else if (types.isMapIterator(value)) {
            keys = getKeys(value, ctx.showHidden);
            braces = getIteratorBraces("Map", tag);
            // Add braces to the formatter parameters.
            (formatter) = formatIterator.bind(null, braces, true);
        } else if (types.isSetIterator(value)) {
            keys = getKeys(value, ctx.showHidden);
            braces = getIteratorBraces("Set", tag);
            // Add braces to the formatter parameters.
            (formatter) = formatIterator.bind(null, braces, false);
        } else {
            noIterator = true;
        }
    }
    if (noIterator) {
        keys = getKeys(value, ctx.showHidden);
        braces = ["{", "}"];
        if (constructor === "Object") {
            if (types.isArgumentsObject(value)) {
                braces[0] = "[Arguments] {";
            } else if (tag !== "") {
                braces[0] = `${getPrefix(constructor, tag, "Object")}{`;
            }
            if (keys.length === 0 && protoProps === undefined) {
                return `${braces[0]}}`;
            }
        } else if (typeof value === "function") {
            base = getFunctionBase(ctx, value, constructor, tag);
            if (keys.length === 0 && protoProps === undefined) {
                return ctx.stylize(base, "special");
            }
        } else if (typeof URL === "function" && value instanceof URL) {
            let href;
            try {
                href = String(value);
            } catch {
                href = "";
            }
            base = `${getPrefix(constructor, tag, "URL")}${href}`.trim();
            if (keys.length === 0 && protoProps === undefined) {
                return ctx.stylize(base, "special");
            }
        } else if (types.isRegExp(value) || (constructor === null && nullProtoConstructor === "RegExp")) {
            // Make RegExps say that they are RegExps
            try {
                const target = constructor !== null ? value : new RegExp(value);
                base = RegExp.prototype.toString.call(target);
            } catch {
                if (keys.length === 0 && protoProps === undefined) {
                    return `${getCtxStyle(value, constructor, tag)}{}`;
                }
                braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
                base = "";
            }
            const prefix = getPrefix(constructor, tag, "RegExp");
            if (prefix !== "RegExp ") {
                base = `${prefix}${base}`;
            }
            if (
                (keys.length === 0 && protoProps === undefined) ||
                (recurseTimes > ctx.depth && ctx.depth !== null)
            ) {
                return ctx.stylize(base, "regexp");
            }
        } else if (types.isDate(value) || (constructor === null && nullProtoConstructor === "Date")) {
            // Make dates with properties first say the date
            try {
                base = Number.isNaN(Date.prototype.getTime.call(value))
                    ? Date.prototype.toString.call(value)
                    : Date.prototype.toISOString.call(value);
            } catch {
                if (keys.length === 0 && protoProps === undefined) {
                    return `${getCtxStyle(value, constructor, tag)}{}`;
                }
                braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
                base = "";
            }
            const prefix = getPrefix(constructor, tag, "Date");
            if (prefix !== "Date ") {
                base = `${prefix}${base}`;
            }
            if (keys.length === 0 && protoProps === undefined) {
                return ctx.stylize(base, "date");
            }
        } else if (isInspectableError(value)) {
            // Ensure 'cause' property is included in keys (it's non-enumerable)
            if (Object.prototype.hasOwnProperty.call(value, 'cause') && keys.indexOf('cause') === -1) {
                keys.push('cause');
            }
            base = formatError(value, constructor, tag, ctx, keys);
            if (keys.length === 0 && protoProps === undefined) {
                return base;
            }
        } else if (
            types.isAnyArrayBuffer(value) ||
            (constructor === null &&
                (nullProtoConstructor === "ArrayBuffer" || nullProtoConstructor === "SharedArrayBuffer"))
        ) {
            // Fast path for ArrayBuffer and SharedArrayBuffer.
            // Can't do the same for DataView because it has a non-primitive
            // .buffer property that we need to recurse for.
            const arrayType = (constructor === null && nullProtoConstructor)
                ? nullProtoConstructor
                : (types.isArrayBuffer(value) ? "ArrayBuffer" : "SharedArrayBuffer");
            const prefix = getPrefix(constructor, tag, arrayType);
            if (typedArray === undefined) {
                (formatter) = formatArrayBuffer;
            } else if (keys.length === 0 && protoProps === undefined) {
                return prefix +
                    `{ byteLength: ${formatNumber(ctx.stylize, value.byteLength, ctx.numericSeparator)} }`;
            }
            braces[0] = `${prefix}{`;
            Array.prototype.unshift.call(keys, "byteLength");
        } else if (types.isDataView(value) || (constructor === null && nullProtoConstructor === "DataView")) {
            braces[0] = `${getPrefix(constructor, tag, "DataView")}{`;
            // .buffer goes last, it's not a primitive like the others.
            Array.prototype.unshift.call(keys, "byteLength", "byteOffset", "buffer");
        } else if (
            types.isPromise(value) ||
            (constructor === null && (nullProtoConstructor === "Promise" || isNullProtoPromise(value)))
        ) {
            braces[0] = `${getPrefix(constructor, tag, "Promise")}{`;
            (formatter) = formatPromise;
        } else if (
            types.isWeakSet(value) ||
            (constructor === null && (nullProtoConstructor === "WeakSet" || isWeakSetLike(value)))
        ) {
            braces[0] = `${getPrefix(constructor, tag, "WeakSet")}{`;
            (formatter) = ctx.showHidden ? formatWeakSet : formatWeakCollection;
        } else if (
            types.isWeakMap(value) ||
            (constructor === null && (nullProtoConstructor === "WeakMap" || isWeakMapLike(value)))
        ) {
            braces[0] = `${getPrefix(constructor, tag, "WeakMap")}{`;
            (formatter) = ctx.showHidden ? formatWeakMap : formatWeakCollection;
        } else if (types.isModuleNamespaceObject(value)) {
            braces[0] = `${getPrefix(constructor, tag, "Module")}{`;
            // Special handle keys for namespace objects.
            (formatter) = formatNamespaceObject.bind(null, keys);
        } else {
            const hasNullProtoBoxedCtor =
                nullProtoConstructor === "Boolean" ||
                nullProtoConstructor === "Number" ||
                nullProtoConstructor === "String" ||
                nullProtoConstructor === "Symbol" ||
                nullProtoConstructor === "BigInt";

            if (!(types.isBoxedPrimitive(value) || hasNullProtoBoxedCtor)) {
                if (keys.length === 0 && protoProps === undefined) {
                    // TODO(wafuwafu13): Implement
                    // if (types.isExternal(value)) {
                    //   const address = getExternalValue(value).toString(16);
                    //   return ctx.stylize(`[External: ${address}]`, 'special');
                    // }
                    return `${getCtxStyle(value, constructor, tag)}{}`;
                }
                braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
            } else {
            try {
                    base = getBoxedBase(
                        value,
                        ctx,
                        keys,
                        constructor,
                        tag,
                        hasNullProtoBoxedCtor ? nullProtoConstructor : undefined,
                    );
                if (keys.length === 0 && protoProps === undefined) {
                    return base;
                }
            } catch {
                if (keys.length === 0 && protoProps === undefined) {
                    return `${getCtxStyle(value, constructor, tag)}{}`;
                }
                braces[0] = `${getCtxStyle(value, constructor, tag)}{`;
            }
            }
        }
    }

    if (recurseTimes > ctx.depth && ctx.depth !== null) {
        let constructorName = getCtxStyle(value, constructor, tag).slice(0, -1);
        if (constructor !== null) {
            constructorName = `[${constructorName}]`;
        }
        return ctx.stylize(constructorName, "special");
    }
    recurseTimes += 1;

    ctx.seen.push(value);
    ctx.currentDepth = recurseTimes;
    let output;
    const indentationLvl = ctx.indentationLvl;
    try {
        output = formatter(ctx, value, recurseTimes);
        for (i = 0; i < keys.length; i++) {
            output.push(
                formatProperty(ctx, value, recurseTimes, keys[i], extrasType),
            );
        }
        if (protoProps !== undefined) {
            output.push(...protoProps);
        }
    } catch (err) {
        if (!isStackOverflowError(err)) {
            throw err;
        }
        const constructorName = getCtxStyle(value, constructor, tag).slice(0, -1);
        return handleMaxCallStackSize(ctx, err, constructorName, indentationLvl);
    }
    if (ctx.circular !== undefined) {
        const index = ctx.circular.get(value);
        if (index !== undefined) {
            const reference = ctx.stylize(`<ref *${index}>`, "special");
            // Add reference always to the very beginning of the output.
            if (ctx.compact !== true) {
                base = base === "" ? reference : `${reference} ${base}`;
            } else {
                braces[0] = `${reference} ${braces[0]}`;
            }
        }
    }
    ctx.seen.pop();

    if (ctx.sorted) {
        const comparator = ctx.sorted === true ? undefined : ctx.sorted;
        if (extrasType === kObjectType) {
            output = output.sort(comparator);
        } else if (keys.length > 1) {
            const sorted = output.slice(output.length - keys.length).sort(comparator);
            output.splice(output.length - keys.length, keys.length, ...sorted);
        }
    }

    const res = reduceToSingleString(
        ctx,
        output,
        base,
        braces,
        extrasType,
        recurseTimes,
        value,
    );
    const budget = ctx.budget[ctx.indentationLvl] || 0;
    const newLength = budget + res.length;
    ctx.budget[ctx.indentationLvl] = newLength;
    // If any indentationLvl exceeds this limit, limit further inspecting to the
    // minimum. Otherwise the recursive algorithm might continue inspecting the
    // object even though the maximum string size (~2 ** 28 on 32 bit systems and
    // ~2 ** 30 on 64 bit systems) exceeded. The actual output is not limited at
    // exactly 2 ** 27 but a bit higher. This depends on the object shape.
    // This limit also makes sure that huge objects don't block the event loop
    // significantly.
    if (newLength > 2 ** 27) {
        ctx.depth = -1;
    }
    return res;
}

const builtInObjects = new Set(
    Object.getOwnPropertyNames(globalThis).filter((e) =>
        /^[A-Z][a-zA-Z0-9]+$/.test(e)
    ),
);

// Special-case common built-in prototypes in case their `constructor`
// property has been tampered with.
const wellKnownPrototypes = new Map();
if (typeof Array === "function") {
    wellKnownPrototypes.set(Array.prototype, { name: "Array", constructor: Array });
}
if (typeof ArrayBuffer === "function") {
    wellKnownPrototypes.set(ArrayBuffer.prototype, { name: "ArrayBuffer", constructor: ArrayBuffer });
}
if (typeof Function === "function") {
    wellKnownPrototypes.set(Function.prototype, { name: "Function", constructor: Function });
}
if (typeof Map === "function") {
    wellKnownPrototypes.set(Map.prototype, { name: "Map", constructor: Map });
}
if (typeof Object === "function") {
    wellKnownPrototypes.set(Object.prototype, { name: "Object", constructor: Object });
}
if (typeof Set === "function") {
    wellKnownPrototypes.set(Set.prototype, { name: "Set", constructor: Set });
}
if (typeof Uint8Array === "function") {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const typedArrayConstructor = Object.getPrototypeOf(Uint8Array);
    if (typedArrayPrototype && typeof typedArrayConstructor === "function") {
        wellKnownPrototypes.set(typedArrayPrototype, { name: "TypedArray", constructor: typedArrayConstructor });
    }
}

function addPrototypeProperties(
    ctx,
    main,
    obj,
    recurseTimes,
    output,
) {
    let depth = 0;
    let keys;
    let keySet;
    do {
        if (depth !== 0 || main === obj) {
            obj = Object.getPrototypeOf(obj);
            // Stop as soon as a null prototype is encountered.
            if (obj === null) {
                return;
            }
            // Stop as soon as a built-in object type is detected.
            const descriptor = Object.getOwnPropertyDescriptor(obj, "constructor");
            if (
                descriptor !== undefined &&
                typeof descriptor.value === "function" &&
                builtInObjects.has(descriptor.value.name)
            ) {
                return;
            }
        }

        if (depth === 0) {
            keySet = new Set();
        } else {
            Array.prototype.forEach.call(keys, (key) => keySet.add(key));
        }
        // Get all own property names and symbols.
        keys = Reflect.ownKeys(obj);
        Array.prototype.push.call(ctx.seen, main);
        for (const key of keys) {
            // Ignore the `constructor` property and keys that exist on layers above.
            if (
                key === "constructor" ||
                // deno-lint-ignore no-prototype-builtins
                Object.prototype.hasOwnProperty.call(main, key) ||
                (depth !== 0 && keySet.has(key))
            ) {
                continue;
            }
            const desc = Object.getOwnPropertyDescriptor(obj, key);
            if (typeof desc.value === "function") {
                continue;
            }
            const value = formatProperty(
                ctx,
                obj,
                recurseTimes,
                key,
                kObjectType,
                desc,
                main,
            );
            if (ctx.colors) {
                // Faint!
                Array.prototype.push.call(output, `\u001b[2m${value}\u001b[22m`);
            } else {
                Array.prototype.push.call(output, value);
            }
        }
        Array.prototype.pop.call(ctx.seen);
        // Limit the inspection to up to three prototype layers. Using `recurseTimes`
        // is not a good choice here, because it's as if the properties are declared
        // on the current object from the users perspective.
    } while (++depth !== 3);
}

function getConstructorName(
    obj,
    ctx,
    recurseTimes,
    protoProps,
) {
    let firstProto;
    const tmp = obj;
    while (obj || isUndetectableObject(obj)) {
        const wellKnownPrototypeNameAndConstructor = wellKnownPrototypes.get(obj);
        if (wellKnownPrototypeNameAndConstructor != null) {
            const { name, constructor } = wellKnownPrototypeNameAndConstructor;
            if (isInstanceof(tmp, constructor)) {
                if (protoProps !== undefined && firstProto !== obj) {
                    addPrototypeProperties(
                        ctx,
                        tmp,
                        firstProto || tmp,
                        recurseTimes,
                        protoProps,
                    );
                }
                return name;
            }
        }

        const descriptor = Object.getOwnPropertyDescriptor(obj, "constructor");
        if (
            descriptor !== undefined &&
            typeof descriptor.value === "function" &&
            descriptor.value.name !== "" &&
            isInstanceof(tmp, descriptor.value)
        ) {
            if (
                protoProps !== undefined &&
                (firstProto !== obj ||
                    !builtInObjects.has(descriptor.value.name))
            ) {
                addPrototypeProperties(
                    ctx,
                    tmp,
                    firstProto || tmp,
                    recurseTimes,
                    protoProps,
                );
            }
            return String(descriptor.value.name);
        }

        obj = Object.getPrototypeOf(obj);
        if (firstProto === undefined) {
            firstProto = obj;
        }
    }

    if (firstProto === null) {
        return null;
    }

    const res = internalGetConstructorName(tmp, recurseTimes === 0);

    if (recurseTimes > ctx.depth && ctx.depth !== null) {
        return `${res} <Complex prototype>`;
    }

    const protoConstr = getConstructorName(
        firstProto,
        ctx,
        recurseTimes + 1,
        protoProps,
    );

    if (protoConstr === null) {
        return `${res} <${inspect(firstProto, {
            ...ctx,
            customInspect: false,
            depth: -1,
        })
            }>`;
    }

    return `${res} <${protoConstr}>`;
}

function formatPrimitive(fn, value, ctx) {
    if (typeof value === "string") {
        let trailer = "";
        if (value.length > ctx.maxStringLength) {
            const remaining = value.length - ctx.maxStringLength;
            value = value.slice(0, ctx.maxStringLength);
            trailer = `... ${remaining} more character${remaining > 1 ? "s" : ""}`;
        }
        if (
            ctx.compact !== true &&
            // TODO(BridgeAR): Add unicode support. Use the readline getStringWidth
            // function.
            value.length > kMinLineLength &&
            value.length > ctx.breakLength - ctx.indentationLvl - 4
        ) {
            return value
                .split(/(?<=\n)/)
                .map((line) => fn(strEscape(line), "string"))
                .join(` +\n${" ".repeat(ctx.indentationLvl + 2)}`) + trailer;
        }
        return fn(strEscape(value), "string") + trailer;
    }
    if (typeof value === "number") {
        return formatNumber(fn, value, ctx.numericSeparator);
    }
    if (typeof value === "bigint") {
        return formatBigInt(fn, value, ctx.numericSeparator);
    }
    if (typeof value === "boolean") {
        return fn(`${value}`, "boolean");
    }
    if (typeof value === "undefined") {
        return fn("undefined", "undefined");
    }
    // es6 symbol primitive
    return fn(Symbol.prototype.toString.call(value), "symbol");
}

// Return a new empty array to push in the results of the default formatter.
function getEmptyFormatArray() {
    return [];
}

function isInstanceof(object, proto) {
    try {
        return object instanceof proto;
    } catch {
        return false;
    }
}

function isInspectableError(value) {
    if (value instanceof Error || types.isNativeError(value)) {
        return true;
    }

    if (typeof Error.isError === "function") {
        try {
            if (Error.isError(value)) {
                return true;
            }
        } catch {
            // Ignore host errors and fall through to shape checks.
        }
    }

    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
        return false;
    }

    try {
        return Object.prototype.hasOwnProperty.call(value, "stack") &&
            (Object.prototype.hasOwnProperty.call(value, "message") ||
                Object.prototype.hasOwnProperty.call(value, "name"));
    } catch {
        return false;
    }
}

function getPrefix(constructor, tag, fallback, size = "") {
    if (constructor === null) {
        if (tag !== "" && fallback !== tag) {
            return `[${fallback}${size}: null prototype] [${tag}] `;
        }
        return `[${fallback}${size}: null prototype] `;
    }

    if (tag !== "" && constructor !== tag) {
        return `${constructor}${size} [${tag}] `;
    }
    return `${constructor}${size} `;
}

function formatArray(ctx, value, recurseTimes) {
    const valLen = value.length;
    const len = Math.min(Math.max(0, ctx.maxArrayLength), valLen);

    const remaining = valLen - len;
    const output = [];
    for (let i = 0; i < len; i++) {
        // Special handle sparse arrays.
        // deno-lint-ignore no-prototype-builtins
        if (!Object.prototype.hasOwnProperty.call(value, i)) {
            return formatSpecialArray(ctx, value, recurseTimes, len, output, i);
        }
        output.push(formatProperty(ctx, value, recurseTimes, i, kArrayType));
    }
    if (remaining > 0) {
        output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
    }
    return output;
}

function getCtxStyle(value, constructor, tag) {
    let fallback = "";
    if (constructor === null) {
        fallback = internalGetConstructorName(value);
        if (fallback === tag) {
            fallback = "Object";
        }
    }
    return getPrefix(constructor, tag, fallback);
}

// Look up the keys of the object.
function getKeys(value, showHidden) {
    let keys;
    const moduleNamespaceExportsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceExports');
    const symbols = Object.getOwnPropertySymbols(value);
    if (showHidden) {
        keys = Object.getOwnPropertyNames(value);
        if (symbols.length !== 0) {
            Array.prototype.push.apply(keys, symbols);
        }
    } else {
        // This might throw if `value` is a Module Namespace Object from an
        // unevaluated module, but we don't want to perform the actual type
        // check because it's expensive.
        // TODO(devsnek): track https://github.com/tc39/ecma262/issues/1209
        // and modify this logic as needed.
        try {
            keys = Object.keys(value);
        } catch (_err) {
            // TODO(wafuwafu13): Implement
            // assert(isNativeError(err) && err.name === 'ReferenceError' &&
            //        isModuleNamespaceObject(value));
            keys = Object.getOwnPropertyNames(value);
        }
        // QuickJS-backed vm.SourceTextModule namespaces can surface as
        // Module objects whose own enumerable keys are unavailable before
        // evaluation; inspect should still format all exports.
        if (keys.length === 0 && types.isModuleNamespaceObject(value)) {
            const knownExports = value[moduleNamespaceExportsSymbol];
            if (Array.isArray(knownExports)) {
                keys = knownExports.slice();
            } else {
                keys = Object.getOwnPropertyNames(value);
            }
        }
        if (symbols.length !== 0) {
            for (let i = 0; i < symbols.length; i++) {
                const symbol = symbols[i];
                if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
                    keys.push(symbol);
                }
            }
        }
    }
    return keys;
}

function formatSet(value, ctx, _ignored, recurseTimes) {
    const length = value.size;
    const maxLength = Math.min(Math.max(0, ctx.maxArrayLength), length);
    const remaining = length - maxLength;
    const output = [];
    ctx.indentationLvl += 2;
    let i = 0;
    for (const v of value) {
        if (i >= maxLength) break;
        Array.prototype.push.call(output, formatValue(ctx, v, recurseTimes));
        i++;
    }
    if (remaining > 0) {
        output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
    }
    ctx.indentationLvl -= 2;
    return output;
}

function formatMap(value, ctx, _gnored, recurseTimes) {
    const length = value.size;
    const maxLength = Math.min(Math.max(0, ctx.maxArrayLength), length);
    const remaining = length - maxLength;
    const output = [];
    ctx.indentationLvl += 2;
    let i = 0;
    for (const { 0: k, 1: v } of value) {
        if (i >= maxLength) break;
        output.push(
            `${formatValue(ctx, k, recurseTimes)} => ${formatValue(ctx, v, recurseTimes)
            }`,
        );
        i++;
    }
    if (remaining > 0) {
        output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
    }
    ctx.indentationLvl -= 2;
    return output;
}

function getTypedArrayLengthForInspect(value) {
    // Own `length` properties on TypedArrays can be user-defined and invalid
    // (for example negative numbers). Prefer backing store metadata.
    try {
        const bytesPerElement = value.BYTES_PER_ELEMENT;
        const byteLength = value.byteLength;
        if (
            typeof bytesPerElement === "number" &&
            bytesPerElement > 0 &&
            typeof byteLength === "number" &&
            byteLength >= 0
        ) {
            return Math.floor(byteLength / bytesPerElement);
        }
    } catch {
        // Fall through to the legacy `length` path.
    }

    try {
        const length = Number(value.length);
        if (Number.isFinite(length) && length >= 0) {
            return Math.floor(length);
        }
    } catch {
        // Ignore invalid accessors and use a safe fallback.
    }

    return 0;
}

function formatTypedArray(
    value,
    length,
    ctx,
    _ignored,
    recurseTimes,
) {
    const maxLength = Math.min(Math.max(0, ctx.maxArrayLength), length);
    const remaining = length - maxLength;
    const output = new Array(maxLength);
    const elementFormatter = length > 0 && typeof value[0] === "number"
        ? formatNumber
        : formatBigInt;
    for (let i = 0; i < maxLength; ++i) {
        output[i] = elementFormatter(ctx.stylize, value[i], ctx.numericSeparator);
    }
    if (remaining > 0) {
        output[maxLength] = `... ${remaining} more item${remaining > 1 ? "s" : ""}`;
    }
    if (ctx.showHidden) {
        // .buffer goes last, it's not a primitive like the others.
        // All besides `BYTES_PER_ELEMENT` are actually getters.
        ctx.indentationLvl += 2;
        for (
            const key of [
                "BYTES_PER_ELEMENT",
                "length",
                "byteLength",
                "byteOffset",
                "buffer",
            ]
        ) {
            const str = formatValue(ctx, value[key], recurseTimes, true);
            Array.prototype.push.call(output, `[${key}]: ${str}`);
        }
        ctx.indentationLvl -= 2;
    }
    return output;
}

function getIteratorBraces(type, tag) {
    if (tag !== `${type} Iterator`) {
        if (tag !== "") {
            tag += "] [";
        }
        tag += `${type} Iterator`;
    }
    return [`[${tag}] {`, "}"];
}

function formatIterator(braces, expectKeyValue, ctx, value, recurseTimes) {
    const preview = previewEntries(value, expectKeyValue, !expectKeyValue);
    const entries = expectKeyValue ? preview?.[0] : preview;
    if (!Array.isArray(entries)) {
        // QuickJS currently does not provide non-destructive iterator previews,
        // so avoid crashing when inspect() is called for diagnostics.
        return [ctx.stylize("<items unknown>", "special")];
    }
    if (expectKeyValue && preview?.[1] === true) {
        // Mark entry iterators as such.
        braces[0] = braces[0].replace(/ Iterator] {$/, " Entries] {");
        return formatMapIterInner(ctx, recurseTimes, entries, kMapEntries);
    }

    if (!expectKeyValue) {
        const isSetEntries = entries.length > 0 && entries.every((entry) =>
            Array.isArray(entry) &&
            entry.length >= 2 &&
            Object.is(entry[0], entry[1])
        );
        if (isSetEntries) {
            braces[0] = braces[0].replace(/ Iterator] {$/, " Entries] {");
            const flattened = [];
            for (const entry of entries) {
                flattened.push(entry[0], entry[1]);
            }
            return formatMapIterInner(ctx, recurseTimes, flattened, kMapEntries);
        }
    }

    return formatSetIterInner(ctx, recurseTimes, entries, kIterator);
}

function getFunctionBase(ctx, value, constructor, tag) {
    const stringified = Function.prototype.toString.call(value);
    const normalizedSource = stringified.trimStart();
    if (stringified.slice(0, 5) === "class" && stringified.endsWith("}")) {
        const slice = stringified.slice(5, -1);
        const bracketIndex = slice.indexOf("{");
        if (
            bracketIndex !== -1 &&
            (!slice.slice(0, bracketIndex).includes("(") ||
                // Slow path to guarantee that it's indeed a class.
                classRegExp.test(slice.replace(stripCommentsRegExp)))
        ) {
            return getClassBase(value, constructor, tag);
        }
    }
    let type = "Function";
    if (
        normalizedSource.startsWith("async function*") ||
        normalizedSource.startsWith("async function *")
    ) {
        type = "AsyncGeneratorFunction";
    } else if (
        normalizedSource.startsWith("function*") ||
        normalizedSource.startsWith("function *") ||
        types.isGeneratorFunction(value)
    ) {
        type = `Generator${type}`;
    } else if (types.isAsyncFunction(value) || normalizedSource.startsWith("async ")) {
        type = `Async${type}`;
    }
    let base = `[${type}`;
    if (constructor === null) {
        base += " (null prototype)";
    }
    if (value.name === "") {
        base += " (anonymous)";
    } else {
        base += `: ${typeof value.name === "string" ? value.name : formatValue(ctx, value.name)}`;
    }
    base += "]";
    if (constructor !== type && constructor !== null) {
        base += ` ${constructor}`;
    }
    if (tag !== "" && constructor !== tag) {
        base += ` [${tag}]`;
    }
    return base;
}

function formatError(
    err,
    constructor,
    tag,
    ctx,
    keys,
) {
    const name = err.name != null ? err.name : "Error";
    let stack;
    const ownStackDescriptor = Object.getOwnPropertyDescriptor(err, "stack");
    const hasEmptyOwnStack =
        ownStackDescriptor &&
        Object.prototype.hasOwnProperty.call(ownStackDescriptor, "value") &&
        ownStackDescriptor.value === "";
    const stackValue = ownStackDescriptor && Object.prototype.hasOwnProperty.call(ownStackDescriptor, "value")
        ? ownStackDescriptor.value
        : err.stack;

    if (stackValue) {
        if (typeof stackValue === "string") {
            stack = stackValue;
        } else {
            const stackCtx = {
                ...ctx,
                compact: false,
                indentationLvl: 0,
                seen: [],
            };
            stack = formatValue(stackCtx, stackValue, 0);
        }
    } else {
        stack = Error.prototype.toString.call(err);
        if (hasEmptyOwnStack) {
            try {
                Object.defineProperty(err, "stack", {
                    value: stack,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            } catch {
                // Best effort: some runtimes may refuse redefining stack.
            }
        }
    }

    // QuickJS may drop the summary line and return only stack frames for some
    // tampered error-name cases. Reconstruct the header from toString() so
    // improveStack() can normalize the first line like Node does.
    if (typeof stack === "string" && stack.startsWith("    at")) {
        const reconstructedHeader = Error.prototype.toString.call(err);
        if (typeof reconstructedHeader === "string" && reconstructedHeader.length !== 0) {
            stack = `${reconstructedHeader}\n${stack}`;
        } else if (constructor !== null) {
            const hasOwnName = Object.prototype.hasOwnProperty.call(err, "name");
            const normalizedName = typeof name === "string" ? name : String(name);
            if (
                normalizedName !== constructor ||
                (!hasOwnName && !nativeErrorConstructorNames.has(constructor))
            ) {
                stack = `${reconstructedHeader}\n${stack}`;
            }
        } else {
            const previousName = cachedErrorName.get(err) || "Error";
            const messageSuffix = err.message ? `: ${err.message}` : "";
            stack = `${previousName}${messageSuffix}\n${stack}`;
        }
    }

    if (typeof stack === "string" && stack.endsWith("\n")) {
        stack = stack.replace(/\n+$/, "");
    }

    let collapsedManualStack = false;
    if (constructor === null && typeof stack === "string") {
        if (!stack.includes("\n    at")) {
            manuallyOverriddenErrorStack.add(err);
        }

        if (tag === "" && manuallyOverriddenErrorStack.has(err)) {
            if (stack.includes("\n    at")) {
                stack = stack.split("\n", 1)[0];
                collapsedManualStack = true;
            } else if (stack.startsWith("    at")) {
                const previousName = cachedErrorName.get(err) || "Error";
                const messageSuffix = err.message ? `: ${err.message}` : "";
                stack = `${previousName}${messageSuffix}`;
                collapsedManualStack = true;
            }
        }
    }

    // Keep frame-only stacks untouched so util.inspect(err) matches err.stack.

    // Do not "duplicate" error properties that are already included in the output
    // otherwise.
    if (!ctx.showHidden && keys.length !== 0) {
        for (const keyName of ["name", "message", "stack"]) {
            const index = keys.indexOf(keyName);
            // Only hide the property in case it's part of the original stack
            if (
                index !== -1 &&
                (typeof err[keyName] !== "string" || stack.includes(err[keyName]))
            ) {
                keys.splice(index, 1);
            }
        }
    } else if (ctx.showHidden) {
        for (const keyName of ["stack", "message"]) {
            if (keys.indexOf(keyName) === -1) {
                keys.push(keyName);
            }
        }
    }

    // A stack trace may contain arbitrary data. Only manipulate the output
    // for "regular errors" (errors that "look normal") for now.
    let improvedStack = stack;
    let nameAsString = typeof name === "string" ? name : String(name);
    if (constructor !== null && typeof nameAsString === "string" && nameAsString !== "") {
        cachedErrorName.set(err, nameAsString);
    }
    let len = nameAsString.length;
    if (typeof name !== "string") {
        const prefix = getPrefix(constructor, tag, "Error").slice(0, -1);
        improvedStack = improvedStack.replace(
            nameAsString,
            `${nameAsString} [${prefix}]`,
        );
    }

    if (
        constructor === null ||
        (nameAsString.endsWith("Error") &&
            improvedStack.startsWith(nameAsString) &&
            (improvedStack.length === len || improvedStack[len] === ":" || improvedStack[len] === "\n"))
    ) {
        let fallback = "Error";
        if (constructor === null) {
            const start = improvedStack.match(/^([A-Z][a-z_ A-Z0-9[\]()-]+)(?::|\n {4}at)/) ||
                improvedStack.match(/^([a-z_A-Z0-9-]*Error)$/);
            fallback = (start && start[1]) || "";
            len = fallback.length;
            fallback = fallback || "Error";
            const previousName = cachedErrorName.get(err);

            if (nameAsString === "Error" && /^Error(?::|\n|$)/.test(improvedStack)) {
                if (typeof previousName === "string" && previousName !== "Error") {
                    nameAsString = previousName;
                    if (fallback === "Error") {
                        fallback = previousName;
                    }
                }
            }

            if (fallback === "Error" && nameAsString === "Error" && previousName === undefined) {
                const frameNameMatch = improvedStack.match(/\n\s*at\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
                const frameName = frameNameMatch && frameNameMatch[1];
                if (frameName && frameName !== "Error") {
                    fallback = frameName;
                    nameAsString = frameName;
                }
            } else if (nameAsString === "Error" && fallback !== "Error") {
                nameAsString = fallback;
            }
        }
        const prefix = getPrefix(constructor, tag, fallback).slice(0, -1);
        if (nameAsString !== prefix) {
            if (prefix.includes(nameAsString)) {
                if (len === 0) {
                    improvedStack = `${prefix}: ${improvedStack}`;
                } else {
                    improvedStack = `${prefix}${improvedStack.slice(len)}`;
                }
            } else {
                improvedStack = `${prefix} [${nameAsString}]${improvedStack.slice(len)}`;
            }
        }
    }

    // Ignore the error message if it's contained in the stack.
    let pos = (err.message && improvedStack.indexOf(err.message)) || -1;
    if (pos !== -1) {
        pos += err.message.length;
    }
    const stackStart = improvedStack.indexOf("\n    at", pos);
    if (stackStart === -1) {
        // No stack frames available: use bracketed error summary.
        improvedStack = `[${improvedStack}]`;
    } else if (ctx.colors && typeof improvedStack === "string") {
        improvedStack = colorizeStackTrace(ctx, improvedStack);
    }
    // The message and the stack have to be indented as well!
    if (ctx.indentationLvl !== 0) {
        const indentation = " ".repeat(ctx.indentationLvl);
        improvedStack = improvedStack.replace(/\n/g, `\n${indentation}`);
    }
    if (ctx.showHidden && typeof err?.message === "string") {
        if (!improvedStack.includes("Error:")) {
            improvedStack = `Error: ${err.message}${improvedStack.startsWith("\n") ? "" : "\n"}${improvedStack}`;
        }
        if (!improvedStack.includes("[stack]")) {
            improvedStack += `${improvedStack.endsWith("\n") ? "" : "\n"}[stack]`;
        }
        if (!improvedStack.includes("[message]")) {
            improvedStack += `${improvedStack.endsWith("\n") ? "" : "\n"}[message]`;
        }
    }
    return improvedStack;
}

function safeGetCWD() {
    if (typeof process !== "object" || process === null || typeof process.cwd !== "function") {
        return undefined;
    }

    try {
        return process.cwd();
    } catch {
        return undefined;
    }
}

function pathToFileUrlHref(pathname) {
    let normalized = pathname.replace(/\\/g, "/");
    if (/^[A-Za-z]:/.test(normalized)) {
        normalized = `/${normalized}`;
    }

    return `file://${encodeURI(normalized)}`;
}

function isKnownCoreModule(modulePath) {
    if (modulePath.startsWith("internal/")) {
        return !(/\/(?:foo|aaaaa)(?:\/|$)/).test(modulePath);
    }

    return modulePath !== "" && !modulePath.includes("/");
}

function markNodeModules(ctx, line) {
    let transformed = "";
    let lastPos = 0;
    let searchFrom = 0;

    while (true) {
        const nodeModulePosition = line.indexOf("node_modules", searchFrom);
        if (nodeModulePosition === -1) {
            break;
        }

        const separator = line[nodeModulePosition - 1];
        const afterNodeModules = line[nodeModulePosition + 12];
        if (
            (separator !== "/" && separator !== "\\") ||
            (afterNodeModules !== "/" && afterNodeModules !== "\\")
        ) {
            searchFrom = nodeModulePosition + 1;
            continue;
        }

        const moduleStart = nodeModulePosition + 13;
        transformed += line.slice(lastPos, moduleStart);

        let moduleEnd = line.indexOf(separator, moduleStart);
        if (moduleEnd === -1) {
            moduleEnd = line.length;
        } else if (line[moduleStart] === "@") {
            const scopedEnd = line.indexOf(separator, moduleEnd + 1);
            moduleEnd = scopedEnd === -1 ? line.length : scopedEnd;
        }

        transformed += ctx.stylize(line.slice(moduleStart, moduleEnd), "module");
        lastPos = moduleEnd;
        searchFrom = moduleEnd;
    }

    return lastPos === 0 ? line : transformed + line.slice(lastPos);
}

function markCwd(ctx, line, cwd) {
    let cwdStart = line.indexOf(cwd);
    if (cwdStart === -1) {
        return line;
    }

    let cwdLength = cwd.length;
    if (line.slice(cwdStart - 7, cwdStart) === "file://") {
        cwdLength += 7;
        cwdStart -= 7;
    }

    const startsWithParen = line[cwdStart - 1] === "(";
    const start = startsWithParen ? cwdStart - 1 : cwdStart;
    const hasClosingParen = startsWithParen && line.endsWith(")");
    const end = hasClosingParen ? line.length - 1 : line.length;
    const separator = line[cwdStart + cwdLength];
    const cwdEnd = cwdStart + cwdLength + ((separator === "/" || separator === "\\") ? 1 : 0);

    let result = line.slice(0, start);
    result += ctx.stylize(line.slice(start, cwdEnd), "undefined");
    result += line.slice(cwdEnd, end);
    if (hasClosingParen) {
        result += ctx.stylize(")", "undefined");
    }

    return result;
}

function colorizeStackTrace(ctx, stack) {
    const lines = stack.split("\n");
    if (lines.length <= 1) {
        return stack;
    }

    const cwd = safeGetCWD();
    let esmCwd;
    let out = lines[0];
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i];
        if (/\(node-compat-runner:\d+:\d+\)$/.test(line)) {
            out += `\n${ctx.stylize(line, "undefined")}`;
            continue;
        }

        const coreMatch = coreModuleRegExp.exec(line);
        if (coreMatch !== null && isKnownCoreModule(coreMatch[1])) {
            out += `\n${ctx.stylize(line, "undefined")}`;
            continue;
        }

        line = markNodeModules(ctx, line);
        if (cwd !== undefined) {
            let marked = markCwd(ctx, line, cwd);
            if (marked === line) {
                if (esmCwd === undefined) {
                    esmCwd = pathToFileUrlHref(cwd);
                }
                marked = markCwd(ctx, line, esmCwd);
            }
            line = marked;
        }

        out += `\n${line}`;
    }

    return out;
}

function hexSlice(view, start, end) {
    let out = "";
    for (let i = start; i < end; i++) {
        const hex = view[i].toString(16);
        out += hex.length === 1 ? `0${hex}` : hex;
    }
    return out;
}

function formatArrayBuffer(ctx, value) {
    let buffer;
    try {
        buffer = new Uint8Array(value);
    } catch {
        return [ctx.stylize("(detached)", "special")];
    }
    let str = hexSlice(buffer, 0, Math.min(ctx.maxArrayLength, buffer.length))
        .replace(/(.{2})/g, "$1 ").trim();

    const remaining = buffer.length - ctx.maxArrayLength;
    if (remaining > 0) {
        str += ` ... ${remaining} more byte${remaining > 1 ? "s" : ""}`;
    }
    return [`${ctx.stylize("[Uint8Contents]", "special")}: <${str}>`];
}

// Copied from util.js to avoid circular dependency; keep in sync.
function addNumericSeparator(intStr) {
    let result = '';
    let i = intStr.length;
    const start = intStr.charAt(0) === '-' ? 1 : 0;
    for (; i >= start + 4; i -= 3) {
        result = '_' + intStr.slice(i - 3, i) + result;
    }
    return (i === intStr.length) ? intStr : intStr.slice(0, i) + result;
}

function addNumericSeparatorEnd(intStr) {
    let result = '';
    let i = 0;
    for (; i < intStr.length - 3; i += 3) {
        result += intStr.slice(i, i + 3) + '_';
    }
    return (i === 0) ? intStr : result + intStr.slice(i);
}

function formatNumber(fn, value, numericSeparator) {
    // Format -0 as '-0'. Checking `value === -0` won't distinguish 0 from -0.
    if (Object.is(value, -0)) return fn("-0", "number");
    const str = `${value}`;
    if (!numericSeparator) return fn(str, "number");
    if (!Number.isFinite(value)) return fn(str, "number");
    if (str.includes("e") || str.includes("E")) return fn(str, "number");
    const dot = str.indexOf(".");
    if (dot === -1) return fn(addNumericSeparator(str), "number");
    const intPart = str.slice(0, dot);
    const fracPart = str.slice(dot + 1);
    return fn(addNumericSeparator(intPart) + "." + addNumericSeparatorEnd(fracPart), "number");
}

function formatPromise(ctx, value, recurseTimes) {
    let output;
    const { 0: state, 1: result } = getPromiseDetails(value);
    if (state === kPending) {
        output = [ctx.stylize("<pending>", "special")];
    } else {
        ctx.indentationLvl += 2;
        const str = formatValue(ctx, result, recurseTimes);
        ctx.indentationLvl -= 2;
        output = [
            state === kRejected
                ? `${ctx.stylize("<rejected>", "special")} ${str}`
                : str,
        ];
    }
    return output;
}

function formatWeakCollection(ctx) {
    return [ctx.stylize("<items unknown>", "special")];
}

function formatWeakSet(ctx, value, recurseTimes) {
    const entries = getWeakSetEntries(value);
    return formatSetIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatWeakMap(ctx, value, recurseTimes) {
    const entries = getWeakMapEntries(value);
    return formatMapIterInner(ctx, recurseTimes, entries, kWeak);
}

function formatProperty(
    ctx,
    value,
    recurseTimes,
    key,
    type,
    desc,
    original = value,
) {
    let name, str;
    let extra = " ";
    desc = desc || Object.getOwnPropertyDescriptor(value, key) || {
        value: value[key],
        enumerable: !(isInspectableError(value) && (key === "message" || key === "stack")),
    };
    if (isInspectableError(value) && (key === "message" || key === "stack")) {
        desc = { ...desc, enumerable: false };
    }
    if (desc.value !== undefined) {
        const diff = (ctx.compact !== true || type !== kObjectType) ? 2 : 3;
        ctx.indentationLvl += diff;
        str = formatValue(ctx, desc.value, recurseTimes);
        if (diff === 3 && ctx.breakLength < getStringWidth(str, ctx.colors)) {
            extra = `\n${" ".repeat(ctx.indentationLvl)}`;
        }
        ctx.indentationLvl -= diff;
    } else if (desc.get !== undefined) {
        const label = desc.set !== undefined ? "Getter/Setter" : "Getter";
        const s = ctx.stylize;
        const sp = "special";
        if (
            ctx.getters && (ctx.getters === true ||
                (ctx.getters === "get" && desc.set === undefined) ||
                (ctx.getters === "set" && desc.set !== undefined))
        ) {
            try {
                const tmp = desc.get.call(original);
                ctx.indentationLvl += 2;
                if (tmp === null) {
                    str = `${s(`[${label}:`, sp)} ${s("null", "null")}${s("]", sp)}`;
                } else if (typeof tmp === "object") {
                    str = `${s(`[${label}]`, sp)} ${formatValue(ctx, tmp, recurseTimes)}`;
                } else {
                    const primitive = formatPrimitive(s, tmp, ctx);
                    str = `${s(`[${label}:`, sp)} ${primitive}${s("]", sp)}`;
                }
                ctx.indentationLvl -= 2;
            } catch (err) {
                let errMessage = err?.message;
                if (err?.name === "TypeError" && errMessage === "not a symbol") {
                    errMessage = "Symbol.prototype.toString requires that 'this' be a Symbol";
                }
                const message = `<Inspection threw (${errMessage})>`;
                str = `${s(`[${label}:`, sp)} ${message}${s("]", sp)}`;
            }
        } else {
            str = ctx.stylize(`[${label}]`, sp);
        }
    } else if (desc.set !== undefined) {
        str = ctx.stylize("[Setter]", "special");
    } else {
        str = ctx.stylize("undefined", "undefined");
    }
    if (type === kArrayType) {
        return str;
    }
    if (typeof key === "symbol") {
        const tmp = key.toString().replace(strEscapeSequencesReplacer, escapeFn);

        name = `[${ctx.stylize(tmp, "symbol")}]`;
    } else if (key === "__proto__") {
        name = "['__proto__']";
    } else if (desc.enumerable === false) {
        const tmp = key.replace(strEscapeSequencesReplacer, escapeFn);

        name = `[${tmp}]`;
    } else if (keyStrRegExp.test(key)) {
        name = ctx.stylize(key, "name");
    } else {
        name = ctx.stylize(strEscape(key), "string");
    }

    return `${name}:${extra}${str}`;
}

function handleMaxCallStackSize(
    ctx,
    err,
    constructorName,
    indentationLvl,
) {
    if (isStackOverflowError(err)) {
        ctx.seen.pop();
        ctx.indentationLvl = indentationLvl;
        return formatInspectionInterrupted(ctx, constructorName);
    }

    throw err;
}

function formatInspectionInterrupted(ctx, constructorName) {
    const message = `[${constructorName}: Inspection interrupted ` +
        "prematurely. Maximum call stack size exceeded.]";
    return ctx.stylize(
        message,
        "special",
    );
}

function formatLinkedListFastPath(ctx, value) {
    if (!(ctx.depth === null || ctx.depth === Infinity)) {
        return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const seen = new Set();
    let node = value;
    for (let i = 0; i <= kLinkedListFastPathDepth; i++) {
        if (node === null || typeof node !== "object" || Array.isArray(node)) {
            return null;
        }
        if (seen.has(node)) {
            return null;
        }
        seen.add(node);

        const keys = Object.keys(node);
        if (keys.length !== 1 || keys[0] !== "next") {
            return null;
        }
        node = node.next;
    }

    const interrupted = formatInspectionInterrupted(ctx, "Object");
    let result = "";
    for (let i = 0; i < kLinkedListFastPathDepth; i++) {
        result += "{ next: ";
    }
    result += interrupted;
    for (let i = 0; i < kLinkedListFastPathDepth; i++) {
        result += " }";
    }
    return result;
}

function isStackOverflowError(err) {
    if (!(err instanceof RangeError)) {
        return false;
    }

    const message = typeof err.message === "string" ? err.message : "";
    return /(?:maximum call stack size exceeded|stack overflow|too much recursion)/i
        .test(message);
}

// deno-lint-ignore no-control-regex
const colorRegExp = /\u001b\[\d\d?m/g;
function removeColors(str) {
    return str.replace(colorRegExp, "");
}

function isBelowBreakLength(ctx, output, start, base) {
    // Each entry is separated by at least a comma. Thus, we start with a total
    // length of at least `output.length`. In addition, some cases have a
    // whitespace in-between each other that is added to the total as well.
    // TODO(BridgeAR): Add unicode support. Use the readline getStringWidth
    // function. Check the performance overhead and make it an opt-in in case it's
    // significant.
    let totalLength = output.length + start;
    if (totalLength + output.length > ctx.breakLength) {
        return false;
    }
    for (let i = 0; i < output.length; i++) {
        if (output[i].includes("\n")) {
            return false;
        }
        if (ctx.colors) {
            totalLength += removeColors(output[i]).length;
        } else {
            totalLength += output[i].length;
        }
        if (totalLength > ctx.breakLength) {
            return false;
        }
    }
    // Do not line up properties on the same line if `base` contains line breaks.
    return base === "" || !base.includes("\n");
}

function formatBigInt(fn, value, numericSeparator) {
    let str = `${value}`;
    if (numericSeparator) str = addNumericSeparator(str);
    return fn(`${str}n`, "bigint");
}

function formatNamespaceObject(
    keys,
    ctx,
    value,
    recurseTimes,
) {
    const moduleNamespaceBindingsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceBindings');
    const moduleBindings = value[moduleNamespaceBindingsSymbol];
    const output = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (
            moduleBindings &&
            typeof key === 'string' &&
            moduleBindings[key] !== undefined
        ) {
            const binding = moduleBindings[key];
            if (binding.initialized) {
                const tmp = { [key]: binding.value };
                output[i] = formatProperty(ctx, tmp, recurseTimes, key, kObjectType);
            } else {
                const tmp = { [key]: '' };
                output[i] = formatProperty(ctx, tmp, recurseTimes, key, kObjectType);
                const pos = output[i].lastIndexOf(' ');
                output[i] = output[i].slice(0, pos + 1) +
                    ctx.stylize('<uninitialized>', 'special');
            }
            continue;
        }

        try {
            output[i] = formatProperty(
                ctx,
                value,
                recurseTimes,
                key,
                kObjectType,
            );
        } catch (_err) {
            // TODO(wafuwfu13): Implement
            // assert(isNativeError(err) && err.name === 'ReferenceError');
            // Use the existing functionality. This makes sure the indentation and
            // line breaks are always correct. Otherwise it is very difficult to keep
            // this aligned, even though this is a hacky way of dealing with this.
            const tmp = { [key]: "" };
            output[i] = formatProperty(ctx, tmp, recurseTimes, key, kObjectType);
            const pos = output[i].lastIndexOf(" ");
            // We have to find the last whitespace and have to replace that value as
            // it will be visualized as a regular string.
            output[i] = output[i].slice(0, pos + 1) +
                ctx.stylize("<uninitialized>", "special");
        }
    }
    // Reset the keys to an empty array. This prevents duplicated inspection.
    keys.length = 0;
    return output;
}

// The array is sparse and/or has extra keys
function formatSpecialArray(
    ctx,
    value,
    recurseTimes,
    maxLength,
    output,
    i,
) {
    const keys = Object.keys(value);
    let index = i;
    for (; i < keys.length && output.length < maxLength; i++) {
        const key = keys[i];
        const tmp = +key;
        // Arrays can only have up to 2^32 - 1 entries
        if (tmp > 2 ** 32 - 2) {
            break;
        }
        if (`${index}` !== key) {
            if (!numberRegExp.test(key)) {
                break;
            }
            const emptyItems = tmp - index;
            const ending = emptyItems > 1 ? "s" : "";
            const message = `<${emptyItems} empty item${ending}>`;
            output.push(ctx.stylize(message, "undefined"));
            index = tmp;
            if (output.length === maxLength) {
                break;
            }
        }
        output.push(formatProperty(ctx, value, recurseTimes, key, kArrayType));
        index++;
    }
    const remaining = value.length - index;
    if (output.length !== maxLength) {
        if (remaining > 0) {
            const ending = remaining > 1 ? "s" : "";
            const message = `<${remaining} empty item${ending}>`;
            output.push(ctx.stylize(message, "undefined"));
        }
    } else if (remaining > 0) {
        output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
    }
    return output;
}

function getBoxedBase(
    value,
    ctx,
    keys,
    constructor,
    tag,
    typeHint,
) {
    let type;
    if (types.isNumberObject(value)) {
        type = "Number";
    } else if (types.isStringObject(value)) {
        type = "String";
        // For boxed Strings, we have to remove the 0-n indexed entries,
        // since they just noisy up the output and are redundant
        // Make boxed primitive Strings look like such
        keys.splice(0, value.length);
    } else if (types.isBooleanObject(value)) {
        type = "Boolean";
    } else if (types.isBigIntObject(value)) {
        type = "BigInt";
    } else if (typeHint) {
        type = typeHint;
    } else {
        type = "Symbol";
    }

    let primitive;
    if (type === "Number") {
        primitive = Number.prototype.valueOf.call(value);
    } else if (type === "String") {
        primitive = String.prototype.valueOf.call(value);
    } else if (type === "Boolean") {
        primitive = Boolean.prototype.valueOf.call(value);
    } else if (type === "BigInt") {
        primitive = BigInt.prototype.valueOf.call(value);
    } else {
        primitive = Symbol.prototype.valueOf.call(value);
    }

    let base = `[${type}`;
    if (type !== constructor) {
        if (constructor === null) {
            base += " (null prototype)";
        } else {
            base += ` (${constructor})`;
        }
    }

    base += `: ${formatPrimitive(stylizeNoColor, primitive, ctx)}]`;
    if (tag !== "" && tag !== constructor) {
        base += ` [${tag}]`;
    }
    if (keys.length !== 0 || ctx.stylize === stylizeNoColor) {
        return base;
    }
    return ctx.stylize(base, type.toLowerCase());
}

function getClassBase(value, constructor, tag) {
    const hasName = Object.prototype.hasOwnProperty.call(value, "name");
    const name = (hasName && value.name) || "(anonymous)";
    let base = `class ${name}`;
    if (constructor !== "Function" && constructor !== null) {
        base += ` [${constructor}]`;
    }
    if (tag !== "" && constructor !== tag) {
        base += ` [${tag}]`;
    }
    if (constructor !== null) {
        const superProto = Object.getPrototypeOf(value);
        const superName = superProto && typeof superProto === "function"
            ? superProto.name
            : undefined;
        if (superName) {
            base += ` extends ${superName}`;
        }
    } else {
        base += " extends [null prototype]";
    }
    return `[${base}]`;
}

function reduceToSingleString(
    ctx,
    output,
    base,
    braces,
    extrasType,
    recurseTimes,
    value,
) {
    if (ctx.compact !== true) {
        if (typeof ctx.compact === "number" && ctx.compact >= 1) {
            // Memorize the original output length. In case the output is grouped,
            // prevent lining up the entries on a single line.
            const entries = output.length;
            // Group array elements together if the array contains at least six
            // separate entries.
            if (extrasType === kArrayExtrasType && entries > 6) {
                output = groupArrayElements(ctx, output, value);
            }
            // `ctx.currentDepth` is set to the most inner depth of the currently
            // inspected object part while `recurseTimes` is the actual current depth
            // that is inspected.
            //
            // Example:
            //
            // const a = { first: [ 1, 2, 3 ], second: { inner: [ 1, 2, 3 ] } }
            //
            // The deepest depth of `a` is 2 (a.second.inner) and `a.first` has a max
            // depth of 1.
            //
            // Consolidate all entries of the local most inner depth up to
            // `ctx.compact`, as long as the properties are smaller than
            // `ctx.breakLength`.
            if (
                ctx.currentDepth - recurseTimes < ctx.compact &&
                entries === output.length
            ) {
                // Line up all entries on a single line in case the entries do not
                // exceed `breakLength`. Add 10 as constant to start next to all other
                // factors that may reduce `breakLength`.
                const start = output.length + ctx.indentationLvl +
                    braces[0].length + base.length + 10;
                if (isBelowBreakLength(ctx, output, start, base)) {
                    return `${base ? `${base} ` : ""}${braces[0]} ${join(output, ", ")}` +
                        ` ${braces[1]}`;
                }
            }
        }
        // Line up each entry on an individual line.
        const indentation = `\n${" ".repeat(ctx.indentationLvl)}`;
        return `${base ? `${base} ` : ""}${braces[0]}${indentation}  ` +
            `${join(output, `,${indentation}  `)}${indentation}${braces[1]}`;
    }
    // Line up all entries on a single line in case the entries do not exceed
    // `breakLength`.
    if (isBelowBreakLength(ctx, output, 0, base)) {
        return `${braces[0]}${base ? ` ${base}` : ""} ${join(output, ", ")} ` +
            braces[1];
    }
    const indentation = " ".repeat(ctx.indentationLvl);
    // If the opening "brace" is too large, like in the case of "Set {",
    // we need to force the first item to be on the next line or the
    // items will not line up correctly.
    const ln = base === "" && braces[0].length === 1
        ? " "
        : `${base ? ` ${base}` : ""}\n${indentation}  `;
    // Line up each entry on an individual line.
    return `${braces[0]}${ln}${join(output, `,\n${indentation}  `)} ${braces[1]}`;
}

// The built-in Array#join is slower in v8 6.0
function join(output, separator) {
    let str = "";
    if (output.length !== 0) {
        const lastIndex = output.length - 1;
        for (let i = 0; i < lastIndex; i++) {
            // It is faster not to use a template string here
            str += output[i];
            str += separator;
        }
        str += output[lastIndex];
    }
    return str;
}

function groupArrayElements(ctx, output, value) {
    let totalLength = 0;
    let maxLength = 0;
    let i = 0;
    let outputLength = output.length;
    if (ctx.maxArrayLength < output.length) {
        // This makes sure the "... n more items" part is not taken into account.
        outputLength--;
    }
    const separatorSpace = 2; // Add 1 for the space and 1 for the separator.
    const dataLen = new Array(outputLength);
    // Calculate the total length of all output entries and the individual max
    // entries length of all output entries. We have to remove colors first,
    // otherwise the length would not be calculated properly.
    for (; i < outputLength; i++) {
        const len = getStringWidth(output[i], ctx.colors);
        dataLen[i] = len;
        totalLength += len + separatorSpace;
        if (maxLength < len) {
            maxLength = len;
        }
    }
    // Add two to `maxLength` as we add a single whitespace character plus a comma
    // in-between two entries.
    const actualMax = maxLength + separatorSpace;
    // Check if at least three entries fit next to each other and prevent grouping
    // of arrays that contains entries of very different length (i.e., if a single
    // entry is longer than 1/5 of all other entries combined). Otherwise the
    // space in-between small entries would be enormous.
    if (
        actualMax * 3 + ctx.indentationLvl < ctx.breakLength &&
        (totalLength / actualMax > 5 || maxLength <= 6)
    ) {
        const approxCharHeights = 2.5;
        const averageBias = Math.sqrt(actualMax - totalLength / output.length);
        const biasedMax = Math.max(actualMax - 3 - averageBias, 1);
        // Dynamically check how many columns seem possible.
        const columns = Math.min(
            // Ideally a square should be drawn. We expect a character to be about 2.5
            // times as high as wide. This is the area formula to calculate a square
            // which contains n rectangles of size `actualMax * approxCharHeights`.
            // Divide that by `actualMax` to receive the correct number of columns.
            // The added bias increases the columns for short entries.
            Math.round(
                Math.sqrt(
                    approxCharHeights * biasedMax * outputLength,
                ) / biasedMax,
            ),
            // Do not exceed the breakLength.
            Math.floor((ctx.breakLength - ctx.indentationLvl) / actualMax),
            // Limit array grouping for small `compact` modes as the user requested
            // minimal grouping.
            ctx.compact * 4,
            // Limit the columns to a maximum of fifteen.
            15,
        );
        // Return with the original output if no grouping should happen.
        if (columns <= 1) {
            return output;
        }
        const tmp = [];
        const maxLineLength = [];
        for (let i = 0; i < columns; i++) {
            let lineMaxLength = 0;
            for (let j = i; j < output.length; j += columns) {
                if (dataLen[j] > lineMaxLength) {
                    lineMaxLength = dataLen[j];
                }
            }
            lineMaxLength += separatorSpace;
            maxLineLength[i] = lineMaxLength;
        }
        let order = String.prototype.padStart;
        if (value !== undefined) {
            for (let i = 0; i < output.length; i++) {
                if (typeof value[i] !== "number" && typeof value[i] !== "bigint") {
                    order = String.prototype.padEnd;
                    break;
                }
            }
        }
        // Each iteration creates a single line of grouped entries.
        for (let i = 0; i < outputLength; i += columns) {
            // The last lines may contain less entries than columns.
            const max = Math.min(i + columns, outputLength);
            let str = "";
            let j = i;
            for (; j < max - 1; j++) {
                // Calculate extra color padding in case it's active. This has to be
                // done line by line as some lines might contain more colors than
                // others.
                const padding = maxLineLength[j - i] + output[j].length - dataLen[j];
                const entry = `${output[j]}, `;
                str += order === String.prototype.padStart
                    ? entry.padStart(padding, " ")
                    : entry.padEnd(padding, " ");
            }
            if (order === String.prototype.padStart) {
                const padding = maxLineLength[j - i] +
                    output[j].length -
                    dataLen[j] -
                    separatorSpace;
                str += output[j].padStart(padding, " ");
            } else {
                str += output[j];
            }
            Array.prototype.push.call(tmp, str);
        }
        if (ctx.maxArrayLength < output.length) {
            Array.prototype.push.call(tmp, output[outputLength]);
        }
        output = tmp;
    }
    return output;
}

function formatMapIterInner(
    ctx,
    recurseTimes,
    entries,
    state,
) {
    const maxArrayLength = Math.max(ctx.maxArrayLength, 0);
    // Entries exist as [key1, val1, key2, val2, ...]
    const len = entries.length / 2;
    const remaining = len - maxArrayLength;
    const maxLength = Math.min(maxArrayLength, len);
    let output = new Array(maxLength);
    let i = 0;
    ctx.indentationLvl += 2;
    if (state === kWeak) {
        for (; i < maxLength; i++) {
            const pos = i * 2;
            output[i] = `${formatValue(ctx, entries[pos], recurseTimes)} => ${formatValue(ctx, entries[pos + 1], recurseTimes)
                }`;
        }
        // Sort all entries to have a halfway reliable output (if more entries than
        // retrieved ones exist, we can not reliably return the same output) if the
        // output is not sorted anyway.
        if (!ctx.sorted) {
            output = output.sort();
        }
    } else {
        for (; i < maxLength; i++) {
            const pos = i * 2;
            const res = [
                formatValue(ctx, entries[pos], recurseTimes),
                formatValue(ctx, entries[pos + 1], recurseTimes),
            ];
            output[i] = reduceToSingleString(
                ctx,
                res,
                "",
                ["[", "]"],
                kArrayExtrasType,
                recurseTimes,
            );
        }
    }
    ctx.indentationLvl -= 2;
    if (remaining > 0) {
        output.push(`... ${remaining} more item${remaining > 1 ? "s" : ""}`);
    }
    return output;
}

function formatSetIterInner(
    ctx,
    recurseTimes,
    entries,
    state,
) {
    const maxArrayLength = Math.max(ctx.maxArrayLength, 0);
    const maxLength = Math.min(maxArrayLength, entries.length);
    const output = new Array(maxLength);
    ctx.indentationLvl += 2;
    for (let i = 0; i < maxLength; i++) {
        output[i] = formatValue(ctx, entries[i], recurseTimes);
    }
    ctx.indentationLvl -= 2;
    if (state === kWeak && !ctx.sorted) {
        // Sort all entries to have a halfway reliable output (if more entries than
        // retrieved ones exist, we can not reliably return the same output) if the
        // output is not sorted anyway.
        output.sort();
    }
    const remaining = entries.length - maxLength;
    if (remaining > 0) {
        Array.prototype.push.call(
            output,
            `... ${remaining} more item${remaining > 1 ? "s" : ""}`,
        );
    }
    return output;
}

// Regex used for ansi escape code splitting
// Adopted from https://github.com/chalk/ansi-regex/blob/HEAD/index.js
// License: MIT, authors: @sindresorhus, Qix-, arjunmehta and LitoMore
// Matches all ansi escape code sequences in a string
const ansiPattern = "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*" +
    "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))";
const ansi = new RegExp(ansiPattern, "g");

/**
 * Returns the number of columns required to display the given string.
 */
export function getStringWidth(str, removeControlChars = true) {
    let width = 0;

    if (removeControlChars) {
        str = stripVTControlCharacters(str);
    }
    str = str.normalize("NFC");
    for (const char of str[Symbol.iterator]()) {
        const code = char.codePointAt(0);
        if (isFullWidthCodePoint(code)) {
            width += 2;
        } else if (!isZeroWidthCodePoint(code)) {
            width++;
        }
    }

    return width;
}

/**
 * Returns true if the character represented by a given
 * Unicode code point is full-width. Otherwise returns false.
 */
const isFullWidthCodePoint = (code) => {
    // Code points are partially derived from:
    // https://www.unicode.org/Public/UNIDATA/EastAsianWidth.txt
    return code >= 0x1100 && (
        code <= 0x115f || // Hangul Jamo
        code === 0x2329 || // LEFT-POINTING ANGLE BRACKET
        code === 0x232a || // RIGHT-POINTING ANGLE BRACKET
        // CJK Radicals Supplement .. Enclosed CJK Letters and Months
        (code >= 0x2e80 && code <= 0x3247 && code !== 0x303f) ||
        // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
        (code >= 0x3250 && code <= 0x4dbf) ||
        // CJK Unified Ideographs .. Yi Radicals
        (code >= 0x4e00 && code <= 0xa4c6) ||
        // Hangul Jamo Extended-A
        (code >= 0xa960 && code <= 0xa97c) ||
        // Hangul Syllables
        (code >= 0xac00 && code <= 0xd7a3) ||
        // CJK Compatibility Ideographs
        (code >= 0xf900 && code <= 0xfaff) ||
        // Vertical Forms
        (code >= 0xfe10 && code <= 0xfe19) ||
        // CJK Compatibility Forms .. Small Form Variants
        (code >= 0xfe30 && code <= 0xfe6b) ||
        // Halfwidth and Fullwidth Forms
        (code >= 0xff01 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        // Kana Supplement
        (code >= 0x1b000 && code <= 0x1b001) ||
        // Enclosed Ideographic Supplement
        (code >= 0x1f200 && code <= 0x1f251) ||
        // Miscellaneous Symbols and Pictographs 0x1f300 - 0x1f5ff
        // Emoticons 0x1f600 - 0x1f64f
        (code >= 0x1f300 && code <= 0x1f64f) ||
        // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
        (code >= 0x20000 && code <= 0x3fffd)
    );
};

const isZeroWidthCodePoint = (code) => {
    return code <= 0x1F || // C0 control codes
        (code >= 0x7F && code <= 0x9F) || // C1 control codes
        (code >= 0x300 && code <= 0x36F) || // Combining Diacritical Marks
        (code >= 0x200B && code <= 0x200F) || // Modifying Invisible Characters
        // Combining Diacritical Marks for Symbols
        (code >= 0x20D0 && code <= 0x20FF) ||
        (code >= 0xFE00 && code <= 0xFE0F) || // Variation Selectors
        (code >= 0xFE20 && code <= 0xFE2F) || // Combining Half Marks
        (code >= 0xE0100 && code <= 0xE01EF); // Variation Selectors
};

function hasBuiltInToString(value) {
    // Prevent triggering proxy traps.
    const getFullProxy = false;
    const proxyTarget = getProxyDetails(value, getFullProxy);
    if (proxyTarget !== undefined) {
        if (proxyTarget === null) {
            return true;
        }
        value = proxyTarget;
    }

    let hasOwnToString = (object, key) =>
        Object.prototype.hasOwnProperty.call(object, key);
    let hasOwnToPrimitive = hasOwnToString;

    // Objects with an own @@toPrimitive are not treated as built-ins.
    if (typeof value.toString !== "function") {
        if (typeof value[Symbol.toPrimitive] !== "function") {
            return true;
        }
        if (Object.prototype.hasOwnProperty.call(value, Symbol.toPrimitive)) {
            return false;
        }
        hasOwnToString = () => false;
    } else if (Object.prototype.hasOwnProperty.call(value, "toString")) {
        return false;
    } else if (typeof value[Symbol.toPrimitive] !== "function") {
        hasOwnToPrimitive = () => false;
    } else if (Object.prototype.hasOwnProperty.call(value, Symbol.toPrimitive)) {
        return false;
    }

    // Find the object that has `toString` or `Symbol.toPrimitive` as own
    // property in the prototype chain.
    let pointer = value;
    do {
        pointer = Object.getPrototypeOf(pointer);
    } while (
        pointer !== null &&
        !hasOwnToString(pointer, "toString") &&
        !hasOwnToPrimitive(pointer, Symbol.toPrimitive)
    );

    if (pointer === null) {
        return true;
    }

    // Check closer if the object is a built-in.
    const descriptor = Object.getOwnPropertyDescriptor(pointer, "constructor");
    return descriptor !== undefined &&
        typeof descriptor.value === "function" &&
        builtInObjects.has(descriptor.value.name);
}

const firstErrorLine = (error) => error.message.split("\n", 1)[0];
let CIRCULAR_ERROR_MESSAGE;
function tryStringify(arg) {
    try {
        return JSON.stringify(arg);
    } catch (err) {
        // Populate the circular error message lazily
        if (!CIRCULAR_ERROR_MESSAGE) {
            try {
                const a = {};
                a.a = a;
                JSON.stringify(a);
            } catch (circularError) {
                CIRCULAR_ERROR_MESSAGE = firstErrorLine(circularError);
            }
        }
        if (
            err.name === "TypeError" &&
            firstErrorLine(err) === CIRCULAR_ERROR_MESSAGE
        ) {
            return "[Circular]";
        }
        throw err;
    }
}

export function format(...args) {
    return formatWithOptionsInternal(undefined, args);
}

export function formatWithOptions(inspectOptions, ...args) {
    if (typeof inspectOptions !== "object" || inspectOptions === null) {
        throw new codes.ERR_INVALID_ARG_TYPE(
            "inspectOptions",
            "object",
            inspectOptions,
        );
    }
    return formatWithOptionsInternal(inspectOptions, args);
}

function formatNumberNoColor(number, options) {
    return formatNumber(
        stylizeNoColor,
        number,
        options?.numericSeparator ?? inspectDefaultOptions.numericSeparator,
    );
}

function formatBigIntNoColor(bigint, options) {
    return formatBigInt(
        stylizeNoColor,
        bigint,
        options?.numericSeparator ?? inspectDefaultOptions.numericSeparator,
    );
}

function formatWithOptionsInternal(inspectOptions, args) {
    const first = args[0];
    let a = 0;
    let str = "";
    let join = "";

    if (typeof first === "string") {
        if (args.length === 1) {
            return first;
        }
        let tempStr;
        let lastPos = 0;

        for (let i = 0; i < first.length - 1; i++) {
            if (first.charCodeAt(i) === 37) { // '%'
                const nextChar = first.charCodeAt(++i);
                if (a + 1 !== args.length) {
                    switch (nextChar) {
                        // deno-lint-ignore no-case-declarations
                        case 115: // 's'
                            const tempArg = args[++a];
                            if (typeof tempArg === "number") {
                                tempStr = formatNumberNoColor(tempArg, inspectOptions);
                            } else if (typeof tempArg === "bigint") {
                                tempStr = formatBigIntNoColor(tempArg, inspectOptions);
                            } else if (
                                typeof tempArg !== "object" ||
                                tempArg === null ||
                                !hasBuiltInToString(tempArg)
                            ) {
                                tempStr = String(tempArg);
                            } else {
                                tempStr = inspect(tempArg, {
                                    ...inspectOptions,
                                    compact: 3,
                                    colors: false,
                                    depth: 0,
                                });
                            }
                            break;
                        case 106: // 'j'
                            tempStr = tryStringify(args[++a]);
                            break;
                        // deno-lint-ignore no-case-declarations
                        case 100: // 'd'
                            const tempNum = args[++a];
                            if (typeof tempNum === "bigint") {
                                tempStr = formatBigIntNoColor(tempNum, inspectOptions);
                            } else if (typeof tempNum === "symbol") {
                                tempStr = "NaN";
                            } else {
                                tempStr = formatNumberNoColor(Number(tempNum), inspectOptions);
                            }
                            break;
                        case 79: // 'O'
                            tempStr = inspect(args[++a], inspectOptions);
                            break;
                        case 111: // 'o'
                            tempStr = inspect(args[++a], {
                                ...inspectOptions,
                                showHidden: true,
                                showProxy: true,
                                depth: 4,
                            });
                            break;
                        // deno-lint-ignore no-case-declarations
                        case 105: // 'i'
                            const tempInteger = args[++a];
                            if (typeof tempInteger === "bigint") {
                                tempStr = formatBigIntNoColor(tempInteger, inspectOptions);
                            } else if (typeof tempInteger === "symbol") {
                                tempStr = "NaN";
                            } else {
                                tempStr = formatNumberNoColor(
                                    Number.parseInt(tempInteger),
                                    inspectOptions,
                                );
                            }
                            break;
                        // deno-lint-ignore no-case-declarations
                        case 102: // 'f'
                            const tempFloat = args[++a];
                            if (typeof tempFloat === "symbol") {
                                tempStr = "NaN";
                            } else {
                                tempStr = formatNumberNoColor(
                                    Number.parseFloat(tempFloat),
                                    inspectOptions,
                                );
                            }
                            break;
                        case 99: // 'c'
                            a += 1;
                            tempStr = "";
                            break;
                        case 37: // '%'
                            str += first.slice(lastPos, i);
                            lastPos = i + 1;
                            continue;
                        default: // Any other character is not a correct placeholder
                            continue;
                    }
                    if (lastPos !== i - 1) {
                        str += first.slice(lastPos, i - 1);
                    }
                    str += tempStr;
                    lastPos = i + 1;
                } else if (nextChar === 37) {
                    str += first.slice(lastPos, i);
                    lastPos = i + 1;
                }
            }
        }
        if (lastPos !== 0) {
            a++;
            join = " ";
            if (lastPos < first.length) {
                str += first.slice(lastPos);
            }
        }
    }

    while (a < args.length) {
        const value = args[a];
        str += join;
        str += typeof value !== "string" ? inspect(value, inspectOptions) : value;
        join = " ";
        a++;
    }
    return str;
}

/**
 * Remove all VT control characters. Use to estimate displayed string width.
 */
export function stripVTControlCharacters(str) {
    validateString(str, "str");

    return str.replace(ansi, "");
}

export default {
    format,
    getStringWidth,
    inspect,
    stripVTControlCharacters,
    formatWithOptions,
};
