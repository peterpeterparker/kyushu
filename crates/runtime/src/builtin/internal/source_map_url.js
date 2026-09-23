function isIdentifierChar(ch) {
  return (
    ch === 0x5f ||
    ch === 0x24 ||
    (ch >= 0x30 && ch <= 0x39) ||
    (ch >= 0x41 && ch <= 0x5a) ||
    (ch >= 0x61 && ch <= 0x7a) ||
    ch >= 0x80
  );
}

function skipStringLiteral(source, index, quote) {
  index++;
  while (index < source.length) {
    const ch = source.charCodeAt(index);
    if (ch === 0x5c) {
      index += 2;
      continue;
    }
    index++;
    if (ch === quote) break;
  }
  return index;
}

function skipTemplateLiteral(source, index) {
  index++;
  while (index < source.length) {
    const ch = source.charCodeAt(index);
    if (ch === 0x5c) {
      index += 2;
      continue;
    }
    index++;
    if (ch === 0x60) break;
  }
  return index;
}

function skipWhitespaceAndComments(source, index) {
  while (index < source.length) {
    const ch = source.charCodeAt(index);
    if (
      ch === 0x20 ||
      ch === 0x09 ||
      ch === 0x0a ||
      ch === 0x0d ||
      ch === 0x0b ||
      ch === 0x0c
    ) {
      index++;
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index + 1) === 0x2f) {
      index += 2;
      while (
        index < source.length &&
        source.charCodeAt(index) !== 0x0a &&
        source.charCodeAt(index) !== 0x0d
      )
        index++;
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index + 1) === 0x2a) {
      index += 2;
      while (
        index + 1 < source.length &&
        !(
          source.charCodeAt(index) === 0x2a &&
          source.charCodeAt(index + 1) === 0x2f
        )
      )
        index++;
      index = Math.min(index + 2, source.length);
      continue;
    }
    break;
  }
  return index;
}

function previousSignificantChar(source, index) {
  index--;
  while (index >= 0) {
    const ch = source.charCodeAt(index);
    if (
      ch === 0x20 ||
      ch === 0x09 ||
      ch === 0x0a ||
      ch === 0x0d ||
      ch === 0x0b ||
      ch === 0x0c
    ) {
      index--;
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index - 1) === 0x2a) {
      const start = source.lastIndexOf("/*", index - 2);
      if (start >= 0) {
        index = start - 1;
        continue;
      }
    }
    return ch;
  }
  return 0;
}

function previousSignificantWord(source, index) {
  index--;
  while (index >= 0) {
    const ch = source.charCodeAt(index);
    if (
      ch === 0x20 ||
      ch === 0x09 ||
      ch === 0x0a ||
      ch === 0x0d ||
      ch === 0x0b ||
      ch === 0x0c
    ) {
      index--;
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index - 1) === 0x2a) {
      const start = source.lastIndexOf("/*", index - 2);
      if (start >= 0) {
        index = start - 1;
        continue;
      }
    }
    break;
  }
  const end = index + 1;
  while (index >= 0 && isIdentifierChar(source.charCodeAt(index))) index--;
  return end === index + 1 ? "" : source.slice(index + 1, end);
}

function skipRegexLiteral(source, index) {
  index++;
  let inClass = false;
  while (index < source.length) {
    const ch = source.charCodeAt(index);
    if (ch === 0x5c) {
      index += 2;
      continue;
    }
    if (ch === 0x5b) inClass = true;
    else if (ch === 0x5d) inClass = false;
    else if (ch === 0x2f && !inClass) {
      index++;
      while (
        index < source.length &&
        isIdentifierChar(source.charCodeAt(index))
      )
        index++;
      break;
    }
    index++;
  }
  return index;
}

function isLikelyRegexLiteral(source, index) {
  const end = skipRegexLiteral(source, index);
  if (end >= source.length) return true;
  if (end === index + 1) return false;
  const next = source.charCodeAt(end);
  return (
    next === 0x20 ||
    next === 0x09 ||
    next === 0x0a ||
    next === 0x0d ||
    next === 0x2e ||
    next === 0x3b ||
    next === 0x2c ||
    next === 0x29 ||
    next === 0x5d ||
    next === 0x7d
  );
}

function previousWordBeforeMatchingParen(source, closeIndex) {
  let depth = 1;
  let index = closeIndex - 1;
  while (index >= 0) {
    const ch = source.charCodeAt(index);
    if (ch === 0x29) depth++;
    else if (ch === 0x28) {
      depth--;
      if (depth === 0) return previousSignificantWord(source, index);
    }
    index--;
  }
  return "";
}

function regexCanFollowParen(source, index) {
  if (previousSignificantChar(source, index) !== 0x29) return false;
  const word = previousWordBeforeMatchingParen(source, index - 1);
  return word === "if" || word === "while" || word === "for" || word === "with";
}

