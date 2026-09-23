import { create_job, start_job, wait_job_event, cancel_job, forget_job } from '__wasm_rquickjs_builtin/execution_native';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { resolve } from 'node:path';
import { deserializeFromTransport } from '__wasm_rquickjs_builtin/structured_clone';

const MAX_TIMEOUT_MS = 18_446_744_073_709;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function invalidType(name, expected, value) {
  const error = new TypeError(`The "${name}" option must be ${expected}. Received ${String(value)}`);
  error.code = 'ERR_INVALID_ARG_TYPE';
  return error;
}

function outOfRange(name, range, value) {
  const error = new RangeError(`The value of "${name}" is out of range. It must be ${range}. Received ${value}`);
  error.code = 'ERR_OUT_OF_RANGE';
  return error;
}

function normalize(options) {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  const hasEntry = Object.hasOwn(options, 'entry');
  const hasSource = Object.hasOwn(options, 'source');
  if (hasEntry === hasSource) throw new TypeError('exactly one of entry or source is required');
  if (hasEntry && typeof options.entry !== 'string')
    throw invalidType('entry', 'a string', options.entry);
  if (hasSource && typeof options.source !== 'string')
    throw invalidType('source', 'a string', options.source);
  const language = options.language ?? 'javascript';
  if (language !== 'javascript' && language !== 'typescript')
    throw new TypeError('language must be javascript or typescript');
  if (hasEntry && options.language !== undefined)
    throw new TypeError('language is only supported with source');
  const cwd = options.cwd ?? process.cwd();
  if (typeof cwd !== 'string') throw invalidType('cwd', 'a string', cwd);
  const argv = options.argv ?? [];
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string'))
    throw invalidType('argv', 'an array of strings', argv);
  const env = options.env ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env) ||
      Object.values(env).some(value => typeof value !== 'string'))
    throw invalidType('env', 'an object with string values', env);
  const timeoutMs = options.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1))
    throw invalidType('timeoutMs', 'a positive safe integer', timeoutMs);
  if (timeoutMs > MAX_TIMEOUT_MS)
    throw outOfRange('timeoutMs', `<= ${MAX_TIMEOUT_MS}`, timeoutMs);
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes)) throw invalidType('maxBytes', 'a positive safe integer', maxBytes);
  if (maxBytes <= 0 || maxBytes > MAX_OUTPUT_BYTES)
    throw outOfRange('maxBytes', `>= 1 && <= ${MAX_OUTPUT_BYTES}`, maxBytes);
  const overflow = options.overflow ?? 'terminate';
  if (overflow !== 'terminate' && overflow !== 'truncate') throw new TypeError('overflow must be terminate or truncate');
  return {
    entry: options.entry, source: options.source, language, cwd: resolve(cwd),
    argv, env, timeoutMs, maxBytes, overflow,
  };
}

export function startJavaScript(options) {
  const optionsJson = JSON.stringify(normalize(options));
  const id = create_job(optionsJson);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let settled = false;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const fail = error => {
    if (settled) return;
    settled = true;
    stdout.destroy();
    stderr.destroy();
    cancel_job(id);
    forget_job(id);
    rejectResult(error);
  };
  // Deliberately do not await: calling an async native function creates a
  // rquickjs-owned promise immediately, while this public function stays sync.
  // Completion and output are observed through the job registry below.
  start_job(id).catch(fail);
  const drain = async () => {
    while (!settled) {
      const state = JSON.parse(await wait_job_event(id));
      for (const chunk of state.stdout) stdout.write(chunk);
      for (const chunk of state.stderr) stderr.write(chunk);
      if (!state.done) continue;
      settled = true;
      stdout.end(); stderr.end(); forget_job(id);
      if (state.error !== null) rejectResult(new Error(state.error));
      else {
        try {
          const completed = { value: deserializeFromTransport(state.value), overflowed: state.overflowed };
          if (state.profile !== undefined) completed.profile = state.profile;
          resolveResult(completed);
        }
        catch (error) { rejectResult(error); }
      }
    }
  };
  drain().catch(fail);
  return { stdout, stderr, result, cancel: () => cancel_job(id) };
}

export async function runJavaScript(options) {
  const job = startJavaScript(options);
  let stdout = '';
  let stderr = '';
  job.stdout.setEncoding('utf8'); job.stderr.setEncoding('utf8');
  job.stdout.on('data', chunk => { stdout += chunk; });
  job.stderr.on('data', chunk => { stderr += chunk; });
  const [structured] = await Promise.all([job.result, finished(job.stdout), finished(job.stderr)]);
  return { stdout, stderr, ...structured };
}

export default { startJavaScript, runJavaScript };
