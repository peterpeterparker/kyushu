import {
    eval_in_new_context as evalInNewContext,
    eval_with_filename as evalWithFilename,
} from '__wasm_rquickjs_builtin/vm_native';
import * as pathModule from 'node:path';
import { extractSourceMapURL } from '__wasm_rquickjs_builtin/internal/source_map_url';

let contextIdCounter = 1;
const contextIds = new WeakMap();
const contextOptions = new WeakMap();
const contextDeletedGlobals = new WeakMap();
const identifierPattern = /^[$A-Z_a-z][$0-9A-Z_a-z]*$/;
const moduleNamespaceExportsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceExports');
const moduleNamespaceBindingsSymbol = Symbol.for('wasm-rquickjs.vm.namespaceBindings');
const moduleNamespaceBrandSymbol = Symbol('wasm-rquickjs.vm.namespaceBrand');
const vmDynamicImportReferrerSymbol = Symbol('wasm-rquickjs.vm.dynamicImportReferrer');
const scriptBrandSet = new WeakSet();
const vmModuleInstanceBrandSymbol = Symbol('wasm-rquickjs.vm.moduleInstance');
const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');
const USE_MAIN_CONTEXT_DEFAULT_LOADER = Symbol('vm_dynamic_import_main_context_default');
const defaultLoaderImportHelper = '__wasm_rquickjs_vm_default_loader_import__';
const missingDynamicImportHelper = '__wasm_rquickjs_vm_missing_dynamic_import__';
const missingDynamicImportFlagHelper = '__wasm_rquickjs_vm_missing_dynamic_import_flag__';
const sandboxDescriptorsHelper = '__wasm_rquickjs_vm_sandbox_descriptors__';
const sandboxSymbolsHelper = '__wasm_rquickjs_vm_sandbox_symbols__';
const sourceTextModuleExportCellsPlaceholder = '__wasm_rquickjs_vm_export_cells_placeholder__';
let defaultLoaderImportHelperCounter = 1;
let sandboxDescriptorsHelperCounter = 1;
let sandboxSymbolsHelperCounter = 1;
function isPrivateBuiltinSpecifier(specifier) {
    return specifier.startsWith('__wasm_rquickjs_builtin/');
}

function rejectPrivateBuiltinImport(specifier) {
    const err = new Error("Cannot find module '" + specifier + "'");
    err.code = 'ERR_MODULE_NOT_FOUND';
    return Promise.reject(err);
}

function defaultLoaderImportFunction(filename, specifier) {
    specifier = String(specifier);
    if (isPrivateBuiltinSpecifier(specifier)) {
        return rejectPrivateBuiltinImport(specifier);
    }
    return import(resolveDefaultLoaderSpecifier(specifier, filename));
}

function missingDynamicImportFunction() {
    const err = new TypeError('A dynamic import callback was not specified.');
    err.code = 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING';
    return Promise.reject(err);
}

function missingDynamicImportFlagFunction() {
    const err = new TypeError('A dynamic import callback was invoked without --experimental-vm-modules');
    err.code = 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG';
    return Promise.reject(err);
}

function vmModulesEnabled() {
    const execArgv = globalThis.process && globalThis.process.execArgv;
    return Array.isArray(execArgv) && execArgv.indexOf('--experimental-vm-modules') !== -1;
}

export const constants = {
    USE_MAIN_CONTEXT_DEFAULT_LOADER,
};

function splitDeclarators(declarationList) {
    const result = [];
    let current = '';
    let depth = 0;
    let quote = '';

    for (let i = 0; i < declarationList.length; i++) {
        const ch = declarationList[i];
        const prev = i > 0 ? declarationList[i - 1] : '';

        if (quote) {
            current += ch;
            if (ch === quote && prev !== '\\') {
                quote = '';
            }
            continue;
        }

        if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }

        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            current += ch;
            continue;
        }

        if (ch === ')' || ch === ']' || ch === '}') {
            if (depth > 0) depth--;
            current += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            if (current.trim().length > 0) {
                result.push(current.trim());
            }
            current = '';
            continue;
        }

        current += ch;
    }

    if (current.trim().length > 0) {
        result.push(current.trim());
    }

    return result;
}

function findSourceTextModuleStatementEnd(source, start) {
    let i = start;
    let depth = 0;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            return i;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(source, i) || (regexCanFollowParen(source, i) && isLikelyRegexLiteral(source, i)))) {
            i = skipRegexLiteral(source, i);
            continue;
        }
        if (ch === 0x28 || ch === 0x5b || ch === 0x7b) {
            depth++;
        } else if ((ch === 0x29 || ch === 0x5d || ch === 0x7d) && depth > 0) {
            depth--;
        }
        if (depth === 0 && ch === 0x3b) return i + 1;
        if (depth === 0 && (ch === 0x0a || ch === 0x0d) && previousSignificantChar(source, i) !== 0x2c) return i;
        i++;
    }
    return source.length;
}

function skipTemplateLiteralWithExpressions(source, start) {
    let i = start + 1;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        if (ch === 0x60) return i + 1;
        if (ch === 0x24 && source.charCodeAt(i + 1) === 0x7b) {
            const expressionEnd = findTemplateExpressionEnd(source, i + 2);
            if (expressionEnd === -1) return source.length;
            i = expressionEnd + 1;
            continue;
        }
        i++;
    }
    return source.length;
}

function sourceTextModuleReadStringSpecifier(source, pos) {
    const quote = source.charCodeAt(pos);
    if (quote !== 0x27 && quote !== 0x22) return null;
    const end = skipStringLiteral(source, pos, quote);
    return { value: source.slice(pos + 1, end - 1), end };
}

function sourceTextModuleParseNamedImports(source, start, end) {
    return source.slice(start, end).split(',').map((part) => {
        const pieces = part.trim().split(/\s+as\s+/);
        const imported = pieces[0] && pieces[0].trim();
        const local = (pieces[1] || pieces[0] || '').trim();
        return imported ? { imported, local } : null;
    }).filter(Boolean);
}

function sourceTextModuleFindFrom(source, start, end) {
    let i = start;
    let depth = 0;
    while (i < end) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < end && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x3b && depth === 0) {
            return -1;
        }
        if (ch === 0x28 || ch === 0x5b || ch === 0x7b) {
            depth++;
            i++;
            continue;
        }
        if ((ch === 0x29 || ch === 0x5d || ch === 0x7d) && depth > 0) {
            depth--;
            i++;
            continue;
        }
        if (depth === 0 && source.startsWith('from', i) && hasIdentifierBoundary(source, i, i + 4)) {
            return i;
        }
        i++;
    }
    return -1;
}

function sourceTextModuleParseImportAttributes(source, start, end) {
    const attributes = Object.create(null);
    let pos = skipWhitespaceAndComments(source, start);
    if (!source.startsWith('with', pos) || !hasIdentifierBoundary(source, pos, pos + 4)) {
        return attributes;
    }
    pos = skipWhitespaceAndComments(source, pos + 4);
    if (source.charCodeAt(pos) !== 0x7b) return attributes;
    pos++;
    while (pos < end) {
        pos = skipWhitespaceAndComments(source, pos);
        if (source.charCodeAt(pos) === 0x7d) break;
        let key;
        const keyQuote = source.charCodeAt(pos);
        if (keyQuote === 0x27 || keyQuote === 0x22) {
            const keyLiteral = sourceTextModuleReadStringSpecifier(source, pos);
            if (!keyLiteral) break;
            key = keyLiteral.value;
            pos = keyLiteral.end;
        } else {
            const keyStart = pos;
            while (pos < end && isIdentifierChar(source.charCodeAt(pos))) pos++;
            key = source.slice(keyStart, pos);
        }
        pos = skipWhitespaceAndComments(source, pos);
        if (!key || source.charCodeAt(pos) !== 0x3a) break;
        pos = skipWhitespaceAndComments(source, pos + 1);
        const value = sourceTextModuleReadStringSpecifier(source, pos);
        if (!value) break;
        attributes[key] = value.value;
        pos = skipWhitespaceAndComments(source, value.end);
        if (source.charCodeAt(pos) === 0x2c) {
            pos++;
            continue;
        }
        if (source.charCodeAt(pos) === 0x7d) break;
    }
    return attributes;
}

function sourceTextModuleParseImportClause(source, clauseStart, clauseEnd) {
    const names = [];
    let pos = skipWhitespaceAndComments(source, clauseStart);
    if (pos >= clauseEnd) return names;

    if (source.charCodeAt(pos) !== 0x7b && source.charCodeAt(pos) !== 0x2a) {
        const localStart = pos;
        while (pos < clauseEnd && isIdentifierChar(source.charCodeAt(pos))) pos++;
        const local = source.slice(localStart, pos);
        if (local) {
            sourceTextModuleAddImportName({ names }, 'default', local);
        }
        pos = skipWhitespaceAndComments(source, pos);
        if (source.charCodeAt(pos) === 0x2c) {
            pos = skipWhitespaceAndComments(source, pos + 1);
        }
    }

    if (source.charCodeAt(pos) === 0x7b) {
        const close = source.indexOf('}', pos + 1);
        if (close >= 0 && close <= clauseEnd) {
            const named = sourceTextModuleParseNamedImports(source, pos + 1, close);
            for (let i = 0; i < named.length; i++) {
                sourceTextModuleAddImportName({ names }, named[i].imported, named[i].local);
            }
        }
        return names;
    }

    if (source.charCodeAt(pos) === 0x2a) {
        pos = skipWhitespaceAndComments(source, pos + 1);
        if (source.startsWith('as', pos) && hasIdentifierBoundary(source, pos, pos + 2)) {
            pos = skipWhitespaceAndComments(source, pos + 2);
            const localStart = pos;
            while (pos < clauseEnd && isIdentifierChar(source.charCodeAt(pos))) pos++;
            const local = source.slice(localStart, pos);
            if (local) {
                sourceTextModuleAddImportName({ names }, '*', local);
            }
        }
    }

    return names;
}

function sourceTextModuleGetDependency(dependencies, bySpecifier, specifier) {
    let dependency = bySpecifier[specifier];
    if (!dependency) {
        dependency = { specifier, names: [], attributes: Object.create(null), exportAll: false };
        bySpecifier[specifier] = dependency;
        dependencies.push(dependency);
    }
    return dependency;
}

function sourceTextModuleAddImportName(dependency, imported, local) {
    if (!dependency.names.some((entry) => entry.local === local && entry.imported === imported)) {
        dependency.names.push({ imported, local });
    }
}

function sourceTextModuleSetAttributes(dependency, attributes) {
    const keys = Object.keys(attributes);
    for (let i = 0; i < keys.length; i++) {
        dependency.attributes[keys[i]] = attributes[keys[i]];
    }
}

function sourceTextModuleExportSyncSource(name, localName) {
    return '\n' + sourceTextModuleExportCellsPlaceholder + '[' + JSON.stringify(name) + '].initialized = true;' +
        sourceTextModuleExportCellsPlaceholder + '[' + JSON.stringify(name) + '].value = ' + localName + ';\n';
}

function applySourceTextModuleEdits(source, edits) {
    if (edits.length === 0) return source;
    edits.sort((a, b) => a.start - b.start);
    let out = '';
    let last = 0;
    for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        if (edit.start < last) continue;
        out += source.slice(last, edit.start) + edit.replacement;
        last = edit.end;
    }
    return out + source.slice(last);
}

function sourceTextModuleExportNamesByLocal(exportBindings) {
    const byLocal = Object.create(null);
    for (let i = 0; i < exportBindings.length; i++) {
        const binding = exportBindings[i];
        if (!byLocal[binding.localName]) byLocal[binding.localName] = [];
        byLocal[binding.localName].push(binding.name);
    }
    return byLocal;
}

function sourceTextModuleAssignmentSyncSource(exportNames, localName) {
    let out = '';
    for (let i = 0; i < exportNames.length; i++) {
        out += sourceTextModuleExportSyncSource(exportNames[i], localName);
    }
    return out;
}

function injectSourceTextModuleAssignmentSync(source, exportBindings) {
    const byLocal = sourceTextModuleExportNamesByLocal(exportBindings);
    const locals = Object.keys(byLocal).filter((name) => identifierPattern.test(name));
    if (locals.length === 0) return source;
    const edits = [];
    sourceTextModuleScanAssignmentSyncRange(source, 0, source.length, byLocal, Object.create(null), edits);
    return applySourceTextModuleEdits(source, edits);
}

function sourceTextModuleScanAssignmentSyncRange(source, start, end, byLocal, shadowed, edits) {
    let i = start;
    while (i < end) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(source, i) || (regexCanFollowParen(source, i) && isLikelyRegexLiteral(source, i)))) {
            i = skipRegexLiteral(source, i);
            continue;
        }
        if ((source.startsWith('function', i) && hasIdentifierBoundary(source, i, i + 8))
            || (source.startsWith('class', i) && hasIdentifierBoundary(source, i, i + 5))) {
            const declaration = sourceTextModuleDeclarationBody(source, i);
            if (declaration) {
                const bodyShadowed = sourceTextModuleMergeShadowed(shadowed, declaration.shadowed);
                sourceTextModuleScanAssignmentSyncRange(source, declaration.bodyStart + 1, declaration.bodyEnd, byLocal, bodyShadowed, edits);
                i = declaration.bodyEnd + 1;
                continue;
            }
            i = end;
            continue;
        }
        if (isIdentifierStart(ch) && !isIdentifierChar(source.charCodeAt(i - 1))) {
            let end = i + 1;
            while (end < source.length && isIdentifierChar(source.charCodeAt(end))) end++;
            const localName = source.slice(i, end);
            if (byLocal[localName] && !shadowed[localName] && sourceTextModuleCanRewriteLocalWrite(source, i)) {
                const assignment = skipWhitespaceAndComments(source, end);
                const assignmentEnd = sourceTextModuleAssignmentOperatorEnd(source, assignment);
                if (assignmentEnd >= 0) {
                    const statementEnd = sourceTextModuleAssignmentStatementEnd(source, assignmentEnd);
                    edits.push({
                        start: statementEnd,
                        end: statementEnd,
                        replacement: sourceTextModuleAssignmentSyncSource(byLocal[localName], localName),
                    });
                    i = statementEnd;
                    continue;
                }
                const updateEnd = sourceTextModuleUpdateOperatorEnd(source, i, end);
                if (updateEnd >= 0) {
                    const statementEnd = sourceTextModuleAssignmentStatementEnd(source, updateEnd);
                    edits.push({
                        start: statementEnd,
                        end: statementEnd,
                        replacement: sourceTextModuleAssignmentSyncSource(byLocal[localName], localName),
                    });
                    i = statementEnd;
                    continue;
                }
            }
            i = end;
            continue;
        }
        i++;
    }
}

