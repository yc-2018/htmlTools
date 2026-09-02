(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.yamlPropertiesConverter = api;
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => api.initPage());
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const exampleProperties = [
    'server.port=8080',
    'spring.application.name=yaml-properties-demo',
    'spring.datasource.url=jdbc:mysql://localhost:3306/demo',
    'spring.datasource.username=root',
    'spring.datasource.password=secret',
    'feature-flags[0].name=login',
    'feature-flags[0].enabled=true',
    'feature-flags[1].name=checkout',
    'feature-flags[1].enabled=false'
  ].join('\n');

  function parseProperties(text) {
    const data = {};
    const logicalLines = joinPropertiesLines(text);

    logicalLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        return;
      }

      const pair = splitPropertiesLine(line, index + 1);
      const key = decodePropertiesEscapes(pair.key.trim(), index + 1);
      const value = decodePropertiesEscapes(pair.value, index + 1);
      setNestedValue(data, key, parsePropertiesScalar(value));
    });

    return data;
  }

  function stringifyProperties(data) {
    const lines = [];

    function visit(value, path) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          visit(item, `${path}[${index}]`);
        });
        return;
      }

      if (isPlainObject(value)) {
        Object.keys(value).forEach((key) => {
          visit(value[key], path ? `${path}.${key}` : key);
        });
        return;
      }

      lines.push(`${path}=${encodePropertiesValue(value)}`);
    }

    if (!isPlainObject(data)) {
      throw new Error('根节点必须是对象，无法转换为 properties');
    }

    Object.keys(data).forEach((key) => visit(data[key], key));
    return lines.join('\n');
  }

  function convertPropertiesToYaml(text) {
    const data = parseProperties(text);
    const body = stringifyYaml(data);
    return insertYamlComments(body, extractPropertiesYamlComments(text));
  }

  function convertYamlToProperties(text) {
    const data = parseYaml(text);
    const propertyComments = extractYamlPropertyComments(text);
    const inserted = insertPropertiesComments(
      stringifyProperties(data),
      propertyComments.commentsByPath,
      propertyComments.trailingComments
    );
    return inserted.body;
  }

  function parseYaml(text) {
    const lines = normalizeYamlLines(text);
    if (lines.length === 0) {
      return {};
    }
    if (lines[0].indent !== 0) {
      throw new Error(`缩进错误：第 ${lines[0].lineNo} 行必须从第 1 列开始`);
    }

    const result = parseYamlBlock(lines, 0, 0);
    if (result.index < lines.length) {
      throw new Error(`缩进不一致：第 ${lines[result.index].lineNo} 行无法归入上级节点`);
    }
    if (!isPlainObject(result.value)) {
      throw new Error('根节点必须是对象，无法转换为 properties');
    }
    return result.value;
  }

  function stringifyYaml(data) {
    if (!isPlainObject(data)) {
      throw new Error('根节点必须是对象，无法转换为 YAML');
    }
    return stringifyYamlObject(data, 0).join('\n');
  }

  function setNestedValue(rootObject, path, value) {
    const tokens = parsePropertyPath(path);
    if (tokens.length === 0) {
      throw new Error('properties 存在空 key，无法转换');
    }

    let current = rootObject;
    tokens.forEach((token, index) => {
      const last = index === tokens.length - 1;
      const next = tokens[index + 1];
      const readablePath = tokensToReadablePath(tokens.slice(0, index + 1));

      if (token.type === 'key') {
        if (!isPlainObject(current)) {
          throw new Error(`类型冲突：${readablePath} 的上级不是对象`);
        }

        if (last) {
          if (current[token.value] !== undefined) {
            throw new Error(`路径冲突：${readablePath} 已经存在，不能重复赋值`);
          }
          current[token.value] = value;
          return;
        }

        if (current[token.value] === undefined) {
          current[token.value] = next.type === 'index' ? [] : {};
        } else if (next.type === 'index' && !Array.isArray(current[token.value])) {
          throw new Error(`类型冲突：${readablePath} 需要是数组`);
        } else if (next.type === 'key' && Array.isArray(current[token.value])) {
          throw new Error(`类型冲突：${readablePath} 需要是对象`);
        } else if (next.type === 'key' && !isPlainObject(current[token.value])) {
          throw new Error(`路径冲突：${readablePath} 已经是值，不能再包含子项`);
        }

        current = current[token.value];
        return;
      }

      if (!Array.isArray(current)) {
        throw new Error(`类型冲突：${readablePath} 的上级不是数组`);
      }

      if (last) {
        if (current[token.value] !== undefined) {
          throw new Error(`路径冲突：${readablePath} 已经存在，不能重复赋值`);
        }
        current[token.value] = value;
        return;
      }

      if (current[token.value] === undefined) {
        current[token.value] = next.type === 'index' ? [] : {};
      } else if (next.type === 'index' && !Array.isArray(current[token.value])) {
        throw new Error(`类型冲突：${readablePath} 需要是数组`);
      } else if (next.type === 'key' && !isPlainObject(current[token.value])) {
        throw new Error(`路径冲突：${readablePath} 已经是值，不能再包含子项`);
      }

      current = current[token.value];
    });

    return rootObject;
  }

  function extractPropertiesComments(text, targetType) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('#') || line.startsWith('!'))
      .map((line) => {
        const body = line.slice(1).trimStart();
        return targetType === 'yaml' ? `# ${body}`.trimEnd() : `#${body ? ` ${body}` : ''}`;
      });
  }

  function extractPropertiesYamlComments(text) {
    const commentsByPath = {};
    const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let pendingComments = [];
    let trailingComments = [];
    let nextCommentId = 1;

    rawLines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        pendingComments = [];
        return;
      }

      if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
        const body = trimmed.slice(1).trimStart();
        pendingComments.push({
          id: nextCommentId++,
          text: formatComment(body, 'yaml'),
          primaryPaths: [],
          fallbackPaths: []
        });
        trailingComments = pendingComments.slice();
        return;
      }

      if (pendingComments.length > 0) {
        const pair = splitPropertiesLine(line, index + 1);
        const key = decodePropertiesEscapes(pair.key.trim(), index + 1);
        const parentPath = getParentPropertyPath(key);
        const primaryPath = parentPath || key;
        pendingComments.forEach((entry) => {
          addYamlCommentEntry(commentsByPath, primaryPath, entry, false);
          if (primaryPath !== key) {
            addYamlCommentEntry(commentsByPath, key, entry, true);
          }
        });
      }

      pendingComments = [];
      trailingComments = [];
    });

    return {
      commentsByPath,
      trailingComments: trailingComments.map((entry) => entry.text)
    };
  }

  function addYamlCommentEntry(commentsByPath, path, entry, fallback) {
    if (!commentsByPath[path]) {
      commentsByPath[path] = [];
    }
    commentsByPath[path].push(entry);
    const targetPaths = fallback ? entry.fallbackPaths : entry.primaryPaths;
    if (!targetPaths.includes(path)) {
      targetPaths.push(path);
    }
  }

  function insertYamlComments(body, commentState) {
    const lines = String(body || '').split('\n');
    const linePaths = collectYamlOutputLinePaths(lines);
    const bodyPaths = new Set(linePaths.filter(Boolean));
    const insertedIds = {};
    const output = [];

    lines.forEach((line, index) => {
      const path = linePaths[index];
      const comments = path ? commentState.commentsByPath[path] || [] : [];
      comments.forEach((entry) => {
        const hasMatchedPrimaryPath = entry.primaryPaths.some((primaryPath) => bodyPaths.has(primaryPath));
        const isOnlyFallbackHere = entry.fallbackPaths.includes(path) && !entry.primaryPaths.includes(path);
        if (insertedIds[entry.id] || (isOnlyFallbackHere && hasMatchedPrimaryPath)) {
          return;
        }
        insertedIds[entry.id] = true;
        output.push(line ? `${line.match(/^ */)[0]}${entry.text}` : entry.text);
      });
      output.push(line);
    });

    if (commentState.trailingComments.length > 0) {
      output.push(...commentState.trailingComments);
    }

    return output.join('\n');
  }

  function collectYamlOutputLinePaths(lines) {
    const paths = [];
    const stack = [];

    lines.forEach((line, index) => {
      const match = String(line).match(/^(\s*)([^:\s][^:]*):(?:\s|$)/);
      if (!match) {
        paths[index] = '';
        return;
      }

      const indent = match[1].length;
      const key = match[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const path = stack.map((item) => item.key).concat(key).join('.');
      paths[index] = path;
      if (/^\s*[^:\s][^:]*:\s*$/.test(line)) {
        stack.push({ indent, key });
      }
    });

    return paths;
  }

  function extractYamlComments(text, targetType) {
    const comments = [];
    String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .forEach((line) => {
        const commentIndex = findYamlCommentIndex(line);
        if (commentIndex === -1) {
          return;
        }
        const body = line.slice(commentIndex + 1).trimStart();
        comments.push(targetType === 'yaml' ? `# ${body}`.trimEnd() : `#${body ? ` ${body}` : ''}`);
      });
    return comments;
  }

  function extractYamlStandaloneComments(text, targetType) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('#'))
      .map((line) => formatComment(line.slice(1).trimStart(), targetType));
  }

  function extractYamlPropertyComments(text) {
    const lines = normalizeYamlLines(text);
    const commentState = {
      commentsByPath: {},
      nextCommentId: 1,
      trailingComments: lines.trailingComments.map((comment) => formatComment(comment, 'properties'))
    };
    collectYamlPathComments(lines, 0, 0, '', commentState, []);
    return commentState;
  }

  function collectYamlPathComments(lines, startIndex, indent, path, commentState, inheritedComments) {
    if (startIndex >= lines.length || lines[startIndex].indent < indent) {
      return startIndex;
    }
    if (lines[startIndex].content.startsWith('- ')) {
      return collectYamlArrayPathComments(lines, startIndex, indent, path, commentState, inheritedComments);
    }
    return collectYamlObjectPathComments(lines, startIndex, indent, path, commentState, inheritedComments);
  }

  function collectYamlObjectPathComments(lines, startIndex, indent, path, commentState, inheritedComments) {
    let index = startIndex;

    while (index < lines.length && lines[index].indent >= indent) {
      const line = lines[index];
      if (line.indent !== indent || line.content.startsWith('- ')) {
        break;
      }

      const pair = splitYamlPair(line.content, line.lineNo);
      const propertyPath = joinYamlPropertyPath(path, pair.key);
      const lineLeadingComments = consumeInheritedComments(inheritedComments).concat(line.leadingComments);
      if (line.leadingComments.length > 0 && pair.hasValue) {
        addYamlLeadingComments(commentState, propertyPath, lineLeadingComments);
      } else if (lineLeadingComments.length > 0 && pair.hasValue) {
        addYamlLeadingComments(commentState, propertyPath, lineLeadingComments);
      }
      if (line.comment && pair.hasValue) {
        addYamlPropertyComment(commentState, propertyPath, line.comment);
      }

      if (pair.hasValue) {
        index++;
      } else {
        index = collectYamlPathComments(
          lines,
          index + 1,
          nextYamlIndent(lines, index),
          propertyPath,
          commentState,
          lineLeadingComments
        );
      }
    }

    return index;
  }

  function collectYamlArrayPathComments(lines, startIndex, indent, path, commentState, inheritedComments) {
    let index = startIndex;
    let itemIndex = 0;

    while (index < lines.length && lines[index].indent >= indent) {
      const line = lines[index];
      if (line.indent !== indent || !line.content.startsWith('- ')) {
        break;
      }

      const itemPath = `${path}[${itemIndex}]`;
      const itemText = line.content.slice(2).trim();
      const lineLeadingComments = consumeInheritedComments(inheritedComments).concat(line.leadingComments);
      if (!itemText) {
        if (lineLeadingComments.length > 0) {
          addYamlLeadingComments(commentState, itemPath, lineLeadingComments);
        }
        if (line.comment) {
          addYamlPropertyComment(commentState, itemPath, line.comment);
        }
        index = collectYamlPathComments(lines, index + 1, nextYamlIndent(lines, index), itemPath, commentState, []);
        itemIndex++;
        continue;
      }

      if (looksLikeYamlPair(itemText)) {
        const pair = splitYamlPair(itemText, line.lineNo);
        const propertyPath = joinYamlPropertyPath(itemPath, pair.key);
        if (lineLeadingComments.length > 0 && pair.hasValue) {
          addYamlLeadingComments(commentState, propertyPath, lineLeadingComments);
        }
        if (line.comment && pair.hasValue) {
          addYamlPropertyComment(commentState, propertyPath, line.comment);
        }

        index++;
        if (index < lines.length && lines[index].indent > indent) {
          index = collectYamlObjectPathComments(lines, index, lines[index].indent, itemPath, commentState, []);
        }
        itemIndex++;
        continue;
      }

      if (lineLeadingComments.length > 0) {
        addYamlLeadingComments(commentState, itemPath, lineLeadingComments);
      }
      if (line.comment) {
        addYamlPropertyComment(commentState, itemPath, line.comment);
      }
      index++;
      itemIndex++;
    }

    return index;
  }

  function consumeInheritedComments(inheritedComments) {
    return inheritedComments.splice(0);
  }

  function nextYamlIndent(lines, index) {
    const nextIndex = index + 1;
    return nextIndex < lines.length && lines[nextIndex].indent > lines[index].indent
      ? lines[nextIndex].indent
      : lines[index].indent + 2;
  }

  function joinYamlPropertyPath(path, key) {
    return path ? `${path}.${key}` : key;
  }

  function addYamlPropertyComment(commentState, path, comment) {
    const entry = createYamlCommentEntry(commentState, comment);
    addYamlCommentEntryToPath(commentState, path, entry, false);
  }

  function createYamlCommentEntry(commentState, comment) {
    return {
      id: commentState.nextCommentId++,
      text: formatComment(comment, 'properties'),
      primaryPaths: [],
      fallbackPaths: []
    };
  }

  function addYamlCommentEntryToPath(commentState, path, entry, fallback) {
    if (!commentState.commentsByPath[path]) {
      commentState.commentsByPath[path] = [];
    }
    commentState.commentsByPath[path].push(entry);
    const targetPaths = fallback ? entry.fallbackPaths : entry.primaryPaths;
    if (!targetPaths.includes(path)) {
      targetPaths.push(path);
    }
  }

  function addYamlCommentWithFallback(commentState, primaryPath, fallbackPath, comment) {
    const entry = createYamlCommentEntry(commentState, comment);
    addYamlCommentEntryToPath(commentState, primaryPath, entry, false);
    if (fallbackPath && fallbackPath !== primaryPath) {
      addYamlCommentEntryToPath(commentState, fallbackPath, entry, true);
    }
  }

  function addYamlLeadingComments(commentState, path, comments) {
    const parentPath = getParentPropertyPath(path);
    const pendingComments = [];
    let attachedToNamedPath = false;

    comments.forEach((comment) => {
      const pair = parseCommentedYamlPair(comment);
      if (!pair) {
        pendingComments.push(comment);
        return;
      }

      const namedPath = joinYamlPropertyPath(parentPath, pair.key);
      pendingComments.splice(0).forEach((pendingComment) => {
        addYamlCommentWithFallback(commentState, namedPath, path, pendingComment);
      });
      addYamlCommentWithFallback(commentState, namedPath, path, comment);
      attachedToNamedPath = true;
    });

    if (!attachedToNamedPath) {
      pendingComments.forEach((comment) => addYamlPropertyComment(commentState, path, comment));
      return;
    }

    pendingComments.forEach((comment) => addYamlPropertyComment(commentState, path, comment));
  }

  function parseCommentedYamlPair(comment) {
    const trimmed = String(comment || '').trim();
    if (!looksLikeYamlPair(trimmed)) {
      return null;
    }
    const pair = splitYamlPair(trimmed, 0);
    return pair.key ? pair : null;
  }

  function getParentPropertyPath(path) {
    const dotIndex = String(path || '').lastIndexOf('.');
    return dotIndex === -1 ? '' : path.slice(0, dotIndex);
  }

  function removeAttachedComments(comments, attachedComments) {
    const attachedCounts = attachedComments.reduce((counts, comment) => {
      counts[comment] = (counts[comment] || 0) + 1;
      return counts;
    }, {});

    return comments.filter((comment) => {
      if (!attachedCounts[comment]) {
        return true;
      }
      attachedCounts[comment]--;
      return false;
    });
  }

  function insertPropertiesComments(body, commentsByPath, trailingComments) {
    const lines = String(body || '').split('\n');
    const output = [];
    const bodyKeys = new Set(
      lines.map((line) => {
        const separatorIndex = line.indexOf('=');
        return separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      })
    );
    const insertedIds = {};

    lines.forEach((line) => {
      const separatorIndex = line.indexOf('=');
      const key = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const comments = commentsByPath[key] || [];
      comments.forEach((entry) => {
        const hasMatchedPrimaryPath = entry.primaryPaths.some((path) => bodyKeys.has(path));
        const isOnlyFallbackHere = entry.fallbackPaths.includes(key) && !entry.primaryPaths.includes(key);
        if (insertedIds[entry.id] || (isOnlyFallbackHere && hasMatchedPrimaryPath)) {
          return;
        }
        insertedIds[entry.id] = true;
        output.push(entry.text);
      });
      output.push(line);
    });

    if (trailingComments.length > 0) {
      output.push(...trailingComments);
    }

    return {
      body: output.join('\n'),
      insertedComments: []
    };
  }

  function formatComment(body, targetType) {
    return targetType === 'yaml' ? `# ${body}`.trimEnd() : `#${body ? ` ${body}` : ''}`;
  }

  function findYamlCommentIndex(line) {
    let quote = null;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if ((char === '"' || char === "'") && !isEscaped(line, index)) {
        quote = quote === char ? null : quote || char;
      }
      if (char === '#' && quote === null && (index === 0 || /\s/.test(line[index - 1]))) {
        return index;
      }
    }
    return -1;
  }

  function prependComments(body, comments) {
    const uniqueComments = [];
    comments.forEach((comment) => {
      if (!uniqueComments.includes(comment)) {
        uniqueComments.push(comment);
      }
    });
    if (uniqueComments.length === 0) {
      return body;
    }
    if (!body) {
      return uniqueComments.join('\n');
    }
    return `${uniqueComments.join('\n')}\n${body}`;
  }

  function highlightProperties(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return '';
        }
        if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
          return `<span class="syntax-comment">${escapeHtml(line)}</span>`;
        }

        const separatorIndex = findPropertiesSeparator(line);
        if (separatorIndex === -1) {
          return `<span class="syntax-key">${escapeHtml(line)}</span>`;
        }

        const key = line.slice(0, separatorIndex);
        const separator = line[separatorIndex];
        const value = line.slice(separatorIndex + 1);
        return [
          `<span class="syntax-key">${escapeHtml(key)}</span>`,
          `<span class="syntax-separator">${escapeHtml(separator)}</span>`,
          highlightScalarText(value)
        ].join('');
      })
      .join('\n');
  }

  function buildLineNumbers(text) {
    const lineCount = String(text || '').replace(/\r\n?/g, '\n').split('\n').length;
    return Array.from({ length: lineCount }, (item, index) => index + 1).join('\n');
  }

  function highlightYaml(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        const trimmedStart = line.trimStart();
        const indent = line.slice(0, line.length - trimmedStart.length);
        if (!trimmedStart) {
          return '';
        }
        if (trimmedStart.startsWith('#')) {
          return `${escapeHtml(indent)}<span class="syntax-comment">${escapeHtml(trimmedStart)}</span>`;
        }

        if (trimmedStart.startsWith('- ')) {
          const rest = trimmedStart.slice(2);
          return `${escapeHtml(indent)}<span class="syntax-list-marker">-</span> ${highlightYamlContent(rest)}`;
        }

        return `${escapeHtml(indent)}${highlightYamlContent(trimmedStart)}`;
      })
      .join('\n');
  }

  function highlightYamlContent(content) {
    const colonIndex = content.indexOf(':');
    if (colonIndex === -1) {
      return highlightScalarText(content);
    }

    const key = content.slice(0, colonIndex);
    const value = content.slice(colonIndex + 1);
    return [
      `<span class="syntax-key">${escapeHtml(key)}</span>`,
      '<span class="syntax-separator">:</span>',
      highlightScalarText(value)
    ].join('');
  }

  function highlightScalarText(text) {
    const leading = text.match(/^\s*/)[0];
    const trailing = text.match(/\s*$/)[0];
    const value = text.slice(leading.length, text.length - trailing.length);
    if (!value) {
      return escapeHtml(text);
    }

    let className = 'syntax-string';
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
      className = 'syntax-number';
    } else if (/^(true|false)$/i.test(value)) {
      className = 'syntax-boolean';
    } else if (/^(null|~)$/i.test(value)) {
      className = 'syntax-null';
    }

    return `${escapeHtml(leading)}<span class="${className}">${escapeHtml(value)}</span>${escapeHtml(trailing)}`;
  }

  function findPropertiesSeparator(line) {
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (isEscaped(line, index)) {
        continue;
      }
      if (char === '=' || char === ':') {
        return index;
      }
      if (/\s/.test(char)) {
        return index;
      }
    }
    return -1;
  }

  function joinPropertiesLines(text) {
    const physicalLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const logicalLines = [];
    let buffer = '';

    physicalLines.forEach((line) => {
      if (continuesPropertiesLine(line)) {
        buffer += line.slice(0, -1);
      } else {
        logicalLines.push(buffer + line);
        buffer = '';
      }
    });

    if (buffer) {
      logicalLines.push(buffer);
    }

    return logicalLines;
  }

  function continuesPropertiesLine(line) {
    let slashCount = 0;
    for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index--) {
      slashCount++;
    }
    return slashCount % 2 === 1;
  }

  function splitPropertiesLine(line, lineNo) {
    let separatorIndex = -1;
    let separatorType = '';

    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (isEscaped(line, index)) {
        continue;
      }
      if (char === '=' || char === ':') {
        separatorIndex = index;
        separatorType = char;
        break;
      }
      if (/\s/.test(char)) {
        separatorIndex = index;
        separatorType = 'space';
        break;
      }
    }

    if (separatorIndex === -1) {
      return { key: line, value: '' };
    }

    let valueStart = separatorIndex + 1;
    while (valueStart < line.length && /\s/.test(line[valueStart])) {
      valueStart++;
    }
    if (separatorType === 'space' && (line[valueStart] === '=' || line[valueStart] === ':')) {
      valueStart++;
      while (valueStart < line.length && /\s/.test(line[valueStart])) {
        valueStart++;
      }
    }

    const key = line.slice(0, separatorIndex);
    if (!key.trim()) {
      throw new Error(`properties 第 ${lineNo} 行存在空 key`);
    }

    return {
      key,
      value: line.slice(valueStart)
    };
  }

  function decodePropertiesEscapes(value, lineNo) {
    let result = '';

    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      if (char !== '\\') {
        result += char;
        continue;
      }

      index++;
      if (index >= value.length) {
        result += '\\';
        break;
      }

      const escaped = value[index];
      if (escaped === 't') result += '\t';
      else if (escaped === 'r') result += '\r';
      else if (escaped === 'n') result += '\n';
      else if (escaped === 'f') result += '\f';
      else if (escaped === 'u') {
        const hex = value.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new Error(`properties 第 ${lineNo} 行存在无效 Unicode 转义`);
        }
        result += String.fromCharCode(parseInt(hex, 16));
        index += 4;
      } else {
        result += escaped;
      }
    }

    return result;
  }

  function encodePropertiesValue(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  function parsePropertiesScalar(value) {
    return parseScalar(value, false);
  }

  function parsePropertyPath(path) {
    const tokens = [];
    const parts = path.split('.');

    parts.forEach((part) => {
      if (!part) {
        throw new Error(`properties key "${path}" 存在空路径片段`);
      }

      const keyMatch = part.match(/^[^\[]+/);
      let cursor = 0;
      if (keyMatch) {
        tokens.push({ type: 'key', value: keyMatch[0] });
        cursor = keyMatch[0].length;
      }

      while (cursor < part.length) {
        const match = part.slice(cursor).match(/^\[(\d+)\]/);
        if (!match) {
          throw new Error(`properties key "${path}" 的数组索引格式无效`);
        }
        tokens.push({ type: 'index', value: Number(match[1]) });
        cursor += match[0].length;
      }
    });

    return tokens;
  }

  function tokensToReadablePath(tokens) {
    return tokens.reduce((path, token) => {
      if (token.type === 'key') {
        return path ? `${path}.${token.value}` : token.value;
      }
      return `${path}[${token.value}]`;
    }, '');
  }

  function normalizeYamlLines(text) {
    const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    let leadingComments = [];
    let trailingComments = [];

    rawLines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      if (/^\s*---\s*$/.test(rawLine) || /^\s*\.\.\.\s*$/.test(rawLine)) {
        throw new Error(`YAML 第 ${lineNo} 行使用了多文档标记，当前工具不支持多文档`);
      }
      if (/^\s*\S.*(^|\s)[&*][A-Za-z0-9_-]+/.test(rawLine)) {
        throw new Error(`YAML 第 ${lineNo} 行使用了锚点或别名，当前工具不支持锚点`);
      }
      if (hasUnsupportedInlineCollection(rawLine)) {
        throw new Error(`YAML 第 ${lineNo} 行使用了行内对象，当前工具只支持展开写法`);
      }
      if (/^\t+/.test(rawLine)) {
        throw new Error(`缩进错误：YAML 第 ${lineNo} 行不能使用 Tab`);
      }

      const withoutComment = stripYamlComment(rawLine).replace(/\s+$/, '');
      if (!withoutComment.trim()) {
        if (rawLine.trim().startsWith('#')) {
          leadingComments.push(rawLine.trim().slice(1).trimStart());
          trailingComments = leadingComments.slice();
        } else {
          leadingComments = [];
        }
        return;
      }

      const commentIndex = findYamlCommentIndex(rawLine);
      const indent = withoutComment.match(/^ */)[0].length;

      lines.push({
        lineNo,
        indent,
        content: withoutComment.slice(indent).trim(),
        comment: commentIndex === -1 ? '' : rawLine.slice(commentIndex + 1).trimStart(),
        leadingComments
      });
      leadingComments = [];
      trailingComments = [];
    });

    lines.trailingComments = trailingComments;
    return lines;
  }

  function stripYamlComment(line) {
    let quote = null;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if ((char === '"' || char === "'") && !isEscaped(line, index)) {
        quote = quote === char ? null : quote || char;
      }
      if (char === '#' && quote === null && (index === 0 || /\s/.test(line[index - 1]))) {
        return line.slice(0, index);
      }
    }
    return line;
  }

  function hasUnsupportedInlineCollection(line) {
    const withoutComment = stripYamlComment(line);
    const withoutSpringPlaceholders = withoutComment.replace(/\$\{[^}]*\}/g, '');
    return /[\{\}]/.test(withoutSpringPlaceholders);
  }

  function parseYamlBlock(lines, startIndex, indent) {
    if (startIndex >= lines.length || lines[startIndex].indent < indent) {
      return { value: {}, index: startIndex };
    }
    if (lines[startIndex].indent > indent) {
      throw new Error(`缩进不一致：第 ${lines[startIndex].lineNo} 行缩进过深`);
    }

    const isArrayBlock = lines[startIndex].content.startsWith('- ');
    return isArrayBlock
      ? parseYamlArray(lines, startIndex, indent)
      : parseYamlObject(lines, startIndex, indent);
  }

  function parseYamlArray(lines, startIndex, indent) {
    const list = [];
    let index = startIndex;

    while (index < lines.length && lines[index].indent >= indent) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent) {
        throw new Error(`缩进不一致：第 ${line.lineNo} 行缩进过深`);
      }
      if (!line.content.startsWith('- ')) {
        throw new Error(`类型冲突：第 ${line.lineNo} 行同级内容混用了数组和对象`);
      }

      const itemText = line.content.slice(2).trim();
      if (!itemText) {
        const child = nextChildOrNull(lines, index, indent);
        list.push(child.value);
        index = child.index;
        continue;
      }

      if (looksLikeYamlPair(itemText)) {
        const item = {};
        assignYamlPairToObject(item, itemText, line.lineNo, lines, { index, indent });
        index++;

        let propertyIndent = null;
        while (index < lines.length && lines[index].indent > indent) {
          if (propertyIndent === null) {
            propertyIndent = lines[index].indent;
          }
          if (lines[index].indent !== propertyIndent) {
            throw new Error(`缩进不一致：第 ${lines[index].lineNo} 行应与同级数组对象属性保持相同缩进`);
          }
          if (lines[index].content.startsWith('- ')) {
            break;
          }
          const nextIndex = assignYamlObjectLine(item, lines, index, indent + 2);
          index = nextIndex;
        }

        list.push(item);
      } else {
        list.push(parseScalar(itemText, true));
        index++;
      }
    }

    return { value: list, index };
  }

  function parseYamlObject(lines, startIndex, indent) {
    const object = {};
    let index = startIndex;

    while (index < lines.length && lines[index].indent >= indent) {
      const line = lines[index];
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent) {
        throw new Error(`缩进不一致：第 ${line.lineNo} 行缩进过深`);
      }
      if (line.content.startsWith('- ')) {
        throw new Error(`类型冲突：第 ${line.lineNo} 行同级内容混用了对象和数组`);
      }
      index = assignYamlObjectLine(object, lines, index, indent);
    }

    return { value: object, index };
  }

  function assignYamlObjectLine(object, lines, index, indent) {
    const line = lines[index];
    const pair = splitYamlPair(line.content, line.lineNo);
    if (Object.prototype.hasOwnProperty.call(object, pair.key)) {
      throw new Error(`路径冲突：YAML 第 ${line.lineNo} 行重复定义 ${pair.key}`);
    }

    if (pair.hasValue) {
      object[pair.key] = parseScalar(pair.value, true);
      return index + 1;
    }

    const child = nextChildOrNull(lines, index, indent);
    object[pair.key] = child.value;
    return child.index;
  }

  function assignYamlPairToObject(object, content, lineNo) {
    const pair = splitYamlPair(content, lineNo);
    if (!pair.hasValue) {
      throw new Error(`YAML 第 ${lineNo} 行数组项中的 ${pair.key} 缺少值`);
    }
    object[pair.key] = parseScalar(pair.value, true);
  }

  function nextChildOrNull(lines, index, indent) {
    const nextIndex = index + 1;
    if (nextIndex >= lines.length || lines[nextIndex].indent <= indent) {
      return { value: null, index: nextIndex };
    }
    return parseYamlBlock(lines, nextIndex, lines[nextIndex].indent);
  }

  function looksLikeYamlPair(content) {
    return /^[^'"][^:]*:\s*/.test(content);
  }

  function splitYamlPair(content, lineNo) {
    const colonIndex = content.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`YAML 第 ${lineNo} 行缺少冒号`);
    }

    const key = content.slice(0, colonIndex).trim();
    if (!key) {
      throw new Error(`YAML 第 ${lineNo} 行存在空 key`);
    }

    const value = content.slice(colonIndex + 1).trim();
    return {
      key,
      value,
      hasValue: value.length > 0
    };
  }

  function parseScalar(value, fromYaml) {
    const trimmed = String(value).trim();
    if (fromYaml && trimmed === '~') {
      return null;
    }
    if (/^null$/i.test(trimmed)) {
      return null;
    }
    if (/^true$/i.test(trimmed)) {
      return true;
    }
    if (/^false$/i.test(trimmed)) {
      return false;
    }
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      return decodeYamlQuotedString(trimmed);
    }
    return trimmed;
  }

  function decodeYamlQuotedString(value) {
    if (value.startsWith("'")) {
      return value
        .slice(1, -1)
        .replace(/''/g, "'")
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
    }

    const body = value.slice(1, -1);
    return body.replace(/\\(["\\/bfnrt])/g, (match, escaped) => {
      const map = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t'
      };
      return map[escaped];
    });
  }

  function stringifyYamlObject(object, indent) {
    const lines = [];
    Object.keys(object).forEach((key) => {
      const value = object[key];
      const prefix = `${' '.repeat(indent)}${key}:`;
      if (isScalar(value)) {
        lines.push(`${prefix} ${formatYamlScalar(value)}`);
      } else if (Array.isArray(value)) {
        lines.push(prefix);
        lines.push(...stringifyYamlArray(value, indent + 2));
      } else {
        lines.push(prefix);
        lines.push(...stringifyYamlObject(value, indent + 2));
      }
    });
    return lines;
  }

  function stringifyYamlArray(list, indent) {
    const lines = [];
    list.forEach((item) => {
      const spaces = ' '.repeat(indent);
      if (isScalar(item)) {
        lines.push(`${spaces}- ${formatYamlScalar(item)}`);
      } else if (Array.isArray(item)) {
        lines.push(`${spaces}-`);
        lines.push(...stringifyYamlArray(item, indent + 2));
      } else {
        const keys = Object.keys(item);
        if (keys.length === 0) {
          lines.push(`${spaces}- null`);
          return;
        }

        keys.forEach((key, index) => {
          const value = item[key];
          const itemPrefix = index === 0 ? `${spaces}- ${key}:` : `${spaces}  ${key}:`;
          if (isScalar(value)) {
            lines.push(`${itemPrefix} ${formatYamlScalar(value)}`);
          } else if (Array.isArray(value)) {
            lines.push(itemPrefix);
            lines.push(...stringifyYamlArray(value, indent + 4));
          } else {
            lines.push(itemPrefix);
            lines.push(...stringifyYamlObject(value, indent + 4));
          }
        });
      }
    });
    return lines;
  }

  function formatYamlScalar(value) {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    const text = String(value);
    if (isSafePlainYamlScalar(text)) {
      return text;
    }
    return `'${text
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/'/g, "''")}'`;
  }

  function isSafePlainYamlScalar(text) {
    if (!text || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(text)) {
      return false;
    }
    if (/[\r\n]/.test(text) || /[:]\s/.test(text) || /\s#/.test(text)) {
      return false;
    }
    return !/[{}\[\],"'`]/.test(text.replace(/\$\{[^}\r\n]+\}/g, ''));
  }

  function isEscaped(text, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) {
      slashCount++;
    }
    return slashCount % 2 === 1;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isScalar(value) {
    return value === null || value === undefined || typeof value !== 'object';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initPage() {
    setupCodeMirrorModes();

    const propertiesInput = document.getElementById('propertiesInput');
    const yamlInput = document.getElementById('yamlInput');
    const propertiesStatus = document.getElementById('propertiesStatus');
    const yamlStatus = document.getElementById('yamlStatus');
    const exampleBtn = document.getElementById('exampleBtn');
    const clearBtn = document.getElementById('clearBtn');
    const copyPropertiesBtn = document.getElementById('copyPropertiesBtn');
    const copyYamlBtn = document.getElementById('copyYamlBtn');
    const propertiesEditor = createEditor(propertiesInput, 'properties-config');
    const yamlEditor = createEditor(yamlInput, 'yaml-config');
    let syncing = false;

    function setStatus(element, text, isError) {
      element.textContent = text;
      element.classList.toggle('status-error', isError);
      element.classList.toggle('status-ok', !isError);
    }

    function syncFromProperties() {
      if (syncing) return;
      try {
        const yaml = convertPropertiesToYaml(propertiesEditor.getValue());
        syncing = true;
        yamlEditor.setValue(yaml);
        syncing = false;
        setStatus(propertiesStatus, 'properties 已解析', false);
        setStatus(yamlStatus, 'YAML 已同步', false);
      } catch (error) {
        syncing = false;
        setStatus(yamlStatus, `无法根据左侧内容更新：${error.message}`, true);
      }
    }

    function syncFromYaml() {
      if (syncing) return;
      try {
        const properties = convertYamlToProperties(yamlEditor.getValue());
        syncing = true;
        propertiesEditor.setValue(properties);
        syncing = false;
        setStatus(yamlStatus, 'YAML 已解析', false);
        setStatus(propertiesStatus, 'properties 已同步', false);
      } catch (error) {
        syncing = false;
        setStatus(propertiesStatus, `无法根据右侧内容更新：${error.message}`, true);
      }
    }

    function copyText(text, statusElement) {
      const done = () => setStatus(statusElement, '已复制到剪贴板', false);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    }

    function fallbackCopy(text, done) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      done();
    }

    propertiesEditor.onChange(syncFromProperties);
    yamlEditor.onChange(syncFromYaml);
    exampleBtn.addEventListener('click', () => {
      propertiesEditor.setValue(exampleProperties);
      syncFromProperties();
    });
    clearBtn.addEventListener('click', () => {
      syncing = true;
      propertiesEditor.setValue('');
      yamlEditor.setValue('');
      syncing = false;
      setStatus(propertiesStatus, '已清空', false);
      setStatus(yamlStatus, '已清空', false);
    });
    copyPropertiesBtn.addEventListener('click', () => copyText(propertiesEditor.getValue(), propertiesStatus));
    copyYamlBtn.addEventListener('click', () => copyText(yamlEditor.getValue(), yamlStatus));

    propertiesEditor.setValue(exampleProperties);
    syncFromProperties();
  }

  function createEditor(textarea, mode) {
    if (typeof CodeMirror === 'undefined') {
      return {
        getValue: () => textarea.value,
        setValue: (value) => {
          textarea.value = value;
        },
        onChange: (handler) => textarea.addEventListener('input', handler)
      };
    }

    const editor = CodeMirror.fromTextArea(textarea, {
      mode,
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      smartIndent: false,
      viewportMargin: 30
    });

    return {
      getValue: () => editor.getValue(),
      setValue: (value) => editor.setValue(value),
      onChange: (handler) => editor.on('change', handler)
    };
  }

  function setupCodeMirrorModes() {
    if (typeof CodeMirror === 'undefined' || setupCodeMirrorModes.done) {
      return;
    }
    setupCodeMirrorModes.done = true;

    CodeMirror.defineMode('properties-config', () => ({
      token(stream) {
        if (stream.sol()) {
          stream.eatSpace();
          if (stream.match(/[#!].*/)) {
            return 'comment';
          }
          if (stream.match(/[^:=\s]+(?=\s*[:=\s])/)) {
            return 'property';
          }
        }
        if (stream.match(/[:=]/)) {
          return 'variable-2';
        }
        return readScalarToken(stream);
      }
    }));

    CodeMirror.defineMode('yaml-config', () => ({
      token(stream) {
        if (stream.sol()) {
          stream.eatSpace();
          if (stream.match('#')) {
            stream.skipToEnd();
            return 'comment';
          }
          if (stream.match('-')) {
            return 'variable-2';
          }
          if (stream.match(/[^:]+(?=\s*:)/)) {
            return 'property';
          }
        }
        if (stream.match(':')) {
          return 'variable-2';
        }
        if (stream.match(/\s+#.*/)) {
          return 'comment';
        }
        return readScalarToken(stream);
      }
    }));
  }

  function readScalarToken(stream) {
    if (stream.eatSpace()) {
      return null;
    }
    if (stream.match(/'(?:[^']|'')*'/) || stream.match(/"(?:[^"\\]|\\.)*"/)) {
      return 'string';
    }
    if (stream.match(/(?:true|false|null|~)\b/i)) {
      return 'atom';
    }
    if (stream.match(/-?(?:0|[1-9]\d*)(?:\.\d+)?\b/)) {
      return 'number';
    }
    stream.next();
    return null;
  }

  return {
    parseProperties,
    stringifyProperties,
    convertPropertiesToYaml,
    convertYamlToProperties,
    parseYaml,
    stringifyYaml,
    setNestedValue,
    highlightProperties,
    highlightYaml,
    buildLineNumbers,
    initPage
  };
});
