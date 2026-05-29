// node:perf_hooks - partial implementation

const _timeOrigin = Date.now();
const _marks = [];
const _measures = [];

function findMark(name) {
    const entry = _marks.find(e => e.name === name);
    if (!entry) {
        throw new Error(`The "${name}" performance mark has not been set`);
    }
    return entry;
}

class PerformanceEntry {
    constructor(name, entryType, startTime, duration) {
        this.name = name;
        this.entryType = entryType;
        this.startTime = startTime;
        this.duration = duration;
    }

    toJSON() {
        return {
            name: this.name,
            entryType: this.entryType,
            startTime: this.startTime,
            duration: this.duration,
        };
    }
}

const nodeTiming = Object.freeze({
    name: 'node',
    entryType: 'node',
    startTime: 0,
    duration: 0,
    nodeStart: 0,
    v8Start: 0,
    bootstrapComplete: 0,
    environment: 0,
    loopStart: 0,
    loopExit: 0,
    idleTime: 0,
});

function removeByName(arr, name) {
    if (name === undefined) {
        arr.length = 0;
    } else {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].name === name) arr.splice(i, 1);
        }
    }
}

const performance = {
    timeOrigin: _timeOrigin,

    now() {
        return Date.now() - _timeOrigin;
    },

    mark(name, options) {
        const startTime = options?.startTime ?? this.now();
        const entry = new PerformanceEntry(name, 'mark', startTime, 0);
        _marks.push(entry);
        return entry;
    },

    measure(name, startMarkOrOptions, endMark) {
        let startTime = 0;
        let endTime = this.now();

        if (typeof startMarkOrOptions === 'string') {
            startTime = findMark(startMarkOrOptions).startTime;
            if (typeof endMark === 'string') {
                endTime = findMark(endMark).startTime;
            }
        } else if (startMarkOrOptions && typeof startMarkOrOptions === 'object') {
            if (startMarkOrOptions.start !== undefined) {
                startTime = typeof startMarkOrOptions.start === 'string'
                    ? findMark(startMarkOrOptions.start).startTime
                    : startMarkOrOptions.start;
            }
            if (startMarkOrOptions.end !== undefined) {
                endTime = typeof startMarkOrOptions.end === 'string'
                    ? findMark(startMarkOrOptions.end).startTime
                    : startMarkOrOptions.end;
            }
            if (startMarkOrOptions.duration !== undefined) {
                endTime = startTime + startMarkOrOptions.duration;
            }
        }

        const duration = endTime - startTime;
        const entry = new PerformanceEntry(name, 'measure', startTime, duration);
        _measures.push(entry);
        return entry;
    },

    clearMarks(name) {
        removeByName(_marks, name);
    },

    clearMeasures(name) {
        removeByName(_measures, name);
    },

    getEntries() {
        return [..._marks, ..._measures];
    },

    getEntriesByName(name, type) {
        return this.getEntries().filter(e =>
            e.name === name && (type === undefined || e.entryType === type)
        );
    },

    getEntriesByType(type) {
        return this.getEntries().filter(e => e.entryType === type);
    },

    nodeTiming,

    toJSON() {
        return { timeOrigin: _timeOrigin };
    },
};

class PerformanceObserver {
    constructor(callback) {
        this._callback = callback;
    }

    observe() {}

    disconnect() {}

    takeRecords() {
        return [];
    }

    static get supportedEntryTypes() {
        return ['mark', 'measure'];
    }
}

function monitorEventLoopDelay() {
    throw new Error('monitorEventLoopDelay is not supported in WebAssembly environment');
}

function createHistogram() {
    throw new Error('createHistogram is not supported in WebAssembly environment');
}

const constants = {};

export {
    performance,
    PerformanceEntry,
    PerformanceObserver,
    monitorEventLoopDelay,
    createHistogram,
    constants,
};

export default {
    performance,
    PerformanceEntry,
    PerformanceObserver,
    monitorEventLoopDelay,
    createHistogram,
    constants,
};
