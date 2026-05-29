import * as httpNative from '__wasm_rquickjs_builtin/http_native'
import {formDataToBlob} from '__wasm_rquickjs_builtin/http_form_data';
import {DOMException} from '__wasm_rquickjs_builtin/abort_controller';
import * as base64 from 'base64-js';

// Partially based on the implementation in wasmedge-quickjs
// Partially based on https://github.com/JakeChampion/fetch/blob/main/fetch.js
// Depends on https://github.com/jimmywarting/FormData and https://github.com/node-fetch/fetch-blob

// Defined as a plain (non-async) function so its prototype is
// `Function.prototype` (not `AsyncFunction.prototype`) — which Node's vendored
// `parallel/test-fetch.mjs` asserts. We deliberately do NOT use a
// method-shorthand here even though that would make `new fetch(...)` throw,
// because Node's own `globalThis.fetch` is also a plain function and
// `new fetch(url)` in Node simply returns the Promise produced by `fetch(url)`.
// Matching Node's behavior is more important than enforcing the web spec's
// "fetch is not a constructor" rule for our compatibility goals.
export function fetch(resource, options = {}) {
    return (async () => {
        let method;
        let rawHeaders = {};
        let version = options.version || 'HTTP/1.1';
        let mode;
        let referer;
        let referrerPolicy;
        let credentials;
        let redirect;
        let body;
        let url;
        let signal;

        if (typeof resource === 'object' && resource instanceof Request) {
            method = resource.method.toUpperCase();
            const headers = resource.headers;
            if (!headers.has('Accept')) {
                headers.set('Accept', '*/*');
            }
            for (const [name, value] of headers.entries()) {
                rawHeaders[name] = value;
            }

            mode = options.mode || resource.mode;
            referer = options.referrer || resource.referrer;
            referrerPolicy = options.referrerPolicy || resource.referrerPolicy;
            // let cache = options.cache || resource.cache; // cache not used in native yet
            credentials = options.credentials || resource.credentials;
            redirect = options.redirect || resource.redirect || 'follow';
            signal = options.signal || resource.signal;

            if (resource._bodyUsed) {
                throw new TypeError("Request body is already used");
            }
            resource._bodyUsed = true;
            body = resource._body;
            url = resource.url;
        } else {
            method = (options.method || 'GET').toUpperCase();
            const headers = new Headers(options.headers || {});
            if (!headers.has('Accept')) {
                headers.set('Accept', '*/*');
            }
            for (const [name, value] of headers.entries()) {
                rawHeaders[name] = value;
            }

            mode = options.mode || 'cors';
            referer = options.referrer || 'about:client';
            referrerPolicy = options.referrerPolicy || 'strict-origin-when-cross-origin';
            // let cache = options.cache || 'default';
            credentials = options.credentials || 'same-origin';
            redirect = options.redirect || 'follow';
            signal = options.signal;

            body = options.body;
            url = String(resource);
        }

        // Check if signal is already aborted
        if (signal && signal.aborted) {
            throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
        }

        if (body instanceof FormData) {
            const blob = formDataToBlob(body);
            if (blob.type && blob.type !== '') {
                rawHeaders['content-type'] = blob.type;
            }
            body = await blob.arrayBuffer();
        } else if (body instanceof Blob) {
            if (body.type && body.type !== '') {
                rawHeaders['content-type'] = body.type;
            }
            body = await body.arrayBuffer();
        }

        // Create the fetch promise
        let fetchPromise;
        if (body instanceof ReadableStream) {
            let bodyCreator;
            if (body.locked) throw new TypeError("ReadableStream is locked");
            let used = false;
            bodyCreator = () => {
                if (used) throw new TypeError("Disturbed stream");
                used = true;
                return body;
            };

            fetchPromise = streamingRequest(
                url, method, rawHeaders, version, mode, referer, referrerPolicy, credentials, redirect,
                bodyCreator
            );
        } else {
            // Simple request
            const request = new httpNative.HttpRequest(
                url,
                method,
                rawHeaders,
                version,
                mode,
                referer,
                referrerPolicy,
                credentials,
                redirect
            );

            if (!body) {
                // no body
            } else if (body instanceof ArrayBuffer) {
                request.arrayBufferBody(body);
            } else if (body instanceof DataView) {
                request.uint8ArrayBody(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
            } else if (body instanceof Uint8Array) {
                request.uint8ArrayBody(body);
            } else if (body instanceof URLSearchParams) {
                request.addHeader('Content-Type', 'application/x-www-form-urlencoded');
                request.stringBody(body.toString());
            } else if (typeof body === 'string' || body instanceof String) {
                request.stringBody(body);
            } else {
                console.warn('Unsupported body type');
            }

            fetchPromise = (async () => {
                const nativeResponse = await request.simpleSend();
                return new Response(nativeResponse, request.url, credentials);
            })();
        }

        // If signal is provided, wrap the promise to support abort
        if (signal) {
            fetchPromise = abortableFetch(fetchPromise, signal);
        }

        return fetchPromise;
    })();
}

function abortableFetch(fetchPromise, signal) {
    // Create a race between the fetch and the abort signal
    return Promise.race([
        fetchPromise,
        new Promise((_, reject) => {
            // If signal is already aborted, this won't execute
            if (signal.aborted) {
                reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
            } else {
                // Listen for abort event
                signal.addEventListener('abort', () => {
                    reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
                });
            }
        })
    ]);
}

// Marker tag for body source (ReadableStream/Blob/FormData) errors so the
// streaming request loop can distinguish them from transport errors that may
// arise when the server closes the upload (e.g. on an early redirect).
const BODY_SOURCE_ERROR = Symbol('bodySourceError');

async function sendBody(bodyWriter, body, abortRef) {
    const reader = body.getReader();
    try {
        while (true) {
            if (abortRef.aborted) {
                try { await reader.cancel(); } catch (_) { /* ignore */ }
                return;
            }
            let item;
            try {
                item = await reader.read();
            } catch (err) {
                if (abortRef.aborted) return;
                // Error originating from the body source itself.
                const wrapped = err instanceof Error ? err : new Error(String(err));
                wrapped[BODY_SOURCE_ERROR] = true;
                throw wrapped;
            }
            const {done, value} = item;
            if (done) break;
            if (abortRef.aborted) {
                try { await reader.cancel(); } catch (_) { /* ignore */ }
                return;
            }
            try {
                await bodyWriter.writeRequestBodyChunk(value);
            } catch (err) {
                // Transport/write error. If we've been aborted (e.g. because
                // a redirect arrived), swallow it — the redirect path handles
                // resource cleanup. Otherwise propagate as a regular error.
                if (abortRef.aborted) return;
                throw err;
            }
        }
    } finally {
        try { reader.releaseLock(); } catch (_) { /* ignore */ }
    }
    if (abortRef.aborted) return;
    try {
        bodyWriter.finishBody();
    } catch (err) {
        if (abortRef.aborted) return;
        throw err;
    }
}

async function streamingRequest(
    url, method, headers, version, mode, referer, referrerPolicy, credentials, redirect,
    bodyCreator
) {
    let currentUrl = url;
    let currentMethod = method;
    let currentBodyCreator = bodyCreator;
    let currentHeaders = {...headers};

    const maxRedirects = 20;
    let currentRedirects = 0;

    while (true) {
        const request = new httpNative.HttpRequest(
            currentUrl,
            currentMethod,
            currentHeaders,
            version,
            mode,
            referer,
            referrerPolicy,
            credentials,
            redirect
        );

        request.initSend();
        const bodyWriter = request.initRequestBody();
        request.sendRequest();

        // Track body upload state synchronously so we can inspect it from the
        // redirect path without having to await the upload promise (which may
        // never finish for slow/infinite streaming bodies).
        const abortRef = {aborted: false};
        const bodyState = {settled: false, ok: true, error: undefined};
        let bodyPromise;

        if (currentBodyCreator && (currentMethod !== 'GET' && currentMethod !== 'HEAD')) {
            const bodyStream = currentBodyCreator();
            bodyPromise = sendBody(bodyWriter, bodyStream, abortRef).then(
                () => {
                    bodyState.settled = true;
                    bodyState.ok = true;
                },
                (error) => {
                    bodyState.settled = true;
                    bodyState.ok = false;
                    bodyState.error = error;
                },
            );
        } else {
            bodyWriter.finishBody();
            bodyState.settled = true;
            bodyPromise = Promise.resolve();
        }

        const nativeResponse = await request.receiveResponse();

        const status = nativeResponse.status;
        const isRedirectStatus = status >= 300 && status < 400 && // is redirect
            status !== 304 && // NOT MODIFIED
            status !== 305 && // USE PROXY
            status !== 306; // SWITCH PROXY

        if (isRedirectStatus) {
            // Always surface a body source error that has already manifested
            // before we observed the redirect — those are genuine failures of
            // the user's stream/blob/formdata and should not be silently
            // swallowed even when the server happened to redirect.
            if (bodyState.settled && !bodyState.ok &&
                bodyState.error && bodyState.error[BODY_SOURCE_ERROR]) {
                throw bodyState.error;
            }
            // Otherwise, do NOT await body upload. Servers can legitimately
            // respond with a redirect before consuming the full request body,
            // and slow/infinite streaming bodies must not delay redirect
            // handling. Signal the upload to abort and ignore further errors
            // (transport errors after this point are expected).
            abortRef.aborted = true;
            // Suppress unhandled-rejection noise on the detached promise.
            bodyPromise.catch(() => {});
        } else {
            // Non-redirect: wait for the body upload to complete and propagate
            // any error (whether source-side or transport-side).
            await bodyPromise;
            if (!bodyState.ok) {
                throw bodyState.error;
            }
        }

        // Redirect logic
        if (redirect === 'follow' && isRedirectStatus) {
            if (currentRedirects >= maxRedirects) {
                throw new Error("Maximum number of redirects exceeded");
            }

            const location = nativeResponse.headers.find(h => h[0].toLowerCase() === 'location');
            if (location) {
                const locationUrl = location[1];
                const newUrl = new URL(locationUrl, currentUrl).toString();

                // Handle method changes
                let newMethod = currentMethod;
                let dropBody = false;

                if (status === 303) { // SEE OTHER
                    newMethod = 'GET';
                    dropBody = true;
                } else if ((status === 301 /* MOVED PERMANENTLY */ || status === 302 /* FOUND */) && currentMethod === 'POST') {
                    newMethod = 'GET';
                    dropBody = true;
                }

                if (dropBody) {
                    currentBodyCreator = null;
                    // Remove Content headers
                    delete currentHeaders['content-type'];
                    delete currentHeaders['content-length'];
                    delete currentHeaders['transfer-encoding'];
                }

                currentUrl = newUrl;
                currentMethod = newMethod;
                currentRedirects++;
                continue;
            }
        } else if (redirect === 'error' && isRedirectStatus) {
            throw new Error("Unexpected redirect");
        }

        const response = new Response(nativeResponse, currentUrl, credentials);
        if (currentRedirects > 0) {
            response.nativeResponse.redirected = true;
        }

        if (redirect === 'manual' && isRedirectStatus) {
            response.nativeResponse.makeOpaque();
        }

        return response;
    }
}

export class Response {
    constructor(bodyOrNative, initOrUrl, credentials, isError = false) {
        if (bodyOrNative instanceof httpNative.HttpResponse) {
            // Internal path: constructed from native HttpResponse
            this.nativeResponse = bodyOrNative;
            this.url = initOrUrl || '';
            this.bodyUsed = false;
            this._credentials = credentials || 'same-origin';
            this._isError = isError;
            this._isNative = true;
        } else {
            // Standard Web API path: new Response(body, init)
            const body = bodyOrNative;
            const init = initOrUrl || {};
            this._status = init.status !== undefined ? init.status : 200;
            this._statusText = init.statusText !== undefined ? init.statusText : '';
            this._headers = new Headers(init.headers || {});
            this.url = '';
            this.bodyUsed = false;
            this._credentials = 'same-origin';
            this._isError = false;
            this._isNative = false;
            this._body = body !== undefined && body !== null ? body : null;
        }
    }

    get status() {
        if (this._isNative) {
            return this.nativeResponse.status;
        }
        return this._status;
    }

    get statusText() {
        if (this._isNative) {
            return this.nativeResponse.statusText;
        }
        return this._statusText;
    }

    get body() {
        if (this._isNative) {
            let nativeStreamSourceSlot = {
                nativeStreamSource: undefined
            };
            let response = this;
            return new ReadableStream({
                start() {
                },
                get type() {
                    return "bytes";
                },
                async pull(controller) {
                    if (nativeStreamSourceSlot.nativeStreamSource === undefined) {
                        nativeStreamSourceSlot.nativeStreamSource = response.nativeResponse.stream();
                        response.bodyUsed = true;
                    }

                    const [next, err] = await nativeStreamSourceSlot.nativeStreamSource.pull();
                    if (err !== undefined) {
                        console.error("Error reading response body stream:", err);
                        controller.error(err);
                    } else if (next === undefined) {
                        controller.close();
                    } else {
                        controller.enqueue(next);
                    }
                }
            });
        }

        if (this._body === null) {
            return null;
        }

        const body = this._body;
        if (body instanceof ReadableStream) {
            return body;
        }

        let bytes;
        if (typeof body === 'string' || body instanceof String) {
            bytes = new TextEncoder().encode(body);
        } else if (body instanceof ArrayBuffer) {
            bytes = new Uint8Array(body);
        } else if (body instanceof Uint8Array) {
            bytes = body;
        } else if (body instanceof Blob) {
            return body.stream();
        } else {
            bytes = new TextEncoder().encode(String(body));
        }
        const data = bytes;
        let pulled = false;
        return new ReadableStream({
            pull(controller) {
                if (!pulled) {
                    controller.enqueue(data);
                    pulled = true;
                } else {
                    controller.close();
                }
            }
        });
    }

    get headers() {
        if (this._isNative) {
            const rawHeaders = this.nativeResponse.headers;
            let result = new Headers();
            for (const [name, value] of rawHeaders) {
                if (this._credentials === 'omit' && name.toLowerCase() === 'set-cookie') {
                    continue;
                }
                result.set(name, value);
            }
            return result;
        }
        return this._headers;
    }

    get ok() {
        const s = this._isNative ? this.nativeResponse.status : this._status;
        return s >= 200 && s < 300;
    }

    get redirected() {
        if (this._isNative) {
            return this.nativeResponse.redirected;
        }
        return false;
    }

    get type() {
        if (this._isError) {
            return 'error';
        }
        if (this._isNative) {
            if (this.nativeResponse.isOpaque) {
                if (this.nativeResponse.redirected) {
                    return 'opaqueredirect';
                } else {
                    return 'opaque';
                }
            }
        }
        return 'basic';
    }

    static error() {
        const nativeResponse = httpNative.HttpResponse.error();
        return new Response(nativeResponse, 'about:blank', 'omit', true);
    }

    static redirect(url, status = 302) {
        if (![301, 302, 303, 307, 308].includes(status)) {
            throw new RangeError("Invalid redirect status code");
        }
        const nativeResponse = httpNative.HttpResponse.redirect(url, status);
        return new Response(nativeResponse, url, 'omit');
    }

    static json(data, init = {}) {
        const json = JSON.stringify(data);
        const bytes = new TextEncoder().encode(json);
        const nativeResponse = httpNative.HttpResponse.json(bytes.buffer, init.status || 200);
        if (init.headers) {
            const headers = new Headers(init.headers);
            for (const [key, value] of headers.entries()) {
                nativeResponse.addHeader(key, value);
            }
        }
        return new Response(nativeResponse, 'about:blank', 'omit');
    }

    clone() {
        if (this.bodyUsed) {
            throw new TypeError('Response body is already consumed');
        }

        if (this._isNative) {
            return new Response(this.nativeResponse.clone(), this.url, this._credentials, this._isError);
        }
        const cloned = new Response(this._body, {
            status: this._status,
            statusText: this._statusText,
            headers: this._headers,
        });
        cloned.url = this.url;
        return cloned;
    }

    async formData() {
        const contentType = this.headers.get('Content-Type');
        if (!contentType || !contentType.includes('multipart/form-data')) {
            throw new TypeError('Response is not multipart/form-data');
        }

        const boundaryMatch = contentType.match(/boundary=([^;]+)/);
        if (!boundaryMatch) {
            throw new TypeError('Content-Type header missing boundary');
        }

        const boundary = boundaryMatch[1].replace(/"/g, '').trim();
        const bodyBuffer = await this.arrayBuffer();
        const bodyString = new TextDecoder().decode(bodyBuffer);

        return parseMultipartFormData(bodyString, boundary);
    }

    async arrayBuffer() {
        if (this._isNative) {
            let result = await this.nativeResponse.arrayBuffer();
            this.bodyUsed = true;
            return result;
        }
        this.bodyUsed = true;
        if (this._body === null) {
            return new ArrayBuffer(0);
        }
        if (this._body instanceof ArrayBuffer) {
            return this._body;
        }
        if (this._body instanceof Uint8Array) {
            return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
        }
        if (this._body instanceof Blob) {
            return this._body.arrayBuffer();
        }
        if (this._body instanceof ReadableStream) {
            const reader = this._body.getReader();
            const chunks = [];
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            let totalLength = 0;
            for (const chunk of chunks) totalLength += chunk.byteLength;
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(new Uint8Array(chunk.buffer || chunk), offset);
                offset += chunk.byteLength;
            }
            return result.buffer;
        }
        const text = typeof this._body === 'string' ? this._body : String(this._body);
        return new TextEncoder().encode(text).buffer;
    }

    async blob() {
        return new Blob([await this.arrayBuffer()], {type: this.headers.get('Content-Type') || ''});
    }

    async bytes() {
        return new Uint8Array(await this.arrayBuffer())
    }

    async json() {
        let result = JSON.parse(await this.text());
        this.bodyUsed = true;
        return result;
    }

    async text() {
        if (this._isNative) {
            let result = await this.nativeResponse.text();
            this.bodyUsed = true;
            return result;
        }
        this.bodyUsed = true;
        if (this._body === null) {
            return '';
        }
        if (typeof this._body === 'string') {
            return this._body;
        }
        const buffer = await this.arrayBuffer();
        return new TextDecoder().decode(buffer);
    }
}

function normalizeName(name) {
    const str = typeof name !== 'string' ? String(name) : name;
    if (/[^a-z0-9\-#$%&'*+.^_`|~!]/i.test(str) || str === '') {
        throw new TypeError('Invalid character in header field name: "' + str + '"')
    }
    return str.toLowerCase()
}

function normalizeValue(value) {
    return typeof value !== 'string' ? String(value) : value;
}

function iteratorFor(items) {
    const iterator = {
        next() {
            const value = items.shift();
            return {done: value === undefined, value};
        },
        [Symbol.iterator]() {
            return iterator;
        }
    };
    return iterator;
}

export class Headers {
    constructor(headers) {
        this.map = {}
        this._setCookies = []

        if (headers instanceof Headers) {
            headers.forEach((value, name) => {
                this.append(name, value)
            })
        } else if (Array.isArray(headers)) {
            headers.forEach((header) => {
                if (header.length != 2) {
                    throw new TypeError('Headers constructor: expected name/value pair to be length 2, found' + header.length)
                }
                this.append(header[0], header[1])
            })
        } else if (headers) {
            Object.getOwnPropertyNames(headers).forEach((name) => {
                this.append(name, headers[name])
            })
        }
    }

    append(name, value) {
        name = normalizeName(name)
        value = normalizeValue(value)
        if (name === 'set-cookie') {
            this._setCookies.push(value)
            this.map[name] = this._setCookies.join(', ')
        } else {
            const oldValue = this.map[name]
            this.map[name] = oldValue ? oldValue + ', ' + value : value
        }
    }

    delete(name) {
        name = normalizeName(name)
        if (name === 'set-cookie') {
            this._setCookies = []
        }
        delete this.map[name]
    }

    get(name) {
        name = normalizeName(name)
        return this.has(name) ? this.map[name] : null
    }

    getSetCookie() {
        return this._setCookies.slice()
    }

    has(name) {
        return this.map.hasOwnProperty(normalizeName(name))
    }

    set(name, value) {
        name = normalizeName(name)
        value = normalizeValue(value)
        if (name === 'set-cookie') {
            this._setCookies = [value]
        }
        this.map[name] = value
    }

    forEach(callback, thisArg) {
        for (const [name, value] of Object.entries(this.map)) {
            callback.call(thisArg, value, name, this)
        }
    }

    keys() {
        const items = []
        this.forEach((value, name) => {
            items.push(name)
        })
        return iteratorFor(items)
    }

    values() {
        const items = []
        this.forEach((value) => {
            items.push(value)
        })
        return iteratorFor(items)
    }

    entries() {
        const items = []
        this.forEach((value, name) => {
            items.push([name, value])
        })
        return iteratorFor(items)
    }

    [Symbol.iterator]() {
        return this.entries()
    }
}

export class Request {
    constructor(input, options = {}) {
        if (input instanceof Request) {
            this._url = input._url;
            this._headers = new Headers(input._headers);
            this._bodyUsed = false;
            this._options = {
                body: input.bytes().slice(),
                ...input._options,
            };
        } else {
            this._url = typeof input === 'string' ? input : String(input);
            this._headers = new Headers(options.headers || {});
            this._bodyUsed = false;
            this._options = {
                ...options,
            };
            this._body = options.body;
        }
    }

    get body() {
        this._bodyUsed = true;
        if (this._body instanceof ReadableStream) {
            return this._body;
        } else if (this._body instanceof FormData) {
            const blob = formDataToBlob(this._body);
            return blob.stream();
        } else if (this._body instanceof Blob) {
            return this._body.stream();
        } else if (this._body instanceof URLSearchParams) {
            const blob = new Blob([this._body.toString()]);
            return blob.stream();
        } else if (this._body instanceof ArrayBuffer) {
            const blob = new Blob([this._body]);
            return blob.stream();
        } else if (this._body instanceof DataView) {
            const blob = new Blob([this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength)]);
            return blob.stream();
        } else if (this._body instanceof Uint8Array) {
            const blob = new Blob([this._body]);
            return blob.stream();
        } else if (typeof this._body === 'string' || this._body instanceof String) {
            const blob = new Blob([this._body]);
            return blob.stream();
        } else {
            console.warn('Unsupported body type');
            return new Blob([]).stream();
        }
    }

    get bodyUsed() {
        return this._bodyUsed;
    }

    get cache() {
        return this._options.cache ?? 'default';
    }

    get credentials() {
        return this._options.credentials ?? 'same-origin';
    }

    get destination() {
        return '';
    }

    get duplex() {
        return this._options.duplex ?? 'half';
    }

    get headers() {
        return this._headers;
    }

    get integrity() {
        return this._options.integrity ?? '';
    }

    get isHistoryNavigation() {
        return false;
    }

    get keepalive() {
        return this._options.keepalive ?? false;
    }

    get method() {
        return this._options.method ?? 'GET';
    }

    get mode() {
        return this._options.mode ?? 'cors';
    }

    get redirect() {
        return this._options.redirect ?? 'follow';
    }

    get referrer() {
        return this._options.referrer ?? 'about:client';
    }

    get referrerPolicy() {
        return this._options.referrerPolicy ?? '';
    }

    get signal() {
        return this._options.signal;
    }

    get url() {
        return this._url;
    }

    async arrayBuffer() {
        this._bodyUsed = true;
        if (this._body instanceof ReadableStream) {
            return await streamToArrayBuffer(this._body);
        } else if (this._body instanceof FormData) {
            const blob = formDataToBlob(this._body);
            return blob.arrayBuffer();
        } else if (this._body instanceof Blob) {
            return this._body.arrayBuffer();
        } else if (this._body instanceof URLSearchParams) {
            return new TextEncoder().encode(this._body.toString()).buffer;
        } else if (this._body instanceof ArrayBuffer) {
            return this._body;
        } else if (this._body instanceof DataView) {
            return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
        } else if (this._body instanceof Uint8Array) {
            return this._body.buffer;
        } else if (typeof this._body === 'string' || this._body instanceof String) {
            return new TextEncoder().encode(this._body).buffer;
        } else {
            console.warn('Unsupported body type');
            return new ArrayBuffer(0);
        }
    }

    async blob() {
        this._bodyUsed = true;
        if (this._body instanceof ReadableStream) {
            return await streamToBlob(this._body);
        } else if (this._body instanceof FormData) {
            const blob = formDataToBlob(this._body);
            return blob;
        } else if (this._body instanceof Blob) {
            return this._body;
        } else if (this._body instanceof URLSearchParams) {
            return new Blob([this._body.toString()]);
        } else if (this._body instanceof ArrayBuffer) {
            return new Blob([this._body]);
        } else if (this._body instanceof DataView) {
            return new Blob([this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength)]);
        } else if (this._body instanceof Uint8Array) {
            return new Blob([this._body]);
        } else if (typeof this._body === 'string' || this._body instanceof String) {
            return new Blob([this._body]);
        } else {
            console.warn('Unsupported body type');
            return new Blob([]);
        }
    }

    async bytes() {
        this._bodyUsed = true;
        if (this._body instanceof ReadableStream) {
            return new Uint8Array(await streamToArrayBuffer(this._body));
        } else if (this._body instanceof FormData) {
            const blob = formDataToBlob(this._body);
            return blob.bytes();
        } else if (this._body instanceof Blob) {
            return this._body.bytes();
        } else if (this._body instanceof URLSearchParams) {
            return new TextEncoder().encode(this._body.toString());
        } else if (this._body instanceof ArrayBuffer) {
            return new Uint8Array(this._body);
        } else if (this._body instanceof DataView) {
            return new Uint8Array(this._body.buffer, this._body.byteOffset, this._body.byteLength);
        } else if (this._body instanceof Uint8Array) {
            return this._body;
        } else if (typeof this._body === 'string' || this._body instanceof String) {
            return new TextEncoder().encode(this._body);
        } else {
            console.warn('Unsupported body type');
            return new Uint8Array(0);
        }
    }

    clone() {
        return new Request(this);
    }

    async formData() {
        this._bodyUsed = true;
        if (this._body instanceof FormData) {
            return this._body;
        } else {
            throw new Error('Body is not FormData');
        }
    }

    async json() {
        return JSON.parse(await this.text());
    }

    async text() {
        return (await this.blob()).text();
    }
}