function sourceTextModuleCanRewriteLocalWrite(source, start) {
    const previous = previousSignificantChar(source, start);
    if (previous === 0x2e || previous === 0x23) return false;
    const word = previousSignificantWord(source, start);
    return word !== 'let' && word !== 'const' && word !== 'var' && word !== 'function' && word !== 'class';
}

function sourceTextModuleDeclarationBody(source, start) {
    let i = start;
    let parenDepth = 0;
    let bracketDepth = 0;
    const paramsStart = source.indexOf('(', start);
    const paramsEnd = paramsStart >= 0 ? findMatchingParen(source, paramsStart) : -1;
    const shadowed = Object.create(null);
    if (paramsStart >= 0 && paramsEnd >= 0) {
        sourceTextModuleCollectBindingNames(source, paramsStart + 1, paramsEnd, shadowed);
    }
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x28) parenDepth++;
        else if (ch === 0x29 && parenDepth > 0) parenDepth--;
        else if (ch === 0x5b) bracketDepth++;
        else if (ch === 0x5d && bracketDepth > 0) bracketDepth--;
        else if (ch === 0x7b && parenDepth === 0 && bracketDepth === 0) {
            const bodyEnd = sourceTextModuleFindMatchingBrace(source, i);
            sourceTextModuleCollectDeclaredNames(source, i + 1, bodyEnd, shadowed);
            return { bodyStart: i, bodyEnd, shadowed };
        }
        i++;
    }
    return null;
}

function sourceTextModuleMergeShadowed(parent, child) {
    const merged = Object.create(null);
    for (const name of Object.keys(parent)) merged[name] = true;
    for (const name of Object.keys(child)) merged[name] = true;
    return merged;
}

function sourceTextModuleCollectBindingNames(source, start, end, out) {
    let i = start;
    while (i < end) {
        if (isIdentifierStart(source.charCodeAt(i))) {
            const nameStart = i;
            i++;
            while (i < end && isIdentifierChar(source.charCodeAt(i))) i++;
            out[source.slice(nameStart, i)] = true;
            continue;
        }
        i++;
    }
}

function sourceTextModuleCollectDeclaredNames(source, start, end, out) {
    let i = start;
    while (i < end) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < end && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if ((source.startsWith('let', i) && hasIdentifierBoundary(source, i, i + 3))
            || (source.startsWith('var', i) && hasIdentifierBoundary(source, i, i + 3))
            || (source.startsWith('const', i) && hasIdentifierBoundary(source, i, i + 5))) {
            const keywordEnd = source.startsWith('const', i) ? i + 5 : i + 3;
            const statementEnd = findSourceTextModuleStatementEnd(source, keywordEnd);
            sourceTextModuleCollectDeclarationListNames(source, keywordEnd, statementEnd, out);
            i = statementEnd;
            continue;
        }
        if ((source.startsWith('function', i) && hasIdentifierBoundary(source, i, i + 8))
            || (source.startsWith('class', i) && hasIdentifierBoundary(source, i, i + 5))) {
            const keywordEnd = source.startsWith('function', i) ? i + 8 : i + 5;
            const nameStart = skipWhitespaceAndComments(source, keywordEnd);
            let nameEnd = nameStart;
            while (nameEnd < end && isIdentifierChar(source.charCodeAt(nameEnd))) nameEnd++;
            if (nameEnd > nameStart) out[source.slice(nameStart, nameEnd)] = true;
            const declaration = sourceTextModuleDeclarationBody(source, i);
            i = declaration ? declaration.bodyEnd + 1 : keywordEnd;
            continue;
        }
        i++;
    }
}

function sourceTextModuleCollectDeclarationListNames(source, start, end, out) {
    const declarations = source.slice(skipWhitespaceAndComments(source, start), end).replace(/;\s*$/, '');
    const declarators = splitDeclarators(declarations);
    for (let i = 0; i < declarators.length; i++) {
        const eq = declarators[i].indexOf('=');
        const name = (eq === -1 ? declarators[i] : declarators[i].slice(0, eq)).trim();
        if (identifierPattern.test(name)) out[name] = true;
    }
}

function sourceTextModuleFindMatchingBrace(source, open) {
    let depth = 1;
    let i = open + 1;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x7b) depth++;
        else if (ch === 0x7d) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return source.length - 1;
}

function sourceTextModuleAssignmentStatementEnd(source, start) {
    let i = start;
    let depth = 0;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(source, i) || (regexCanFollowParen(source, i) && isLikelyRegexLiteral(source, i)))) {
            i = skipRegexLiteral(source, i);
            continue;
        }
        if (ch === 0x28 || ch === 0x5b || ch === 0x7b) {
            depth++;
        } else if ((ch === 0x29 || ch === 0x5d || ch === 0x7d) && depth > 0) {
            depth--;
        }
        if (depth === 0 && ch === 0x3b) return i + 1;
        if (depth === 0 && (ch === 0x0a || ch === 0x0d)) {
            const previous = previousSignificantChar(source, i);
            const next = nextSignificantChar(source, i + 1);
            if (!sourceTextModuleExpressionContinues(previous, next)) return i;
        }
        i++;
    }
    return source.length;
}

function sourceTextModuleExpressionContinues(previous, next) {
    if (previous === 0x2b || previous === 0x2d || previous === 0x2a || previous === 0x2f ||
        previous === 0x25 || previous === 0x26 || previous === 0x7c || previous === 0x5e ||
        previous === 0x3f || previous === 0x3a || previous === 0x2c || previous === 0x3d ||
        previous === 0x3c || previous === 0x3e || previous === 0x21 || previous === 0x7e) {
        return true;
    }
    return next === 0x2b || next === 0x2d || next === 0x2a || next === 0x2f ||
        next === 0x25 || next === 0x26 || next === 0x7c || next === 0x5e ||
        next === 0x3f || next === 0x3a || next === 0x2c || next === 0x2e ||
        next === 0x28 || next === 0x5b;
}

function sourceTextModuleAssignmentOperatorEnd(source, pos) {
    const ch = source.charCodeAt(pos);
    const next = source.charCodeAt(pos + 1);
    if (ch === 0x3d && next !== 0x3d && next !== 0x3e) return pos + 1;
    if ((ch === 0x2b || ch === 0x2d || ch === 0x2a || ch === 0x2f || ch === 0x25 ||
        ch === 0x26 || ch === 0x7c || ch === 0x5e) && next === 0x3d) {
        return pos + 2;
    }
    if ((ch === 0x3c || ch === 0x3e) && next === ch && source.charCodeAt(pos + 2) === 0x3d) {
        return pos + 3;
    }
    if (ch === 0x2a && next === 0x2a && source.charCodeAt(pos + 2) === 0x3d) {
        return pos + 3;
    }
    if (ch === 0x3f && next === 0x3f && source.charCodeAt(pos + 2) === 0x3d) {
        return pos + 3;
    }
    if (ch === 0x26 && next === 0x26 && source.charCodeAt(pos + 2) === 0x3d) {
        return pos + 3;
    }
    if (ch === 0x7c && next === 0x7c && source.charCodeAt(pos + 2) === 0x3d) {
        return pos + 3;
    }
    return -1;
}

function sourceTextModuleUpdateOperatorEnd(source, start, end) {
    const before = previousSignificantIndex(source, start);
    if (before >= 1 && source.charCodeAt(before) === 0x2b && source.charCodeAt(before - 1) === 0x2b) return end;
    if (before >= 1 && source.charCodeAt(before) === 0x2d && source.charCodeAt(before - 1) === 0x2d) return end;
    const after = skipWhitespaceAndComments(source, end);
    if (source.charCodeAt(after) === 0x2b && source.charCodeAt(after + 1) === 0x2b) return after + 2;
    if (source.charCodeAt(after) === 0x2d && source.charCodeAt(after + 1) === 0x2d) return after + 2;
    return -1;
}

function analyzeSourceTextModule(source) {
    const dependencies = [];
    const bySpecifier = Object.create(null);
    const bindings = [];
    const edits = [];
    let sawExportKeyword = false;
    let sawSupportedExport = false;
    let i = 0;

    function getDependency(specifier) {
        return sourceTextModuleGetDependency(dependencies, bySpecifier, specifier);
    }

    function isModuleItemBoundary(pos) {
        const previous = previousSignificantChar(source, pos);
        return previous === 0 || previous === 0x3b || previous === 0x7b || previous === 0x7d;
    }

    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteralWithExpressions(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(source, i) || (regexCanFollowParen(source, i) && isLikelyRegexLiteral(source, i)))) {
            i = skipRegexLiteral(source, i);
            continue;
        }

        if (source.startsWith('import', i) && hasIdentifierBoundary(source, i, i + 6) && isModuleItemBoundary(i)) {
            const afterImport = skipWhitespaceAndComments(source, i + 6);
            if (source.charCodeAt(afterImport) === 0x28) {
                i = afterImport + 1;
                continue;
            }

            const sideEffect = sourceTextModuleReadStringSpecifier(source, afterImport);
            if (sideEffect) {
                const end = findSourceTextModuleStatementEnd(source, sideEffect.end);
                const dependency = getDependency(sideEffect.value);
                sourceTextModuleSetAttributes(dependency, sourceTextModuleParseImportAttributes(source, sideEffect.end, end));
                edits.push({ start: i, end, replacement: '' });
                i = end;
                continue;
            }

            const fromIndex = sourceTextModuleFindFrom(source, afterImport, source.length);
            if (fromIndex >= 0) {
                const specifierStart = skipWhitespaceAndComments(source, fromIndex + 4);
                const specifier = sourceTextModuleReadStringSpecifier(source, specifierStart);
                if (specifier) {
                    const importStatementEnd = findSourceTextModuleStatementEnd(source, specifier.end);
                    const dependency = getDependency(specifier.value);
                    const names = sourceTextModuleParseImportClause(source, afterImport, fromIndex);
                    for (let j = 0; j < names.length; j++) {
                        sourceTextModuleAddImportName(dependency, names[j].imported, names[j].local);
                    }
                    sourceTextModuleSetAttributes(dependency, sourceTextModuleParseImportAttributes(source, specifier.end, importStatementEnd));
                    edits.push({ start: i, end: importStatementEnd, replacement: '' });
                    i = importStatementEnd;
                    continue;
                }
            }
        }

        if (source.startsWith('export', i) && hasIdentifierBoundary(source, i, i + 6) && isModuleItemBoundary(i)) {
            const afterExport = skipWhitespaceAndComments(source, i + 6);
            if (source.startsWith('const', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 5)
                || source.startsWith('let', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 3)
                || source.startsWith('var', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 3)) {
                sawExportKeyword = true;
                sawSupportedExport = true;
                const kindEnd = source.startsWith('const', afterExport) ? afterExport + 5 : afterExport + 3;
                const kind = source.slice(afterExport, kindEnd);
                const statementEnd = findSourceTextModuleStatementEnd(source, kindEnd);
                const declarations = source.slice(skipWhitespaceAndComments(source, kindEnd), statementEnd).replace(/;\s*$/, '');
                const declarators = splitDeclarators(declarations);
                for (let j = 0; j < declarators.length; j++) {
                    const declarator = declarators[j];
                    const eq = declarator.indexOf('=');
                    const bindingName = (eq === -1 ? declarator : declarator.slice(0, eq)).trim();
                    if (!identifierPattern.test(bindingName)) {
                        throw new SyntaxError('Unsupported export declaration in vm.SourceTextModule');
                    }
                    bindings.push({ name: bindingName, localName: bindingName, kind });
                }
                edits.push({ start: i, end: afterExport, replacement: '' });
                for (let j = 0; j < declarators.length; j++) {
                    const bindingName = bindings[bindings.length - declarators.length + j].name;
                    edits.push({ start: statementEnd, end: statementEnd, replacement: sourceTextModuleExportSyncSource(bindingName, bindingName) });
                }
                i = statementEnd;
                continue;
            }
            if (source.startsWith('default', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 7)) {
                sawExportKeyword = true;
                sawSupportedExport = true;
                const valueStart = skipWhitespaceAndComments(source, afterExport + 7);
                const defaultLocal = chooseInternalBindingName(source, '__wasm_rquickjs_vm_default_export');
                if (source.startsWith('function', valueStart) && hasIdentifierBoundary(source, valueStart, valueStart + 8)
                    || source.startsWith('class', valueStart) && hasIdentifierBoundary(source, valueStart, valueStart + 5)) {
                    const keywordEnd = source.startsWith('function', valueStart) ? valueStart + 8 : valueStart + 5;
                    const nameStart = skipWhitespaceAndComments(source, keywordEnd);
                    let nameEnd = nameStart;
                    while (nameEnd < source.length && isIdentifierChar(source.charCodeAt(nameEnd))) nameEnd++;
                    const declarationName = source.slice(nameStart, nameEnd);
                    const statementEnd = findSourceTextModuleStatementEnd(source, valueStart);
                    if (declarationName) {
                        bindings.push({ name: 'default', localName: declarationName, kind: 'const' });
                        edits.push({ start: i, end: valueStart, replacement: '' });
                        edits.push({ start: statementEnd, end: statementEnd, replacement: sourceTextModuleExportSyncSource('default', declarationName) });
                    } else {
                        bindings.push({ name: 'default', localName: defaultLocal, kind: 'const' });
                        edits.push({ start: i, end: valueStart, replacement: 'const ' + defaultLocal + ' = ' });
                        edits.push({ start: statementEnd, end: statementEnd, replacement: sourceTextModuleExportSyncSource('default', defaultLocal) });
                    }
                    i = statementEnd;
                    continue;
                }
                const statementEnd = findSourceTextModuleStatementEnd(source, valueStart);
                bindings.push({ name: 'default', localName: defaultLocal, kind: 'const' });
                edits.push({ start: i, end: valueStart, replacement: 'const ' + defaultLocal + ' = ' });
                edits.push({ start: statementEnd, end: statementEnd, replacement: sourceTextModuleExportSyncSource('default', defaultLocal) });
                i = statementEnd;
                continue;
            }
            if (source.charCodeAt(afterExport) === 0x2a) {
                const fromIndex = sourceTextModuleFindFrom(source, afterExport + 1, source.length);
                if (fromIndex >= 0) {
                    const specifierStart = skipWhitespaceAndComments(source, fromIndex + 4);
                    const specifier = sourceTextModuleReadStringSpecifier(source, specifierStart);
                    if (specifier) {
                        const statementEnd = findSourceTextModuleStatementEnd(source, specifier.end);
                        sawExportKeyword = true;
                        sawSupportedExport = true;
                        const dependency = getDependency(specifier.value);
                        dependency.exportAll = true;
                        sourceTextModuleSetAttributes(dependency, sourceTextModuleParseImportAttributes(source, specifier.end, statementEnd));
                        edits.push({ start: i, end: statementEnd, replacement: '' });
                        i = statementEnd;
                        continue;
                    }
                }
                sawExportKeyword = true;
            }
            if (source.charCodeAt(afterExport) === 0x7b
                || source.startsWith('class', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 5)
                || source.startsWith('function', afterExport) && hasIdentifierBoundary(source, afterExport, afterExport + 8)) {
                sawExportKeyword = true;
            }
        }

        i++;
    }

    if (sawExportKeyword && !sawSupportedExport) {
        throw new SyntaxError('Unsupported export declaration in vm.SourceTextModule');
    }

    return {
        bindings,
        dependencies,
        executableSource: applySourceTextModuleEdits(source, edits),
    };
}

