import { inspect, innerDeepEqual } from 'node:util';
import fs from 'node:fs';
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE, ERR_INVALID_RETURN_VALUE, ERR_MISSING_ARGS } from '__wasm_rquickjs_builtin/internal/errors';

const inspectDiffOptions = {
    depth: 1000,
    compact: false,
    sorted: true,
    getters: true,
    customInspect: false,
    showHidden: false,
    showProxy: false,
};

function inspectForDiff(value) {
    return inspect(value, inspectDiffOptions);
}

function isError(e) {
    return e instanceof Error ||
        (e !== null && typeof e === 'object' && Object.prototype.toString.call(e) === '[object Error]');
}

function copyError(source) {
    const target = Object.assign(
        { __proto__: Object.getPrototypeOf(source) },
        source,
    );
    Object.defineProperty(target, 'message', {
        value: source.message,
    });
    delete target.stack;
    if (Object.prototype.hasOwnProperty.call(source, 'cause')) {
        let cause = source.cause;
        if (isError(cause)) {
            cause = copyError(cause);
        }
        Object.defineProperty(target, 'cause', { value: cause });
    }
    return target;
}

const ESCAPE_SEQUENCES_REGEXP = /[\x00-\x09\x0B\x0C\x0E-\x1F]/g;

function escapeControlCharacter(char) {
    switch (char) {
        case '\\b':
            return '\\\\b';
        case '\\t':
            return '\\\\t';
        case '\\n':
            return '\\\\n';
        case '\\v':
            return '\\\\v';
        case '\\f':
            return '\\\\f';
        case '\\r':
            return '\\\\r';
        default:
            return '\\\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    }
}

function isIdentifierPartCharacter(char) {
    if (!char) {
        return false;
    }

    const code = char.charCodeAt(0);
    return (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 36 ||
        code > 0x7f;
}

function normalizeExpressionIndentation(expression) {
    if (typeof expression !== 'string' || expression.indexOf('\n') === -1) {
        return expression;
    }

    const lines = expression.split('\n');
    let minContinuationIndent = Infinity;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) {
            continue;
        }

        let indent = 0;
        while (indent < line.length && line.charAt(indent) === ' ') {
            indent++;
        }

        if (indent < minContinuationIndent) {
            minContinuationIndent = indent;
        }
    }

    if (!isFinite(minContinuationIndent) || minContinuationIndent <= 2) {
        return expression;
    }

    const removeIndent = minContinuationIndent - 2;
    for (let j = 1; j < lines.length; j++) {
        const currentLine = lines[j];
        let removed = 0;
        while (removed < removeIndent && removed < currentLine.length && currentLine.charAt(removed) === ' ') {
            removed++;
        }
        lines[j] = currentLine.slice(removed);
    }

    return lines.join('\n');
}

function normalizeExtractedExpression(expression) {
    let normalizedExpression = normalizeExpressionIndentation(expression);
    return normalizedExpression.replace(/^(?:assert|strict)\s*\n\s*\.\s*/, '');
}

function isInsideQuotedSection(source, index) {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < index; i++) {
        const char = source.charAt(i);
        const nextChar = i + 1 < source.length ? source.charAt(i + 1) : '';

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
            }
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (escaped) {
            escaped = false;
            continue;
        }

        if (inSingleQuote) {
            if (char === '\\') {
                escaped = true;
            } else if (char === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inTemplateLiteral) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '`') {
                inTemplateLiteral = false;
            }
            continue;
        }

        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (char === "'") {
            inSingleQuote = true;
            continue;
        }
        if (char === '"') {
            inDoubleQuote = true;
            continue;
        }
        if (char === '`') {
            inTemplateLiteral = true;
        }
    }

    return inSingleQuote || inDoubleQuote || inTemplateLiteral || inLineComment || inBlockComment;
}

function extractNamedCallExpression(sourceSnippet, names, preferLast) {
    let lastExpression = '';

    for (let nameIdx = 0; nameIdx < names.length; nameIdx++) {
        const name = names[nameIdx];
        let searchOffset = 0;

        while (searchOffset < sourceSnippet.length) {
            const start = sourceSnippet.indexOf(name, searchOffset);
            if (start < 0) {
                break;
            }

            if (isInsideQuotedSection(sourceSnippet, start)) {
                searchOffset = start + name.length;
                continue;
            }

            const previous = start > 0 ? sourceSnippet.charAt(start - 1) : '';
            if (isIdentifierPartCharacter(previous) || previous === '.') {
                searchOffset = start + name.length;
                continue;
            }

            const openParenIndex = sourceSnippet.indexOf('(', start + name.length);
            if (openParenIndex < 0) {
                break;
            }

            if (openParenIndex - start > 80) {
                searchOffset = start + name.length;
                continue;
            }

            const closeParenIndex = findMatchingParenEnd(sourceSnippet, openParenIndex);
            if (closeParenIndex < 0) {
                searchOffset = start + name.length;
                continue;
            }

            const expression = sourceSnippet.slice(start, closeParenIndex + 1).trim();
            if (expression && expression.charAt(0) !== '(') {
                const normalizedExpression = normalizeExtractedExpression(expression);
                if (!preferLast) {
                    return normalizedExpression;
                }

                lastExpression = normalizedExpression;
            }

            searchOffset = start + name.length;
        }
    }

    return lastExpression;
}

function areDiffLinesEqual(actualLine, expectedLine, checkCommaDisparity) {
    if (actualLine === expectedLine) {
        return true;
    }

    if (checkCommaDisparity) {
        return (actualLine + ',') === expectedLine || actualLine === (expectedLine + ',');
    }

    return false;
}

function myersBacktrack(trace, actual, expected, checkCommaDisparity) {
    let actualLength = actual.length;
    let expectedLength = expected.length;
    let max = actualLength + expectedLength;
    let x = actualLength;
    let y = expectedLength;
    const result = [];

    for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
        let v = trace[diffLevel];
        let diagonalIndex = x - y;
        let offset = diagonalIndex + max;

        let prevDiagonalIndex;
        if (diagonalIndex === -diffLevel || (diagonalIndex !== diffLevel && v[offset - 1] < v[offset + 1])) {
            prevDiagonalIndex = diagonalIndex + 1;
        } else {
            prevDiagonalIndex = diagonalIndex - 1;
        }

        const prevX = v[prevDiagonalIndex + max];
        const prevY = prevX - prevDiagonalIndex;

        while (x > prevX && y > prevY) {
            const actualItem = actual[x - 1];
            const value = (!checkCommaDisparity || actualItem.endsWith(',')) ? actualItem : expected[y - 1];
            result.push({ type: 'nop', value: value });
            x--;
            y--;
        }

        if (diffLevel > 0) {
            if (x > prevX) {
                result.push({ type: 'insert', value: actual[x - 1] });
                x--;
            } else {
                result.push({ type: 'delete', value: expected[y - 1] });
                y--;
            }
        }
    }

    return result;
}

function myersDiff(actual, expected, checkCommaDisparity) {
    const actualLength = actual.length;
    const expectedLength = expected.length;
    const max = actualLength + expectedLength;
    const v = new Int32Array(2 * max + 1);
    const trace = [];

    for (let diffLevel = 0; diffLevel <= max; diffLevel++) {
        trace.push(v.slice());

        for (let diagonalIndex = -diffLevel; diagonalIndex <= diffLevel; diagonalIndex += 2) {
            const offset = diagonalIndex + max;
            const previousOffset = v[offset - 1];
            const nextOffset = v[offset + 1];

            let x;
            if (diagonalIndex === -diffLevel || (diagonalIndex !== diffLevel && previousOffset < nextOffset)) {
                x = nextOffset;
            } else {
                x = previousOffset + 1;
            }

            let y = x - diagonalIndex;
            while (x < actualLength && y < expectedLength && areDiffLinesEqual(actual[x], expected[y], checkCommaDisparity)) {
                x++;
                y++;
            }

            v[offset] = x;
            if (x >= actualLength && y >= expectedLength) {
                return myersBacktrack(trace, actual, expected, checkCommaDisparity);
            }
        }
    }

    return [];
}

function printMyersDiff(diffEntries) {
    const rendered = [];
    let skipped = false;
    let nopCount = 0;
    const kNopLinesToCollapse = 5;

    for (let diffIdx = diffEntries.length - 1; diffIdx >= 0; diffIdx--) {
        const diffEntry = diffEntries[diffIdx];
        const previousType = diffIdx < diffEntries.length - 1 ? diffEntries[diffIdx + 1].type : null;

        if (previousType === 'nop' && diffEntry.type !== previousType) {
            if (nopCount === kNopLinesToCollapse + 1) {
                rendered.push('  ' + diffEntries[diffIdx + 1].value);
            } else if (nopCount === kNopLinesToCollapse + 2) {
                rendered.push('  ' + diffEntries[diffIdx + 2].value);
                rendered.push('  ' + diffEntries[diffIdx + 1].value);
            } else if (nopCount >= kNopLinesToCollapse + 3) {
                rendered.push('...');
                rendered.push('  ' + diffEntries[diffIdx + 1].value);
                skipped = true;
            }

            nopCount = 0;
        }

        if (diffEntry.type === 'insert') {
            rendered.push('+ ' + diffEntry.value);
        } else if (diffEntry.type === 'delete') {
            rendered.push('- ' + diffEntry.value);
        } else if (diffEntry.type === 'nop') {
            if (nopCount < kNopLinesToCollapse) {
                rendered.push('  ' + diffEntry.value);
            }
            nopCount++;
        }
    }

    // Flush trailing NOP run (when the sequence ends with or is entirely NOPs)
    if (nopCount > kNopLinesToCollapse) {
        if (nopCount === kNopLinesToCollapse + 1) {
            rendered.push('  ' + diffEntries[0].value);
        } else if (nopCount === kNopLinesToCollapse + 2) {
            rendered.push('  ' + diffEntries[1].value);
            rendered.push('  ' + diffEntries[0].value);
        } else if (nopCount >= kNopLinesToCollapse + 3) {
            rendered.push('...');
            rendered.push('  ' + diffEntries[0].value);
            skipped = true;
        }
    }

    return { message: rendered.join('\n'), skipped: skipped };
}

