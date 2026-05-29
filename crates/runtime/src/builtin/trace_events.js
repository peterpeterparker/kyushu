import { inspect } from 'node:util';
import { ERR_INVALID_ARG_TYPE } from '__wasm_rquickjs_builtin/internal/errors';

const enabledTraces = new Set();

function validateCategories(categories) {
    if (!Array.isArray(categories)) {
        throw new ERR_INVALID_ARG_TYPE('options.categories', 'Array', categories);
    }

    if (categories.length === 0) {
        const err = new Error('At least one category is required');
        err.code = 'ERR_TRACE_EVENTS_CATEGORY_REQUIRED';
        throw err;
    }

    for (let i = 0; i < categories.length; i++) {
        if (typeof categories[i] !== 'string') {
            throw new ERR_INVALID_ARG_TYPE(`options.categories[${i}]`, 'string', categories[i]);
        }
    }

    return categories;
}

class Tracing {
    #enabled = false;
    #categories;

    constructor(categories) {
        this.#categories = categories;
    }

    get enabled() {
        return this.#enabled;
    }

    get categories() {
        return this.#categories.join(',');
    }

    enable() {
        this.#enabled = true;
        enabledTraces.add(this);
    }

    disable() {
        this.#enabled = false;
        enabledTraces.delete(this);
    }

    [inspect.custom](depth, options) {
        if (depth < 0) {
            return 'Tracing {}';
        }

        return `Tracing { enabled: ${this.enabled}, categories: ${inspect(this.categories, options)} }`;
    }
}

export function createTracing(options) {
    if (options === null || typeof options !== 'object') {
        throw new ERR_INVALID_ARG_TYPE('options', 'Object', options);
    }

    return new Tracing(validateCategories(options.categories));
}

export function getEnabledCategories() {
    const categories = new Set();

    for (const trace of enabledTraces) {
        for (const category of trace.categories.split(',')) {
            categories.add(category);
        }
    }

    return Array.from(categories).join(',');
}

export default {
    createTracing,
    getEnabledCategories,
};