function sourceTextModuleHasImportedNames(dependencies) {
    for (let i = 0; i < dependencies.length; i++) {
        for (let j = 0; j < dependencies[i].names.length; j++) {
            return true;
        }
    }
    return false;
}

function compileSourceTextModuleEvaluator(source, exportBindings, dependencies, importMetaName, exportCellsName, usesImportMeta) {
    const hasImportedNames = sourceTextModuleHasImportedNames(dependencies);
    const executableSource = source;
    const exportObjectEntries = exportBindings.map(function(binding) {
        return JSON.stringify(binding.name) + ': ' + binding.localName;
    }).join(', ');

    if (hasImportedNames) {
        const importsParameterName = chooseInternalBindingName(source, '__wasm_rquickjs_vm_imports');
        if (usesImportMeta) {
            return new Function(importsParameterName, importMetaName, exportCellsName, 'with (' + importsParameterName + ') {\n' + executableSource + '\nreturn { ' + exportObjectEntries + ' };\n}');
        }
        return new Function(importsParameterName, exportCellsName, 'with (' + importsParameterName + ') {\n' + executableSource + '\nreturn { ' + exportObjectEntries + ' };\n}');
    }
    if (usesImportMeta) {
        return new Function(importMetaName, exportCellsName, '"use strict";\n' + executableSource + '\nreturn { ' + exportObjectEntries + ' };');
    }
    return new Function(exportCellsName, '"use strict";\n' + executableSource + '\nreturn { ' + exportObjectEntries + ' };');
}

function rewriteImportMetaForEvaluation(code, replacementSource) {
    code = String(code);
    let changed = false;
    let out = '';
    let last = 0;
    let i = 0;
    while (i < code.length) {
        const ch = code.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(code, i, ch);
            continue;
        }
        if (ch === 0x60) {
            const template = rewriteImportMetaTemplateLiteral(code, i, replacementSource);
            if (template.changed) {
                changed = true;
                out += code.slice(last, i) + template.text;
                last = template.end;
            }
            i = template.end;
            continue;
        }
        if (ch === 0x2f && code.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < code.length && code.charCodeAt(i) !== 0x0a && code.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && code.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(code, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(code, i) || (regexCanFollowParen(code, i) && isLikelyRegexLiteral(code, i)))) {
            i = skipRegexLiteral(code, i);
            continue;
        }
        if (code.startsWith('import', i)
            && hasIdentifierBoundary(code, i, i + 6)
            && previousSignificantChar(code, i) !== 0x2e
            && previousSignificantChar(code, i) !== 0x23) {
            const dot = skipWhitespaceAndComments(code, i + 6);
            if (code.charCodeAt(dot) === 0x2e) {
                const meta = skipWhitespaceAndComments(code, dot + 1);
                if (code.startsWith('meta', meta) && hasIdentifierBoundary(code, meta, meta + 4)) {
                    changed = true;
                    out += code.slice(last, i) + replacementSource;
                    last = meta + 4;
                    i = meta + 4;
                    continue;
                }
            }
        }
        i++;
    }
    if (last === 0) return { code, changed: false };
    return { code: out + code.slice(last), changed };
}

function rewriteImportMetaTemplateLiteral(source, start, replacementSource) {
    let i = start + 1;
    let out = '`';
    let chunkStart = i;
    let changed = false;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        if (ch === 0x60) {
            out += source.slice(chunkStart, i + 1);
            return { end: i + 1, text: out, changed };
        }
        if (ch === 0x24 && source.charCodeAt(i + 1) === 0x7b) {
            out += source.slice(chunkStart, i + 2);
            const expressionStart = i + 2;
            const expressionEnd = findTemplateExpressionEnd(source, expressionStart);
            if (expressionEnd === -1) {
                out += source.slice(expressionStart);
                return { end: source.length, text: out, changed };
            }
            const expression = source.slice(expressionStart, expressionEnd);
            const rewritten = rewriteImportMetaForEvaluation(expression, replacementSource);
            if (rewritten.changed) changed = true;
            out += rewritten.code + '}';
            i = expressionEnd + 1;
            chunkStart = i;
            continue;
        }
        i++;
    }
    out += source.slice(chunkStart);
    return { end: source.length, text: out, changed };
}

function chooseInternalBindingName(source, baseName) {
    let name = baseName;
    let suffix = 0;
    while (source.indexOf(name) !== -1) {
        suffix++;
        name = baseName + '_' + suffix;
    }
    return name;
}

function createModuleNamespace(module) {
    const namespaceTarget = Object.create(null);
    const names = module._names.slice().sort();

    for (let i = 0; i < names.length; i++) {
        const exportName = names[i];
        Object.defineProperty(namespaceTarget, exportName, {
            get: function() {
                return sourceTextModuleBindingValue(module._bindings[exportName], exportName);
            },
            enumerable: true,
            configurable: false,
        });
    }

    // QuickJS does not expose virtual export keys from this proxy via
    // Object.getOwnPropertyNames() while bindings are uninitialized.
    // Store names out-of-band so util.inspect can still enumerate exports.
    Object.defineProperty(namespaceTarget, moduleNamespaceExportsSymbol, {
        value: names.slice(),
        enumerable: false,
        writable: false,
        configurable: false,
    });
    Object.defineProperty(namespaceTarget, moduleNamespaceBindingsSymbol, {
        value: module._bindings,
        enumerable: false,
        writable: false,
        configurable: false,
    });
    Object.defineProperty(namespaceTarget, moduleNamespaceBrandSymbol, {
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
    });

    Object.defineProperty(namespaceTarget, Symbol.toStringTag, {
        value: 'Module',
        enumerable: false,
        writable: false,
        configurable: true,
    });

    return new Proxy(namespaceTarget, {
        ownKeys: function() {
            return names.concat([Symbol.toStringTag]);
        },
        has: function(_target, prop) {
            if (typeof prop === 'string' && module._bindings[prop] !== undefined) {
                return true;
            }
            return prop in namespaceTarget;
        },
        get: function(_target, prop, receiver) {
            if (typeof prop === 'string' && module._bindings[prop] !== undefined) {
                return sourceTextModuleBindingValue(module._bindings[prop], prop);
            }
            return Reflect.get(namespaceTarget, prop, receiver);
        },
        getOwnPropertyDescriptor: function(_target, prop) {
            return Object.getOwnPropertyDescriptor(namespaceTarget, prop);
        },
    });
}

function sourceTextModuleBindingValue(binding, name) {
    if (!binding.initialized) {
        throw new ReferenceError(name + ' is not initialized');
    }
    if (binding.kind === 'reexport') {
        return binding.module.namespace[binding.importName];
    }
    return binding.value;
}

function createIndirectEvalSource(code) {
    return '(0, eval)(' + JSON.stringify(code) + ')';
}

function createSandboxEvalSource(code, helperName, sandboxKeys, descriptorHelperName, symbolHelperName, deletedGlobalKeys) {
    const sandboxKeyLiterals = [];
    for (let i = 0; i < sandboxKeys.length; i++) {
        sandboxKeyLiterals.push(JSON.stringify(sandboxKeys[i]));
    }
    const deletedGlobalKeyLiterals = [];
    for (let i = 0; i < deletedGlobalKeys.length; i++) {
        deletedGlobalKeyLiterals.push(JSON.stringify(deletedGlobalKeys[i]));
    }
    return '(() => {' +
        'const __wasm_rquickjs_vm_Object = ({}).constructor;' +
        'const __wasm_rquickjs_vm_create = __wasm_rquickjs_vm_Object.create;' +
        'const __wasm_rquickjs_vm_names_of = __wasm_rquickjs_vm_Object.getOwnPropertyNames;' +
        'const __wasm_rquickjs_vm_symbols_of = __wasm_rquickjs_vm_Object.getOwnPropertySymbols;' +
        'const __wasm_rquickjs_vm_get_desc = __wasm_rquickjs_vm_Object.getOwnPropertyDescriptor;' +
        'const __wasm_rquickjs_vm_define = __wasm_rquickjs_vm_Object.defineProperty;' +
        'const __wasm_rquickjs_vm_is = __wasm_rquickjs_vm_Object.is;' +
        'const __wasm_rquickjs_vm_same_desc = (__wasm_rquickjs_vm_a, __wasm_rquickjs_vm_b) => __wasm_rquickjs_vm_a === __wasm_rquickjs_vm_b || (__wasm_rquickjs_vm_a !== undefined && __wasm_rquickjs_vm_b !== undefined && __wasm_rquickjs_vm_is(__wasm_rquickjs_vm_a.value, __wasm_rquickjs_vm_b.value) && __wasm_rquickjs_vm_is(__wasm_rquickjs_vm_a.get, __wasm_rquickjs_vm_b.get) && __wasm_rquickjs_vm_is(__wasm_rquickjs_vm_a.set, __wasm_rquickjs_vm_b.set) && __wasm_rquickjs_vm_a.writable === __wasm_rquickjs_vm_b.writable && __wasm_rquickjs_vm_a.enumerable === __wasm_rquickjs_vm_b.enumerable && __wasm_rquickjs_vm_a.configurable === __wasm_rquickjs_vm_b.configurable);' +
        'const __wasm_rquickjs_vm_descriptors = ' + (descriptorHelperName ? 'globalThis[' + JSON.stringify(descriptorHelperName) + ']' : 'undefined') + ';' +
        (descriptorHelperName ? 'delete globalThis[' + JSON.stringify(descriptorHelperName) + '];' : '') +
        'const __wasm_rquickjs_vm_symbol_bindings = ' + (symbolHelperName ? 'globalThis[' + JSON.stringify(symbolHelperName) + ']' : 'undefined') + ';' +
        (symbolHelperName ? 'delete globalThis[' + JSON.stringify(symbolHelperName) + '];' : '') +
        'const __wasm_rquickjs_vm_sandbox_key_list = [' + sandboxKeyLiterals.join(',') + '];' +
        'const __wasm_rquickjs_vm_deleted_global_list = [' + deletedGlobalKeyLiterals.join(',') + '];' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_deleted_global_list.length; __wasm_rquickjs_vm_i++) {' +
        'delete globalThis[__wasm_rquickjs_vm_deleted_global_list[__wasm_rquickjs_vm_i]];' +
        '}' +
        'if (__wasm_rquickjs_vm_descriptors !== undefined) {' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_key_list.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_sandbox_key_list[__wasm_rquickjs_vm_i];' +
        'const __wasm_rquickjs_vm_desc = __wasm_rquickjs_vm_descriptors[__wasm_rquickjs_vm_key];' +
        'if (__wasm_rquickjs_vm_desc !== undefined) {' +
        'const __wasm_rquickjs_vm_current_desc = __wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key);' +
        'if (!__wasm_rquickjs_vm_same_desc(__wasm_rquickjs_vm_current_desc, __wasm_rquickjs_vm_desc)) {' +
        '__wasm_rquickjs_vm_define(globalThis, __wasm_rquickjs_vm_key, __wasm_rquickjs_vm_desc);' +
        '}' +
        '}' +
        '}' +
        '}' +
        'const __wasm_rquickjs_vm_sandbox_symbol_list = __wasm_rquickjs_vm_symbol_bindings === undefined ? [] : __wasm_rquickjs_vm_symbol_bindings.keys;' +
        'const __wasm_rquickjs_vm_sandbox_symbol_descriptors = __wasm_rquickjs_vm_symbol_bindings === undefined ? [] : __wasm_rquickjs_vm_symbol_bindings.descriptors;' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_symbol_list.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_symbol = __wasm_rquickjs_vm_sandbox_symbol_list[__wasm_rquickjs_vm_i];' +
        'const __wasm_rquickjs_vm_desc = __wasm_rquickjs_vm_sandbox_symbol_descriptors[__wasm_rquickjs_vm_i];' +
        'if (__wasm_rquickjs_vm_desc !== undefined) {' +
        'const __wasm_rquickjs_vm_current_desc = __wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_symbol);' +
        'if (!__wasm_rquickjs_vm_same_desc(__wasm_rquickjs_vm_current_desc, __wasm_rquickjs_vm_desc)) {' +
        '__wasm_rquickjs_vm_define(globalThis, __wasm_rquickjs_vm_symbol, __wasm_rquickjs_vm_desc);' +
        '}' +
        '}' +
        '}' +
        'const __wasm_rquickjs_vm_baseline = __wasm_rquickjs_vm_create(null);' +
        'const __wasm_rquickjs_vm_baseline_keys = __wasm_rquickjs_vm_names_of(globalThis);' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_baseline_keys.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_baseline_keys[__wasm_rquickjs_vm_i];' +
        '__wasm_rquickjs_vm_baseline[__wasm_rquickjs_vm_key] = __wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key);' +
        '}' +
        'const __wasm_rquickjs_vm_sandbox_keys = __wasm_rquickjs_vm_create(null);' +
        'const __wasm_rquickjs_vm_represented_sandbox_keys = __wasm_rquickjs_vm_create(null);' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_key_list.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_sandbox_key_list[__wasm_rquickjs_vm_i];' +
        '__wasm_rquickjs_vm_sandbox_keys[__wasm_rquickjs_vm_key] = true;' +
        'if (__wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key) !== undefined) {' +
        '__wasm_rquickjs_vm_represented_sandbox_keys[__wasm_rquickjs_vm_key] = true;' +
        '}' +
        '}' +
        'const __wasm_rquickjs_vm_represented_symbol_indexes = [];' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_symbol_list.length; __wasm_rquickjs_vm_i++) {' +
        'if (__wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_sandbox_symbol_list[__wasm_rquickjs_vm_i]) !== undefined) {' +
        '__wasm_rquickjs_vm_represented_symbol_indexes[__wasm_rquickjs_vm_i] = true;' +
        '}' +
        '}' +
        'let __wasm_rquickjs_vm_result;' +
        'let __wasm_rquickjs_vm_thrown;' +
        'let __wasm_rquickjs_vm_ok = true;' +
        'try {' +
        '__wasm_rquickjs_vm_result = ' + createIndirectEvalSource(code) + ';' +
        '} catch (__wasm_rquickjs_vm_error) {' +
        '__wasm_rquickjs_vm_ok = false;' +
        '__wasm_rquickjs_vm_thrown = __wasm_rquickjs_vm_error;' +
        '}' +
        'const __wasm_rquickjs_vm_updates = [];' +
        'const __wasm_rquickjs_vm_keys = __wasm_rquickjs_vm_names_of(globalThis);' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_keys.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_keys[__wasm_rquickjs_vm_i];' +
        (helperName ? 'if (__wasm_rquickjs_vm_key === ' + JSON.stringify(helperName) + ') continue;' : '') +
        'const __wasm_rquickjs_vm_desc = __wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key);' +
        'if (!__wasm_rquickjs_vm_represented_sandbox_keys[__wasm_rquickjs_vm_key] && __wasm_rquickjs_vm_same_desc(__wasm_rquickjs_vm_baseline[__wasm_rquickjs_vm_key], __wasm_rquickjs_vm_desc)) continue;' +
        '__wasm_rquickjs_vm_updates[__wasm_rquickjs_vm_updates.length] = [__wasm_rquickjs_vm_key, true, __wasm_rquickjs_vm_desc];' +
        '}' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_baseline_keys.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_baseline_keys[__wasm_rquickjs_vm_i];' +
        'if (__wasm_rquickjs_vm_represented_sandbox_keys[__wasm_rquickjs_vm_key]) continue;' +
        'if (__wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key) === undefined) {' +
        '__wasm_rquickjs_vm_updates[__wasm_rquickjs_vm_updates.length] = [__wasm_rquickjs_vm_key, false, undefined, true];' +
        '}' +
        '}' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_key_list.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_key = __wasm_rquickjs_vm_sandbox_key_list[__wasm_rquickjs_vm_i];' +
        'if (!__wasm_rquickjs_vm_represented_sandbox_keys[__wasm_rquickjs_vm_key]) continue;' +
        'if (__wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_key) === undefined) {' +
        '__wasm_rquickjs_vm_updates[__wasm_rquickjs_vm_updates.length] = [__wasm_rquickjs_vm_key, false, undefined, false];' +
        '}' +
        '}' +
        'for (let __wasm_rquickjs_vm_i = 0; __wasm_rquickjs_vm_i < __wasm_rquickjs_vm_sandbox_symbol_list.length; __wasm_rquickjs_vm_i++) {' +
        'const __wasm_rquickjs_vm_symbol = __wasm_rquickjs_vm_sandbox_symbol_list[__wasm_rquickjs_vm_i];' +
        'if (!__wasm_rquickjs_vm_represented_symbol_indexes[__wasm_rquickjs_vm_i]) continue;' +
        'const __wasm_rquickjs_vm_symbol_desc = __wasm_rquickjs_vm_get_desc(globalThis, __wasm_rquickjs_vm_symbol);' +
        'if (__wasm_rquickjs_vm_symbol_desc === undefined) {' +
        '__wasm_rquickjs_vm_updates[__wasm_rquickjs_vm_updates.length] = [__wasm_rquickjs_vm_symbol, false, undefined];' +
        '} else {' +
        '__wasm_rquickjs_vm_updates[__wasm_rquickjs_vm_updates.length] = [__wasm_rquickjs_vm_symbol, true, __wasm_rquickjs_vm_symbol_desc];' +
        '}' +
        '}' +
        'return [__wasm_rquickjs_vm_ok, __wasm_rquickjs_vm_ok ? __wasm_rquickjs_vm_result : __wasm_rquickjs_vm_thrown, __wasm_rquickjs_vm_updates];' +
        '})()';
}

