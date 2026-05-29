// node:cluster stub implementation
// Multi-process clustering is not possible in WASM environment

const NOT_SUPPORTED_ERROR = 'cluster is not supported in WebAssembly environment';

export const isPrimary = true;
export const isMaster = true;
export const isWorker = false;
export const worker = null;
export const workers = {};
export const settings = {};
export const SCHED_NONE = 1;
export const SCHED_RR = 2;
export const schedulingPolicy = 2;

export function fork() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export function disconnect() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export function setupPrimary() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export function setupMaster() {
    throw new Error(NOT_SUPPORTED_ERROR);
}

export default {
    isPrimary,
    isMaster,
    isWorker,
    worker,
    workers,
    settings,
    SCHED_NONE,
    SCHED_RR,
    schedulingPolicy,
    fork,
    disconnect,
    setupPrimary,
    setupMaster,
};