function normalizeStackFrameFormatting(stack) {
    if (typeof stack !== 'string') {
        return stack;
    }

    let lines = stack.split('\n');
    const normalizedLines = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (/^\s*at\s+apply\s+\(native\)\s*$/.test(line)) {
            continue;
        }

        const bareFrameMatch = line.match(/^(\s*at)\s+(.+):(\d+):(\d+)\s*$/);
        if (!bareFrameMatch) {
            normalizedLines.push(line);
            continue;
        }

        const location = bareFrameMatch[2];
        normalizedLines.push(
            bareFrameMatch[1] + ' anonymous (' + location + ':' + bareFrameMatch[3] + ':' + bareFrameMatch[4] + ')'
        );
    }

    return normalizedLines.join('\n');
}

function parseStackFrames(stack) {
    if (typeof stack !== 'string') {
        return [];
    }

    let frames = [];
    const lines = stack.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let match = line.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
        if (!match) {
            match = line.match(/^at\s+(.+):(\d+):(\d+)$/);
            if (match) {
                frames.push({
                    functionName: '',
                    fileName: match[1],
                    lineNumber: Number(match[2]),
                    columnNumber: Number(match[3])
                });
            }
            continue;
        }

        frames.push({
            functionName: match[1],
            fileName: match[2],
            lineNumber: Number(match[3]),
            columnNumber: Number(match[4])
        });
    }

    return frames;
}

function resolveSourceForFrame(frame, currentModuleSource) {
    if (!frame || typeof frame.fileName !== 'string') {
        return undefined;
    }

    if (frame.fileName.startsWith('<') && frame.fileName !== '<input>') {
        return undefined;
    }

    // Eval/Function contexts should not use the current module source
    if (frame.fileName === '[eval]' || frame.fileName === 'eval' ||
        frame.fileName.startsWith('[eval') || frame.fileName === 'anonymous') {
        return undefined;
    }

    if (!frame.fileName.startsWith('<')) {
        try {
            const fileSource = fs.readFileSync(frame.fileName, 'utf8');
            if (typeof fileSource === 'string') {
                return fileSource;
            }
        } catch (err) {
            // Fall through to current module source.
        }
    }

    if (typeof currentModuleSource === 'string') {
        return currentModuleSource;
    }

    return undefined;
}

function shouldSkipStackFrame(frame, stackStartFnName) {
    if (!frame) {
        return true;
    }
    if (frame.fileName === 'native' || frame.fileName.startsWith('node:')) {
        return true;
    }

    const functionName = frame.functionName;
    if (functionName === 'getErrMessage' || functionName === 'innerOk' || functionName === 'ok') {
        return true;
    }
    if (stackStartFnName && functionName === stackStartFnName) {
        return true;
    }

    return false;
}

function expressionRelevanceScore(expression, stackStartFnName) {
    if (!expression) {
        return -1;
    }

    if (!stackStartFnName) {
        return 0;
    }

    let score = 0;
    const hasNameReference = expression.indexOf(stackStartFnName) !== -1;
    if (hasNameReference) {
        if (expression.startsWith(stackStartFnName + '(')) {
            score += 5;
        }
        if (expression.indexOf('.' + stackStartFnName + '(') !== -1) {
            score += 4;
        }
        if (expression.indexOf("['" + stackStartFnName + "']") !== -1 || expression.indexOf('["' + stackStartFnName + '"]') !== -1) {
            score += 3;
        }
        if (
            expression.indexOf("['" + stackStartFnName + "'][\"apply\"](") !== -1 ||
            expression.indexOf("['" + stackStartFnName + "']['apply'](") !== -1 ||
            expression.indexOf('["' + stackStartFnName + '"]["apply"](') !== -1 ||
            expression.indexOf('["' + stackStartFnName + '"][\'apply\'](') !== -1
        ) {
            score += 6;
        }
        if (expression.startsWith(stackStartFnName + '(') || expression.indexOf(stackStartFnName + '(') !== -1) {
            score += 2;
        }
    }

    if (expression.length <= 120) {
        score += 1;
    }

    if (expression.indexOf('\\n') !== -1) {
        score -= 4;
    }

    if (hasNameReference && (expression.startsWith('assert.throws(') || expression.startsWith('strict.throws('))) {
        score -= 5;
    }

    return score;
}

function findExpressionFromStack(stack, stackStartFnName, currentModuleSource) {
    const frames = parseStackFrames(stack);
    let checkedFrames = 0;

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        if (shouldSkipStackFrame(frame, stackStartFnName)) {
            continue;
        }

        checkedFrames++;
        if (checkedFrames > 3) {
            break;
        }

        const source = resolveSourceForFrame(frame, currentModuleSource);
        if (typeof source !== 'string') {
            continue;
        }

        const sourceLines = source.split(/\r?\n/);
        let frameBestExpression = '';
        let frameBestRank = -Infinity;
        const candidateLineNumbers = [];
        for (let lineOffset = 0; lineOffset <= 10; lineOffset++) {
            candidateLineNumbers.push(frame.lineNumber - lineOffset);
        }
        for (let j = 0; j < candidateLineNumbers.length; j++) {
            const lineNumber = candidateLineNumbers[j];
            if (lineNumber <= 0 || lineNumber > sourceLines.length) {
                continue;
            }

            const sourceExpression = extractCallExpression(sourceLines, lineNumber, frame.columnNumber);
            const lineExpression = extractNamedCallExpression(sourceLines[lineNumber - 1], ['assert', 'strict'], true);
            let arrowExpression = '';
            const arrowMatch = sourceLines[lineNumber - 1].match(/=>\s*([A-Za-z_$][\w$]*\([^)]*\))/);
            if (arrowMatch) {
                arrowExpression = normalizeExtractedExpression(arrowMatch[1]);
            }
            let wrapperExpression = '';
            if (sourceExpression) {
                const wrapperInvocationMatch = sourceExpression.match(/^([A-Za-z_$][\w$]*)\([^)]*\)$/);
                if (wrapperInvocationMatch) {
                    const wrapperName = wrapperInvocationMatch[1];
                    const wrapperDefinitionRegExp = new RegExp('\\b' + wrapperName + '\\s*=\\s*\\([^)]*\\)\\s*=>\\s*([A-Za-z_$][\\w$]*\\([^)]*\\))');
                    const startSearchLine = Math.max(0, lineNumber - 4);
                    for (let searchLine = startSearchLine; searchLine < lineNumber; searchLine++) {
                        const wrapperDefinitionMatch = sourceLines[searchLine].match(wrapperDefinitionRegExp);
                        if (wrapperDefinitionMatch) {
                            wrapperExpression = normalizeExtractedExpression(wrapperDefinitionMatch[1]);
                        }
                    }
                }
            }

            const candidates = [sourceExpression, lineExpression, arrowExpression, wrapperExpression];

            for (let candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
                const candidateExpression = candidates[candidateIdx];
                if (!candidateExpression) {
                    continue;
                }

                const relevanceScore = expressionRelevanceScore(candidateExpression, stackStartFnName);
                if (relevanceScore < 0) {
                    continue;
                }

                const lineDistance = frame.lineNumber - lineNumber;
                const candidateRank = relevanceScore * 100 - lineDistance * 5 - i;
                if (candidateRank > frameBestRank || (candidateRank === frameBestRank && (frameBestExpression === '' || candidateExpression.length < frameBestExpression.length))) {
                    frameBestRank = candidateRank;
                    frameBestExpression = candidateExpression;
                }
            }
        }

        if (frameBestExpression) {
            return frameBestExpression;
        }
    }

    return '';
}