function applySandboxUpdates(sandbox, evaluation) {
    const defineProperty = ({}).constructor.defineProperty;
    const ok = evaluation[0];
    const result = evaluation[1];
    if (!sandbox || typeof sandbox !== 'object') {
        if (!ok) throw result;
        return result;
    }
    const updates = evaluation[2];
    let deletedGlobals = contextDeletedGlobals.get(sandbox);
    for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        try {
            if (update[1]) {
                defineProperty(sandbox, update[0], update[2]);
                if (deletedGlobals) {
                    delete deletedGlobals[update[0]];
                }
            } else {
                delete sandbox[update[0]];
                if (update[3]) {
                    if (!deletedGlobals) {
                        deletedGlobals = Object.create(null);
                        contextDeletedGlobals.set(sandbox, deletedGlobals);
                    }
                    deletedGlobals[update[0]] = true;
                } else if (deletedGlobals) {
                    delete deletedGlobals[update[0]];
                }
            }
        } catch (_writeBackError) {
            if (!ok) throw result;
        }
    }
    if (!ok) throw result;
    return result;
}

export function runInNewContext(code, sandbox, options) {
    if (code === undefined || code === null) code = '';
    code = String(code);
    if (sandbox !== undefined && (sandbox === null || typeof sandbox !== 'object')) {
        throwInvalidArgType('object', 'object', sandbox);
    }
    options = normalizeRunOptions(options);
    validateVmRunOptions(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    let helperName;
    if (options.importModuleDynamically === USE_MAIN_CONTEXT_DEFAULT_LOADER) {
        const rewritten = rewriteDefaultLoaderDynamicImportsForEvaluation(code, referrerFilenameFromOptions(options));
        code = rewritten.code;
        helperName = rewritten.helperName;
    } else if (options.importModuleDynamically === undefined) {
        const rewritten = rewriteMissingDynamicImportsForEvaluation(code);
        code = rewritten.code;
        helperName = rewritten.helperName;
    } else if (typeof options.importModuleDynamically === 'function') {
        const rewritten = vmModulesEnabled()
            ? rewriteVmDynamicImportCallbackForEvaluation(code, options.importModuleDynamically, undefined)
            : rewriteMissingDynamicImportFlagForEvaluation(code);
        code = rewritten.code;
        helperName = rewritten.helperName;
    }
    return evalVmRunWithFilename(() => evalCodeInNewContext(code, sandbox, helperName), options.filename);
}

function evalCodeInNewContext(code, sandbox, helperName) {
    if (isEmptyVmSourceText(code)) return undefined;

    const keys = [];
    const values = [];
    let sandboxKeys = [];
    let descriptorHelperName;
    let symbolHelperName;

    let deletedGlobalKeys = [];

    if (sandbox && typeof sandbox === 'object') {
        const bindings = collectSandboxBindings(sandbox);
        sandboxKeys = bindings.keys;
        deletedGlobalKeys = bindings.deletedGlobalKeys;
        if (bindings.keys.length > 0) {
            descriptorHelperName = chooseSandboxDescriptorsHelperName(code, bindings.keys);
            keys.push(descriptorHelperName);
            values.push(bindings.descriptors);
        }
        if (bindings.symbolKeys.length > 0) {
            symbolHelperName = chooseSandboxSymbolsHelperName(code, bindings.keys);
            keys.push(symbolHelperName);
            values.push({ keys: bindings.symbolKeys, descriptors: bindings.symbolDescriptors });
        }
    }
    if (helperName) {
        keys.push(helperName);
        values.push(globalThis[helperName]);
    }

    return applySandboxUpdates(sandbox, evalInNewContext(createSandboxEvalSource(code, helperName, sandboxKeys, descriptorHelperName, symbolHelperName, deletedGlobalKeys), keys, values));
}

function createContextForRunInNewContext(sandbox) {
    if (sandbox === undefined) {
        return createContext({});
    }
    if (sandbox === null || typeof sandbox !== 'object') {
        throwInvalidArgType('object', 'object', sandbox);
    }
    return createContext(sandbox);
}

function validateRunInNewContextPreSandboxOptions(options) {
    if (options === null || typeof options !== 'object') {
        return;
    }
    if (options.contextName !== undefined && typeof options.contextName !== 'string') {
        throwInvalidPropertyType('options.contextName', 'string', options.contextName);
    }
    if (options.contextOrigin !== undefined && typeof options.contextOrigin !== 'string') {
        throwInvalidPropertyType('options.contextOrigin', 'string', options.contextOrigin);
    }
    if (options.contextCodeGeneration !== undefined) {
        if (options.contextCodeGeneration === null || typeof options.contextCodeGeneration !== 'object') {
            throwInvalidPropertyType('options.contextCodeGeneration', 'object', options.contextCodeGeneration);
        }
        if (options.contextCodeGeneration.strings !== undefined && typeof options.contextCodeGeneration.strings !== 'boolean') {
            throwInvalidPropertyType('options.contextCodeGeneration.strings', 'boolean', options.contextCodeGeneration.strings);
        }
        if (options.contextCodeGeneration.wasm !== undefined && typeof options.contextCodeGeneration.wasm !== 'boolean') {
            throwInvalidPropertyType('options.contextCodeGeneration.wasm', 'boolean', options.contextCodeGeneration.wasm);
        }
    }
}

function validateRunInNewContextPostSandboxOptions(options) {
    if (options === null || typeof options !== 'object') {
        return;
    }
    if (options.microtaskMode !== undefined && options.microtaskMode !== 'afterEvaluate') {
        throw invalidArgValue("The property 'options.microtaskMode' must be one of: 'afterEvaluate', undefined. Received " + formatReceived(options.microtaskMode));
    }
}

export function createContext(sandbox, options) {
    if (sandbox === undefined || sandbox === null) {
        sandbox = {};
    }
    if (typeof sandbox !== 'object') {
        throwInvalidArgType('object', 'object', sandbox);
    }
    options = validateOptionsObject(options);
    contextIds.set(sandbox, contextIdCounter++);
    contextOptions.set(sandbox, snapshotVmOptions(options));
    return sandbox;
}

export function isContext(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
        throwInvalidArgType('object', 'object', obj);
    }
    return isContextObject(obj);
}

function isContextObject(obj) {
    return obj != null && typeof obj === 'object' && contextIds.has(obj);
}

