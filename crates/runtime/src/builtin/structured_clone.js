// @ungap/structured-clone v1.3.0
// https://github.com/ungap/structured-clone
// MIT License

const VOID = -1;
const PRIMITIVE = 0;
const ARRAY = 1;
const OBJECT = 2;
const DATE = 3;
const REGEXP = 4;
const MAP = 5;
const SET = 6;
const ERROR = 7;
const BIGINT = 8;
const CUSTOM = 9;

const EMPTY = '';
const customCloneSymbol = Symbol.for('__wasm_rquickjs.structuredClone');

const {toString} = {};
const {keys} = Object;

const typeOf = value => {
  const type = typeof value;
  if (type !== 'object' || !value)
    return [PRIMITIVE, type];

  const asString = toString.call(value).slice(8, -1);
  switch (asString) {
    case 'Array':
      return [ARRAY, EMPTY];
    case 'Object':
      return [OBJECT, EMPTY];
    case 'Date':
      return [DATE, EMPTY];
    case 'RegExp':
      return [REGEXP, EMPTY];
    case 'Map':
      return [MAP, EMPTY];
    case 'Set':
      return [SET, EMPTY];
    case 'DataView':
      return [ARRAY, asString];
  }

  if (asString.includes('Array'))
    return [ARRAY, asString];

  if (asString.includes('Error'))
    return [ERROR, asString];

  return [OBJECT, asString];
};

const shouldSkip = ([TYPE, type]) => (
  TYPE === PRIMITIVE &&
  (type === 'function' || type === 'symbol')
);

const serializer = (strict, json, $, _) => {

  const as = (out, value) => {
    const index = _.push(out) - 1;
    $.set(value, index);
    return index;
  };

  const pair = value => {
    if ($.has(value))
      return $.get(value);

    if (value && (typeof value === 'object' || typeof value === 'function') && typeof value[customCloneSymbol] === 'function')
      return as([CUSTOM, value[customCloneSymbol]()], value);

    let [TYPE, type] = typeOf(value);
    switch (TYPE) {
      case PRIMITIVE: {
        let entry = value;
        switch (type) {
          case 'bigint':
            TYPE = BIGINT;
            entry = value.toString();
            break;
          case 'function':
          case 'symbol':
            if (strict)
              throw new TypeError('unable to serialize ' + type);
            entry = null;
            break;
          case 'undefined':
            return as([VOID], value);
        }
        return as([TYPE, entry], value);
      }
      case ARRAY: {
        if (type) {
          let spread = value;
          if (type === 'DataView') {
            const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            return as([type, {bytes: [...bytes], byteOffset: 0, byteLength: value.byteLength}], value);
          }
          else if (type === 'ArrayBuffer' || type === 'SharedArrayBuffer') {
            spread = new Uint8Array(value);
          }
          return as([type, [...spread]], value);
        }

        const arr = [];
        const index = as([TYPE, arr], value);
        for (const entry of value)
          arr.push(pair(entry));
        return index;
      }
      case OBJECT: {
        if (type) {
          switch (type) {
            case 'BigInt':
              return as([type, value.toString()], value);
            case 'Boolean':
            case 'Number':
            case 'String':
              return as([type, value.valueOf()], value);
          }
        }

        if (json && ('toJSON' in value))
          return pair(value.toJSON());

        const entries = [];
        const index = as([TYPE, entries], value);
        for (const key of keys(value)) {
          if (strict || !shouldSkip(typeOf(value[key])))
            entries.push([pair(key), pair(value[key])]);
        }
        return index;
      }
      case DATE:
        return as([TYPE, value.toISOString()], value);
      case REGEXP: {
        const {source, flags} = value;
        return as([TYPE, {source, flags}], value);
      }
      case MAP: {
        const entries = [];
        const index = as([TYPE, entries], value);
        for (const [key, entry] of value) {
          if (strict || !(shouldSkip(typeOf(key)) || shouldSkip(typeOf(entry))))
            entries.push([pair(key), pair(entry)]);
        }
        return index;
      }
      case SET: {
        const entries = [];
        const index = as([TYPE, entries], value);
        for (const entry of value) {
          if (strict || !shouldSkip(typeOf(entry)))
            entries.push(pair(entry));
        }
        return index;
      }
    }

    const {message} = value;
    return as([TYPE, {name: type, message}], value);
  };

  return pair;
};