async function streamToArrayBuffer(stream) {
    const chunks = [];
    const reader = stream.getReader();

    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);          // value is Uint8Array
        }
    } finally {
        reader.releaseLock();
    }

    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result.buffer;
}

async function streamToBlob(stream) {
    const chunks = [];
    const reader = stream.getReader();

    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    return new Blob(chunks);
}

function parseMultipartFormData(bodyString, boundary) {
    const formData = new FormData();
    const boundaryDelimiter = `--${boundary}`;
    const parts = bodyString.split(boundaryDelimiter);

    // Skip first empty part (before first boundary) and last part (after closing boundary)
    for (let i = 1; i < parts.length - 1; i++) {
        const part = parts[i];

        // Remove leading \r\n
        let cleanPart = part.startsWith('\r\n') ? part.slice(2) : part;
        if (cleanPart.startsWith('\n')) {
            cleanPart = cleanPart.slice(1);
        }

        // Find the double CRLF that separates headers from body
        const headerEndIndex = cleanPart.indexOf('\r\n\r\n');
        if (headerEndIndex === -1) {
            // Try with just \n\n
            const headerEndIndexLF = cleanPart.indexOf('\n\n');
            if (headerEndIndexLF === -1) {
                continue;
            }
            const headers = cleanPart.substring(0, headerEndIndexLF);
            let body = cleanPart.substring(headerEndIndexLF + 2);
            // Remove trailing \r\n or \n
            if (body.endsWith('\r\n')) {
                body = body.slice(0, -2);
            } else if (body.endsWith('\n')) {
                body = body.slice(0, -1);
            }
            addPartToFormData(formData, headers, body);
        } else {
            const headers = cleanPart.substring(0, headerEndIndex);
            let body = cleanPart.substring(headerEndIndex + 4);
            // Remove trailing \r\n
            if (body.endsWith('\r\n')) {
                body = body.slice(0, -2);
            }
            addPartToFormData(formData, headers, body);
        }
    }

    return formData;
}