export function runInContext(code, context, options) {
    if (!isContext(context)) {
        throwInvalidContextifiedObject();
    }
    if (code === undefined || code === null) code = '';
    code = String(code);
    options = normalizeRunOptions(options);
    validateVmRunOptions(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    let helperName;
    if (options.importModuleDynamically === USE_MAIN_CONTEXT_DEFAULT_LOADER) {
        const rewritten = rewriteDefaultLoaderDynamicImportsForEvaluation(code, referrerFilenameFromOptions(options));
        code = rewritten.code;
        helperName = rewritten.helperName;
    } else if (options.importModuleDynamically === undefined) {
        const rewritten = rewriteMissingDynamicImportsForEvaluation(code);
        code = rewritten.code;
        helperName = rewritten.helperName;
    } else if (typeof options.importModuleDynamically === 'function') {
        const rewritten = vmModulesEnabled()
            ? rewriteVmDynamicImportCallbackForEvaluation(code, options.importModuleDynamically, undefined)
            : rewriteMissingDynamicImportFlagForEvaluation(code);
        code = rewritten.code;
        helperName = rewritten.helperName;
    }
    return evalVmRunWithFilename(() => evalCodeInContext(code, context, helperName), options.filename);
}

function evalCodeInContext(code, context, helperName) {
    if (isEmptyVmSourceText(code)) return undefined;

    const keys = [];
    const values = [];
    const bindings = collectSandboxBindings(context);
    let descriptorHelperName;
    let symbolHelperName;
    if (bindings.keys.length > 0) {
        descriptorHelperName = chooseSandboxDescriptorsHelperName(code, bindings.keys);
        keys.push(descriptorHelperName);
        values.push(bindings.descriptors);
    }
    if (bindings.symbolKeys.length > 0) {
        symbolHelperName = chooseSandboxSymbolsHelperName(code, bindings.keys);
        keys.push(symbolHelperName);
        values.push({ keys: bindings.symbolKeys, descriptors: bindings.symbolDescriptors });
    }
    if (helperName) {
        keys.push(helperName);
        values.push(globalThis[helperName]);
    }

    return applySandboxUpdates(context, evalInNewContext(createSandboxEvalSource(code, helperName, bindings.keys, descriptorHelperName, symbolHelperName, bindings.deletedGlobalKeys), keys, values));
}

export function runInThisContext(code, options) {
    if (code === undefined || code === null) return undefined;
    code = String(code);
    options = normalizeRunOptions(options);
    validateVmRunOptions(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    if (options.importModuleDynamically === USE_MAIN_CONTEXT_DEFAULT_LOADER) {
        const filename = referrerFilenameFromOptions(options);
        return evalVmRunWithFilename(() => evalWithFilename(rewriteDefaultLoaderDynamicImportsForEvaluation(code, filename).code, filename), filename);
    }
    if (options.importModuleDynamically === undefined) {
        const rewritten = rewriteMissingDynamicImportsForEvaluation(code).code;
        return evalVmRunWithFilename(() => evalWithFilename(rewritten, filenameForMainContextEval(options)), options.filename);
    }
    if (typeof options.importModuleDynamically === 'function') {
        const rewritten = vmModulesEnabled()
            ? rewriteVmDynamicImportCallbackForEvaluation(code, options.importModuleDynamically, undefined)
            : rewriteMissingDynamicImportFlagForEvaluation(code);
        return evalVmRunWithFilename(() => evalWithFilename(rewritten.code, filenameForMainContextEval(options)), options.filename);
    }
    return evalVmRunWithFilename(() => evalWithFilename(code, filenameForMainContextEval(options)), options.filename);
}

function filenameForMainContextEval(options) {
    return options.filename === undefined ? 'evalmachine.<anonymous>' : options.filename;
}

function normalizeRunOptions(options) {
    if (typeof options === 'string') {
        return { filename: options };
    }
    return validateOptionsObject(options);
}

function validateVmRunOptions(options) {
    if (options.filename !== undefined && typeof options.filename !== 'string') {
        throwInvalidPropertyType('options.filename', 'string', options.filename);
    }
    validateInt32PropertyOption(options.lineOffset, 'options.lineOffset');
    validateInt32PropertyOption(options.columnOffset, 'options.columnOffset');
}

function evalVmRunWithFilename(fn, filename) {
    try {
        return fn();
    } catch (err) {
        normalizeVmRunFilenameStack(err, filename);
        throw err;
    }
}

function normalizeVmRunFilenameStack(err, filename) {
    if (filename === undefined || !err || typeof err !== 'object') return;
    err.stack = String(filename) + ':1\n' + (err.name || 'Error') + ': ' + (err.message || '');
}

export function compileFunction(code, params, options) {
    if (typeof code !== 'string') {
        throwInvalidArgType('code', 'string', code);
    }
    if (params === undefined) {
        params = [];
    } else if (!Array.isArray(params)) {
        throwInvalidArgInstance('params', 'Array', params);
    }
    options = validateOptionsObject(options);
    validateCompileFunctionOptions(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    validateInt32PropertyOption(options.lineOffset, 'options.lineOffset');
    validateInt32PropertyOption(options.columnOffset, 'options.columnOffset');
    const sourceCode = code;
    if (options.importModuleDynamically === USE_MAIN_CONTEXT_DEFAULT_LOADER) {
        const filename = referrerFilenameFromOptions(options);
        const paramList = params.map(String).join(',');
        const source = '[function(' + paramList + '){' + rewriteDefaultLoaderDynamicImportsForEvaluation(code, filename).code + '\n}][0]';
        return finalizeCompileFunction(evaluateCompileFunctionSource(source, sourceCode, filename), sourceCode, params, options);
    }
    if (options.importModuleDynamically === undefined) {
        code = rewriteMissingDynamicImportsForEvaluation(code).code;
    } else if (typeof options.importModuleDynamically === 'function') {
        if (vmModulesEnabled()) {
            const referrer = { [vmDynamicImportReferrerSymbol]: undefined };
            code = rewriteVmDynamicImportCallbackForEvaluation(code, options.importModuleDynamically, referrer).code;
            const fn = compileFunctionInContext(code, params, options);
            const publicFunction = finalizeCompileFunction(fn, sourceCode, params, options);
            referrer[vmDynamicImportReferrerSymbol] = publicFunction;
            return publicFunction;
        }
        code = rewriteMissingDynamicImportFlagForEvaluation(code).code;
    }
    return finalizeCompileFunction(compileFunctionInContext(code, params, options), sourceCode, params, options);
}

function validateCompileFunctionOptions(options) {
    if (options.filename !== undefined && typeof options.filename !== 'string') {
        throwInvalidPropertyType('options.filename', 'string', options.filename);
    }
    if (options.cachedData !== undefined && !ArrayBuffer.isView(options.cachedData)) {
        throwInvalidPropertyInstance('options.cachedData', 'Buffer, TypedArray, or DataView', options.cachedData);
    }
    if (options.produceCachedData !== undefined && typeof options.produceCachedData !== 'boolean') {
        throwInvalidPropertyType('options.produceCachedData', 'boolean', options.produceCachedData);
    }
    if (options.parsingContext !== undefined && !isContextObject(options.parsingContext)) {
        throwInvalidPropertyInstance('options.parsingContext', 'Context', options.parsingContext);
    }
    if (options.contextExtensions !== undefined && !Array.isArray(options.contextExtensions)) {
        throwInvalidPropertyInstance('options.contextExtensions', 'Array', options.contextExtensions);
    }
    if (Array.isArray(options.contextExtensions)) {
        for (let i = 0; i < options.contextExtensions.length; i++) {
            const value = options.contextExtensions[i];
            if (value === null || typeof value !== 'object') {
                throwInvalidPropertyType('options.contextExtensions[' + i + ']', 'object', value);
            }
        }
    }
}

function validateScriptConstructorOptions(options) {
    if (typeof options === 'string') {
        return { filename: options };
    }
    options = validateOptionsObject(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    validateInt32PropertyOption(options.lineOffset, 'options.lineOffset');
    validateInt32PropertyOption(options.columnOffset, 'options.columnOffset');
    if (options.filename !== undefined && typeof options.filename !== 'string') {
        throwInvalidPropertyType('options.filename', 'string', options.filename);
    }
    if (options.produceCachedData !== undefined && typeof options.produceCachedData !== 'boolean') {
        throwInvalidPropertyType('options.produceCachedData', 'boolean', options.produceCachedData);
    }
    if (options.cachedData !== undefined && !ArrayBuffer.isView(options.cachedData)) {
        throwInvalidPropertyInstance('options.cachedData', 'Buffer, TypedArray, or DataView', options.cachedData);
    }
    return options;
}

function validateScriptRunOptions(options) {
    options = validateOptionsObject(options);
    if (options.timeout !== undefined) {
        if (typeof options.timeout !== 'number') {
            throwInvalidArgType('options.timeout', 'number', options.timeout);
        }
        if (!Number.isInteger(options.timeout)) {
            throwOutOfRange('options.timeout', 'an integer', options.timeout);
        }
        if (options.timeout < 1 || options.timeout > 4294967295) {
            throwOutOfRange('options.timeout', '>= 1 && <= 4294967295', options.timeout);
        }
    }
    if (options.displayErrors !== undefined && typeof options.displayErrors !== 'boolean') {
        throwInvalidPropertyType('options.displayErrors', 'boolean', options.displayErrors);
    }
    if (options.breakOnSigint !== undefined && typeof options.breakOnSigint !== 'boolean') {
        throwInvalidPropertyType('options.breakOnSigint', 'boolean', options.breakOnSigint);
    }
    return options;
}

function compileFunctionInContext(code, params, options) {
    const source = '[function(' + params.map(String).join(',') + '){' + code + '\n}][0]';
    const keys = [];
    const values = [];

    if (options.parsingContext !== undefined) {
        collectContextBindings(options.parsingContext, keys, values);
    }
    if (Array.isArray(options.contextExtensions)) {
        for (let i = 0; i < options.contextExtensions.length; i++) {
            collectContextBindings(options.contextExtensions[i], keys, values);
        }
    }
    if (keys.length > 0) {
        try {
            return evalInNewContext(createIndirectEvalSource(source), keys, values);
        } catch (err) {
            throw normalizeCompileFunctionSyntaxError(err, code);
        }
    }
    return evaluateCompileFunctionSource(source, code);
}

function evaluateCompileFunctionSource(source, code, filename) {
    try {
        if (filename !== undefined) {
            return evalWithFilename(source, filename);
        }
        return (0, eval)(source);
    } catch (err) {
        throw normalizeCompileFunctionSyntaxError(err, code);
    }
}

function normalizeCompileFunctionSyntaxError(err, code) {
    if (err && err.name === 'SyntaxError') {
        const first = firstNonWhitespaceChar(code);
        if (first === '}') {
            return new SyntaxError("Unexpected token '}'");
        }
    }
    return err;
}

function firstNonWhitespaceChar(value) {
    for (let i = 0; i < value.length; i++) {
        const ch = value.charCodeAt(i);
        if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) {
            return value[i];
        }
    }
    return '';
}

function isEmptyVmSourceText(value) {
    let i = 0;
    let lineStart = true;
    while (i < value.length) {
        const ch = value.charCodeAt(i);
        if (i === 0 && ch === 0x23 && value.charCodeAt(i + 1) === 0x21) {
            i += 2;
            while (i < value.length) {
                const lineCh = value.charCodeAt(i);
                if (isVmSourceLineTerminator(lineCh)) break;
                i++;
            }
            continue;
        }
        if (ch === 0x2f && value.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < value.length) {
                const lineCh = value.charCodeAt(i);
                if (isVmSourceLineTerminator(lineCh)) break;
                i++;
            }
            continue;
        }
        if (ch === 0x2f && value.charCodeAt(i + 1) === 0x2a) {
            const end = value.indexOf('*/', i + 2);
            if (end === -1) return false;
            for (let j = i + 2; j < end; j++) {
                if (isVmSourceLineTerminator(value.charCodeAt(j))) {
                    lineStart = true;
                }
            }
            i = end + 2;
            continue;
        }
        if (ch === 0x3c && value.charCodeAt(i + 1) === 0x21 && value.charCodeAt(i + 2) === 0x2d && value.charCodeAt(i + 3) === 0x2d) {
            i += 4;
            while (i < value.length) {
                const lineCh = value.charCodeAt(i);
                if (isVmSourceLineTerminator(lineCh)) break;
                i++;
            }
            continue;
        }
        if (lineStart && ch === 0x2d && value.charCodeAt(i + 1) === 0x2d && value.charCodeAt(i + 2) === 0x3e) {
            i += 3;
            while (i < value.length) {
                const lineCh = value.charCodeAt(i);
                if (isVmSourceLineTerminator(lineCh)) break;
                i++;
            }
            continue;
        }
        if (!isVmSourceWhitespace(ch)) return false;
        if (isVmSourceLineTerminator(ch)) {
            lineStart = true;
        }
        i++;
    }
    return true;
}

function isVmSourceWhitespace(ch) {
    return isVmSourceLineTerminator(ch) ||
        ch === 0x09 ||
        ch === 0x0b ||
        ch === 0x0c ||
        ch === 0x20 ||
        ch === 0xa0 ||
        ch === 0x1680 ||
        ch === 0x202f ||
        ch === 0x205f ||
        ch === 0x3000 ||
        ch === 0xfeff ||
        (ch >= 0x2000 && ch <= 0x200a);
}

function isVmSourceLineTerminator(ch) {
    return ch === 0x0a || ch === 0x0d || ch === 0x2028 || ch === 0x2029;
}

function collectContextBindings(context, keys, values) {
    const contextKeys = Object.keys(context);
    for (let i = 0; i < contextKeys.length; i++) {
        const key = contextKeys[i];
        keys.push(key);
        values.push(context[key]);
    }
}

function collectSandboxBindings(sandbox) {
    const descriptors = Object.create(null);
    const keys = Object.getOwnPropertyNames(sandbox);
    const values = [];
    const deletedGlobals = contextDeletedGlobals.get(sandbox);
    const deletedGlobalKeys = deletedGlobals ? Object.getOwnPropertyNames(deletedGlobals).filter((key) => keys.indexOf(key) === -1) : [];
    for (let i = 0; i < keys.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(sandbox, keys[i]);
        descriptors[keys[i]] = descriptor;
        values.push(descriptor && 'value' in descriptor ? descriptor.value : undefined);
    }
    const symbolKeys = Object.getOwnPropertySymbols(sandbox);
    const symbolDescriptors = [];
    for (let i = 0; i < symbolKeys.length; i++) {
        symbolDescriptors.push(Object.getOwnPropertyDescriptor(sandbox, symbolKeys[i]));
    }
    return { keys, values, descriptors, symbolKeys, symbolDescriptors, deletedGlobalKeys };
}

function finalizeCompileFunction(fn, code, params, options) {
    fn = new Proxy(fn, {
        apply(target, thisArg, args) {
            try {
                return Reflect.apply(target, thisArg, args);
            } catch (err) {
                normalizeCompileFunctionRuntimeStack(err, code, options);
                throw err;
            }
        },
    });
    const renderedParams = params.map(String).join(', ');
    Object.defineProperty(fn, 'toString', {
        configurable: true,
        value() {
            return 'function (' + renderedParams + ') {\n' + code + '\n}';
        },
    });
    if (options.produceCachedData === true) {
        const cachedData = new Uint8Array([0x77, 0x72, 0x71, 0x6a, code.length & 0xff]);
        cachedData.__wasm_rquickjs_compile_function_source = code;
        fn.cachedData = cachedData;
        fn.cachedDataProduced = true;
    }
    if (options.cachedData !== undefined) {
        fn.cachedDataRejected = options.cachedData.__wasm_rquickjs_compile_function_source !== code;
    }
    return fn;
}

function normalizeCompileFunctionRuntimeStack(err, code, options) {
    if (!err || typeof err.stack !== 'string' || err.stack.indexOf('<input>') === -1) return;
    const lineOffset = typeof options.lineOffset === 'number' ? options.lineOffset : 0;
    const columnOffset = typeof options.columnOffset === 'number' ? options.columnOffset : 0;
    const location = (typeof options.filename === 'string' && options.filename.length > 0)
        ? options.filename
        : '<anonymous>';
    const line = 1 + lineOffset;
    const column = compileFunctionRuntimeColumn(code) + columnOffset;
    const message = (err.name || 'Error') + ': ' + (err.message || '');
    err.stack = message + '\n    at ' + location + ':' + line + ':' + column;
}

function compileFunctionRuntimeColumn(code) {
    let i = 0;
    while (i < code.length) {
        const ch = code.charCodeAt(i);
        if (ch !== 0x20 && ch !== 0x09) break;
        i++;
    }
    if (code.slice(i, i + 5) === 'throw') return i + 7;
    return i + 1;
}

function snapshotVmOptions(options) {
    options = validateOptionsObject(options);
    validateImportModuleDynamicallyOption(options.importModuleDynamically);
    if (options.identifier !== undefined && typeof options.identifier !== 'string') {
        throwInvalidPropertyType('options.identifier', 'string', options.identifier);
    }
    if (options.context !== undefined && !isContext(options.context)) {
        throwInvalidPropertyType('options.context', 'vm.Context', options.context);
    }
    if (options.cachedData !== undefined && !ArrayBuffer.isView(options.cachedData)) {
        const err = new TypeError('The "options.cachedData" property must be an instance of Buffer, TypedArray, or DataView.' + invalidArgTypeHelper(options.cachedData));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    return Object.assign({}, options);
}

function validateOptionsObject(options) {
    if (options === undefined) return {};
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throwInvalidArgType('options', 'object', options);
    }
    return options;
}

function validateImportModuleDynamicallyOption(value) {
    if (value === undefined || value === USE_MAIN_CONTEXT_DEFAULT_LOADER || typeof value === 'function') {
        return;
    }
    throwInvalidPropertyType('options.importModuleDynamically', 'function', value);
}

function validateInitializeImportMetaOption(value) {
    if (value === undefined || typeof value === 'function') {
        return;
    }
    throwInvalidPropertyType('options.initializeImportMeta', 'function', value);
}

function validateInt32Option(value, name) {
    if (value === undefined) return;
    if (typeof value !== 'number') {
        throwInvalidArgType(name, 'number', value);
    }
    if (!Number.isInteger(value)) {
        throwOutOfRange(name, 'an integer', value);
    }
    if (value < -2147483648 || value > 2147483647) {
        throwOutOfRange(name, '>= -2147483648 && <= 2147483647', value);
    }
}

function validateInt32PropertyOption(value, name) {
    if (value === undefined) return;
    if (typeof value !== 'number') {
        throwInvalidPropertyType(name, 'number', value);
    }
    if (!Number.isInteger(value)) {
        throwOutOfRange(name, 'an integer', value);
    }
    if (value < -2147483648 || value > 2147483647) {
        throwOutOfRange(name, '>= -2147483648 && <= 2147483647', value);
    }
}

function hasIdentifierBoundary(source, start, end) {
    const before = start > 0 ? source.charCodeAt(start - 1) : 0;
    const after = end < source.length ? source.charCodeAt(end) : 0;
    return !isIdentifierChar(before) && !isIdentifierChar(after);
}

function isIdentifierChar(ch) {
    return ch === 0x5f || ch === 0x24 ||
        (ch >= 0x30 && ch <= 0x39) ||
        (ch >= 0x41 && ch <= 0x5a) ||
        (ch >= 0x61 && ch <= 0x7a) ||
        ch >= 0x80;
}

function isIdentifierStart(ch) {
    return ch === 0x5f || ch === 0x24 ||
        (ch >= 0x41 && ch <= 0x5a) ||
        (ch >= 0x61 && ch <= 0x7a) ||
        ch >= 0x80;
}

function skipWhitespaceAndComments(source, i) {
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0b || ch === 0x0c) {
            i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i += 2;
            while (i + 1 < source.length && !(source.charCodeAt(i) === 0x2a && source.charCodeAt(i + 1) === 0x2f)) i++;
            i = Math.min(i + 2, source.length);
            continue;
        }
        break;
    }
    return i;
}