function regexCanFollow(source, index) {
  const previous = previousSignificantChar(source, index);
  if (
    previous === 0 ||
    previous === 0x28 ||
    previous === 0x5b ||
    previous === 0x7b ||
    previous === 0x2c ||
    previous === 0x3b ||
    previous === 0x3a ||
    previous === 0x3d ||
    previous === 0x21 ||
    previous === 0x3f ||
    previous === 0x26 ||
    previous === 0x7c ||
    previous === 0x2b ||
    previous === 0x2d ||
    previous === 0x2a ||
    previous === 0x2f ||
    previous === 0x25 ||
    previous === 0x7e ||
    previous === 0x5e ||
    previous === 0x3c ||
    previous === 0x3e
  )
    return true;
  const word = previousSignificantWord(source, index);
  return (
    word === "return" ||
    word === "throw" ||
    word === "case" ||
    word === "delete" ||
    word === "void" ||
    word === "typeof" ||
    word === "yield" ||
    word === "await" ||
    word === "else" ||
    word === "do" ||
    word === "in" ||
    word === "instanceof" ||
    word === "of"
  );
}

function findTemplateExpressionEnd(source, start) {
  let index = start;
  let depth = 0;
  while (index < source.length) {
    const ch = source.charCodeAt(index);
    if (ch === 0x27 || ch === 0x22) {
      index = skipStringLiteral(source, index, ch);
      continue;
    }
    if (ch === 0x60) {
      index = skipTemplateLiteral(source, index);
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index + 1) === 0x2f) {
      index += 2;
      while (
        index < source.length &&
        source.charCodeAt(index) !== 0x0a &&
        source.charCodeAt(index) !== 0x0d
      )
        index++;
      continue;
    }
    if (ch === 0x2f && source.charCodeAt(index + 1) === 0x2a) {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (ch === 0x2f && regexCanFollow(source, index)) {
      index = skipRegexLiteral(source, index);
      continue;
    }
    if (ch === 0x7b) depth++;
    else if (ch === 0x7d) {
      if (depth === 0) return index;
      depth--;
    }
    index++;
  }
  return -1;
}

function sourceMapURLFromComment(comment) {
  let index = 3;
  const separator = comment.charCodeAt(index);
  if (
    separator !== 0x09 &&
    separator !== 0x0b &&
    separator !== 0x0c &&
    separator !== 0x20 &&
    separator !== 0xa0
  )
    return undefined;
  index++;
  if (!comment.startsWith("sourceMappingURL=", index)) return undefined;
  const valueStart = index + 17;
  let valueEnd = valueStart;
  while (valueEnd < comment.length && !/\s/.test(comment[valueEnd])) valueEnd++;
  if (valueEnd === valueStart || comment.slice(valueEnd).trim() !== "") return undefined;
  return comment.slice(valueStart, valueEnd);
}

export function extractSourceMapURL(code) {
  const source = String(code);
  if (source.indexOf("sourceMappingURL=") === -1) return undefined;
  let result;

  function scan(start, end) {
    let index = start;
    while (index < end) {
      const ch = source.charCodeAt(index);
      if (ch === 0x27 || ch === 0x22) {
        index = skipStringLiteral(source, index, ch);
        continue;
      }
      if (ch === 0x60) {
        index++;
        while (index < end) {
          const templateCh = source.charCodeAt(index);
          if (templateCh === 0x5c) {
            index += 2;
            continue;
          }
          if (templateCh === 0x60) {
            index++;
            break;
          }
          if (templateCh === 0x24 && source.charCodeAt(index + 1) === 0x7b) {
            const expressionStart = index + 2;
            const expressionEnd = findTemplateExpressionEnd(
              source,
              expressionStart,
            );
            if (expressionEnd === -1) return;
            scan(expressionStart, expressionEnd);
            index = expressionEnd + 1;
            continue;
          }
          index++;
        }
        continue;
      }
      if (ch !== 0x2f) {
        index++;
        continue;
      }
      const next = source.charCodeAt(index + 1);
      if (next === 0x2f) {
        let lineEnd = index + 2;
        while (
          lineEnd < end &&
          source.charCodeAt(lineEnd) !== 0x0a &&
          source.charCodeAt(lineEnd) !== 0x0d
        )
          lineEnd++;
        const marker = source.charCodeAt(index + 2);
        if (marker === 0x23 || marker === 0x40) {
          const value = sourceMapURLFromComment(source.slice(index, lineEnd));
          if (value !== undefined) result = value;
        }
        index = lineEnd;
        continue;
      }
      if (next === 0x2a) {
        const close = source.indexOf("*/", index + 2);
        const blockEnd = close === -1 ? end : Math.min(close + 2, end);
        index = blockEnd;
        continue;
      }
      if (
        regexCanFollow(source, index) ||
        (regexCanFollowParen(source, index) &&
          isLikelyRegexLiteral(source, index))
      ) {
        index = skipRegexLiteral(source, index);
        continue;
      }
      index++;
    }
  }

  scan(0, source.length);
  return result;
}