export const serialize = (value, {json, lossy} = {}) => {
  const _ = [];
  return serializer(!(json || lossy), !!json, new Map, _)(value), _;
};

const env = globalThis;

const deserializer = ($, _) => {
  const as = (out, index) => {
    $.set(index, out);
    return out;
  };

  const unpair = index => {
    if ($.has(index))
      return $.get(index);

    const [type, value] = _[index];
    switch (type) {
      case PRIMITIVE:
      case VOID:
        return as(value, index);
      case ARRAY: {
        const arr = as([], index);
        for (const index of value)
          arr.push(unpair(index));
        return arr;
      }
      case OBJECT: {
        const object = as({}, index);
        for (const [key, index] of value)
          object[unpair(key)] = unpair(index);
        return object;
      }
      case DATE:
        return as(new Date(value), index);
      case REGEXP: {
        const {source, flags} = value;
        return as(new RegExp(source, flags), index);
      }
      case MAP: {
        const map = as(new Map, index);
        for (const [key, index] of value)
          map.set(unpair(key), unpair(index));
        return map;
      }
      case SET: {
        const set = as(new Set, index);
        for (const index of value)
          set.add(unpair(index));
        return set;
      }
      case ERROR: {
        const {name, message} = value;
        return as(new env[name](message), index);
      }
      case BIGINT:
        return as(BigInt(value), index);
      case CUSTOM:
        return as(value, index);
      case 'BigInt':
        return as(Object(BigInt(value)), index);
      case 'ArrayBuffer':
        return as(new Uint8Array(value).buffer, index);
      case 'SharedArrayBuffer': {
        const buffer = new SharedArrayBuffer(value.length);
        new Uint8Array(buffer).set(value);
        return as(buffer, index);
      }
      case 'DataView': {
        const {bytes, byteOffset, byteLength} = value;
        const buf = new Uint8Array(bytes).buffer;
        return as(new DataView(buf, byteOffset, byteLength), index);
      }
    }
    return as(new env[type](value), index);
  };

  return unpair;
};

export const deserialize = serialized => deserializer(new Map, serialized)(0);

const dataCloneError = (message) => {
  const e = new Error(message);
  e.name = 'DataCloneError';
  return e;
};

const _TRANSFER_MARKER_KEY = '__wasm_rquickjs_sc_transfer__';

function _nodeTypeError(code, message) {
  const err = new TypeError(message);
  err.code = code;
  return err;
}

function _missingArgsError() {
  const err = new TypeError('The "value" argument must be specified');
  err.code = 'ERR_MISSING_ARGS';
  return err;
}

function _isTransferableType(item) {
  return (
    item instanceof ArrayBuffer ||
    item instanceof ReadableStream ||
    item instanceof WritableStream ||
    item instanceof TransformStream
  );
}

function _normalizeStructuredCloneOptions(options) {
  const prefix = "Failed to execute 'structuredClone'";
  const dictionaryConverterError = `${prefix}: Options cannot be converted to a dictionary`;
  const memberConverterError = `${prefix}: transfer in Options can not be converted to sequence.`;

  if (options == null) {
    return undefined;
  }
  if (typeof options !== 'object') {
    throw _nodeTypeError('ERR_INVALID_ARG_TYPE', dictionaryConverterError);
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'transfer')) {
    return options;
  }
  const transfer = options.transfer;
  if (transfer == null || typeof transfer === 'string' || typeof transfer[Symbol.iterator] !== 'function') {
    throw _nodeTypeError('ERR_INVALID_ARG_TYPE', memberConverterError);
  }
  return { ...options, transfer: [...transfer] };
}