function findMatchingParenEnd(source, openParenIndex) {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    let escaped = false;

    for (let i = openParenIndex; i < source.length; i++) {
        const char = source.charAt(i);

        if (escaped) {
            escaped = false;
            continue;
        }

        if (inSingleQuote) {
            if (char === '\\\\') {
                escaped = true;
            } else if (char === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (char === '\\\\') {
                escaped = true;
            } else if (char === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (inTemplateLiteral) {
            if (char === '\\\\') {
                escaped = true;
            } else if (char === '`') {
                inTemplateLiteral = false;
            }
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            continue;
        }
        if (char === '"') {
            inDoubleQuote = true;
            continue;
        }
        if (char === '`') {
            inTemplateLiteral = true;
            continue;
        }

        if (char === '(') {
            depth++;
            continue;
        }

        if (char === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function utf8CharByteSize(code) {
    if (code <= 0x7F) return 1;
    if (code <= 0x7FF) return 2;
    if (code >= 0xD800 && code <= 0xDBFF) return 4;
    return 3;
}

function utf8ByteLength(str) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        let size = utf8CharByteSize(code);
        bytes += size;
        if (size === 4) i++;
    }
    return bytes;
}

function byteOffsetToCharOffset(str, byteOffset) {
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
        if (bytes >= byteOffset) {
            return i;
        }
        let code = str.charCodeAt(i);
        const size = utf8CharByteSize(code);
        bytes += size;
        if (size === 4) i++;
    }
    return str.length;
}

function extractCallExpression(sourceLines, lineNumber, columnNumber) {
    if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
        return '';
    }

    if (lineNumber <= 0 || lineNumber > sourceLines.length) {
        return '';
    }

    const startLineIndex = lineNumber - 1;
    const sourceLine = sourceLines[startLineIndex];
    if (typeof sourceLine !== 'string') {
        return '';
    }

    if (sourceLine.trimStart().startsWith('//')) {
        return '';
    }

    // Keep the scan local to avoid accidentally consuming surrounding unrelated code.
    const maxSnippetLines = Math.min(sourceLines.length, startLineIndex + 20);
    const sourceSnippet = sourceLines.slice(startLineIndex, maxSnippetLines).join('\n');

    let index = 0;
    if (sourceLine.length > 0) {
        let byteCol = Math.max(0, columnNumber - 1);
        const lineByteLen = utf8ByteLength(sourceLine);
        if (byteCol >= lineByteLen) {
            byteCol = Math.max(0, byteCol - 62);
        }
        const charColumn = byteOffsetToCharOffset(sourceLine, byteCol);
        index = Math.max(0, Math.min(sourceLine.length - 1, charColumn));
    }

    const beforeIndex = sourceSnippet.lastIndexOf('(', index);
    const afterIndex = sourceSnippet.indexOf('(', index);
    let openParenIndex = -1;

    if (beforeIndex >= 0 && afterIndex >= 0) {
        openParenIndex = (index - beforeIndex <= afterIndex - index) ? beforeIndex : afterIndex;
    } else if (beforeIndex >= 0) {
        openParenIndex = beforeIndex;
    } else {
        openParenIndex = afterIndex;
    }

    if (openParenIndex < 0) {
        return '';
    }

    const closeParenIndex = findMatchingParenEnd(sourceSnippet, openParenIndex);
    if (closeParenIndex < 0) {
        return '';
    }

    let startIndex = openParenIndex;
    while (startIndex > 0) {
        const previous = sourceSnippet.charAt(startIndex - 1);
        if (isIdentifierPartCharacter(previous) || previous === '.' || previous === '?' || previous === '[' || previous === ']') {
            startIndex--;
            continue;
        }
        break;
    }

    const charBeforeStart = startIndex > 0 ? sourceSnippet.charAt(startIndex - 1) : '';
    if (charBeforeStart === '"' || charBeforeStart === '\'' || charBeforeStart === '`') {
        return '';
    }

    let expression = sourceSnippet.slice(startIndex, closeParenIndex + 1).trim();
    if (!expression) {
        return '';
    }

    if (expression.charAt(0) === '(') {
        return '';
    }

    if (expression.startsWith('eval(') || expression.startsWith('new Function(')) {
        return '';
    }

    while (expression.length > 0 && (expression.charAt(0) === ';' || expression.charAt(0) === ',')) {
        expression = expression.slice(1).trimStart();
    }

    const isLikelyAssertInvocation = expression.indexOf('assert') !== -1 ||
        expression.indexOf('strict') !== -1 ||
        expression.startsWith('ok(');

    if (!isLikelyAssertInvocation) {
        const assertionExpression = extractNamedCallExpression(sourceSnippet, ['assert', 'strict']);
        if (assertionExpression) {
            return assertionExpression;
        }
    } else if (expression.startsWith('assert(') && sourceLine.indexOf('assert(') !== sourceLine.lastIndexOf('assert(')) {
        const sameLineAssertionExpression = extractNamedCallExpression(sourceLine, ['assert'], true);
        if (sameLineAssertionExpression) {
            return sameLineAssertionExpression;
        }
    }

    return normalizeExtractedExpression(expression);
}

function getErrMessage(stackStartFn) {
    let stack;
    const originalStackTraceLimit = Error.stackTraceLimit;
    let restoreStackTraceLimit = false;

    if (typeof originalStackTraceLimit === 'number' && originalStackTraceLimit < 4) {
        Error.stackTraceLimit = 4;
        restoreStackTraceLimit = true;
    }

    try {
        if (typeof Error.captureStackTrace === 'function') {
            const stackHolder = {};
            Error.captureStackTrace(stackHolder, stackStartFn);
            stack = stackHolder.stack;
        }

        if (typeof stack !== 'string' || stack.length === 0) {
            stack = new Error().stack;
        }
    } finally {
        if (restoreStackTraceLimit) {
            Error.stackTraceLimit = originalStackTraceLimit;
        }
    }

    const stackFrames = parseStackFrames(stack);
    for (let i = 0; i < stackFrames.length; i++) {
        const frame = stackFrames[i];
        if (frame.fileName === 'native') {
            continue;
        }
        if (typeof frame.fileName === 'string' && frame.fileName.startsWith('node:')) {
            return undefined;
        }
        break;
    }

    const currentModule = globalThis.__wasm_rquickjs_current_module;
    if (!currentModule) {
        return undefined;
    }

    const currentModuleSource = typeof currentModule.source === 'string' ? currentModule.source : undefined;
    const stackStartFnName = stackStartFn && stackStartFn.name ? stackStartFn.name : '';
    let sourceExpression = findExpressionFromStack(stack, stackStartFnName, currentModuleSource);
    if (!sourceExpression) {
        return undefined;
    }

    if (sourceExpression.indexOf('eval(') !== -1 || sourceExpression.indexOf('new Function(') !== -1) {
        return undefined;
    }

    sourceExpression = sourceExpression.replace(ESCAPE_SEQUENCES_REGEXP, escapeControlCharacter);
    sourceExpression = sourceExpression.replace(/\\\\u([0-9a-fA-F]{4})/g, function(_, hex) {
        return '\\u' + hex;
    });
    return 'The expression evaluated to a falsy value:\n\n  ' + sourceExpression + '\n';
}

class Comparison {
    constructor(properties) {
        if (properties && typeof properties === 'object') {
            Object.assign(this, properties);
        }
    }
}

class AssertionError extends Error {
    constructor(options) {
        if (typeof options !== 'object' || options === null) {
            const err = new TypeError('The "options" argument must be of type object.' + invalidArgTypeHelper(options));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        let message;
        let actual = options.actual;
        let expected = options.expected;
        const operator = options.operator || 'fail';

        // Prevent the error stack from being visible by duplicating the error
        // in a very close way to the original in case both sides are actually
        // instances of Error.
        if (typeof actual === 'object' && actual !== null &&
            typeof expected === 'object' && expected !== null &&
            'stack' in actual && actual instanceof Error &&
            'stack' in expected && expected instanceof Error) {
            actual = copyError(actual);
            expected = copyError(expected);
        }

        try {
        if (operator === 'deepEqual') {
                let actualInsp = inspectForDiff(actual);
                let expectedInsp = inspectForDiff(expected);
                message = 'Expected values to be loosely deep-equal:\n\n' +
                    actualInsp + '\n\nshould loosely deep-equal\n\n' + expectedInsp;
        } else if (operator === 'notDeepEqual') {
                let actualInsp = inspectForDiff(actual);
                let expectedInsp = inspectForDiff(expected);
                if (actualInsp === expectedInsp) {
                    let base2 = 'Expected "actual" not to be loosely deep-equal to:';
                    let lines2 = actualInsp.split('\n');
                    if (lines2.length > 50) {
                        lines2 = lines2.slice(0, 46);
                        lines2.push('...');
                        message = base2 + '\n\n' + lines2.join('\n') + '\n';
                    } else {
                        message = base2 + '\n\n' + lines2.join('\n');
                    }
                } else {
                    message = actualInsp + '\n\nshould not loosely deep-equal\n\n' + expectedInsp;
                }
        } else if (operator === 'deepStrictEqual' || operator === 'partialDeepStrictEqual') {
                const actualInsp = inspectForDiff(actual);
                const expectedInsp = inspectForDiff(expected);
                const actualIsPrimitive = actual === null || (typeof actual !== 'object' && typeof actual !== 'function');
                const expectedIsPrimitive = expected === null || (typeof expected !== 'object' && typeof expected !== 'function');
                if (actualIsPrimitive && expectedIsPrimitive) {
                    message = 'Expected values to be strictly deep-equal:\n\n' + actualInsp + ' !== ' + expectedInsp + '\n';
                } else {
                const actualLines = actualInsp.split('\n');
                const expectedLines = expectedInsp.split('\n');
                let header = 'Expected values to be strictly deep-equal:\n+ actual - expected\n\n';
                const checkCommaDisparity = actual != null && typeof actual === 'object';
                const m = actualLines.length;
                let n = expectedLines.length;

                if (m > 500 || n > 500 || m * n > 100000) {
                    const diffLines = [];
                    const maxLen = Math.max(m, n);
                    for (let di = 0; di < maxLen; di++) {
                        const aLine = di < m ? actualLines[di] : undefined;
                        let eLine = di < n ? expectedLines[di] : undefined;
                        if (aLine !== undefined && eLine !== undefined && areDiffLinesEqual(aLine, eLine, checkCommaDisparity)) {
                            const commonLine = checkCommaDisparity && !aLine.endsWith(',') ? eLine : aLine;
                            diffLines.push('  ' + commonLine);
                        } else {
                            if (aLine !== undefined) diffLines.push('+ ' + aLine);
                            if (eLine !== undefined) diffLines.push('- ' + eLine);
                        }
                    }
                    message = header + diffLines.join('\n') + '\n';
                } else {
                    const diffResult = printMyersDiff(myersDiff(actualLines, expectedLines, checkCommaDisparity));
                    if (diffResult.skipped) {
                        header = header.replace('\n\n', '\n... Skipped lines\n\n');
                    }
                    message = header + diffResult.message + '\n';
                }
                }
        } else if (operator === 'notDeepStrictEqual') {
                    let actualInsp2 = inspectForDiff(actual);
                    let base2 = 'Expected "actual" not to be strictly deep-equal to:';
                    let lines2 = actualInsp2.split('\n');
                    // Truncate at ~50 lines
                    if (lines2.length > 50) {
                        lines2 = lines2.slice(0, 46);
                        lines2.push('...');
                        message = base2 + '\n\n' + lines2.join('\n') + '\n';
                    } else if (lines2.length === 1) {
                        message = base2 + (lines2[0].length > 5 ? '\n\n' : ' ') + lines2[0];
                    } else {
                        message = base2 + '\n\n' + lines2.join('\n') + '\n';
                    }
        } else if (operator === 'notStrictEqual') {
                    const actualInsp2 = inspectForDiff(actual);
                    let base2 = 'Expected "actual" to be strictly unequal to:';
                    if ((typeof actual === 'object' && actual !== null) || typeof actual === 'function') {
                        base2 = 'Expected "actual" not to be reference-equal to "expected":';
                    }
                    const lines2 = actualInsp2.split('\n');
                    if (lines2.length === 1) {
                        message = base2 + (lines2[0].length > 5 ? '\n\n' : ' ') + lines2[0];
                    } else {
                        message = base2 + '\n\n' + lines2.join('\n') + '\n';
                    }
        } else if (operator === 'strictEqual') {
                    const isObjCompare = (typeof actual === 'object' && actual !== null &&
                        typeof expected === 'object' && expected !== null) ||
                        (typeof actual === 'function' && typeof expected === 'function');
                    if (isObjCompare) {
                        const actualInsp3 = inspectForDiff(actual);
                        const expectedInsp3 = inspectForDiff(expected);
                        if (actualInsp3 === expectedInsp3) {
                            message = 'Values have same structure but are not reference-equal:\n\n' + actualInsp3 + '\n';
                        } else {
                            message = 'Expected "actual" to be reference-equal to "expected":\n' +
                                '+ actual - expected\n\n';
                            const aLines3 = actualInsp3.split('\n');
                            const eLines3 = expectedInsp3.split('\n');
                            const maxLen3 = Math.max(aLines3.length, eLines3.length);
                            const diffParts3 = [];
                            for (let si = 0; si < maxLen3; si++) {
                                const aL3 = si < aLines3.length ? aLines3[si] : undefined;
                                const eL3 = si < eLines3.length ? eLines3[si] : undefined;
                                if (aL3 !== undefined && eL3 !== undefined && aL3 === eL3) {
                                    diffParts3.push('  ' + aL3);
                                } else {
                                    if (aL3 !== undefined) diffParts3.push('+ ' + aL3);
                                    if (eL3 !== undefined) diffParts3.push('- ' + eL3);
                                }
                            }
                            message += diffParts3.join('\n') + '\n';
                        }
                    } else {
                        let actualStr = inspectForDiff(actual);
                        let expectedStr = inspectForDiff(expected);
                        const aLines4 = actualStr.split('\n');
                        const eLines4 = expectedStr.split('\n');
                        let stringsLen = actualStr.length + expectedStr.length;
                        if (typeof actual === 'string') stringsLen -= 2;
                        if (typeof expected === 'string') stringsLen -= 2;
                        const isSingleLine = aLines4.length === 1 && eLines4.length === 1;
                        if (isSingleLine && stringsLen <= 12 && (actual !== 0 || expected !== 0)) {
                            message = 'Expected values to be strictly equal:\n\n' + actualStr + ' !== ' + expectedStr + '\n';
                        } else {
                            const aPrefixed = aLines4.map(function(l) { return '+ ' + l; }).join('\n');
                            const ePrefixed = eLines4.map(function(l) { return '- ' + l; }).join('\n');
                            message = 'Expected values to be strictly equal:\n+ actual - expected\n\n' +
                                aPrefixed + '\n' + ePrefixed + '\n';

                            if (typeof actual === 'string' && typeof expected === 'string' && isSingleLine) {
                                let indicatorIdx = -1;
                                const maxIdx = Math.min(actualStr.length, expectedStr.length);
                                for (let idx = 0; idx < maxIdx; idx++) {
                                    if (actualStr.charAt(idx) !== expectedStr.charAt(idx)) {
                                        if (idx >= 3) {
                                            indicatorIdx = idx;
                                        }
                                        break;
                                    }
                                }

                                if (indicatorIdx !== -1) {
                                    message += ' '.repeat(indicatorIdx + 2) + '^\n';
                                }
                            }
                        }
                    }
        } else {
                    let actualStr = inspect(actual, { depth: 2 });
                    let expectedStr = inspect(expected, { depth: 2 });
                    if (actualStr.length > 128) actualStr = actualStr.slice(0, 125) + '...';
                    if (expectedStr.length > 128) expectedStr = expectedStr.slice(0, 125) + '...';
                    message = actualStr + ' ' + operator + ' ' + expectedStr;
        }

        } catch (diffErr) {
            // If diff generation fails (e.g., stack overflow on large/circular objects),
            // fall back to a simple message
            if (message == null) {
                let actualStr = typeof actual === 'object' ? '[object]' : String(actual);
                let expectedStr = typeof expected === 'object' ? '[object]' : String(expected);
                if (actualStr.length > 128) actualStr = actualStr.slice(0, 125) + '...';
                if (expectedStr.length > 128) expectedStr = expectedStr.slice(0, 125) + '...';
                message = actualStr + ' ' + operator + ' ' + expectedStr;
            }
        }

        if (options.message != null) {
            const userMsg = String(options.message);
            if (message != null) {
                const diffStartIdx = message.indexOf('\n+ actual - expected\n\n');
                if (diffStartIdx >= 0) {
                    message = userMsg + message.slice(diffStartIdx);
                } else {
                    const nnIdx = message.indexOf('\n\n');
                    if (nnIdx >= 0) {
                        message = userMsg + '\n\n' + message.slice(nnIdx + 2);
                    } else {
                        message = userMsg;
                    }
                }
            } else {
                message = userMsg;
            }
        }

        super(message);

        this.actual = actual;
        this.expected = expected;
        this.operator = operator;
        this.generatedMessage = 'generatedMessage' in options ? options.generatedMessage : !options.message;
        this.code = 'ERR_ASSERTION';
        this.name = 'AssertionError';

        if (typeof Error.captureStackTrace === 'function') {
            const stackStartFunction = options.stackStartFn || options.stackStartFunction || this.constructor;
            Error.captureStackTrace(this, stackStartFunction);
        }
        // QuickJS stacks don't include the error message; prepend it to match Node.js format
        if (typeof this.stack === 'string' && !this.stack.includes(message)) {
            this.stack = this.name + ': ' + message + '\n' + this.stack;
        }
        this.stack = normalizeStackFrameFormatting(this.stack);
        // In QuickJS stack traces may omit frames. For async assertion helpers,
        // keep the entry point name visible so /rejects/ checks keep working.
        const keepAsyncEntryPoint = options.stackStartFn === rejects || options.stackStartFn === doesNotReject;
        if (keepAsyncEntryPoint && typeof this.stack === 'string' && options.stackStartFn && options.stackStartFn.name && !this.stack.includes(options.stackStartFn.name)) {
            this.stack += '\n    at ' + options.stackStartFn.name + ' (native)';
        }
    }

    toString() {
        return 'AssertionError [ERR_ASSERTION]: ' + this.message;
    }

    inspect(depth, ctx) {
        const kMaxLongStringLength = 512;
        // addEllipsis helper
        function addEllipsis(string) {
            const lines = string.split('\n', 11);
            if (lines.length > 10) {
                lines.length = 10;
                return lines.join('\n') + '\n...';
            } else if (string.length > kMaxLongStringLength) {
                return string.slice(kMaxLongStringLength) + '...';
            }
            return string;
        }
        // Temporarily truncate long string actual/expected
        const tmpActual = this.actual;
        const tmpExpected = this.expected;
        if (typeof this.actual === 'string') {
            this.actual = addEllipsis(this.actual);
        }
        if (typeof this.expected === 'string') {
            this.expected = addEllipsis(this.expected);
        }
        const inspectOpts = Object.assign({}, ctx || {}, { customInspect: false, depth: 0 });
        let result = inspect(this, inspectOpts);
        // Restore original values
        this.actual = tmpActual;
        this.expected = tmpExpected;
        return result;
    }

    [inspect.custom](depth, ctx) {
        return this.inspect(depth, ctx);
    }
}

// Process message argument: supports string, Error, and message factory functions
function isErrorLike(obj) {
    return obj instanceof Error ||
        (obj !== null && typeof obj === 'object' && 'message' in obj && 'name' in obj &&
         typeof obj.message === 'string' && typeof obj.name === 'string' &&
         (obj.constructor === Error || (obj.constructor && obj.constructor.prototype instanceof Error) ||
          /Error$/.test(obj.name)));
}

function processMessage(message, actual, expected) {
    if (isErrorLike(message)) return message;
    if (typeof message === 'function') {
        const result = message(actual, expected);
        if (typeof result === 'string') return result;
        return undefined;
    }
    return message;
}

function innerFail(obj) {
    let msg = processMessage(obj.message, obj.actual, obj.expected);
    if (isErrorLike(msg)) throw msg;
    obj.message = msg;
    throw new AssertionError(obj);
}

const NO_EXCEPTION_SENTINEL = {};

function fail(actual, expected, message, operator, stackStartFn) {
    if (arguments.length === 0) {
        innerFail({
            actual: undefined,
            expected: undefined,
            message: 'Failed',
            operator: 'fail',
            generatedMessage: true,
            stackStartFn: fail
        });
        return;
    }
    if (arguments.length === 1) {
        const msg1 = processMessage(actual, undefined, undefined);
        if (isErrorLike(msg1)) throw msg1;
        innerFail({
            actual: undefined,
            expected: undefined,
            message: msg1,
            operator: 'fail',
            stackStartFn: fail
        });
        return;
    }
    // 2+ args (deprecated path)
    if (arguments.length === 2) {
        operator = '!=';
    }
    const msg = processMessage(message, actual, expected);
    if (isErrorLike(msg)) throw msg;
    innerFail({
        actual: actual,
        expected: expected,
        message: msg,
        operator: operator || 'fail',
        generatedMessage: !message,
        stackStartFn: stackStartFn || fail
    });
}

function innerOk(stackStartFn, argLength, value, message) {
    if (!value) {
        let generatedMessage = false;
        let assertionMessage = message;

        if (argLength === 0) {
            generatedMessage = true;
            assertionMessage = 'No value argument passed to `assert.ok()`';
        } else if (argLength === 1 || message == null) {
            generatedMessage = true;
            assertionMessage = getErrMessage(stackStartFn);
        }

        innerFail({
            actual: value,
            expected: true,
            message: assertionMessage,
            operator: '==',
            generatedMessage: generatedMessage,
            stackStartFn: stackStartFn
        });
    }
}

function ok(value, message) {
    innerOk(ok, arguments.length, value, message);
}

function equal(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    // eslint-disable-next-line eqeqeq
    if (actual != expected && !Object.is(actual, expected)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: '==',
            stackStartFn: equal
        });
    }
}

function notEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    // eslint-disable-next-line eqeqeq
    if (actual == expected || Object.is(actual, expected)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: '!=',
            stackStartFn: notEqual
        });
    }
}

function strictEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (!Object.is(actual, expected)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'strictEqual',
            stackStartFn: strictEqual
        });
    }
}

function notStrictEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (Object.is(actual, expected)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'notStrictEqual',
            stackStartFn: notStrictEqual
        });
    }
}

// --- Deep equality helpers ---

function isArguments(val) {
    return Object.prototype.toString.call(val) === '[object Arguments]';
}

function hasOwn(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

function deepEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (!innerDeepEqual(actual, expected, false, undefined)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'deepEqual',
            stackStartFn: deepEqual
        });
    }
}

function notDeepEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (innerDeepEqual(actual, expected, false, undefined)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'notDeepEqual',
            stackStartFn: notDeepEqual
        });
    }
}

function deepStrictEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (!innerDeepEqual(actual, expected, true, undefined)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'deepStrictEqual',
            stackStartFn: deepStrictEqual
        });
    }
}

function notDeepStrictEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (innerDeepEqual(actual, expected, true, undefined)) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'notDeepStrictEqual',
            stackStartFn: notDeepStrictEqual
        });
    }
}

function partialDeepStrictEqual(actual, expected, message) {
    if (arguments.length < 2) {
        throw new ERR_MISSING_ARGS('actual', 'expected');
    }

    if (!innerPartialDeepEqual(actual, expected, createPartialDeepMemo())) {
        innerFail({
            actual: actual,
            expected: expected,
            message: message,
            operator: 'partialDeepStrictEqual',
            stackStartFn: partialDeepStrictEqual
        });
    }
}