function addPartToFormData(formData, headers, body) {
     // Parse Content-Disposition header
     const dispositionMatch = headers.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
     if (!dispositionMatch) {
         return;
     }
 
     const fieldName = dispositionMatch[1];
     const filename = dispositionMatch[2];
 
     // Check if this is a file upload (has filename) or regular form field
     if (filename) {
         // This is a file - extract Content-Type if available
         const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
         const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
 
         // Convert body string to Uint8Array for binary data
         const bodyBytes = new TextEncoder().encode(body);
         const blob = new Blob([bodyBytes], {type: contentType});
         const file = new File([blob], filename, {type: contentType});
         formData.append(fieldName, file);
     } else {
         // Regular form field - append as string
         formData.append(fieldName, body);
     }
 }

// XMLHttpRequest implementation based on fetch API
// MDN Spec: https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest

export class XMLHttpRequest {
     constructor() {
         // ReadyState constants
         this.UNSENT = 0;
         this.OPENED = 1;
         this.HEADERS_RECEIVED = 2;
         this.LOADING = 3;
         this.DONE = 4;

         // State management
         this.readyState = this.UNSENT;
         this.status = 0;
         this.statusText = '';
         this.response = null;
         this.responseText = '';
         this.responseType = '';
         this.responseURL = '';

         // Request properties
         this._method = '';
         this._url = '';
         this._async = true;
         this._username = '';
         this._password = '';
         this._requestHeaders = {};
         this._requestBody = null;
         this._abortController = null;
         this._responseHeaders = {};
         this._sent = false;

         // Event handlers
         this.onreadystatechange = null;
         this.onload = null;
         this.onerror = null;
         this.onabort = null;
         this.onloadstart = null;
         this.onprogress = null;
         this.onloadend = null;
         this.ontimeout = null;

         // Timeout
         this.timeout = 0;
         this._timeoutId = null;

         // Event listeners (for addEventListener/removeEventListener)
         this._listeners = {};
         this._aborted = false;
     }