function skipStringLiteral(source, i, quote) {
    i++;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        i++;
        if (ch === quote) break;
    }
    return i;
}

function skipTemplateLiteral(source, i) {
    i++;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        i++;
        if (ch === 0x60) break;
    }
    return i;
}

function rewriteTemplateLiteral(source, start, replacementOpenSource) {
    let i = start + 1;
    let out = '`';
    let chunkStart = i;
    let changed = false;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        if (ch === 0x60) {
            out += source.slice(chunkStart, i + 1);
            return { end: i + 1, text: out, changed };
        }
        if (ch === 0x24 && source.charCodeAt(i + 1) === 0x7b) {
            out += source.slice(chunkStart, i + 2);
            const expressionStart = i + 2;
            const expressionEnd = findTemplateExpressionEnd(source, expressionStart);
            if (expressionEnd === -1) {
                out += source.slice(expressionStart);
                return { end: source.length, text: out, changed };
            }
            const expression = source.slice(expressionStart, expressionEnd);
            const rewritten = rewriteDynamicImports(expression, replacementOpenSource);
            if (rewritten.changed) changed = true;
            out += rewritten.code + '}';
            i = expressionEnd + 1;
            chunkStart = i;
            continue;
        }
        i++;
    }
    out += source.slice(chunkStart);
    return { end: source.length, text: out, changed };
}

function findTemplateExpressionEnd(source, start) {
    let i = start;
    let depth = 0;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteral(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && regexCanFollow(source, i)) {
            i = skipRegexLiteral(source, i);
            continue;
        }
        if (ch === 0x7b) {
            depth++;
        } else if (ch === 0x7d) {
            if (depth === 0) return i;
            depth--;
        }
        i++;
    }
    return -1;
}

function findMatchingParen(source, open) {
    let depth = 1;
    let i = open + 1;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(source, i, ch);
            continue;
        }
        if (ch === 0x60) {
            i = skipTemplateLiteral(source, i);
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        if (ch === 0x2f && regexCanFollow(source, i)) {
            i = skipRegexLiteral(source, i);
            continue;
        }
        if (ch === 0x28) {
            depth++;
        } else if (ch === 0x29) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function skipRegexLiteral(source, i) {
    i++;
    let inClass = false;
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x5c) {
            i += 2;
            continue;
        }
        if (ch === 0x5b) inClass = true;
        else if (ch === 0x5d) inClass = false;
        else if (ch === 0x2f && !inClass) {
            i++;
            while (i < source.length && isIdentifierChar(source.charCodeAt(i))) i++;
            break;
        }
        i++;
    }
    return i;
}

function isLikelyRegexLiteral(source, i) {
    const end = skipRegexLiteral(source, i);
    if (end >= source.length) return true;
    if (end === i + 1) return false;
    const next = source.charCodeAt(end);
    return next === 0x20 || next === 0x09 || next === 0x0a || next === 0x0d ||
        next === 0x2e || next === 0x3b || next === 0x2c || next === 0x29 ||
        next === 0x5d || next === 0x7d;
}

function previousWordBeforeMatchingParen(source, closeIndex) {
    let depth = 1;
    let i = closeIndex - 1;
    while (i >= 0) {
        const ch = source.charCodeAt(i);
        if (ch === 0x29) {
            depth++;
        } else if (ch === 0x28) {
            depth--;
            if (depth === 0) return previousSignificantWord(source, i);
        }
        i--;
    }
    return '';
}

function regexCanFollowParen(source, i) {
    if (previousSignificantChar(source, i) !== 0x29) return false;
    const word = previousWordBeforeMatchingParen(source, i - 1);
    return word === 'if' || word === 'while' || word === 'for' || word === 'with';
}

function previousSignificantChar(source, i) {
    i--;
    while (i >= 0) {
        const ch = source.charCodeAt(i);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0b || ch === 0x0c) {
            i--;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i - 1) === 0x2a) {
            const start = source.lastIndexOf('/*', i - 2);
            if (start >= 0) {
                i = start - 1;
                continue;
            }
        }
        return ch;
    }
    return 0;
}

function nextSignificantChar(source, i) {
    while (i < source.length) {
        const ch = source.charCodeAt(i);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0b || ch === 0x0c) {
            i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < source.length && source.charCodeAt(i) !== 0x0a && source.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(source, i);
            continue;
        }
        return ch;
    }
    return 0;
}

function previousSignificantWord(source, i) {
    i--;
    while (i >= 0) {
        const ch = source.charCodeAt(i);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0b || ch === 0x0c) {
            i--;
            continue;
        }
        if (ch === 0x2f && source.charCodeAt(i - 1) === 0x2a) {
            const start = source.lastIndexOf('/*', i - 2);
            if (start >= 0) {
                i = start - 1;
                continue;
            }
        }
        break;
    }
    const end = i + 1;
    while (i >= 0 && isIdentifierChar(source.charCodeAt(i))) i--;
    if (end === i + 1) return '';
    return source.slice(i + 1, end);
}

function previousSignificantIndex(source, i) {
    i--;
    while (i >= 0) {
        const ch = source.charCodeAt(i);
        if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0b || ch === 0x0c) {
            i--;
            continue;
        }
        return i;
    }
    return -1;
}

function regexCanFollow(source, i) {
    const prev = previousSignificantChar(source, i);
    if (prev === 0 || prev === 0x28 || prev === 0x5b || prev === 0x7b || prev === 0x2c ||
        prev === 0x3b || prev === 0x3a || prev === 0x3d || prev === 0x21 || prev === 0x3f ||
        prev === 0x26 || prev === 0x7c || prev === 0x2b || prev === 0x2d || prev === 0x2a ||
        prev === 0x2f || prev === 0x25 || prev === 0x7e || prev === 0x5e || prev === 0x3c ||
        prev === 0x3e) {
        return true;
    }
    const word = previousSignificantWord(source, i);
    return word === 'return' || word === 'throw' || word === 'case' || word === 'delete' ||
        word === 'void' || word === 'typeof' || word === 'yield' || word === 'await' ||
        word === 'else' || word === 'do' || word === 'in' || word === 'instanceof' ||
        word === 'of';
}

function isImportMethodDefinition(source, importStart, open) {
    const isMethodDelimiter = (ch) => ch === 0x7b || ch === 0x2c;
    const before = previousSignificantChar(source, importStart);
    let hasMethodPrefix = isMethodDelimiter(before);
    if (!hasMethodPrefix) {
        const prefixIndex = previousSignificantIndex(source, importStart);
        if (before === 0x2a && prefixIndex >= 0) {
            const beforeStar = previousSignificantChar(source, prefixIndex);
            if (isMethodDelimiter(beforeStar)) {
                hasMethodPrefix = true;
            } else if (previousSignificantWord(source, prefixIndex) === 'async') {
                const asyncEnd = previousSignificantIndex(source, prefixIndex) + 1;
                const asyncStart = source.lastIndexOf('async', asyncEnd);
                const beforeAsync = previousSignificantChar(source, asyncStart);
                if (isMethodDelimiter(beforeAsync)) {
                    hasMethodPrefix = true;
                } else if (previousSignificantWord(source, asyncStart) === 'static') {
                    const staticStart = source.lastIndexOf('static', asyncStart);
                    hasMethodPrefix = isMethodDelimiter(previousSignificantChar(source, staticStart));
                }
            } else if (previousSignificantWord(source, prefixIndex) === 'static') {
                const staticEnd = previousSignificantIndex(source, prefixIndex) + 1;
                const staticStart = source.lastIndexOf('static', staticEnd);
                hasMethodPrefix = isMethodDelimiter(previousSignificantChar(source, staticStart));
            }
        } else {
            const word = previousSignificantWord(source, importStart);
            if (word === 'async' || word === 'get' || word === 'set' || word === 'static') {
                const wordStart = source.lastIndexOf(word, importStart);
                const beforeWord = previousSignificantChar(source, wordStart);
                if (isMethodDelimiter(beforeWord)) {
                    hasMethodPrefix = true;
                } else if (word !== 'static' && previousSignificantWord(source, wordStart) === 'static') {
                    const staticStart = source.lastIndexOf('static', wordStart);
                    hasMethodPrefix = isMethodDelimiter(previousSignificantChar(source, staticStart));
                }
            }
        }
    }
    if (!hasMethodPrefix) return false;
    const close = findMatchingParen(source, open);
    if (close < 0) return false;
    return source.charCodeAt(skipWhitespaceAndComments(source, close + 1)) === 0x7b;
}