function createPartialDeepMemo() {
    return { weakMemo: new WeakMap(), pairsA: null, pairsB: null };
}

function partialMemoHas(memo, actual, expected) {
    const expectedSet = memo.weakMemo.get(actual);
    return expectedSet !== undefined && expectedSet.has(expected);
}

function partialMemoAdd(memo, actual, expected) {
    let expectedSet = memo.weakMemo.get(actual);
    if (expectedSet === undefined) {
        expectedSet = new WeakSet();
        memo.weakMemo.set(actual, expectedSet);
    }
    expectedSet.add(expected);
}

function getTag(value) {
    return Object.prototype.toString.call(value);
}

function getEnumerableSymbols(value) {
    const symbols = Object.getOwnPropertySymbols(value);
    const enumerableSymbols = [];
    for (let i = 0; i < symbols.length; i++) {
        if (Object.prototype.propertyIsEnumerable.call(value, symbols[i])) {
            enumerableSymbols.push(symbols[i]);
        }
    }

    return enumerableSymbols;
}

function isArrayIndexKey(key, length) {
    if (key === '') {
        return false;
    }

    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length) {
        return false;
    }

    return String(index) === key;
}

function compareExpectedProperties(actual, expected, memo, skipArrayIndices) {
    const expectedKeys = Object.keys(expected);
    for (let i = 0; i < expectedKeys.length; i++) {
        const key = expectedKeys[i];
        if (skipArrayIndices && isArrayIndexKey(key, expected.length)) {
            continue;
        }

        if (!hasOwn(actual, key)) {
            return false;
        }

        if (!innerPartialDeepEqual(actual[key], expected[key], memo)) {
            return false;
        }
    }

    const expectedSymbols = getEnumerableSymbols(expected);
    for (let i = 0; i < expectedSymbols.length; i++) {
        const symbolKey = expectedSymbols[i];
        if (!hasOwn(actual, symbolKey)) {
            return false;
        }

        if (!innerPartialDeepEqual(actual[symbolKey], expected[symbolKey], memo)) {
            return false;
        }
    }

    return true;
}

function arraysEqual(actualBytes, expectedBytes) {
    if (actualBytes.length !== expectedBytes.length) {
        return false;
    }

    for (let i = 0; i < expectedBytes.length; i++) {
        if (actualBytes[i] !== expectedBytes[i]) {
            return false;
        }
    }

    return true;
}

function isSubsequence(actualValues, expectedValues, compare) {
    if (actualValues.length < expectedValues.length) {
        return false;
    }

    let searchStart = 0;
    for (let i = 0; i < expectedValues.length; i++) {
        let found = false;
        for (let j = searchStart; j < actualValues.length; j++) {
            if (compare(actualValues[j], expectedValues[i])) {
                searchStart = j + 1;
                found = true;
                break;
            }
        }

        if (!found) {
            return false;
        }
    }

    return true;
}

function isTypedArrayView(value, tag) {
    if (tag === '[object DataView]') {
        return false;
    }

    return ArrayBuffer.isView(value);
}

function strictMapKeyEqual(actualKey, expectedKey) {
    if (Object.is(actualKey, expectedKey)) {
        return true;
    }

    if (actualKey === null || expectedKey === null ||
        typeof actualKey !== 'object' || typeof expectedKey !== 'object') {
        return false;
    }

    return innerDeepEqual(actualKey, expectedKey, true, undefined);
}

function isURLValue(value, tag) {
    return tag === '[object URL]' ||
        (value !== null && typeof value === 'object' &&
            value.constructor && value.constructor.name === 'URL' &&
            typeof value.href === 'string' &&
            value.searchParams !== undefined && value.searchParams !== null);
}