     open(method, url, async = true, username = '', password = '') {
         if (this.readyState !== this.UNSENT && this._sent) {
             throw new Error('XMLHttpRequest: cannot open connection when request is already sent');
         }

         this._method = method.toUpperCase();
         this._url = url;
         this._async = async;
         this._username = username;
         this._password = password;
         this._requestHeaders = {};
         this._requestBody = null;
         this._responseHeaders = {};
         this._sent = false;
         this._aborted = false;

         this._setReadyState(this.OPENED);
     }

     setRequestHeader(name, value) {
         if (this.readyState !== this.OPENED) {
             throw new Error('XMLHttpRequest: cannot set header when not in OPENED state');
         }
         if (this._sent) {
             throw new Error('XMLHttpRequest: cannot set header after send');
         }

         // Normalize header name
         const normalizedName = String(name);
         this._requestHeaders[normalizedName] = String(value);
     }

     send(body = null) {
         if (this.readyState !== this.OPENED) {
             throw new Error('XMLHttpRequest: cannot send when not in OPENED state');
         }
         if (this._sent) {
             throw new Error('XMLHttpRequest: cannot send request twice');
         }

         this._sent = true;
         this._requestBody = body;

         // Dispatch loadstart event
         this._dispatchEvent('loadstart');

         // Execute the fetch request
         if (this._async) {
             this._sendAsync();
         } else {
             // Note: Synchronous XHR is not practical in WASM/async context
             // We simulate it by using synchronous-like behavior, but this is not true synchronous
             this._sendAsync();
         }

         // Set timeout if specified
         if (this.timeout > 0) {
             this._timeoutId = setTimeout(() => {
                 this._timeoutId = null;
                 if (this.readyState !== this.DONE && !this._aborted) {
                     this._aborted = true;
                     this._abortController?.abort();
                     this._setReadyState(this.DONE);
                     this._dispatchEvent('timeout');
                     this._dispatchEvent('loadend');
                 }
             }, this.timeout);
         }
     }

