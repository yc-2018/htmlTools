(function () {
  'use strict';

  /* ---------- 常量 ---------- */

  const MAX_TRACKS = 12;
  const MAX_GAP = 50;
  const DEFAULT_UNIT = '1fr';
  const HUE_START = 45;
  const HUE_STEP = 24;
  // 允许的轨道单位：数值 + 单位，或 auto / min-content / max-content 等关键字
  const UNIT_PATTERN = /^\d*\.?\d+(fr|px|%|em|rem|vh|vw|vmin|vmax|q|mm|cm|in|pt|pc|ex|ch)$/i;
  const KEYWORD_UNITS = ['auto', 'min-content', 'max-content'];
  const FUNCTION_UNITS = /^(minmax|repeat|fit-content)\(.+\)$/i;

  /* ---------- 状态 ---------- */

  const state = {
    columns: 5,
    rows: 5,
    columnGap: 0,
    rowGap: 0,
    colTracks: [],
    rowTracks: [],
    areas: []
  };

  const dom = {
    colUnits: document.getElementById('colUnits'),
    rowUnits: document.getElementById('rowUnits'),
    boxLayer: document.getElementById('boxLayer'),
    childLayer: document.getElementById('childLayer'),
    columnsInput: document.getElementById('columns'),
    rowsInput: document.getElementById('rows'),
    columnGapInput: document.getElementById('columnGap'),
    rowGapInput: document.getElementById('rowGap'),
    showCode: document.getElementById('showCode'),
    resetGrid: document.getElementById('resetGrid'),
    showExplain: document.getElementById('showExplain'),
    modalMask: document.getElementById('modalMask'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose')
  };

  /* ---------- 轨道模板 ---------- */

  function createTracks(count) {
    return Array.from({ length: count }, function () {
      return { unit: DEFAULT_UNIT };
    });
  }

  function resizeTracks(tracks, count) {
    while (tracks.length > count) tracks.pop();
    while (tracks.length < count) tracks.push({ unit: DEFAULT_UNIT });
  }

  // 相邻且单位相同的轨道合并，方便生成 repeat() 简写
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

  function createRepetition(groups) {
    return groups
      .map(function (group) {
        return group.length === 1 ? group[0] : 'repeat(' + group.length + ', ' + group[0] + ')';
      })
      .join(' ')
      .trim();
  }

  function colTemplate() {
    return createRepetition(groupRepeatedUnits(state.colTracks));
  }

  function rowTemplate() {
    return createRepetition(groupRepeatedUnits(state.rowTracks));
  }

  function cellCount() {
    return Math.max(state.columns, 0) * Math.max(state.rows, 0);
  }

  /* ---------- 单位校验 ---------- */

  function isValidTrackUnit(value) {
    const unit = String(value).trim();
    if (!unit) return false;
    if (KEYWORD_UNITS.indexOf(unit) !== -1) return true;
    if (Number(unit) === 0) return true;
    if (UNIT_PATTERN.test(unit)) return true;
    return FUNCTION_UNITS.test(unit);
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const cols = colTemplate() || 'none';
    const rows = rowTemplate() || 'none';
    const columnGap = state.columnGap + 'px';
    const rowGap = state.rowGap + 'px';

    dom.colUnits.style.gridTemplateColumns = cols;
    dom.colUnits.style.columnGap = columnGap;
    dom.rowUnits.style.gridTemplateRows = rows;
    dom.rowUnits.style.rowGap = rowGap;

    [dom.boxLayer, dom.childLayer].forEach(function (layer) {
      layer.style.gridTemplateColumns = cols;
      layer.style.gridTemplateRows = rows;
      layer.style.columnGap = columnGap;
      layer.style.rowGap = rowGap;
    });

    syncUnitCells(dom.colUnits, state.colTracks, 'col');
    syncUnitCells(dom.rowUnits, state.rowTracks, 'row');
    renderBoxes();
    renderAreas();
  }

  function createUnitCell(kind) {
    const cell = document.createElement('div');
    cell.className = 'unit-cell';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'unit-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.kind = kind;
    input.setAttribute('aria-label', kind === 'col' ? '列轨道宽度' : '行轨道高度');

    const tip = document.createElement('div');
    tip.className = 'unit-error';
    tip.textContent = '请填写正确的 CSS 单位，例如 1fr、200px、auto';
    tip.hidden = true;

    cell.appendChild(input);
    cell.appendChild(tip);
    return cell;
  }

  function syncUnitCells(container, tracks, kind) {
    while (container.children.length > tracks.length) {
      container.lastElementChild.remove();
    }
    while (container.children.length < tracks.length) {
      container.appendChild(createUnitCell(kind));
    }

    Array.prototype.forEach.call(container.children, function (cell, index) {
      const input = cell.querySelector('.unit-input');
      const track = tracks[index];
      input.dataset.index = String(index);
      input.name = kind + 'Unit' + index;
      if (document.activeElement !== input && input.value !== track.unit) {
        input.value = track.unit;
      }
      const valid = isValidTrackUnit(track.unit);
      input.classList.toggle('has-error', !valid);
      cell.querySelector('.unit-error').hidden = valid;
    });
  }

  function renderBoxes() {
    const total = cellCount();
    dom.boxLayer.replaceChildren();
    for (let i = 1; i <= total; i += 1) {
      const box = document.createElement('div');
      box.className = 'box';
      box.dataset.cell = String(i);
      dom.boxLayer.appendChild(box);
    }
  }

  function renderAreas() {
    dom.childLayer.replaceChildren();
    state.areas.forEach(function (area, index) {
      const child = document.createElement('div');
      child.className = 'child';
      child.style.gridArea = area;
      child.style.setProperty('--hue', (HUE_START + index * HUE_STEP) % 360 + 'deg');

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'child-remove';
      remove.textContent = '×';
      remove.title = '删除这块区域';
      remove.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 块区域');
      remove.addEventListener('click', function () {
        state.areas.splice(index, 1);
        renderAreas();
      });

      child.appendChild(remove);
      dom.childLayer.appendChild(child);
    });
  }

  /* ---------- 拖拽划区 ---------- */

  let dragStart = null;

  function cellPosition(cell) {
    const index = Number(cell);
    const row = Math.ceil(index / state.columns);
    const col = index - (row - 1) * state.columns;
    return { row: row, col: col };
  }

  function clearDragStart() {
    dragStart = null;
    const active = dom.boxLayer.querySelector('.box.is-start');
    if (active) active.classList.remove('is-start');
  }

  function finishDrag(clientX, clientY) {
    if (!dragStart || !state.columns) {
      clearDragStart();
      return;
    }

    const start = dragStart;
    clearDragStart();

    const target = document.elementFromPoint(clientX, clientY);
    const box = target && target.closest ? target.closest('.box') : null;
    if (!box) return;

    const end = cellPosition(box.dataset.cell);
    const rowFrom = Math.min(start.row, end.row);
    const rowTo = Math.max(start.row, end.row) + 1;
    const colFrom = Math.min(start.col, end.col);
    const colTo = Math.max(start.col, end.col) + 1;

    state.areas.push(rowFrom + ' / ' + colFrom + ' / ' + rowTo + ' / ' + colTo);
    renderAreas();
  }

  /* ---------- 代码生成 ---------- */

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function buildCssText() {
    const lines = [
      '.parent {',
      '  display: grid;',
      '  grid-template-columns: ' + (colTemplate() || 'none') + ';',
      '  grid-template-rows: ' + (rowTemplate() || 'none') + ';',
      '  grid-column-gap: ' + state.columnGap + 'px;',
      '  grid-row-gap: ' + state.rowGap + 'px;',
      '}'
    ];
    state.areas.forEach(function (area, index) {
      lines.push('');
      lines.push('.div' + (index + 1) + ' {');
      lines.push('  grid-area: ' + area + ';');
      lines.push('}');
    });
    return lines.join('\n');
  }

  function buildCssHtml() {
    const rows = [
      '<span class="cname">.parent</span> {',
      '  <span class="ckey">display</span>: <span class="cprop">grid</span>;',
      '  <span class="ckey">grid-template-columns</span>: <span class="cprop">' + escapeHtml(colTemplate() || 'none') + '</span>;',
      '  <span class="ckey">grid-template-rows</span>: <span class="cprop">' + escapeHtml(rowTemplate() || 'none') + '</span>;',
      '  <span class="ckey">grid-column-gap</span>: <span class="cprop">' + state.columnGap + 'px</span>;',
      '  <span class="ckey">grid-row-gap</span>: <span class="cprop">' + state.rowGap + 'px</span>;',
      '}'
    ];
    state.areas.forEach(function (area, index) {
      rows.push('');
      rows.push('<span class="cname">.div' + (index + 1) + '</span> {');
      rows.push('  <span class="ckey">grid-area</span>: <span class="cprop">' + escapeHtml(area) + '</span>;');
      rows.push('}');
    });
    return rows.join('\n');
  }

  function buildHtmlText() {
    const lines = ['<div class="parent">'];
    state.areas.forEach(function (area, index) {
      lines.push('  <div class="div' + (index + 1) + '"></div>');
    });
    lines.push('</div>');
    return lines.join('\n');
  }

  function buildHtmlHtml() {
    const rows = ['<span class="cname">&lt;div</span> <span class="cprop">class="parent"</span><span class="cname">&gt;</span>'];
    state.areas.forEach(function (area, index) {
      rows.push('  <span class="cname">&lt;div</span> <span class="cprop">class="div' + (index + 1) + '"</span><span class="cname">&gt;&lt;/div&gt;</span>');
    });
    rows.push('<span class="cname">&lt;/div&gt;</span>');
    return rows.join('\n');
  }

  /* ---------- 复制 ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  /* ---------- 弹窗 ---------- */

  let showHtml = false;
  let copyTimer = null;
  let lastFocus = null;

  function openModal(renderBody) {
    lastFocus = document.activeElement;
    renderBody();
    dom.modalMask.hidden = false;
    dom.modalClose.focus();
  }

  function closeModal() {
    if (dom.modalMask.hidden) return;
    dom.modalMask.hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function renderCodeModal() {
    dom.modalTitle.textContent = '您的 Grid 代码';

    const title = document.createElement('h3');
    title.className = 'code-title';
    title.textContent = '复制以下代码：';

    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-small';
    toggle.textContent = showHtml ? '展示 CSS' : '展示 HTML';
    toggle.addEventListener('click', function () {
      showHtml = !showHtml;
      renderCodeModal();
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-small';
    copy.textContent = '复制';
    copy.addEventListener('click', function () {
      copyText(showHtml ? buildHtmlText() : buildCssText()).then(function (ok) {
        copy.textContent = ok ? '复制成功！' : '复制失败';
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(function () {
          copy.textContent = '复制';
        }, 2000);
      });
    });

    const block = document.createElement('pre');
    block.className = 'code-block';
    block.innerHTML = showHtml ? buildHtmlHtml() : buildCssHtml();

    toolbar.appendChild(toggle);
    toolbar.appendChild(copy);
    dom.modalBody.replaceChildren(title, toolbar, block);
  }

  function renderExplainModal() {
    dom.modalTitle.textContent = '这是什么？';

    const wrap = document.createElement('div');
    wrap.innerHTML = [
      '<p>您可以设置行与列的数量和每一格的轨道单位，我会据此生成一份 CSS Grid 布局。' +
      '在网格里<strong>按住并拖动</strong>，就能划出一块区域，它会被写成一个 div。</p>',
      '<p>这个小工具只能帮您搭出一个基础布局，并不是 CSS Grid 的完整教程，它只是一个快速上手 Grid 的捷径。</p>',
      '<p>很多人不用 Grid，是因为觉得它太复杂、难以理解。Grid 能做的事情很多，这个生成器只涉及其中很小一部分，' +
      '目的就是让您快速做出更有意思的布局。</p>',
      '<p>上手之后，推荐继续阅读 <a href="https://css-tricks.com/snippets/css/complete-guide-grid/" target="_blank" rel="noopener">' +
      'CSS-Tricks 的 CSS Grid 完整指南</a>，也可以去玩一玩小游戏 ' +
      '<a href="https://cssgridgarden.com/" target="_blank" rel="noopener">Grid Garden</a> 来加深理解。</p>',
      '<p>注意：读屏器会按照 div 添加的顺序朗读，构建布局时请留意这一点。</p>',
      '<p class="credit">本项目参考 Sarah Drasner 的 CSS Grid Generator 实现，界面与文案已改为中文版。</p>'
    ].join('');
    dom.modalBody.replaceChildren(wrap);
  }

  /* ---------- 数值输入 ---------- */

  function normalizeInt(raw, max) {
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, max);
  }

  function syncNumberInput(input, value) {
    input.value = String(value);
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    dom.colUnits.addEventListener('change', function (event) {
      updateTrackUnit(event, state.colTracks);
    });
    dom.rowUnits.addEventListener('change', function (event) {
      updateTrackUnit(event, state.rowTracks);
    });

    dom.columnsInput.addEventListener('input', function () {
      state.columns = normalizeInt(dom.columnsInput.value, MAX_TRACKS);
      resizeTracks(state.colTracks, state.columns);
      render();
    });
    dom.columnsInput.addEventListener('change', function () {
      syncNumberInput(dom.columnsInput, state.columns);
    });

    dom.rowsInput.addEventListener('input', function () {
      state.rows = normalizeInt(dom.rowsInput.value, MAX_TRACKS);
      resizeTracks(state.rowTracks, state.rows);
      render();
    });
    dom.rowsInput.addEventListener('change', function () {
      syncNumberInput(dom.rowsInput, state.rows);
    });

    dom.columnGapInput.addEventListener('input', function () {
      state.columnGap = normalizeInt(dom.columnGapInput.value, MAX_GAP);
      render();
    });
    dom.columnGapInput.addEventListener('change', function () {
      syncNumberInput(dom.columnGapInput, state.columnGap);
    });

    dom.rowGapInput.addEventListener('input', function () {
      state.rowGap = normalizeInt(dom.rowGapInput.value, MAX_GAP);
      render();
    });
    dom.rowGapInput.addEventListener('change', function () {
      syncNumberInput(dom.rowGapInput, state.rowGap);
    });

    dom.boxLayer.addEventListener('pointerdown', function (event) {
      const box = event.target.closest('.box');
      if (!box) return;
      event.preventDefault();
      clearDragStart();
      dragStart = cellPosition(box.dataset.cell);
      box.classList.add('is-start');
    });

    window.addEventListener('pointerup', function (event) {
      finishDrag(event.clientX, event.clientY);
    });
    window.addEventListener('pointercancel', clearDragStart);

    dom.showCode.addEventListener('click', function () {
      showHtml = false;
      openModal(renderCodeModal);
    });

    dom.showExplain.addEventListener('click', function () {
      openModal(renderExplainModal);
    });

    dom.resetGrid.addEventListener('click', function () {
      state.areas = [];
      renderAreas();
    });

    dom.modalClose.addEventListener('click', closeModal);

    dom.modalMask.addEventListener('mousedown', function (event) {
      if (event.target === dom.modalMask) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
    });
  }

  function updateTrackUnit(event, tracks) {
    const input = event.target.closest('.unit-input');
    if (!input) return;
    const track = tracks[Number(input.dataset.index)];
    if (!track) return;
    track.unit = input.value.trim();
    render();
  }

  /* ---------- 启动 ---------- */

  state.colTracks = createTracks(state.columns);
  state.rowTracks = createTracks(state.rows);
  bindEvents();
  render();
})();