function innerPartialDeepEqual(actual, expected, memo) {
    if (Object.is(actual, expected)) {
        return true;
    }
    if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
        return false;
    }

    if (partialMemoHas(memo, actual, expected)) {
        return true;
    }
    partialMemoAdd(memo, actual, expected);

    const expectedTag = getTag(expected);
    const actualTag = getTag(actual);

    if (expectedTag === '[object Array]') {
        if (actualTag !== '[object Array]') {
            return false;
        }

        if (!isSubsequence(actual, expected, function(actualItem, expectedItem) {
            return innerPartialDeepEqual(actualItem, expectedItem, memo);
        })) {
            return false;
        }

        return compareExpectedProperties(actual, expected, memo, true);
    }

    if (expectedTag === '[object Map]') {
        if (actualTag !== '[object Map]' || actual.size < expected.size) {
            return false;
        }

        const actualEntries = Array.from(actual.entries());

        const expectedEntries = Array.from(expected.entries());
        for (let i = 0; i < expectedEntries.length; i++) {
            const expectedEntry = expectedEntries[i];
            let foundMapEntry = false;

            if (actual.has(expectedEntry[0])) {
                if (!innerPartialDeepEqual(actual.get(expectedEntry[0]), expectedEntry[1], memo)) {
                    return false;
                }
                foundMapEntry = true;
            } else {
                for (let j = 0; j < actualEntries.length; j++) {
                    const actualEntry = actualEntries[j];
                    if (strictMapKeyEqual(actualEntry[0], expectedEntry[0]) &&
                        innerPartialDeepEqual(actualEntry[1], expectedEntry[1], memo)) {
                        foundMapEntry = true;
                        break;
                    }
                }
            }

            if (!foundMapEntry) {
                return false;
            }
        }

        return compareExpectedProperties(actual, expected, memo, false);
    }

    if (expectedTag === '[object Set]') {
        if (actualTag !== '[object Set]' || actual.size < expected.size) {
            return false;
        }

        const actualValues = Array.from(actual.values());
        const usedActualValues = new Array(actualValues.length);
        for (let i = 0; i < usedActualValues.length; i++) {
            usedActualValues[i] = false;
        }

        const expectedValues = Array.from(expected.values());
        for (let i = 0; i < expectedValues.length; i++) {
            const expectedValue = expectedValues[i];
            let foundSetValue = false;

            for (let j = 0; j < actualValues.length; j++) {
                if (usedActualValues[j]) {
                    continue;
                }

                if (innerPartialDeepEqual(actualValues[j], expectedValue, memo)) {
                    usedActualValues[j] = true;
                    foundSetValue = true;
                    break;
                }
            }

            if (!foundSetValue) {
                return false;
            }
        }

        return compareExpectedProperties(actual, expected, memo, false);
    }

    if (expectedTag === '[object Date]' || actualTag === '[object Date]') {
        if (expectedTag !== '[object Date]' || actualTag !== '[object Date]') {
            return false;
        }

        return Object.is(actual.getTime(), expected.getTime());
    }

    if (expectedTag === '[object RegExp]' || actualTag === '[object RegExp]') {
        if (expectedTag !== '[object RegExp]' || actualTag !== '[object RegExp]') {
            return false;
        }

        return actual.source === expected.source &&
            actual.flags === expected.flags &&
            actual.lastIndex === expected.lastIndex;
    }

    if (expectedTag === '[object ArrayBuffer]' || expectedTag === '[object SharedArrayBuffer]') {
        if (actualTag !== expectedTag) {
            return false;
        }

        const actualBuffer = new Uint8Array(actual);
        const expectedBuffer = new Uint8Array(expected);
        if (actualBuffer.length < expectedBuffer.length) {
            return false;
        }

        if (actualBuffer.length === expectedBuffer.length) {
            return arraysEqual(actualBuffer, expectedBuffer);
        }

        return isSubsequence(actualBuffer, expectedBuffer, function(actualByte, expectedByte) {
            return actualByte === expectedByte;
        });
    }

    if (expectedTag === '[object DataView]') {
        if (actualTag !== '[object DataView]' || actual.byteLength < expected.byteLength) {
            return false;
        }

        const actualDataView = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
        const expectedDataView = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
        if (actualDataView.length === expectedDataView.length) {
            return arraysEqual(actualDataView, expectedDataView);
        }

        return isSubsequence(actualDataView, expectedDataView, function(actualByte, expectedByte) {
            return actualByte === expectedByte;
        });
    }

    if (isTypedArrayView(expected, expectedTag)) {
        if (!isTypedArrayView(actual, actualTag) || actualTag !== expectedTag || actual.byteLength < expected.byteLength) {
            return false;
        }

        const actualTypedArray = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
        const expectedTypedArray = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
        if (actualTypedArray.length === expectedTypedArray.length) {
            if (!arraysEqual(actualTypedArray, expectedTypedArray)) {
                return false;
            }
        } else if (!isSubsequence(actualTypedArray, expectedTypedArray, function(actualByte, expectedByte) {
            return actualByte === expectedByte;
        })) {
            return false;
        }

        return compareExpectedProperties(actual, expected, memo, false);
    }

    const expectedIsURL = isURLValue(expected, expectedTag);
    const actualIsURL = isURLValue(actual, actualTag);
    if (expectedIsURL || actualIsURL) {
        if (!expectedIsURL || !actualIsURL) {
            return false;
        }

        return actual.href === expected.href;
    }

    if (expectedTag === '[object Error]' || expected instanceof Error) {
        if (!(actual instanceof Error) && actualTag !== '[object Error]') {
            return false;
        }

        if (typeof expected.name === 'string' && expected.name.length > 0 && actual.name !== expected.name) {
            return false;
        }
        if (typeof expected.message === 'string' && expected.message.length > 0 &&
            !isEquivalentEngineErrorMessage(actual.message, expected.message)) {
            return false;
        }
        if (hasOwn(expected, 'cause')) {
            if (!hasOwn(actual, 'cause')) {
                return false;
            }
            if (!innerPartialDeepEqual(actual.cause, expected.cause, memo)) {
                return false;
            }
        }
        if (hasOwn(expected, 'errors')) {
            if (!hasOwn(actual, 'errors')) {
                return false;
            }
            if (!innerPartialDeepEqual(actual.errors, expected.errors, memo)) {
                return false;
            }
        }

        return compareExpectedProperties(actual, expected, memo, false);
    }

    if (expectedTag !== '[object Object]') {
        return innerDeepEqual(actual, expected, true, undefined);
    }

    return compareExpectedProperties(actual, expected, memo, false);
}

// --- throws / doesNotThrow / rejects / doesNotReject ---

function makeAmbiguousArgumentError(arg, details) {
    let err = new TypeError('The "' + arg + '" argument is ambiguous. ' + details);
    err.code = 'ERR_AMBIGUOUS_ARGUMENT';
    return err;
}

function isEquivalentEngineErrorMessage(actualMessage, expectedMessage) {
    if (actualMessage === expectedMessage) {
        return true;
    }

    // QuickJS reports proxy ownKeys invariant violations with a different
    // wording than V8/Node.js.
    if (expectedMessage === "'ownKeys' on proxy: trap result did not include 'length'" &&
        actualMessage === 'proxy: target property must be present in proxy ownKeys') {
        return true;
    }

    return false;
}

function compareExceptionKey(actual, expected, key, message, keys, fn) {
    if ((key in actual) && innerDeepEqual(actual[key], expected[key], true, undefined)) {
        return;
    }

    if (key === 'message' &&
        typeof actual[key] === 'string' &&
        typeof expected[key] === 'string' &&
        isEquivalentEngineErrorMessage(actual[key], expected[key])) {
        return;
    }

    if (!message) {
        // Build small placeholder objects to keep the generated diff readable.
        const actualSubset = {};
        const expectedSubset = {};
        for (let i = 0; i < keys.length; i++) {
            const currentKey = keys[i];
            if (currentKey in actual) {
                actualSubset[currentKey] = actual[currentKey];
            }
            if (currentKey in expected) {
                if (typeof actual[currentKey] === 'string' && expected[currentKey] instanceof RegExp && expected[currentKey].test(actual[currentKey])) {
                    expectedSubset[currentKey] = actual[currentKey];
                } else {
                    expectedSubset[currentKey] = expected[currentKey];
                }
            }
        }

        let err = new AssertionError({
            actual: new Comparison(actualSubset),
            expected: new Comparison(expectedSubset),
            operator: 'deepStrictEqual',
            stackStartFn: fn
        });
        err.actual = actual;
        err.expected = expected;
        err.operator = fn.name;
        throw err;
    }

    innerFail({
        actual: actual,
        expected: expected,
        message: message,
        operator: fn.name,
        stackStartFn: fn
    });
}