     async _sendAsync() {
         try {
             // Prepare fetch options
             const fetchOptions = {
                 method: this._method,
                 headers: this._requestHeaders,
             };

             // Add credentials if provided
             if (this._username || this._password) {
                 // Note: Basic auth implementation
                 const credentialsStr = `${this._username}:${this._password}`;
                 const credentialsBytes = new TextEncoder().encode(credentialsStr);
                 const credentialsB64 = base64.fromByteArray(credentialsBytes);
                 fetchOptions.headers['Authorization'] = `Basic ${credentialsB64}`;
             }

             // Add body if present and not a GET/HEAD request
             if (this._requestBody && this._method !== 'GET' && this._method !== 'HEAD') {
                 if (typeof this._requestBody === 'string') {
                     fetchOptions.body = this._requestBody;
                 } else if (this._requestBody instanceof Blob) {
                     fetchOptions.body = this._requestBody;
                 } else if (this._requestBody instanceof FormData) {
                     fetchOptions.body = this._requestBody;
                 } else if (this._requestBody instanceof ArrayBuffer) {
                     fetchOptions.body = this._requestBody;
                 } else if (this._requestBody instanceof Uint8Array) {
                     fetchOptions.body = this._requestBody;
                 } else if (this._requestBody instanceof URLSearchParams) {
                     fetchOptions.body = this._requestBody;
                 } else {
                     fetchOptions.body = String(this._requestBody);
                 }
             }

             // Create abort controller for abort support
             this._abortController = new AbortController();
             fetchOptions.signal = this._abortController.signal;

             // Update readyState to HEADERS_RECEIVED (once fetch completes header phase)
             // Note: fetch doesn't have a true headers-received event, so we approximate
             this._setReadyState(this.HEADERS_RECEIVED);

             const response = await fetch(this._url, fetchOptions);

             // If aborted, don't process response
             if (this._aborted) return;

             // Clear timeout if request completed
             if (this._timeoutId) {
                 clearTimeout(this._timeoutId);
                 this._timeoutId = null;
             }

             // Parse response headers
             this._parseResponseHeaders(response);

             // Update status and statusText
             this.status = response.status;
             this.statusText = response.statusText;
             this.responseURL = response.url;

             // Update readyState to LOADING
             this._setReadyState(this.LOADING);

             // Handle different response types
             let responseData;
             if (this.responseType === '' || this.responseType === 'text') {
                 responseData = await response.text();
                 this.response = responseData;
                 this.responseText = responseData;
             } else if (this.responseType === 'arraybuffer') {
                 responseData = await response.arrayBuffer();
                 this.response = responseData;
             } else if (this.responseType === 'blob') {
                 responseData = await response.blob();
                 this.response = responseData;
             } else if (this.responseType === 'json') {
                 responseData = await response.json();
                 this.response = responseData;
             } else if (this.responseType === 'document') {
                 // Not fully supported in WASM, return as text
                 responseData = await response.text();
                 this.response = responseData;
             } else {
                 responseData = await response.text();
                 this.response = responseData;
                 this.responseText = responseData;
             }

             // Update readyState to DONE
             this._setReadyState(this.DONE);

             // Dispatch load and loadend events
             this._dispatchEvent('load');
             this._dispatchEvent('loadend');
         } catch (error) {
             // Clear timeout on error
             if (this._timeoutId) {
                 clearTimeout(this._timeoutId);
                 this._timeoutId = null;
             }

             // Check if error is due to abort
             if (this._aborted || (error instanceof DOMException && error.name === 'AbortError')) {
                 // Abort was already handled by abort() method
                 return;
             } else {
                 this.status = 0;
                 this.statusText = '';
                 this._setReadyState(this.DONE);
                 this._dispatchEvent('error');
                 this._dispatchEvent('loadend');
             }
         }
     }