function _cloneTransferredPlatformObject(item) {
  if (item instanceof ReadableStream) {
    return Object.create(ReadableStream.prototype);
  }
  if (item instanceof WritableStream) {
    return Object.create(WritableStream.prototype);
  }
  if (item instanceof TransformStream) {
    return Object.create(TransformStream.prototype);
  }
  return item;
}

function _replaceTransferItems(value, itemToMarker, visited) {
  if (value == null || typeof value !== 'object') return value;
  if (visited.has(value)) return value;
  if (itemToMarker.has(value)) return itemToMarker.get(value);
  visited.add(value);
  if (Array.isArray(value)) {
    const result = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      result[i] = _replaceTransferItems(value[i], itemToMarker, visited);
    }
    return result;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = _replaceTransferItems(value[key], itemToMarker, visited);
    }
    return result;
  }
  return value;
}

function _restoreTransferItems(value, reverseMap, visited) {
  if (value == null || typeof value !== 'object') return value;
  if (visited.has(value)) return value;
  if (value[_TRANSFER_MARKER_KEY] !== undefined) {
    return reverseMap.get(value[_TRANSFER_MARKER_KEY]);
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = _restoreTransferItems(value[i], reverseMap, visited);
    }
  } else {
    for (const key of Object.keys(value)) {
      value[key] = _restoreTransferItems(value[key], reverseMap, visited);
    }
  }
  return value;
}

function structuredClone(any, options) {
  if (arguments.length === 0) {
    throw _missingArgsError();
  }

  options = _normalizeStructuredCloneOptions(options);

  // Detect file-backed Blobs (from fs.openAsBlob) and reject them
  const kFileBackedBlob = Symbol.for('kFileBackedBlob');
  if (any && typeof any === 'object' && any[kFileBackedBlob]) {
    const err = new Error('Invalid state: File-backed Blobs are not cloneable');
    err.code = 'ERR_INVALID_STATE';
    throw err;
  }

  const transferList = options && options.transfer;

  if (transferList != null) {
    const seen = new Set();
    for (const item of transferList) {
      if (!_isTransferableType(item)) {
        throw dataCloneError('Transfer list item is not transferable');
      }
      if (item instanceof ArrayBuffer && item.detached) {
        throw dataCloneError('ArrayBuffer is already detached');
      }
      if (seen.has(item)) {
        throw dataCloneError('Transfer list item appears more than once');
      }
      seen.add(item);
    }
  }

  // Build maps for non-ArrayBuffer transferables (streams etc.)
  const itemToMarker = new Map();
  const reverseMap = new Map();
  if (transferList != null) {
    let idx = 0;
    for (const item of transferList) {
      if (!(item instanceof ArrayBuffer)) {
        const marker = { [_TRANSFER_MARKER_KEY]: idx };
        itemToMarker.set(item, marker);
        reverseMap.set(idx, _cloneTransferredPlatformObject(item));
        idx++;
      }
    }
  }

  // Pre-process: replace non-ArrayBuffer transfer items with markers
  const processedValue = itemToMarker.size > 0
    ? _replaceTransferItems(any, itemToMarker, new Set())
    : any;

  const cloneOpts = options && ('json' in options || 'lossy' in options) ? options : {};
  let result = deserialize(serialize(processedValue, cloneOpts));

  // Post-process: replace markers with original transferred objects
  if (reverseMap.size > 0) {
    result = _restoreTransferItems(result, reverseMap, new Set());
  }

  // Transfer ArrayBuffers (detach originals)
  if (transferList != null) {
    for (const item of transferList) {
      if (item instanceof ArrayBuffer) {
        if (typeof ArrayBuffer.prototype.transfer === 'function') {
          ArrayBuffer.prototype.transfer.call(item);
        }
      }
    }
  }

  return result;
}

export default structuredClone;