function expectedException(actual, expected, message, fn) {
    let generatedMessage = false;
    let throwError = false;

    if (typeof expected !== 'function') {
        if (expected instanceof RegExp) {
            const str = String(actual);
            if (expected.test(str)) {
                return;
            }

            if (!message) {
                generatedMessage = true;
                message = 'The input did not match the regular expression ' + inspect(expected) + '. Input:\n\n' + inspect(str) + '\n';
            }
            throwError = true;
        } else if (typeof actual !== 'object' || actual === null) {
            const primitiveErr = new AssertionError({
                actual: actual,
                expected: expected,
                message: message,
                operator: 'deepStrictEqual',
                stackStartFn: fn
            });
            primitiveErr.operator = fn.name;
            throw primitiveErr;
        } else {
            const keys = Object.keys(expected);
            if (expected instanceof Error) {
                if (keys.indexOf('name') === -1) {
                    keys.push('name');
                }
                if (keys.indexOf('message') === -1) {
                    keys.push('message');
                }
            } else if (keys.length === 0) {
                throw new ERR_INVALID_ARG_VALUE('error', expected, 'may not be an empty object');
            }

            for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
                const key = keys[keyIdx];
                if (typeof actual[key] === 'string' && expected[key] instanceof RegExp && expected[key].test(actual[key])) {
                    continue;
                }
                compareExceptionKey(actual, expected, key, message, keys, fn);
            }
            return;
        }
    } else if (expected.prototype !== undefined && actual instanceof expected) {
        return;
    } else if (Error.isPrototypeOf(expected)) {
        if (!message) {
            generatedMessage = true;
            message = 'The error is expected to be an instance of "' + expected.name + '". Received ';

            if (isError(actual)) {
                let name = (actual && actual.constructor && actual.constructor.name) || actual.name;
                if (expected.name === name) {
                    message += 'an error with identical name but a different prototype.';
                } else {
                    message += '"' + name + '"';
                }

                if (actual.message) {
                    message += '\n\nError message:\n\n' + actual.message;
                }
            } else {
                message += '"' + inspect(actual, { depth: -1 }) + '"';
            }
        }
        throwError = true;
    } else {
        const result = expected.call({}, actual);
        if (result !== true) {
            if (!message) {
                generatedMessage = true;
                const name = expected.name ? '"' + expected.name + '" ' : '';
                message = 'The ' + name + 'validation function is expected to return "true". Received ' + inspect(result);
                if (actual instanceof Error) {
                    message += '\n\nCaught error:\n\n' + actual;
                }
            }
            throwError = true;
        }
    }

    if (throwError) {
        const err = new AssertionError({
            actual: actual,
            expected: expected,
            message: message,
            operator: fn.name,
            stackStartFn: fn
        });
        err.generatedMessage = generatedMessage;
        throw err;
    }
}

function invalidArgTypeHelper(input) {
    if (input == null) return ' Received ' + input;
    if (typeof input === 'function') return ' Received function ' + input.name;
    if (typeof input === 'object') {
        const ctorName = input.constructor && input.constructor.name;
        if (ctorName) return ' Received an instance of ' + ctorName;
        return ' Received [object]';
    }
    return ' Received type ' + typeof input + ' (' + inspect(input) + ')';
}

function getActual(fn) {
    if (typeof fn !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('fn', 'Function', fn);
    }

    try {
        fn();
    } catch (e) {
        return e;
    }

    return NO_EXCEPTION_SENTINEL;
}

function checkIsPromise(obj) {
    if (obj instanceof Promise) {
        return true;
    }
    return obj !== null && typeof obj === 'object' && typeof obj.then === 'function' && typeof obj.catch === 'function';
}

function ensureAsyncAssertionFrame(error, assertionFn) {
    if (!error || typeof error !== 'object' || typeof assertionFn !== 'function' || !assertionFn.name) {
        return;
    }

    if (typeof error.stack !== 'string' || error.stack.length === 0) {
        return;
    }

    const asyncFrame = 'at async Function.' + assertionFn.name;
    if (error.stack.indexOf(asyncFrame) !== -1) {
        return;
    }

    error.stack += '\n    ' + asyncFrame + ' (native)';
}

async function waitForActual(promiseFn, assertionFn) {
    let resultPromise;
    if (typeof promiseFn === 'function') {
        // If this throws synchronously, async function semantics make the returned
        // promise reject with the thrown error, matching Node.js behavior.
        resultPromise = promiseFn();
        if (!checkIsPromise(resultPromise)) {
            throw new ERR_INVALID_RETURN_VALUE('instance of Promise', 'promiseFn', resultPromise);
        }
    } else if (checkIsPromise(promiseFn)) {
        resultPromise = promiseFn;
    } else {
        throw new ERR_INVALID_ARG_TYPE('promiseFn', ['Function', 'Promise'], promiseFn);
    }

    try {
        await resultPromise;
    } catch (e) {
        ensureAsyncAssertionFrame(e, assertionFn);
        return e;
    }

    return NO_EXCEPTION_SENTINEL;
}

function expectsError(stackStartFn, actual, error, message) {
    if (typeof error === 'string') {
        if (arguments.length === 4) {
            throw new ERR_INVALID_ARG_TYPE('error', ['Object', 'Error', 'Function', 'RegExp'], error);
        }

        if (typeof actual === 'object' && actual !== null) {
            if (actual.message === error) {
                throw makeAmbiguousArgumentError(
                    'error/message',
                    'The error message "' + actual.message + '" is identical to the message.'
                );
            }
        } else {
            if (actual === error) {
                throw makeAmbiguousArgumentError(
                    'error/message',
                    'The error "' + actual + '" is identical to the message.'
                );
            }
        }

        message = error;
        error = undefined;
    } else if (error != null && typeof error !== 'object' && typeof error !== 'function') {
        throw new ERR_INVALID_ARG_TYPE('error', ['Object', 'Error', 'Function', 'RegExp'], error);
    }

    if (actual === NO_EXCEPTION_SENTINEL) {
        let details = '';
        if (error && error.name) {
            details += ' (' + error.name + ')';
        }
        details += message ? ': ' + message : '.';
        let fnType = stackStartFn === rejects ? 'rejection' : 'exception';

        innerFail({
            actual: undefined,
            expected: error,
            operator: stackStartFn.name,
            message: 'Missing expected ' + fnType + details,
            stackStartFn: stackStartFn
        });
    }

    if (!error) {
        return;
    }

    expectedException(actual, error, message, stackStartFn);
}

function hasMatchingError(actual, expected) {
    if (typeof expected !== 'function') {
        if (expected instanceof RegExp) {
            return expected.test(String(actual));
        }
        throw new ERR_INVALID_ARG_TYPE('expected', ['Function', 'RegExp'], expected);
    }

    if (expected.prototype !== undefined && actual instanceof expected) {
        return true;
    }
    if (Error.isPrototypeOf(expected)) {
        return false;
    }
    return expected.call({}, actual) === true;
}

function expectsNoError(stackStartFn, actual, error, message) {
    if (actual === NO_EXCEPTION_SENTINEL) {
        return;
    }

    if (typeof error === 'string') {
        message = error;
        error = undefined;
    }

    if (!error || hasMatchingError(actual, error)) {
        const details = message ? ': ' + message : '.';
        const fnType = stackStartFn === doesNotReject ? 'rejection' : 'exception';
        const actualMessage = actual != null && typeof actual === 'object' && 'message' in actual
            ? String(actual.message)
            : String(actual);

        innerFail({
            actual: actual,
            expected: error,
            operator: stackStartFn.name,
            message: 'Got unwanted ' + fnType + details + '\nActual message: "' + actualMessage + '"',
            stackStartFn: stackStartFn
        });
    }

    throw actual;
}

function throws(fn) {
    let args = Array.prototype.slice.call(arguments, 1);
    expectsError.apply(null, [throws, getActual(fn)].concat(args));
}

function doesNotThrow(fn) {
    let args = Array.prototype.slice.call(arguments, 1);
    expectsNoError.apply(null, [doesNotThrow, getActual(fn)].concat(args));
}

async function rejects(promiseFn) {
    let args = Array.prototype.slice.call(arguments, 1);
    expectsError.apply(null, [rejects, await waitForActual(promiseFn, rejects)].concat(args));
}

async function doesNotReject(promiseFn) {
    const args = Array.prototype.slice.call(arguments, 1);
    expectsNoError.apply(null, [doesNotReject, await waitForActual(promiseFn, doesNotReject)].concat(args));
}

function ifError(value) {
    if (value !== null && value !== undefined) {
        const newErr = new AssertionError({
            actual: value,
            expected: null,
            message: 'ifError got unwanted exception: ' + (
                value instanceof Error
                    ? (value.message || value.name)
                    : (typeof value === 'object' && value !== null && 'message' in value
                        ? value.message
                        : inspect(value))
            ),
            operator: 'ifError',
            stackStartFn: ifError
        });
        throw newErr;
    }
}

function match(string, regexp, message) {
    if (!(regexp instanceof RegExp)) {
        let err = new ERR_INVALID_ARG_TYPE('regexp', 'RegExp', regexp);
        throw err;
    }
    if (typeof string !== 'string') {
        if (message) {
            throw new AssertionError({
                actual: string,
                expected: regexp,
                message: message,
                operator: 'match',
                stackStartFn: match
            });
        }
        innerFail({
            actual: string,
            expected: regexp,
            message: 'The "string" argument must be of type string. Received type ' + typeof string + ' (' + inspect(string) + ')',
            operator: 'match',
            stackStartFn: match,
            generatedMessage: true
        });
    }
    if (!regexp.test(string)) {
        innerFail({
            actual: string,
            expected: regexp,
            message: message || 'The input did not match the regular expression ' + inspect(regexp) + '. Input:\n\n' + inspect(string) + '\n',
            operator: 'match',
            stackStartFn: match,
            generatedMessage: !message
        });
    }
}