     abort() {
         this._aborted = true;
         if (this._abortController) {
             this._abortController.abort();
         }
         if (this._timeoutId) {
             clearTimeout(this._timeoutId);
             this._timeoutId = null;
         }
         this._sent = false;
         this._setReadyState(this.DONE);
         this._dispatchEvent('abort');
         this._dispatchEvent('loadend');
     }

     getResponseHeader(name) {
         if (this.readyState < this.HEADERS_RECEIVED) {
             return null;
         }
         const lowerName = name.toLowerCase();
         for (const [key, value] of Object.entries(this._responseHeaders)) {
             if (key.toLowerCase() === lowerName) {
                 return value;
             }
         }
         return null;
     }

     getAllResponseHeaders() {
         if (this.readyState < this.HEADERS_RECEIVED) {
             return '';
         }
         let headerString = '';
         for (const [name, value] of Object.entries(this._responseHeaders)) {
             headerString += `${name}: ${value}\r\n`;
         }
         return headerString;
     }

     overrideMimeType(mimeType) {
         // In a real implementation, this would affect how the response is parsed
         // For now, we store it but don't use it
         this._mimeType = mimeType;
     }

     _parseResponseHeaders(response) {
         this._responseHeaders = {};
         for (const [name, value] of response.headers.entries()) {
             this._responseHeaders[name] = value;
         }
     }

