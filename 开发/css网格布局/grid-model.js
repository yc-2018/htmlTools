/**
 * CSS Grid 生成器的纯逻辑：轨道模板、单位校验、区域几何、代码生成与高亮。
 * 不触达 DOM，便于单独验证。
 */
(function (global) {
  'use strict';

  const MAX_TRACKS = 12;
  const MAX_GAP = 50;
  const DEFAULT_UNIT = '1fr';

  const UNIT_PATTERN = /^\d*\.?\d+(fr|px|%|em|rem|vh|vw|vmin|vmax|q|mm|cm|in|pt|pc|ex|ch)$/i;
  const KEYWORD_UNITS = ['auto', 'min-content', 'max-content'];
  // repeat() 由相邻轨道合并生成，单个轨道输入里不允许再写，否则会嵌套出非法值
  const FUNCTION_UNITS = /^(minmax|fit-content|min|max|clamp)\(.+\)$/i;
  // CSS 标识符允许非 ASCII 字符，中文名可以直接用在类名和 grid-area 里；不能以数字开头
  const NAME_PATTERN = /^-?[A-Za-z_\u00A0-\uFFFF][A-Za-z0-9_\-\u00A0-\uFFFF]*$/;
  // 这些关键字不能作为 grid-area 的名称
  const RESERVED_NAMES = ['auto', 'none', 'span', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'];

  /* ---------- 轨道 ---------- */

  function createTracks(count) {
    return Array.from({ length: count }, function () {
      return { unit: DEFAULT_UNIT };
    });
  }

  function resizeTracks(tracks, count) {
    while (tracks.length > count) tracks.pop();
    while (tracks.length < count) tracks.push({ unit: DEFAULT_UNIT });
  }

  function isValidTrackUnit(value) {
    const unit = String(value).trim();
    if (!unit) return false;
    if (KEYWORD_UNITS.indexOf(unit) !== -1) return true;
    if (unit === '0') return true;
    if (UNIT_PATTERN.test(unit)) return true;
    return FUNCTION_UNITS.test(unit);
  }

  function groupRepeatedUnits(tracks) {
    const units = tracks.map(function (track) {
      return track.unit;
    });
    if (!units.length) return [];
    const groups = [[units[0]]];
    for (let i = 1; i < units.length; i += 1) {
      const last = groups[groups.length - 1];
      if (last[0] === units[i]) {
        last.push(units[i]);
      } else {
        groups.push([units[i]]);
      }
    }
    return groups;
  }

  // 相邻且单位相同的轨道合并成 repeat() 简写
  // clampFr 用于轨迹输入条：输入框自身有最小尺寸，不夹住 fr 的话 1fr 会被内容撑开，行高就与格子对不上了
  function templateFromTracks(tracks, clampFr) {
    return groupRepeatedUnits(tracks)
      .map(function (group) {
        let unit = group[0];
        if (clampFr && /^\d*\.?\d+fr$/i.test(unit)) {
          unit = 'minmax(0, ' + unit + ')';
        }
        return group.length === 1 ? unit : 'repeat(' + group.length + ', ' + unit + ')';
      })
      .join(' ')
      .trim();
  }

  /* ---------- 区域几何 ---------- */

  function overlap(a, b) {
    return a.row < b.row + b.rowSpan &&
      b.row < a.row + a.rowSpan &&
      a.col < b.col + b.colSpan &&
      b.col < a.col + a.colSpan;
  }

  function findOverlap(candidate, areas, ignoreId) {
    for (let i = 0; i < areas.length; i += 1) {
      const area = areas[i];
      if (ignoreId != null && area.id === ignoreId) continue;
      if (overlap(candidate, area)) return area;
    }
    return null;
  }

  // 右下角可拖到的最小位置，保证区域整体留在网格内
  function clampRect(rect, columns, rows) {
    const rowSpan = Math.max(1, Math.min(rect.rowSpan, rows));
    const colSpan = Math.max(1, Math.min(rect.colSpan, columns));
    return {
      row: Math.max(1, Math.min(rect.row, rows - rowSpan + 1)),
      col: Math.max(1, Math.min(rect.col, columns - colSpan + 1)),
      rowSpan: rowSpan,
      colSpan: colSpan
    };
  }

  // 行列数减少后把区域裁进边界，起点已经越界的直接丢弃
  function clampAreas(areas, columns, rows) {
    const kept = [];
    let removed = 0;
    areas.forEach(function (area) {
      if (area.row > rows || area.col > columns) {
        removed += 1;
        return;
      }
      kept.push({
        id: area.id,
        name: area.name,
        row: area.row,
        col: area.col,
        rowSpan: Math.min(area.rowSpan, rows - area.row + 1),
        colSpan: Math.min(area.colSpan, columns - area.col + 1)
      });
    });
    return { areas: kept, removed: removed };
  }

  function rectFromCells(a, b) {
    return {
      row: Math.min(a.row, b.row),
      col: Math.min(a.col, b.col),
      rowSpan: Math.abs(a.row - b.row) + 1,
      colSpan: Math.abs(a.col - b.col) + 1
    };
  }

  function gridAreaOf(area) {
    return area.row + ' / ' + area.col + ' / ' +
      (area.row + area.rowSpan) + ' / ' + (area.col + area.colSpan);
  }

  function isReservedName(name) {
    return RESERVED_NAMES.indexOf(name.toLowerCase()) !== -1;
  }

  // 尽量把用户输入修成合法的 CSS 标识符，实在不行才回退
  function sanitizeName(raw, fallback) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name) return fallback;
    if (NAME_PATTERN.test(name) && !isReservedName(name)) return name;

    let cleaned = name
      .replace(/[\s"'`!@#$%^&*()=+\[\]{};:,.<>/?\\|~]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');

    // 数字或不合法字符开头时补个前缀，而不是把用户输入整个丢掉
    if (cleaned && !NAME_PATTERN.test(cleaned)) {
      cleaned = 'a-' + cleaned.replace(/^-+/, '');
    }
    if (!cleaned || !NAME_PATTERN.test(cleaned)) return fallback;
    return isReservedName(cleaned) ? cleaned + '-area' : cleaned;
  }

  // 生成 grid-template-areas 的矩阵行，每行已带缩进和引号
  function areasMatrix(areas, columns, rows) {
    if (columns < 1 || rows < 1) return '';
    const grid = [];
    for (let r = 0; r < rows; r += 1) {
      grid.push(new Array(columns).fill('.'));
    }
    areas.forEach(function (area) {
      for (let r = area.row; r < area.row + area.rowSpan; r += 1) {
        for (let c = area.col; c < area.col + area.colSpan; c += 1) {
          if (r >= 1 && r <= rows && c >= 1 && c <= columns) {
            grid[r - 1][c - 1] = area.name;
          }
        }
      }
    });
    return grid.map(function (row) {
      return '    "' + row.join(' ') + '"';
    }).join('\n');
  }

  /* ---------- 代码生成 ---------- */

  function gapValue(columnGap, rowGap) {
    return rowGap === columnGap ? rowGap + 'px' : rowGap + 'px ' + columnGap + 'px';
  }

  function buildCssText(config) {
    const colTemplate = templateFromTracks(config.colTracks) || 'none';
    const rowTemplate = templateFromTracks(config.rowTracks) || 'none';
    const named = config.codeMode === 'named';

    const lines = [
      '.parent {',
      '  display: grid;',
      '  grid-template-columns: ' + colTemplate + ';',
      '  grid-template-rows: ' + rowTemplate + ';'
    ];

    if (named && config.areas.length) {
      lines.push('  grid-template-areas:');
      lines.push(areasMatrix(config.areas, config.columns, config.rows) + ';');
    }

    lines.push('  gap: ' + gapValue(config.columnGap, config.rowGap) + ';');
    lines.push('  /* 给容器一个高度，粘贴后能直接看到效果，可按需删掉 */');
    lines.push('  min-height: 400px;');
    lines.push('}');

    config.areas.forEach(function (area) {
      lines.push('');
      lines.push('.' + area.name + ' {');
      lines.push('  grid-area: ' + (named ? area.name : gridAreaOf(area)) + ';');
      lines.push('}');
    });

    return lines.join('\n');
  }

  function buildHtmlText(config) {
    const lines = ['<div class="parent">'];
    config.areas.forEach(function (area) {
      lines.push('  <div class="' + area.name + '"></div>');
    });
    lines.push('</div>');
    return lines.join('\n');
  }

  function indent(text, size) {
    const pad = new Array(size + 1).join(' ');
    return text.split('\n').map(function (line) {
      return line ? pad + line : line;
    }).join('\n');
  }

  function buildFullPageText(config) {
    return [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      '  <title>Grid 布局示例</title>',
      '  <style>',
      '    body {',
      '      margin: 0;',
      '      padding: 24px;',
      '      font-family: system-ui, sans-serif;',
      '      background: #f4f5f7;',
      '    }',
      '',
      indent(buildCssText(config), 4),
      '  </style>',
      '</head>',
      '<body>',
      indent(buildHtmlText(config), 2),
      '</body>',
      '</html>'
    ].join('\n');
  }

  /* ---------- 语法高亮 ---------- */

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function highlightCssLine(line) {
    const indentPart = line.match(/^\s*/)[0];
    const body = line.slice(indentPart.length);
    if (!body) return '';

    if (/^\/\*.*\*\/$/.test(body)) {
      return indentPart + '<span class="ccomment">' + escapeHtml(body) + '</span>';
    }

    // grid-template-areas 的值行
    const areaLine = body.match(/^(".*")(;?)$/);
    if (areaLine) {
      return indentPart + '<span class="cprop">' + escapeHtml(areaLine[1]) + '</span>' + escapeHtml(areaLine[2]);
    }

    if (body === '}') return indentPart + '}';

    const selector = body.match(/^([^{}]+?)(\s*\{)$/);
    if (selector && body.indexOf(':') === -1) {
      return indentPart + '<span class="cname">' + escapeHtml(selector[1]) + '</span>' + escapeHtml(selector[2]);
    }

    const decl = body.match(/^(-{0,2}[a-zA-Z-]+)(:)(.*?)(;?)$/);
    if (decl) {
      return indentPart + '<span class="ckey">' + escapeHtml(decl[1]) + '</span>:' +
        '<span class="cprop">' + escapeHtml(decl[3]) + '</span>' + escapeHtml(decl[4]);
    }

    return indentPart + escapeHtml(body);
  }

  function highlightCss(text) {
    return text.split('\n').map(highlightCssLine).join('\n');
  }

  function highlightHtmlLine(line) {
    let out = escapeHtml(line);
    out = out.replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="cname">$2</span>');
    out = out.replace(/(\s)([a-zA-Z-]+)=(&quot;[^&]*&quot;)/g,
      '$1<span class="cprop">$2</span>=<span class="cstring">$3</span>');
    return out;
  }

  function highlightHtml(text) {
    return text.split('\n').map(highlightHtmlLine).join('\n');
  }

  // 完整页面里 <style> 之间按 CSS 规则着色，其余按 HTML 着色的
  function highlightFullPage(text) {
    let inStyle = false;
    return text.split('\n').map(function (line) {
      if (/<style>/.test(line)) {
        inStyle = true;
        return highlightHtmlLine(line);
      }
      if (/<\/style>/.test(line)) {
        inStyle = false;
        return highlightHtmlLine(line);
      }
      return inStyle ? highlightCssLine(line) : highlightHtmlLine(line);
    }).join('\n');
  }

  global.GridModel = {
    MAX_TRACKS: MAX_TRACKS,
    MAX_GAP: MAX_GAP,
    DEFAULT_UNIT: DEFAULT_UNIT,
    createTracks: createTracks,
    resizeTracks: resizeTracks,
    isValidTrackUnit: isValidTrackUnit,
    templateFromTracks: templateFromTracks,
    findOverlap: findOverlap,
    clampRect: clampRect,
    clampAreas: clampAreas,
    rectFromCells: rectFromCells,
    gridAreaOf: gridAreaOf,
    sanitizeName: sanitizeName,
    buildCssText: buildCssText,
    buildHtmlText: buildHtmlText,
    buildFullPageText: buildFullPageText,
    highlightCss: highlightCss,
    highlightHtml: highlightHtml,
    highlightFullPage: highlightFullPage
  };
})(window);
