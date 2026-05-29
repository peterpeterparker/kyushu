// Minimal v8 module stub for Node.js compatibility
// Most v8 internals are not available in QuickJS/WASM

export function getHeapStatistics() {
    return {
        total_heap_size: 0,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 0,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
    };
}

export function getHeapSpaceStatistics() {
    return [];
}

export function getHeapSnapshot() {
    throw new Error('v8.getHeapSnapshot is not supported in WASM environment');
}

export function getHeapCodeStatistics() {
    return {
        code_and_metadata_size: 0,
        bytecode_and_metadata_size: 0,
        external_script_source_size: 0,
        cpu_profiler_metadata_size: 0,
    };
}

export function setFlagsFromString(flags) {
    if (typeof flags !== 'string') {
        throw new TypeError('The "flags" argument must be of type string');
    }
    // No-op: V8 flags cannot be set in QuickJS/WASM
}

export function writeHeapSnapshot() {
    throw new Error('v8.writeHeapSnapshot is not supported in WASM environment');
}

export function takeCoverage() {
    // No-op
}

export function stopCoverage() {
    // No-op
}

export function serialize(value) {
    throw new Error('v8.serialize is not supported in WASM environment');
}

export function deserialize(buffer) {
    throw new Error('v8.deserialize is not supported in WASM environment');
}

class Serializer {
    constructor() {
        throw new Error('v8.Serializer is not supported in WASM environment');
    }
}

class Deserializer {
    constructor() {
        throw new Error('v8.Deserializer is not supported in WASM environment');
    }
}

class DefaultSerializer extends Serializer {}
class DefaultDeserializer extends Deserializer {}

export { Serializer, Deserializer, DefaultSerializer, DefaultDeserializer };

export default {
    getHeapStatistics, getHeapSpaceStatistics, getHeapSnapshot, getHeapCodeStatistics,
    setFlagsFromString, writeHeapSnapshot, takeCoverage, stopCoverage,
    serialize, deserialize,
    Serializer, Deserializer, DefaultSerializer, DefaultDeserializer,
};