     _setReadyState(state) {
         if (this.readyState !== state) {
             this.readyState = state;
             this._dispatchEvent('readystatechange');
         }
     }

     _dispatchEvent(eventType) {
         const evt = { type: eventType, target: this, currentTarget: this };

         // Call property handler (e.g., onreadystatechange, onerror, etc.)
         const propertyHandler = this['on' + eventType];
         if (typeof propertyHandler === 'function') {
             try {
                 propertyHandler.call(this, evt);
             } catch (e) {
                 queueMicrotask(() => { throw e; });
             }
         }

         // Call registered event listeners
         const listeners = this._listeners[eventType];
         if (listeners) {
             // Copy to avoid mutation during iteration
             const listenersCopy = [...listeners];
             for (const { listener, once } of listenersCopy) {
                 try {
                     listener.call(this, evt);
                 } catch (e) {
                     queueMicrotask(() => { throw e; });
                 }
                 if (once) {
                     this.removeEventListener(eventType, listener);
                 }
             }
         }
     }

     addEventListener(type, listener, options = {}) {
         if (typeof listener !== 'function') return;
         if (!this._listeners[type]) {
             this._listeners[type] = [];
         }
         this._listeners[type].push({
             listener,
             once: !!(options && options.once)
         });
     }

     removeEventListener(type, listener) {
         if (!this._listeners[type]) return;
         this._listeners[type] = this._listeners[type].filter(l => l.listener !== listener);
     }

     dispatchEvent(event) {
         if (event && event.type) {
             this._dispatchEvent(event.type);
         }
         return true;
     }
 }