function throwInvalidArgType(name, expected, value) {
    const err = new TypeError('The "' + name + '" argument must be of type ' + expected + '.' + formatReceivedType(value));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function throwInvalidContextifiedObject() {
    const err = new TypeError('The "contextifiedObject" argument must be an vm.Context.');
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function throwInvalidPropertyType(name, expected, value) {
    const err = new TypeError('The "' + name + '" property must be of type ' + expected + '.' + formatReceivedType(value));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function throwInvalidArgInstance(name, expected, value) {
    const err = new TypeError('The "' + name + '" argument must be an instance of ' + expected + '.' + invalidArgTypeHelper(value));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function throwInvalidPropertyInstance(name, expected, value) {
    const err = new TypeError('The "' + name + '" property must be an instance of ' + expected + '.' + invalidArgTypeHelper(value));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function throwOutOfRange(name, range, value) {
    const err = new RangeError('The value of "' + name + '" is out of range. It must be ' + range + '. Received ' + formatReceived(value));
    err.code = 'ERR_OUT_OF_RANGE';
    throw err;
}

function formatReceived(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return "'" + value + "'";
    if (typeof value === 'symbol') return value.toString();
    return String(value);
}

function formatReceivedType(value) {
    if (value === null) return ' Received null';
    if (value === undefined) return ' Received undefined';
    if (typeof value === 'string') return " Received type string ('" + value + "')";
    return ' Received type ' + typeof value + ' (' + formatReceived(value) + ')';
}

function invalidArgTypeHelper(value) {
    if (value === null) return ' Received null';
    if (value === undefined) return ' Received undefined';
    if (typeof value === 'function') return ' Received function ' + (value.name || '');
    if (value && typeof value === 'object' && value.constructor && value.constructor.name) {
        return ' Received an instance of ' + value.constructor.name;
    }
    if (value && typeof value === 'object') return ' Received an object';
    return formatReceivedType(value);
}

function referrerFilenameFromOptions(options) {
    if (typeof options.filename === 'string' && options.filename.length > 0) {
        return options.filename;
    }
    if (globalThis.process && typeof globalThis.process.cwd === 'function') {
        return globalThis.process.cwd() + '/';
    }
    return '/';
}

function referrerDirectory(filename) {
    if (filename.startsWith('file://')) {
        try {
            filename = decodeURIComponent(new URL(filename).pathname);
        } catch (_) {
            return globalThis.process && typeof globalThis.process.cwd === 'function'
                ? globalThis.process.cwd()
                : '/';
        }
    }
    if (filename.endsWith('/')) return filename.slice(0, -1) || '/';
    if (!filename.startsWith('/')) {
        return globalThis.process && typeof globalThis.process.cwd === 'function'
            ? globalThis.process.cwd()
            : '/';
    }
    return pathModule.dirname(filename);
}

function resolveDefaultLoaderSpecifier(specifier, filename) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        return pathModule.resolve(referrerDirectory(filename), specifier);
    }
    return specifier;
}

function ensureDefaultLoaderImportBinding(helperName) {
    if (globalThis[helperName] !== defaultLoaderImportFunction) {
        Object.defineProperty(globalThis, helperName, {
            value: defaultLoaderImportFunction,
            writable: false,
            configurable: true,
        });
    }
}

function ensureMissingDynamicImportBinding(helperName) {
    if (globalThis[helperName] !== missingDynamicImportFunction) {
        Object.defineProperty(globalThis, helperName, {
            value: missingDynamicImportFunction,
            writable: false,
            configurable: true,
        });
    }
}

function ensureMissingDynamicImportFlagBinding(helperName) {
    if (globalThis[helperName] !== missingDynamicImportFlagFunction) {
        Object.defineProperty(globalThis, helperName, {
            value: missingDynamicImportFlagFunction,
            writable: false,
            configurable: true,
        });
    }
}

function chooseDefaultLoaderImportHelperName(code) {
    let helperName;
    do {
        helperName = defaultLoaderImportHelper + '_' + defaultLoaderImportHelperCounter++;
    } while (code.indexOf(helperName) !== -1);
    return helperName;
}

function chooseMissingDynamicImportHelperName(code) {
    let helperName;
    do {
        helperName = missingDynamicImportHelper + '_' + defaultLoaderImportHelperCounter++;
    } while (code.indexOf(helperName) !== -1);
    return helperName;
}

function chooseMissingDynamicImportFlagHelperName(code) {
    let helperName;
    do {
        helperName = missingDynamicImportFlagHelper + '_' + defaultLoaderImportHelperCounter++;
    } while (code.indexOf(helperName) !== -1);
    return helperName;
}

function chooseSandboxDescriptorsHelperName(code, sandboxKeys) {
    let helperName;
    do {
        helperName = sandboxDescriptorsHelper + '_' + sandboxDescriptorsHelperCounter++;
    } while (code.indexOf(helperName) !== -1 || sandboxKeys.indexOf(helperName) !== -1);
    return helperName;
}

function chooseSandboxSymbolsHelperName(code, sandboxKeys) {
    let helperName;
    do {
        helperName = sandboxSymbolsHelper + '_' + sandboxSymbolsHelperCounter++;
    } while (code.indexOf(helperName) !== -1 || sandboxKeys.indexOf(helperName) !== -1);
    return helperName;
}

function defaultLoaderImportSource(filename, helperName) {
    return helperName + '(' + JSON.stringify(filename) + ',';
}

function missingDynamicImportSource(helperName) {
    return helperName + '(';
}

function missingDynamicImportFlagSource(helperName) {
    return helperName + '(';
}

function vmDynamicImportCallbackSource(helperName) {
    return helperName + '(';
}

function dynamicImportAttributes(options) {
    const attributes = Object.create(null);
    if (options && typeof options === 'object' && options.with && typeof options.with === 'object') {
        const keys = Object.keys(options.with);
        for (let i = 0; i < keys.length; i++) {
            attributes[keys[i]] = options.with[keys[i]];
        }
    }
    return attributes;
}

function vmModuleNotModuleError() {
    const err = new TypeError('Provided module is not an instance of Module');
    err.code = 'ERR_VM_MODULE_NOT_MODULE';
    return err;
}

function invalidArgValue(message) {
    const err = new TypeError(message);
    err.code = 'ERR_INVALID_ARG_VALUE';
    return err;
}

function vmModuleStatusError(message) {
    const err = new Error(message);
    err.code = 'ERR_VM_MODULE_STATUS';
    return err;
}

function throwInvalidModuleThis(value) {
    const err = new TypeError('The "this" argument must be an instance of Module.' + invalidArgTypeHelper(value));
    err.code = 'ERR_INVALID_ARG_TYPE';
    throw err;
}

function requireVmModuleThis(value) {
    if (!value || value[vmModuleInstanceBrandSymbol] !== true) {
        throwInvalidModuleThis(value);
    }
    return value;
}

function vmModulePublicContext(context) {
    if (!context || typeof context !== 'object') return context;
    const result = {};
    const keys = Object.keys(context);
    for (let i = 0; i < keys.length; i++) {
        result[keys[i]] = context[keys[i]];
    }
    return result;
}

function inspectVmModule(depth, options, inspect) {
    'use strict';
    const module = requireVmModuleThis(this);
    const name = module instanceof SourceTextModule ? 'SourceTextModule' : 'SyntheticModule';
    if (depth !== null && depth < 0) return '[' + name + ']';
    const context = inspect(vmModulePublicContext(module._context), options);
    return name + ' {\n'
        + '  status: ' + inspect(module._status, options) + ',\n'
        + '  identifier: ' + inspect(module._identifier, options) + ',\n'
        + '  context: ' + context.replace(/\n/g, '\n  ') + '\n'
        + '}';
}

function requireSyntheticModuleThis(value) {
    if (!value || value[vmModuleInstanceBrandSymbol] !== true || !(value instanceof SyntheticModule)) {
        const err = new TypeError('The "this" argument must be an instance of SyntheticModule.' + invalidArgTypeHelper(value));
        err.code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    return value;
}

function vmModuleDifferentContextError() {
    const err = new Error('Linked modules must use the same context');
    err.code = 'ERR_VM_MODULE_DIFFERENT_CONTEXT';
    return err;
}

function vmModuleLinkFailureError(cause) {
    const err = new Error('Module link failed');
    err.code = 'ERR_VM_MODULE_LINK_FAILURE';
    err.cause = cause;
    return err;
}

function namespaceFromVmModule(module) {
    if (!(module instanceof SourceTextModule) && !(module instanceof SyntheticModule)) {
        if (module && typeof module === 'object' && module[moduleNamespaceBrandSymbol] === true) {
            return module;
        }
        throw vmModuleNotModuleError();
    }
    return module.namespace;
}

function defineVmDynamicImportCallbackBinding(helperName, callback, wrap) {
    Object.defineProperty(globalThis, helperName, {
        value: function(specifier, options) {
            let result;
            const referrer = wrap && typeof wrap === 'object' && Object.prototype.hasOwnProperty.call(wrap, vmDynamicImportReferrerSymbol)
                ? wrap[vmDynamicImportReferrerSymbol]
                : wrap;
            try {
                result = callback(String(specifier), referrer, dynamicImportAttributes(options));
            } catch (err) {
                return Promise.reject(err);
            }
            return Promise.resolve(result).then(namespaceFromVmModule);
        },
        writable: false,
        configurable: true,
    });
}

function rewriteDefaultLoaderDynamicImportsForEvaluation(code, filename) {
    code = String(code);
    const helperName = chooseDefaultLoaderImportHelperName(code);
    const rewritten = rewriteDynamicImports(code, defaultLoaderImportSource(filename, helperName));
    if (rewritten.changed) ensureDefaultLoaderImportBinding(helperName);
    return {
        code: rewritten.code,
        helperName: rewritten.changed ? helperName : undefined,
    };
}

function rewriteMissingDynamicImportsForEvaluation(code) {
    code = String(code);
    const helperName = chooseMissingDynamicImportHelperName(code);
    const rewritten = rewriteDynamicImports(code, missingDynamicImportSource(helperName));
    if (rewritten.changed) ensureMissingDynamicImportBinding(helperName);
    return {
        code: rewritten.code,
        helperName: rewritten.changed ? helperName : undefined,
    };
}

function rewriteMissingDynamicImportFlagForEvaluation(code) {
    code = String(code);
    const helperName = chooseMissingDynamicImportFlagHelperName(code);
    const rewritten = rewriteDynamicImports(code, missingDynamicImportFlagSource(helperName));
    if (rewritten.changed) ensureMissingDynamicImportFlagBinding(helperName);
    return {
        code: rewritten.code,
        helperName: rewritten.changed ? helperName : undefined,
    };
}

function rewriteVmDynamicImportCallbackForEvaluation(code, callback, wrap) {
    code = String(code);
    const helperName = chooseDefaultLoaderImportHelperName(code);
    const rewritten = rewriteDynamicImports(code, vmDynamicImportCallbackSource(helperName));
    if (rewritten.changed) defineVmDynamicImportCallbackBinding(helperName, callback, wrap);
    return {
        code: rewritten.code,
        helperName: rewritten.changed ? helperName : undefined,
    };
}

function rewriteDynamicImports(code, replacementOpenSource) {
    code = String(code);
    let changed = false;
    let out = '';
    let last = 0;
    let i = 0;
    while (i < code.length) {
        const ch = code.charCodeAt(i);
        if (ch === 0x27 || ch === 0x22) {
            i = skipStringLiteral(code, i, ch);
            continue;
        }
        if (ch === 0x60) {
            const template = rewriteTemplateLiteral(code, i, replacementOpenSource);
            if (template.changed) {
                changed = true;
                out += code.slice(last, i) + template.text;
                last = template.end;
            }
            i = template.end;
            continue;
        }
        if (ch === 0x2f && code.charCodeAt(i + 1) === 0x2f) {
            i += 2;
            while (i < code.length && code.charCodeAt(i) !== 0x0a && code.charCodeAt(i) !== 0x0d) i++;
            continue;
        }
        if (ch === 0x2f && code.charCodeAt(i + 1) === 0x2a) {
            i = skipWhitespaceAndComments(code, i);
            continue;
        }
        if (ch === 0x2f && (regexCanFollow(code, i) || (regexCanFollowParen(code, i) && isLikelyRegexLiteral(code, i)))) {
            i = skipRegexLiteral(code, i);
            continue;
        }
        if (code.startsWith('import', i)
            && hasIdentifierBoundary(code, i, i + 6)
            && previousSignificantChar(code, i) !== 0x2e
            && previousSignificantChar(code, i) !== 0x23) {
            const open = skipWhitespaceAndComments(code, i + 6);
            if (code.charCodeAt(open) === 0x28) {
                if (isImportMethodDefinition(code, i, open)) {
                    i = open + 1;
                    continue;
                }
                changed = true;
                out += code.slice(last, i) + replacementOpenSource;
                last = open + 1;
                i = open + 1;
                continue;
            }
        }
        i++;
    }
    if (last === 0) return { code, changed: false };
    return { code: out + code.slice(last), changed };
}

export class Script {
    constructor(code, options) {
        scriptBrandSet.add(this);
        this._code = String(code);
        options = validateScriptConstructorOptions(options);
        this.sourceMapURL = extractSourceMapURL(this._code);
        this._options = snapshotVmOptions(options);
        this._usesDefaultLoader = this._options.importModuleDynamically === USE_MAIN_CONTEXT_DEFAULT_LOADER;
        this._usesMissingDynamicImportCallback = this._options.importModuleDynamically === undefined;
        this._usesDynamicImportCallback = typeof this._options.importModuleDynamically === 'function' && vmModulesEnabled();
        this._usesMissingDynamicImportFlag = typeof this._options.importModuleDynamically === 'function' && !this._usesDynamicImportCallback;
        this._defaultLoaderFilename = this._usesDefaultLoader
            ? referrerFilenameFromOptions(this._options)
            : undefined;
        const defaultLoaderRewrite = this._usesDefaultLoader
            ? rewriteDefaultLoaderDynamicImportsForEvaluation(this._code, this._defaultLoaderFilename)
            : undefined;
        const missingCallbackRewrite = this._usesMissingDynamicImportCallback
            ? rewriteMissingDynamicImportsForEvaluation(this._code)
            : undefined;
        const missingFlagRewrite = this._usesMissingDynamicImportFlag
            ? rewriteMissingDynamicImportFlagForEvaluation(this._code)
            : undefined;
        const dynamicImportCallbackRewrite = this._usesDynamicImportCallback
            ? rewriteVmDynamicImportCallbackForEvaluation(this._code, this._options.importModuleDynamically, this)
            : undefined;
        this._defaultLoaderCode = defaultLoaderRewrite && defaultLoaderRewrite.code;
        this._defaultLoaderHelperName = defaultLoaderRewrite && defaultLoaderRewrite.helperName;
        this._missingCallbackCode = missingCallbackRewrite && missingCallbackRewrite.code;
        this._missingCallbackHelperName = missingCallbackRewrite && missingCallbackRewrite.helperName;
        this._missingFlagCode = missingFlagRewrite && missingFlagRewrite.code;
        this._missingFlagHelperName = missingFlagRewrite && missingFlagRewrite.helperName;
        this._dynamicImportCallbackCode = dynamicImportCallbackRewrite && dynamicImportCallbackRewrite.code;
        this._dynamicImportCallbackHelperName = dynamicImportCallbackRewrite && dynamicImportCallbackRewrite.helperName;
    }

    runInNewContext(sandbox, options) {
        if (this === null || this === undefined) {
            throw new TypeError("Cannot read properties of " + this + " (reading 'runInContext')");
        }
        const runInContext = this.runInContext;
        if (typeof runInContext !== 'function') {
            throw new TypeError('this.runInContext is not a function');
        }
        validateRunInNewContextPreSandboxOptions(options);
        const context = createContextForRunInNewContext(sandbox);
        validateRunInNewContextPostSandboxOptions(options);
        return runInContext.call(this, context, options);
    }

    runInContext(context, options) {
        if (!this || !scriptBrandSet.has(this)) {
            throw new TypeError('Illegal invocation');
        }
        if (!isContext(context)) {
            throwInvalidContextifiedObject();
        }
        options = validateScriptRunOptions(options);
        if (this._usesDefaultLoader) {
            return evalCodeInContext(this._defaultLoaderCode, context, this._defaultLoaderHelperName);
        }
        if (this._usesMissingDynamicImportCallback) {
            return evalCodeInContext(this._missingCallbackCode, context, this._missingCallbackHelperName);
        }
        if (this._usesMissingDynamicImportFlag) {
            return evalCodeInContext(this._missingFlagCode, context, this._missingFlagHelperName);
        }
        if (this._usesDynamicImportCallback) {
            return evalCodeInContext(this._dynamicImportCallbackCode, context, this._dynamicImportCallbackHelperName);
        }
        return runInContext(this._code, context, options);
    }

    runInThisContext(options) {
        if (!this || !scriptBrandSet.has(this)) {
            throw new TypeError('Illegal invocation');
        }
        options = validateScriptRunOptions(options);
        const runOptions = scriptRunInThisContextOptions(this, options);
        if (this._usesDefaultLoader) {
            return evalWithFilename(this._defaultLoaderCode, this._defaultLoaderFilename);
        }
        if (this._usesMissingDynamicImportCallback) {
            return runInThisContext(this._missingCallbackCode, runOptions);
        }
        if (this._usesMissingDynamicImportFlag) {
            return runInThisContext(this._missingFlagCode, runOptions);
        }
        if (this._usesDynamicImportCallback) {
            return runInThisContext(this._dynamicImportCallbackCode, runOptions);
        }
        return runInThisContext(this._code, runOptions);
    }

    createCachedData() {
        if (!this || !scriptBrandSet.has(this)) {
            throw new TypeError('Illegal invocation');
        }
        return new Uint8Array(0);
    }
}

function scriptRunInThisContextOptions(script, options) {
    const result = Object.assign({}, options);
    delete result.filename;
    if (script._options.filename !== undefined) {
        result.filename = script._options.filename;
    }
    return result;
}

export function Module() {
    throw new TypeError('Module is not a constructor');
}

Object.defineProperties(Module.prototype, {
    status: {
        get: function() {
            return requireVmModuleThis(this)._status;
        },
        configurable: true,
    },
    error: {
        get: function() {
            const module = requireVmModuleThis(this);
            if (module._status !== 'errored') {
                throw vmModuleStatusError('Module status must be errored');
            }
            return module._error;
        },
        configurable: true,
    },
    namespace: {
        get: function() {
            const module = requireVmModuleThis(this);
            if (module._status === 'unlinked' || module._status === 'linking') {
                throw vmModuleStatusError('Module status must not be unlinked or linking');
            }
            return module._namespace;
        },
        configurable: true,
    },
    identifier: {
        get: function() {
            return requireVmModuleThis(this)._identifier;
        },
        configurable: true,
    },
    context: {
        get: function() {
            return requireVmModuleThis(this)._context;
        },
        configurable: true,
    },
    [customInspectSymbol]: {
        value: inspectVmModule,
        configurable: true,
    },
});

Module.prototype.link = async function link() {
    requireVmModuleThis(this);
};

Module.prototype.evaluate = async function evaluate() {
    requireVmModuleThis(this);
};

export class SourceTextModule {
    constructor(code, options) {
        if (typeof code !== 'string') {
            throwInvalidArgType('code', 'string', code);
        }
        this._source = code;
        this[vmModuleInstanceBrandSymbol] = true;
        this._status = 'unlinked';
        this._error = undefined;
        this._options = snapshotVmOptions(options);
        validateInitializeImportMetaOption(this._options.initializeImportMeta);
        this._context = this._options.context;
        this._identifier = this._options.identifier || 'vm:module(0)';
        this._importMetaName = undefined;
        this._usesDynamicImportCallback = typeof this._options.importModuleDynamically === 'function' && vmModulesEnabled();
        this._usesMissingDynamicImportFlag = typeof this._options.importModuleDynamically === 'function' && !this._usesDynamicImportCallback;

        const analysis = analyzeSourceTextModule(this._source);
        const declaredBindings = analysis.bindings;
        this._dependencies = analysis.dependencies;
        this._usesImportedNames = sourceTextModuleHasImportedNames(this._dependencies);
        this._dependencySpecifiers = Object.freeze(this._dependencies.map((dependency) => dependency.specifier));
        this._bindings = Object.create(null);
        this._names = [];
        this._exportBindings = [];

        for (let i = 0; i < declaredBindings.length; i++) {
            const binding = declaredBindings[i];
            this._names.push(binding.name);
            this._exportBindings.push(binding);
            this._bindings[binding.name] = {
                kind: binding.kind,
                initialized: binding.kind === 'var',
                value: undefined,
            };
        }

        let executableSource = analysis.executableSource;
        if (this._usesDynamicImportCallback) {
            executableSource = rewriteVmDynamicImportCallbackForEvaluation(executableSource, this._options.importModuleDynamically, this).code;
        } else if (this._usesMissingDynamicImportFlag) {
            executableSource = rewriteMissingDynamicImportFlagForEvaluation(executableSource).code;
        } else {
            executableSource = rewriteMissingDynamicImportsForEvaluation(executableSource).code;
        }
        this._importMetaName = chooseInternalBindingName(executableSource, '__wasm_rquickjs_vm_import_meta');
        const importMetaRewrite = rewriteImportMetaForEvaluation(executableSource, this._importMetaName);
        executableSource = importMetaRewrite.code;
        this._usesImportMeta = importMetaRewrite.changed;
        executableSource = injectSourceTextModuleAssignmentSync(executableSource, this._exportBindings);
        this._exportCellsName = chooseInternalBindingName(executableSource, '__wasm_rquickjs_vm_export_cells');
        executableSource = executableSource.split(sourceTextModuleExportCellsPlaceholder).join(this._exportCellsName);

        this._evaluateSource = compileSourceTextModuleEvaluator(executableSource, this._exportBindings, this._dependencies, this._importMetaName, this._exportCellsName, this._usesImportMeta);
        this._namespace = createModuleNamespace(this);
    }

    get status() {
        return requireVmModuleThis(this)._status;
    }

    get namespace() {
        requireVmModuleThis(this);
        if (this._status === 'unlinked' || this._status === 'linking') {
            throw vmModuleStatusError('Module status must not be unlinked or linking');
        }
        return this._namespace;
    }

    get error() {
        requireVmModuleThis(this);
        if (this._status !== 'errored') {
            throw vmModuleStatusError('Module status must be errored');
        }
        return this._error;
    }

    get dependencySpecifiers() {
        requireVmModuleThis(this);
        return this._dependencySpecifiers;
    }

    async link(linker) {
        if (typeof linker !== 'function') {
            throwInvalidArgType('linker', 'function', linker);
        }
        if (this._status === 'linked' || this._status === 'evaluated' || this._status === 'errored') {
            const err = new Error('Module has already been linked');
            err.code = 'ERR_VM_MODULE_ALREADY_LINKED';
            throw err;
        }
        if (this._status !== 'unlinked') {
            throw vmModuleStatusError('Module status must be unlinked');
        }
        this._status = 'linking';
        try {
            for (let i = 0; i < this._dependencies.length; i++) {
                const dependency = this._dependencies[i];
                const attributes = dependency.attributes || Object.create(null);
                const module = await linker(dependency.specifier, this, { attributes, assert: attributes });
                if (!(module instanceof SourceTextModule) && !(module instanceof SyntheticModule)) {
                    throw vmModuleNotModuleError();
                }
                if (this._context !== module._context) {
                    throw vmModuleDifferentContextError();
                }
                if (module.status === 'unlinked') {
                    await module.link(linker);
                }
                if (module.status === 'errored') {
                    throw vmModuleLinkFailureError(module.error);
                }
                for (let j = 0; j < dependency.names.length; j++) {
                    if (dependency.names[j].imported === '*') {
                        continue;
                    }
                    if (!Object.prototype.hasOwnProperty.call(module._bindings, dependency.names[j].imported)) {
                        throw new SyntaxError("The requested module '" + dependency.specifier + "' does not provide an export named '" + dependency.names[j].imported + "'");
                    }
                }
                dependency.module = module;
            }
            this._resolveStarExports();
            await Promise.resolve();
            this._status = 'linked';
        } catch (err) {
            this._error = err;
            this._status = 'errored';
            throw err;
        }
    }

    async evaluate(options) {
        options = validateOptionsObject(options);
        if (options.breakOnSigint !== undefined && typeof options.breakOnSigint !== 'boolean') {
            throwInvalidPropertyType('options.breakOnSigint', 'boolean', options.breakOnSigint);
        }
        if (options.timeout !== undefined) {
            validateInt32Option(options.timeout, 'options.timeout');
        }
        if (this._status === 'unlinked' || this._status === 'linking') {
            throw vmModuleStatusError('Module status must be one of linked, evaluated, or errored');
        }
        if (this._status === 'evaluated') {
            return undefined;
        }
        if (this._status === 'errored') {
            throw this._error;
        }

        this._status = 'evaluating';

        try {
            for (let i = 0; i < this._dependencies.length; i++) {
                const dependency = this._dependencies[i];
                if (dependency.module.status === 'linked') {
                    await dependency.module.evaluate();
                }
            }
            const importedValues = Object.create(null);
            for (let i = 0; i < this._dependencies.length; i++) {
                const dependency = this._dependencies[i];
                for (let j = 0; j < dependency.names.length; j++) {
                    const binding = dependency.names[j];
                    if (binding.imported === '*') {
                        Object.defineProperty(importedValues, binding.local, {
                            get: function() {
                                return dependency.module.namespace;
                            },
                            enumerable: true,
                            configurable: true,
                        });
                    } else {
                        Object.defineProperty(importedValues, binding.local, {
                            get: function() {
                                return dependency.module.namespace[binding.imported];
                            },
                            enumerable: true,
                            configurable: true,
                        });
                    }
                }
            }
            let evaluatedExports;
            if (this._usesImportMeta) {
                const importMeta = Object.create(null);
                const initializeImportMeta = this._options.initializeImportMeta;
                if (typeof initializeImportMeta === 'function') {
                    initializeImportMeta(importMeta, this);
                }
                evaluatedExports = this._usesImportedNames
                    ? this._evaluateSource(importedValues, importMeta, this._bindings)
                    : this._evaluateSource(importMeta, this._bindings);
            } else {
                evaluatedExports = this._usesImportedNames
                    ? this._evaluateSource(importedValues, this._bindings)
                    : this._evaluateSource(this._bindings);
            }
            for (let i = 0; i < this._exportBindings.length; i++) {
                const name = this._exportBindings[i].name;
                const binding = this._bindings[name];
                binding.initialized = true;
                binding.value = evaluatedExports[name];
            }
            this._status = 'evaluated';
            return undefined;
        } catch (err) {
            this._error = err;
            this._status = 'errored';
            throw err;
        }
    }

    _resolveStarExports() {
        const ambiguous = Object.create(null);
        const resolved = Object.create(null);
        for (let i = 0; i < this._dependencies.length; i++) {
            const dependency = this._dependencies[i];
            if (!dependency.exportAll || !dependency.module) continue;
            const names = dependency.module._names;
            for (let j = 0; j < names.length; j++) {
                const name = names[j];
                if (name === 'default' || Object.prototype.hasOwnProperty.call(this._bindings, name)) {
                    continue;
                }
                if (ambiguous[name]) {
                    continue;
                }
                const resolution = sourceTextModuleResolveExport(dependency.module, name);
                if (!resolution) {
                    continue;
                }
                if (resolved[name] && !sourceTextModuleSameExportResolution(resolved[name], resolution)) {
                    ambiguous[name] = true;
                    delete resolved[name];
                    continue;
                }
                resolved[name] = resolution;
            }
        }
        const resolvedNames = Object.keys(resolved);
        for (let i = 0; i < resolvedNames.length; i++) {
            const name = resolvedNames[i];
            if (ambiguous[name] || Object.prototype.hasOwnProperty.call(this._bindings, name)) continue;
            const resolution = resolved[name];
            this._names.push(name);
            this._bindings[name] = {
                kind: 'reexport',
                initialized: true,
                module: resolution.module,
                importName: resolution.importName,
            };
        }
        this._names = this._names.filter((name, index, names) => names.indexOf(name) === index);
        this._namespace = createModuleNamespace(this);
    }
}

function sourceTextModuleResolveExport(module, name, seen) {
    seen = seen || [];
    for (let i = 0; i < seen.length; i++) {
        if (seen[i].module === module && seen[i].name === name) return null;
    }
    seen.push({ module, name });
    const binding = module._bindings[name];
    if (!binding) return null;
    if (binding.kind === 'reexport') {
        return sourceTextModuleResolveExport(binding.module, binding.importName, seen);
    }
    return { module, importName: name };
}

function sourceTextModuleSameExportResolution(left, right) {
    return left.module === right.module && left.importName === right.importName;
}

Object.setPrototypeOf(SourceTextModule.prototype, Module.prototype);
Object.setPrototypeOf(SourceTextModule, Module);

export class SyntheticModule {
    constructor(exportNames, evaluateCallback, options) {
        if (!Array.isArray(exportNames) || exportNames.some((name) => typeof name !== 'string')) {
            const err = new TypeError('The "exportNames" argument must be an Array of unique strings. Received ' + formatReceived(exportNames));
            err.code = 'ERR_INVALID_ARG_TYPE';
            throw err;
        }
        const seen = new Set();
        for (let i = 0; i < exportNames.length; i++) {
            const name = exportNames[i];
            if (seen.has(name)) {
                throw invalidArgValue("The property 'exportNames." + name + "' is duplicated. Received '" + name + "'");
            }
            seen.add(name);
        }
        if (typeof evaluateCallback !== 'function') {
            throwInvalidArgType('evaluateCallback', 'function', evaluateCallback);
        }
        this._options = snapshotVmOptions(options);
        this[vmModuleInstanceBrandSymbol] = true;
        this._context = this._options.context;
        this._identifier = this._options.identifier || 'vm:module(0)';
        this._status = 'unlinked';
        this._error = undefined;
        this._dependencySpecifiers = Object.freeze([]);
        this._names = exportNames.slice();
        this._bindings = Object.create(null);
        for (let i = 0; i < this._names.length; i++) {
            this._bindings[this._names[i]] = {
                kind: 'const',
                initialized: true,
                value: undefined,
            };
        }
        this._evaluateCallback = evaluateCallback;
        this._namespace = createModuleNamespace(this);
    }

    get status() {
        return requireVmModuleThis(this)._status;
    }

    get namespace() {
        requireVmModuleThis(this);
        if (this._status === 'unlinked' || this._status === 'linking') {
            throw vmModuleStatusError('Module status must not be unlinked or linking');
        }
        return this._namespace;
    }

    get error() {
        requireVmModuleThis(this);
        if (this._status !== 'errored') {
            throw vmModuleStatusError('Module status must be errored');
        }
        return this._error;
    }

    async link(linker) {
        if (typeof linker !== 'function') {
            throwInvalidArgType('linker', 'function', linker);
        }
        if (this._status === 'linked' || this._status === 'evaluated' || this._status === 'errored') {
            const err = new Error('Module has already been linked');
            err.code = 'ERR_VM_MODULE_ALREADY_LINKED';
            throw err;
        }
        if (this._status !== 'unlinked') {
            throw vmModuleStatusError('Module status must be unlinked');
        }
        this._status = 'linking';
        await Promise.resolve();
        this._status = 'linked';
    }

    setExport(name, value) {
        requireSyntheticModuleThis(this);
        if (typeof name !== 'string') {
            throw new TypeError('Export name must be a string');
        }
        if (this._status === 'unlinked' || this._status === 'linking') {
            throw vmModuleStatusError('Module status must not be unlinked or linking');
        }
        const binding = this._bindings[name];
        if (binding === undefined) {
            throw new ReferenceError('Export ' + name + ' is not defined in module');
        }
        binding.value = value;
    }

    async evaluate(options) {
        options = validateOptionsObject(options);
        if (options.breakOnSigint !== undefined && typeof options.breakOnSigint !== 'boolean') {
            throwInvalidPropertyType('options.breakOnSigint', 'boolean', options.breakOnSigint);
        }
        if (options.timeout !== undefined) {
            validateInt32Option(options.timeout, 'options.timeout');
        }
        if (this._status === 'unlinked' || this._status === 'linking') {
            throw vmModuleStatusError('Module status must be one of linked, evaluated, or errored');
        }
        if (this._status === 'evaluated') {
            return undefined;
        }
        if (this._status === 'errored') {
            throw this._error;
        }
        this._status = 'evaluating';
        try {
            this._evaluateCallback.call(this);
            this._status = 'evaluated';
            return undefined;
        } catch (err) {
            this._error = err;
            this._status = 'errored';
            throw err;
        }
    }
}

Object.setPrototypeOf(SyntheticModule.prototype, Module.prototype);
Object.setPrototypeOf(SyntheticModule, Module);

export function createScript(code, options) {
    return new Script(code, options);
}

const vmExports = {
    runInNewContext,
    runInContext,
    runInThisContext,
    createContext,
    isContext,
    compileFunction,
    Module,
    Script,
    SourceTextModule,
    SyntheticModule,
    createScript,
    constants,
};

export default vmExports;