function doesNotMatch(string, regexp, message) {
    if (!(regexp instanceof RegExp)) {
        let err = new ERR_INVALID_ARG_TYPE('regexp', 'RegExp', regexp);
        throw err;
    }
    if (typeof string !== 'string') {
        if (message) {
            throw new AssertionError({
                actual: string,
                expected: regexp,
                message: message,
                operator: 'doesNotMatch',
                stackStartFn: doesNotMatch
            });
        }
        innerFail({
            actual: string,
            expected: regexp,
            message: 'The "string" argument must be of type string. Received type ' + typeof string + ' (' + inspect(string) + ')',
            operator: 'doesNotMatch',
            stackStartFn: doesNotMatch,
            generatedMessage: true
        });
    }
    if (regexp.test(string)) {
        innerFail({
            actual: string,
            expected: regexp,
            message: message || 'The input was expected to not match the regular expression ' + inspect(regexp) + '. Input:\n\n' + inspect(string) + '\n',
            operator: 'doesNotMatch',
            stackStartFn: doesNotMatch,
            generatedMessage: !message
        });
    }
}

// CallTracker implementation
class CallTracker {
    constructor() {
        this._trackedFunctions = [];
    }

    calls(fn, exact) {
        if (typeof globalThis.process !== 'undefined' && globalThis.process._exiting) {
            const exitErr = new Error('Cannot call CallTracker methods during process exit handler');
            exitErr.code = 'ERR_UNAVAILABLE_DURING_EXIT';
            throw exitErr;
        }
        if (typeof fn === 'number') {
            exact = fn;
            fn = undefined;
        }
        if (fn === undefined) {
            fn = function() {};
        }
        if (typeof fn !== 'function') {
            let err = new TypeError('The "fn" argument must be of type function. Received type ' + typeof fn);
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (exact === undefined) {
            exact = 1;
        }
        if (typeof exact !== 'number') {
            let err = new TypeError('The "exact" argument must be of type number. Received type ' + typeof exact);
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        if (!Number.isInteger(exact) || exact < 0) {
            let err = new RangeError('The value of "exact" is out of range. It must be a non-negative integer. Received ' + exact);
            err.code = 'ERR_OUT_OF_RANGE';
            throw err;
        }

        const callRecords = [];
        let tracking = {
            fn: fn,
            expected: exact,
            callRecords: callRecords,
            name: fn.name || 'anonymous'
        };

        let wrapper = function() {
            callRecords.push({
                arguments: Array.prototype.slice.call(arguments),
                thisArg: this === globalThis ? undefined : this
            });
            return fn.apply(this, arguments);
        };

        // Copy own properties from the original function.
        // Use Object.create(null) for descriptors to avoid prototype pollution
        // (e.g. Object.prototype.get being set can confuse Object.defineProperty).
        const ownKeys = Object.getOwnPropertyNames(fn);
        for (let i = 0; i < ownKeys.length; i++) {
            const key = ownKeys[i];
            if (key === 'length' || key === 'name' || key === 'prototype') continue;
            const desc = Object.getOwnPropertyDescriptor(fn, key);
            if (desc) {
                const cleanDesc = Object.create(null);
                if (Object.prototype.hasOwnProperty.call(desc, 'value')) {
                    cleanDesc.value = desc.value;
                    cleanDesc.writable = desc.writable;
                } else {
                    if (Object.prototype.hasOwnProperty.call(desc, 'get')) cleanDesc.get = desc.get;
                    if (Object.prototype.hasOwnProperty.call(desc, 'set')) cleanDesc.set = desc.set;
                }
                cleanDesc.enumerable = desc.enumerable;
                cleanDesc.configurable = desc.configurable;
                Object.defineProperty(wrapper, key, cleanDesc);
            }
        }

        // Handle the length property specially
        if (Object.prototype.hasOwnProperty.call(fn, 'length')) {
            const lengthDesc = Object.getOwnPropertyDescriptor(fn, 'length');
            if (lengthDesc && Object.prototype.hasOwnProperty.call(lengthDesc, 'value')) {
                const cleanLenDesc = Object.create(null);
                cleanLenDesc.value = lengthDesc.value;
                cleanLenDesc.writable = false;
                cleanLenDesc.enumerable = false;
                cleanLenDesc.configurable = true;
                Object.defineProperty(wrapper, 'length', cleanLenDesc);
            } else if (lengthDesc && Object.prototype.hasOwnProperty.call(lengthDesc, 'get')) {
                const cleanLenDesc2 = Object.create(null);
                cleanLenDesc2.get = lengthDesc.get;
                if (Object.prototype.hasOwnProperty.call(lengthDesc, 'set')) cleanLenDesc2.set = lengthDesc.set;
                cleanLenDesc2.enumerable = lengthDesc.enumerable;
                cleanLenDesc2.configurable = lengthDesc.configurable;
                Object.defineProperty(wrapper, 'length', cleanLenDesc2);
            }
        } else {
            // fn doesn't have own 'length', remove it from wrapper too
            delete wrapper.length;
        }

        tracking.wrapper = wrapper;
        this._trackedFunctions.push(tracking);

        return wrapper;
    }

    getCalls(fn) {
        let tracking = this._findTracking(fn);
        if (!tracking) {
            let err = new TypeError('The "fn" argument is not a tracked function');
            err.code = 'ERR_INVALID_ARG_VALUE';
            throw err;
        }
        let result = tracking.callRecords.map(function(record) {
            return Object.freeze({
                arguments: Object.freeze(Array.prototype.slice.call(record.arguments)),
                thisArg: record.thisArg
            });
        });
        return Object.freeze(result);
    }

    report() {
        const result = [];
        for (let i = 0; i < this._trackedFunctions.length; i++) {
            let t = this._trackedFunctions[i];
            const actual = t.callRecords.length;
            if (actual !== t.expected) {
                result.push({
                    message: 'Expected the ' + t.name + ' function to be executed ' +
                             t.expected + ' time(s) but was executed ' + actual + ' time(s).',
                    actual: actual,
                    expected: t.expected,
                    operator: t.name,
                    stack: new Error().stack
                });
            }
        }
        return result;
    }

    reset(fn) {
        if (fn !== undefined) {
            const tracking = this._findTracking(fn);
            if (!tracking) {
                const err = new TypeError('The "fn" argument is not a tracked function');
                err.code = 'ERR_INVALID_ARG_VALUE';
                throw err;
            }
            tracking.callRecords.length = 0;
        } else {
            for (let i = 0; i < this._trackedFunctions.length; i++) {
                this._trackedFunctions[i].callRecords.length = 0;
            }
        }
    }

    verify() {
        const errors = this.report();
        if (errors.length === 0) return;
        if (errors.length === 1) {
            throw new AssertionError({
                message: errors[0].message,
                actual: errors[0].actual,
                expected: errors[0].expected,
                operator: errors[0].operator
            });
        }
        throw new AssertionError({
            message: 'Functions were not called the expected number of times',
            actual: errors,
            expected: [],
            operator: 'verify'
        });
    }

    _findTracking(fn) {
        for (let i = 0; i < this._trackedFunctions.length; i++) {
            if (this._trackedFunctions[i].wrapper === fn) {
                return this._trackedFunctions[i];
            }
        }
        return null;
    }
}

// --- Wire up the main assert function ---

const assert = function assert(value, message) {
    innerOk(assert, arguments.length, value, message);
};

assert.ok = ok;
assert.equal = equal;
assert.notEqual = notEqual;
assert.strictEqual = strictEqual;
assert.notStrictEqual = notStrictEqual;
assert.deepEqual = deepEqual;
assert.notDeepEqual = notDeepEqual;
assert.deepStrictEqual = deepStrictEqual;
assert.notDeepStrictEqual = notDeepStrictEqual;
assert.partialDeepStrictEqual = partialDeepStrictEqual;
assert.throws = throws;
assert.doesNotThrow = doesNotThrow;
assert.rejects = rejects;
assert.doesNotReject = doesNotReject;
assert.ifError = ifError;
assert.match = match;
assert.doesNotMatch = doesNotMatch;
assert.fail = fail;
assert.AssertionError = AssertionError;
assert.CallTracker = CallTracker;

const strict = function strict(value, message) {
    innerOk(strict, arguments.length, value, message);
};

strict.ok = ok;
strict.equal = strictEqual;
strict.notEqual = notStrictEqual;
strict.deepEqual = deepStrictEqual;
strict.notDeepEqual = notDeepStrictEqual;
strict.strictEqual = strictEqual;
strict.notStrictEqual = notStrictEqual;
strict.deepStrictEqual = deepStrictEqual;
strict.notDeepStrictEqual = notDeepStrictEqual;
strict.partialDeepStrictEqual = partialDeepStrictEqual;
strict.throws = throws;
strict.doesNotThrow = doesNotThrow;
strict.rejects = rejects;
strict.doesNotReject = doesNotReject;
strict.ifError = ifError;
strict.match = match;
strict.doesNotMatch = doesNotMatch;
strict.fail = fail;
strict.AssertionError = AssertionError;
strict.CallTracker = CallTracker;
strict.strict = strict;

assert.strict = strict;

export {
    AssertionError,
    CallTracker,
    ok,
    equal,
    notEqual,
    strictEqual,
    notStrictEqual,
    deepEqual,
    notDeepEqual,
    deepStrictEqual,
    notDeepStrictEqual,
    partialDeepStrictEqual,
    throws,
    doesNotThrow,
    rejects,
    doesNotReject,
    ifError,
    match,
    doesNotMatch,
    fail,
    strict
};

export default assert;
