(function () {
  'use strict';

  const Model = window.GridModel;

  const HUE_START = 45;
  const HUE_STEP = 24;
  const HISTORY_LIMIT = 60;
  const STORAGE_KEY = 'html-tools:css-grid-generator:v1';
  // 轨道至少要有这么高，否则行输入框里的字会挤得看不见
  const MIN_ROW_PX = 22;
  // 列还要更宽一点，不然区域名和列输入框都露不出来
  const MIN_COL_PX = 32;
  // 顶部单位条的高度，对应 .stage-grid 的 grid-template-rows
  const UNIT_BAR_PX = 46;

  /* ---------- 状态 ---------- */

  const state = {
    columns: 5,
    rows: 5,
    columnGap: 0,
    rowGap: 0,
    colTracks: Model.createTracks(5),
    rowTracks: Model.createTracks(5),
    // 每块区域：{ id, name, row, col, rowSpan, colSpan }
    areas: [],
    nameSeq: 0,
    codeMode: 'named'
  };

  let selectedId = null;
  let action = null;
  let idSeq = 0;
  let codeTab = 'css';
  let copyTimer = null;
  let toastTimer = null;
  let lastFocus = null;
  let stageObserver = null;

  const history = { past: [], future: [] };

  const dom = {
    stage: document.getElementById('stage'),
    stageGrid: document.getElementById('stageGrid'),
    stageScroll: document.querySelector('.stage-scroll'),
    colUnits: document.getElementById('colUnits'),
    rowUnits: document.getElementById('rowUnits'),
    boxLayer: document.getElementById('boxLayer'),
    childLayer: document.getElementById('childLayer'),
    ghostLayer: document.getElementById('ghostLayer'),
    ghostBlock: document.getElementById('ghostBlock'),
    columnsInput: document.getElementById('columns'),
    rowsInput: document.getElementById('rows'),
    columnsValue: document.getElementById('columnsValue'),
    rowsValue: document.getElementById('rowsValue'),
    columnGapInput: document.getElementById('columnGap'),
    rowGapInput: document.getElementById('rowGap'),
    showCode: document.getElementById('showCode'),
    resetGrid: document.getElementById('resetGrid'),
    restoreDefault: document.getElementById('restoreDefault'),
    showExplain: document.getElementById('showExplain'),
    toast: document.getElementById('toast'),
    modalMask: document.getElementById('modalMask'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose')
  };

  /* ---------- 小工具 ---------- */

  function toInt(value, fallback) {
    const num = Math.floor(Number(value));
    return Number.isFinite(num) ? num : fallback;
  }

  function clampInt(value, min, max, fallback) {
    return Math.max(min, Math.min(toInt(value, fallback), max));
  }

  function getArea(id) {
    for (let i = 0; i < state.areas.length; i += 1) {
      if (state.areas[i].id === id) return state.areas[i];
    }
    return null;
  }

  function childElement(id) {
    return dom.childLayer.querySelector('.child[data-id="' + id + '"]');
  }

  function nextId() {
    idSeq += 1;
    return idSeq;
  }

  function nextName() {
    state.nameSeq += 1;
    return 'div' + state.nameSeq;
  }

  function maxDivIndex(areas) {
    return areas.reduce(function (max, area) {
      const match = /^div(\d+)$/.exec(area.name);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  }

  /* ---------- 提示 ---------- */

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      dom.toast.classList.remove('is-visible');
    }, 2400);
  }

  function flashArea(id) {
    const el = childElement(id);
    if (!el) return;
    el.classList.add('is-conflict');
    window.setTimeout(function () {
      el.classList.remove('is-conflict');
    }, 520);
  }

  /* ---------- 撤销栈 ---------- */

  function snapshot() {
    return {
      columns: state.columns,
      rows: state.rows,
      columnGap: state.columnGap,
      rowGap: state.rowGap,
      colTracks: state.colTracks.map(function (t) { return { unit: t.unit }; }),
      rowTracks: state.rowTracks.map(function (t) { return { unit: t.unit }; }),
      areas: state.areas.map(function (a) { return Object.assign({}, a); }),
      nameSeq: state.nameSeq
    };
  }

  function restoreSnapshot(snap) {
    state.columns = snap.columns;
    state.rows = snap.rows;
    state.columnGap = snap.columnGap;
    state.rowGap = snap.rowGap;
    state.colTracks = snap.colTracks.map(function (t) { return { unit: t.unit }; });
    state.rowTracks = snap.rowTracks.map(function (t) { return { unit: t.unit }; });
    state.areas = snap.areas.map(function (a) { return Object.assign({}, a); });
    state.nameSeq = snap.nameSeq;
    selectedId = null;
    syncInputs();
    render();
  }

  function pushHistory() {
    history.past.push(snapshot());
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future.length = 0;
  }

  function undo() {
    if (!history.past.length) {
      toast('没有可以撤销的操作了');
      return;
    }
    history.future.push(snapshot());
    restoreSnapshot(history.past.pop());
    saveState();
    toast('已撤销');
  }

  function redo() {
    if (!history.future.length) {
      toast('没有可以重做的操作了');
      return;
    }
    history.past.push(snapshot());
    restoreSnapshot(history.future.pop());
    saveState();
    toast('已重做');
  }

  /* ---------- 持久化 ---------- */

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        columns: state.columns,
        rows: state.rows,
        columnGap: state.columnGap,
        rowGap: state.rowGap,
        colTracks: state.colTracks,
        rowTracks: state.rowTracks,
        areas: state.areas,
        nameSeq: state.nameSeq,
        codeMode: state.codeMode
      }));
    } catch (error) {
      // 隐私模式下写入会抛异常，忽略即可
    }
  }

  function normalizeTracks(list, count) {
    const tracks = [];
    for (let i = 0; i < count; i += 1) {
      const item = list && list[i];
      const unit = item && typeof item.unit === 'string' ? item.unit.trim() : '';
      tracks.push({ unit: unit || Model.DEFAULT_UNIT });
    }
    return tracks;
  }

  function normalizeAreas(list, columns, rows) {
    const source = Array.isArray(list) ? list : [];
    const result = [];

    source.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      const row = toInt(item.row, 0);
      const col = toInt(item.col, 0);
      const rowSpan = toInt(item.rowSpan, 0);
      const colSpan = toInt(item.colSpan, 0);
      if (row < 1 || col < 1 || rowSpan < 1 || colSpan < 1) return;
      if (row + rowSpan - 1 > rows || col + colSpan - 1 > columns) return;
      const rect = { row: row, col: col, rowSpan: rowSpan, colSpan: colSpan };
      if (Model.findOverlap(rect, result, null)) return;
      result.push({
        id: toInt(item.id, 0),
        name: Model.sanitizeName(item.name, 'div' + (result.length + 1)),
        row: row,
        col: col,
        rowSpan: rowSpan,
        colSpan: colSpan
      });
    });

    // 修正重复或缺失的 id
    const usedIds = {};
    result.forEach(function (area) {
      if (area.id > 0 && !usedIds[area.id]) {
        usedIds[area.id] = true;
      } else {
        area.id = 0;
      }
    });
    let seq = result.reduce(function (max, area) { return Math.max(max, area.id); }, 0);
    result.forEach(function (area) {
      if (!area.id) {
        seq += 1;
        area.id = seq;
      }
    });

    // 修正重名，否则 grid-template-areas 会拼出非矩形
    const usedNames = {};
    result.forEach(function (area) {
      let name = area.name;
      if (usedNames[name]) {
        let n = 2;
        while (usedNames[name + '-' + n]) n += 1;
        name = name + '-' + n;
      }
      usedNames[name] = true;
      area.name = name;
    });

    return result;
  }

  function loadState() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return false;
    }
    if (!raw) return false;

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return false;
    }
    if (!data || data.v !== 1) return false;

    const columns = clampInt(data.columns, 1, Model.MAX_TRACKS, 5);
    const rows = clampInt(data.rows, 1, Model.MAX_TRACKS, 5);

    state.columns = columns;
    state.rows = rows;
    state.columnGap = clampInt(data.columnGap, 0, Model.MAX_GAP, 0);
    state.rowGap = clampInt(data.rowGap, 0, Model.MAX_GAP, 0);
    state.colTracks = normalizeTracks(data.colTracks, columns);
    state.rowTracks = normalizeTracks(data.rowTracks, rows);
    state.codeMode = data.codeMode === 'numbers' ? 'numbers' : 'named';
    state.areas = normalizeAreas(data.areas, columns, rows);
    state.nameSeq = Math.max(clampInt(data.nameSeq, 0, 9999, 0), maxDivIndex(state.areas));
    idSeq = state.areas.reduce(function (max, area) { return Math.max(max, area.id); }, 0);
    return true;
  }

  /* ---------- 渲染 ---------- */

  // 横向滚动条出现时会占掉网格区高度，左侧行输入条要让出同样多，否则越往下错得越多
  function syncRowUnitsPadding() {
    const barH = dom.stageScroll.offsetHeight - dom.stageScroll.clientHeight;
    dom.rowUnits.style.paddingBottom = barH + 'px';
  }

  function render() {
    // 预览层和输入条都用 minmax(0, 1fr)：1fr 的隐含最小值是内容尺寸，
    // 区域标签、输入框这类自带最小宽高的内容会把轨道撑开，三层各自撑开多少还不一样，于是错位
    const colTemplate = Model.templateFromTracks(state.colTracks, true) || 'none';
    const rowTemplate = Model.templateFromTracks(state.rowTracks, true) || 'none';
    const columnGap = state.columnGap + 'px';
    const rowGap = state.rowGap + 'px';

    // 行数多又间距大时固定高度装不下，把预览区撑高，别把行挤成一条线
    const needed = UNIT_BAR_PX + state.rows * MIN_ROW_PX +
      Math.max(0, state.rows - 1) * state.rowGap;
    dom.stage.style.minHeight = (state.rows > 1 ? needed : 0) + 'px';

    // 列同理：宽度不够时把网格区撑宽，让它横向滚动，而不是把列压成一条线
    const neededWidth = state.columns * MIN_COL_PX +
      Math.max(0, state.columns - 1) * state.columnGap;
    dom.stageGrid.style.setProperty('--stage-min-w', neededWidth + 'px');

    // 顶部只排一列一个输入框，左侧只排一行一个输入框，其余层两者都要
    dom.colUnits.style.gridTemplateColumns = colTemplate;
    dom.colUnits.style.columnGap = columnGap;
    dom.rowUnits.style.gridTemplateRows = rowTemplate;
    dom.rowUnits.style.rowGap = rowGap;

    [dom.boxLayer, dom.childLayer, dom.ghostLayer].forEach(function (layer) {
      layer.style.gridTemplateColumns = colTemplate;
      layer.style.gridTemplateRows = rowTemplate;
      layer.style.columnGap = columnGap;
      layer.style.rowGap = rowGap;
    });

    syncUnitCells(dom.colUnits, state.colTracks, 'col');
    syncUnitCells(dom.rowUnits, state.rowTracks, 'row');
    syncRowUnitsPadding();
    renderBoxes();
    renderAreas();
    clearGhost();
  }

  function syncInputs() {
    dom.columnsInput.value = String(state.columns);
    dom.rowsInput.value = String(state.rows);
    dom.columnsValue.textContent = String(state.columns);
    dom.rowsValue.textContent = String(state.rows);
    dom.columnGapInput.value = String(state.columnGap);
    dom.rowGapInput.value = String(state.rowGap);
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
      input.setAttribute('aria-label', '第 ' + (index + 1) +
        (kind === 'col' ? ' 列轨道宽度' : ' 行轨道高度'));
      if (document.activeElement !== input && input.value !== track.unit) {
        input.value = track.unit;
      }
      const valid = Model.isValidTrackUnit(track.unit);
      input.classList.toggle('has-error', !valid);
      cell.querySelector('.unit-error').hidden = valid;
    });
  }

  function renderBoxes() {
    const total = state.columns * state.rows;
    if (dom.boxLayer.children.length === total) return;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= total; i += 1) {
      const box = document.createElement('div');
      box.className = 'box';
      box.dataset.cell = String(i);
      frag.appendChild(box);
    }
    dom.boxLayer.replaceChildren(frag);
  }

  function createChild(area, index) {
    const child = document.createElement('div');
    child.className = 'child';
    child.dataset.id = String(area.id);
    child.tabIndex = 0;
    child.style.gridArea = Model.gridAreaOf(area);
    child.style.setProperty('--hue', (HUE_START + index * HUE_STEP) % 360 + 'deg');
    child.setAttribute('role', 'group');
    child.setAttribute('aria-label', '区域 ' + area.name + '，第 ' + area.row + ' 行第 ' + area.col +
      ' 列开始，横跨 ' + area.colSpan + ' 列 ' + area.rowSpan + ' 行');
    if (area.id === selectedId) child.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'child-label';
    label.textContent = area.name;
    label.title = '双击可重命名';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'child-remove';
    remove.textContent = '×';
    remove.title = '删除这块区域';
    remove.setAttribute('aria-label', '删除区域 ' + area.name);
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteArea(area.id);
    });

    child.appendChild(label);
    ['nw', 'ne', 'sw', 'se'].forEach(function (corner) {
      const handle = document.createElement('span');
      handle.className = 'child-handle child-handle-' + corner;
      handle.dataset.corner = corner;
      child.appendChild(handle);
    });
    child.appendChild(remove);

    child.addEventListener('focus', function () {
      selectArea(area.id);
    });

    return child;
  }

  function renderAreas() {
    if (selectedId !== null && !getArea(selectedId)) selectedId = null;
    const frag = document.createDocumentFragment();
    state.areas.forEach(function (area, index) {
      frag.appendChild(createChild(area, index));
    });
    dom.childLayer.replaceChildren(frag);
  }

  function selectArea(id) {
    if (selectedId === id) return;
    selectedId = id;
    Array.prototype.forEach.call(dom.childLayer.children, function (child) {
      child.classList.toggle('is-selected', Number(child.dataset.id) === id);
    });
  }

  /* ---------- 拖拽划区与移动缩放 ---------- */

  function cellRowCol(box) {
    const index = Number(box.dataset.cell);
    const row = Math.ceil(index / state.columns);
    return { row: row, col: index - (row - 1) * state.columns };
  }

  // 区域和缩放手柄会盖在格子上，所以要遍历整条命中链找底下的 .box
  function cellAtPoint(x, y) {
    if (state.columns < 1 || state.rows < 1) return null;
    const stack = document.elementsFromPoint(x, y);
    for (let i = 0; i < stack.length; i += 1) {
      const box = stack[i].closest ? stack[i].closest('.box') : null;
      if (box && box.parentElement === dom.boxLayer) return cellRowCol(box);
    }
    return null;
  }

  function showGhost(rect) {
    dom.ghostBlock.style.gridArea = Model.gridAreaOf(rect);
    dom.ghostLayer.hidden = false;
  }

  function clearGhost() {
    dom.ghostLayer.hidden = true;
  }

  function moveRect(act, cell) {
    return Model.clampRect({
      row: act.origin.row + (cell.row - act.anchor.row),
      col: act.origin.col + (cell.col - act.anchor.col),
      rowSpan: act.origin.rowSpan,
      colSpan: act.origin.colSpan
    }, state.columns, state.rows);
  }

  function resizeRect(act, cell) {
    const origin = act.origin;
    const bottom = origin.row + origin.rowSpan - 1;
    const right = origin.col + origin.colSpan - 1;
    const row = Math.max(1, Math.min(cell.row, state.rows));
    const col = Math.max(1, Math.min(cell.col, state.columns));

    let top = origin.row;
    let left = origin.col;
    let bottomEdge = bottom;
    let rightEdge = right;

    if (act.corner === 'nw' || act.corner === 'sw') {
      left = Math.min(col, right);
    } else {
      rightEdge = Math.max(col, left);
    }
    if (act.corner === 'nw' || act.corner === 'ne') {
      top = Math.min(row, bottom);
    } else {
      bottomEdge = Math.max(row, top);
    }

    return {
      row: top,
      col: left,
      rowSpan: bottomEdge - top + 1,
      colSpan: rightEdge - left + 1
    };
  }

  function beginMove(area, event, child) {
    const anchor = cellAtPoint(event.clientX, event.clientY);
    if (!anchor) return;
    action = {
      type: 'move',
      id: area.id,
      el: child,
      anchor: anchor,
      origin: { row: area.row, col: area.col, rowSpan: area.rowSpan, colSpan: area.colSpan },
      current: { row: area.row, col: area.col, rowSpan: area.rowSpan, colSpan: area.colSpan }
    };
    child.classList.add('is-dragging');
  }

  function beginResize(area, corner, child) {
    action = {
      type: 'resize',
      id: area.id,
      el: child,
      corner: corner,
      origin: { row: area.row, col: area.col, rowSpan: area.rowSpan, colSpan: area.colSpan },
      current: { row: area.row, col: area.col, rowSpan: area.rowSpan, colSpan: area.colSpan }
    };
    child.classList.add('is-dragging');
  }

  function cancelAction() {
    if (!action) return;
    const act = action;
    action = null;
    clearGhost();
    if (act.el) act.el.classList.remove('is-dragging');
    renderAreas();
  }

  function commitDraw(act) {
    const rect = Model.rectFromCells(act.start, act.current);
    const conflict = Model.findOverlap(rect, state.areas, null);
    if (conflict) {
      flashArea(conflict.id);
      toast('这块位置已经被占用了，换个地方划吧');
      return;
    }
    pushHistory();
    const area = Object.assign({ id: nextId(), name: nextName() }, rect);
    state.areas.push(area);
    selectedId = area.id;
    renderAreas();
    saveState();
  }

  function commitLive(act) {
    const area = getArea(act.id);
    if (!area) return;
    const rect = act.current;
    const origin = act.origin;
    const unchanged = rect.row === origin.row && rect.col === origin.col &&
      rect.rowSpan === origin.rowSpan && rect.colSpan === origin.colSpan;
    if (unchanged) {
      renderAreas();
      return;
    }
    pushHistory();
    area.row = rect.row;
    area.col = rect.col;
    area.rowSpan = rect.rowSpan;
    area.colSpan = rect.colSpan;
    renderAreas();
    saveState();
  }

  /* ---------- 删除 / 重命名 ---------- */

  function deleteArea(id) {
    const index = state.areas.findIndex(function (area) { return area.id === id; });
    if (index === -1) return;
    pushHistory();
    state.areas.splice(index, 1);
    if (selectedId === id) selectedId = null;
    renderAreas();
    saveState();
  }

  function startRename(area, labelEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'child-name-input';
    input.name = 'areaNameEdit';
    input.value = area.name;
    input.maxLength = 24;
    input.setAttribute('aria-label', '区域名称');
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    function finish(save) {
      if (done) return;
      done = true;
      let message = '';
      if (save) {
        const raw = input.value.trim();
        if (!raw) {
          message = '区域名称不能为空';
        } else {
          const next = Model.sanitizeName(raw, area.name);
          const duplicated = state.areas.some(function (item) {
            return item.id !== area.id && item.name === next;
          });
          if (duplicated) {
            message = '名称「' + next + '」已经被其它区域占用了';
          } else if (next !== area.name) {
            pushHistory();
            area.name = next;
            saveState();
            if (next !== raw) message = '名称已改成「' + next + '」';
          }
        }
      }
      renderAreas();
      if (message) toast(message);
    }

    input.addEventListener('keydown', function (event) {
      // 输入法拼字过程中回车是选候选词，不能当成提交
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  /* ---------- 行列与间距 ---------- */

  // 行列数量变化：只改状态与视图，撤销历史由调用方记录
  function changeCount(kind, raw) {
    const count = clampInt(raw, 1, Model.MAX_TRACKS, 1);
    const current = kind === 'col' ? state.columns : state.rows;
    if (count === current) return;

    if (kind === 'col') {
      state.columns = count;
      Model.resizeTracks(state.colTracks, count);
    } else {
      state.rows = count;
      Model.resizeTracks(state.rowTracks, count);
    }

    const trimmed = Model.clampAreas(state.areas, state.columns, state.rows);
    const shrunk = trimmed.removed === 0 && trimmed.areas.some(function (area, index) {
      const old = state.areas[index];
      return !old || old.rowSpan !== area.rowSpan || old.colSpan !== area.colSpan;
    });
    state.areas = trimmed.areas;

    render();
    saveState();

    if (trimmed.removed > 0) {
      toast('有 ' + trimmed.removed + ' 块区域超出新范围，已移除');
    } else if (shrunk) {
      toast('部分区域已被裁到新的边界内');
    }
  }

  function changeGap(kind, raw) {
    const value = clampInt(raw, 0, Model.MAX_GAP, 0);
    if (kind === 'col') {
      if (value === state.columnGap) return;
      state.columnGap = value;
    } else {
      if (value === state.rowGap) return;
      state.rowGap = value;
    }
    render();
    saveState();
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

  const CODE_TABS = [
    { key: 'css', label: 'CSS' },
    { key: 'html', label: 'HTML' },
    { key: 'page', label: '完整页面' }
  ];

  const CODE_MODES = [
    { value: 'named', label: '命名区域' },
    { value: 'numbers', label: '行列编号' }
  ];

  function openModal(renderBody) {
    lastFocus = document.activeElement;
    renderBody();
    dom.modalMask.hidden = false;
    dom.modalClose.focus();
  }

  function closeModal() {
    if (dom.modalMask.hidden) return;
    dom.modalMask.hidden = true;
    dom.modalBody.replaceChildren();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function codePayload() {
    const config = {
      columns: state.columns,
      rows: state.rows,
      colTracks: state.colTracks,
      rowTracks: state.rowTracks,
      columnGap: state.columnGap,
      rowGap: state.rowGap,
      areas: state.areas,
      codeMode: state.codeMode
    };
    if (codeTab === 'html') {
      const text = Model.buildHtmlText(config);
      return { text: text, html: Model.highlightHtml(text) };
    }
    if (codeTab === 'page') {
      const text = Model.buildFullPageText(config);
      return { text: text, html: Model.highlightFullPage(text) };
    }
    const text = Model.buildCssText(config);
    return { text: text, html: Model.highlightCss(text) };
  }

  // 代码右侧的类名清单：改名后代码块和画布标签同步刷新
  function buildNamePanel(block) {
    const panel = document.createElement('div');
    panel.className = 'name-panel';

    const title = document.createElement('p');
    title.className = 'name-panel-title';
    title.textContent = '类名';

    const list = document.createElement('ul');
    list.className = 'name-list';

    state.areas.forEach(function (area, index) {
      const item = document.createElement('li');
      item.className = 'name-item';

      // 色块和画布上的区域同色，方便对上是哪一块
      const swatch = document.createElement('span');
      swatch.className = 'name-swatch';
      swatch.style.setProperty('--hue', (HUE_START + index * HUE_STEP) % 360 + 'deg');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'name-input';
      input.value = area.name;
      input.maxLength = 24;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.name = 'areaName' + index;
      input.setAttribute('aria-label', '第 ' + (index + 1) + ' 块区域的类名');

      // 同一个输入框里连续敲字只记一条撤销
      let recorded = false;

      input.addEventListener('input', function () {
        const next = Model.sanitizeName(input.value, '');
        const usable = Boolean(next) && !state.areas.some(function (other) {
          return other.id !== area.id && other.name === next;
        });
        input.classList.toggle('has-error', !usable);
        if (!usable || next === area.name) return;
        if (!recorded) {
          pushHistory();
          recorded = true;
        }
        area.name = next;
        saveState();
        renderAreas();
        block.innerHTML = codePayload().html;
      });

      // 失焦时把自动修正过的名字回填，保证输入框和实际类名一致
      input.addEventListener('blur', function () {
        input.value = area.name;
        input.classList.remove('has-error');
        recorded = false;
      });

      item.replaceChildren(swatch, input);
      list.appendChild(item);
    });

    panel.replaceChildren(title, list);
    return panel;
  }

  function renderCodeModal() {
    dom.modalTitle.textContent = '生成的代码';

    const block = document.createElement('pre');
    block.className = 'code-block';
    block.innerHTML = codePayload().html;

    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';

    const tabs = document.createElement('div');
    tabs.className = 'code-tabs';
    tabs.setAttribute('role', 'tablist');
    CODE_TABS.forEach(function (tab) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.key === codeTab));
      button.textContent = tab.label;
      button.addEventListener('click', function () {
        codeTab = tab.key;
        renderCodeModal();
      });
      tabs.appendChild(button);
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-small';
    copy.textContent = '复制';
    copy.addEventListener('click', function () {
      copyText(codePayload().text).then(function (ok) {
        copy.textContent = ok ? '已复制' : '复制失败';
        toast(ok ? '代码已复制到剪贴板' : '复制失败，请手动选中复制');
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(function () {
          copy.textContent = '复制';
        }, 2000);
      });
    });

    const tools = document.createElement('div');
    tools.className = 'code-tools';
    tools.appendChild(copy);

    // HTML 结构不受写法影响，只在有 CSS 的标签页里给选择器
    if (codeTab !== 'html') {
      const mode = document.createElement('select');
      mode.className = 'code-mode';
      mode.name = 'codeMode';
      mode.setAttribute('aria-label', '代码写法');
      CODE_MODES.forEach(function (item) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        mode.appendChild(option);
      });
      mode.value = state.codeMode;
      mode.addEventListener('change', function () {
        state.codeMode = mode.value === 'numbers' ? 'numbers' : 'named';
        saveState();
        block.innerHTML = codePayload().html;
      });
      tools.insertBefore(mode, copy);
    }

    toolbar.replaceChildren(tabs, tools);
    if (!state.areas.length) {
      dom.modalBody.replaceChildren(toolbar, block);
      return;
    }
    const layout = document.createElement('div');
    layout.className = 'code-layout';
    layout.replaceChildren(block, buildNamePanel(block));
    dom.modalBody.replaceChildren(toolbar, layout);
  }

  function renderExplainModal() {
    dom.modalTitle.textContent = '这是什么？';

    const wrap = document.createElement('div');
    wrap.innerHTML = [
      '<p>您可以设置行与列的数量和每一格的轨道单位，我会据此生成一份 CSS Grid 布局。' +
      '在网格里<strong>按住并拖动</strong>，就能划出一块区域，它会被写成一个 div。</p>',
      '<p>划出的区域可以<strong>拖动移动</strong>、拖四角<strong>缩放</strong>，双击名称还能改名。' +
      '区域之间不允许重叠，改一个不会串到另一个上面。</p>',
      '<p>代码有两种写法：命名区域会生成 <code>grid-template-areas</code> 与 <code>grid-area: 名称</code>，' +
      '可读性好；行列编号写法则直接输出 <code>grid-area: 行 / 列 / 结束行 / 结束列</code>。' +
      '在代码弹窗里可以随时切换。</p>',
      '<p>这个小工具只能帮您搭出一个基础布局，并不是 CSS Grid 的完整教程，它只是一个快速上手 Grid 的捷径。</p>',
      '<p>上手之后，推荐继续阅读 <a href="https://css-tricks.com/snippets/css/complete-guide-grid/" target="_blank" rel="noopener">' +
      'CSS-Tricks 的 CSS Grid 完整指南</a>，也可以去玩一玩小游戏 ' +
      '<a href="https://cssgridgarden.com/" target="_blank" rel="noopener">Grid Garden</a> 来加深理解。</p>',
      '<p>注意：读屏器会按照 div 添加的顺序朗读，构建布局时请留意这一点。</p>',
      '<p class="credit">本项目参考 Sarah Drasner 的 CSS Grid Generator 实现，界面与文案已改为中文版。</p>'
    ].join('');
    dom.modalBody.replaceChildren(wrap);
  }

  function trapFocus(event) {
    if (dom.modalMask.hidden) return;
    const focusables = dom.modalMask.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------- 事件绑定 ---------- */

  function bindUnitEvents(container, tracks) {
    // 输入过程中只做校验标记，不重建视图，避免输入框跳动
    container.addEventListener('input', function (event) {
      const input = event.target.closest('.unit-input');
      if (!input) return;
      const valid = Model.isValidTrackUnit(input.value);
      input.classList.toggle('has-error', !valid);
      const cell = input.closest('.unit-cell');
      cell.querySelector('.unit-error').hidden = valid;
    });

    container.addEventListener('change', function (event) {
      const input = event.target.closest('.unit-input');
      if (!input) return;
      const track = tracks[Number(input.dataset.index)];
      if (!track) return;
      const unit = input.value.trim();
      if (unit === track.unit) return;
      track.unit = unit;
      saveState();
      render();
    });
  }

  /* 行列滑杆：拖动中实时重建网格，松手后只记一条撤销历史 */
  function bindCountSlider(input, output, kind) {
    let before = null;

    input.addEventListener('input', function () {
      const count = clampInt(input.value, 1, Model.MAX_TRACKS, 1);
      const current = kind === 'col' ? state.columns : state.rows;
      output.textContent = String(count);
      if (count === current) return;
      if (!before) before = snapshot();
      changeCount(kind, count);
    });

    input.addEventListener('change', function () {
      if (!before) return;
      const origin = kind === 'col' ? before.columns : before.rows;
      const count = kind === 'col' ? state.columns : state.rows;
      // 拖回原值且没裁掉区域时，不必留下一条空的历史
      if (count === origin && before.areas.length === state.areas.length) {
        before = null;
        return;
      }
      history.past.push(before);
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
      history.future.length = 0;
      before = null;
    });
  }

  function bindEvents() {
    bindUnitEvents(dom.colUnits, state.colTracks);
    bindUnitEvents(dom.rowUnits, state.rowTracks);

    bindCountSlider(dom.columnsInput, dom.columnsValue, 'col');
    bindCountSlider(dom.rowsInput, dom.rowsValue, 'row');

    dom.columnGapInput.addEventListener('input', function () {
      changeGap('col', dom.columnGapInput.value);
    });
    dom.columnGapInput.addEventListener('change', function () {
      dom.columnGapInput.value = String(state.columnGap);
    });

    dom.rowGapInput.addEventListener('input', function () {
      changeGap('row', dom.rowGapInput.value);
    });
    dom.rowGapInput.addEventListener('change', function () {
      dom.rowGapInput.value = String(state.rowGap);
    });

    // 空格子：开始划新区域
    dom.boxLayer.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      const box = event.target.closest('.box');
      if (!box) return;
      event.preventDefault();
      selectArea(null);
      const cell = cellRowCol(box);
      action = { type: 'draw', start: cell, current: cell };
      showGhost(Model.rectFromCells(cell, cell));
    });

    // 已有区域：选中、移动、拖角缩放
    dom.childLayer.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      const child = event.target.closest('.child');
      if (!child) return;
      const area = getArea(Number(child.dataset.id));
      if (!area) return;

      selectArea(area.id);

      if (event.target.closest('.child-label')) return;
      if (event.target.closest('.child-remove')) return;
      if (event.target.closest('.child-name-input')) return;

      event.preventDefault();
      const handle = event.target.closest('.child-handle');
      if (handle) {
        beginResize(area, handle.dataset.corner, child);
      } else {
        beginMove(area, event, child);
      }
    });

    window.addEventListener('pointermove', function (event) {
      if (!action) return;

      if (action.type === 'draw') {
        const cell = cellAtPoint(event.clientX, event.clientY);
        if (!cell) return;
        action.current = cell;
        showGhost(Model.rectFromCells(action.start, cell));
        return;
      }

      const cell = cellAtPoint(event.clientX, event.clientY);
      if (!cell) return;
      const next = action.type === 'move' ? moveRect(action, cell) : resizeRect(action, cell);
      if (Model.findOverlap(next, state.areas, action.id)) return;
      action.current = next;
      action.el.style.gridArea = Model.gridAreaOf(next);
    });

    window.addEventListener('pointerup', function () {
      if (!action) return;
      const act = action;
      action = null;
      clearGhost();
      if (act.el) act.el.classList.remove('is-dragging');
      if (act.type === 'draw') {
        commitDraw(act);
      } else {
        commitLive(act);
      }
    });

    window.addEventListener('pointercancel', cancelAction);

    dom.childLayer.addEventListener('dblclick', function (event) {
      const label = event.target.closest('.child-label');
      if (!label) return;
      const child = label.closest('.child');
      const area = getArea(Number(child.dataset.id));
      if (area) startRename(area, label);
    });

    dom.showCode.addEventListener('click', function () {
      codeTab = 'css';
      openModal(renderCodeModal);
    });

    dom.showExplain.addEventListener('click', function () {
      openModal(renderExplainModal);
    });

    dom.resetGrid.addEventListener('click', function () {
      if (!state.areas.length) {
        toast('当前还没有任何区域');
        return;
      }
      pushHistory();
      state.areas = [];
      selectedId = null;
      renderAreas();
      saveState();
      toast('已清空所有区域，可用 Ctrl + Z 撤销');
    });

    dom.restoreDefault.addEventListener('click', function () {
      pushHistory();
      state.columns = 5;
      state.rows = 5;
      state.columnGap = 0;
      state.rowGap = 0;
      state.colTracks = Model.createTracks(5);
      state.rowTracks = Model.createTracks(5);
      state.areas = [];
      state.nameSeq = 0;
      selectedId = null;
      idSeq = 0;
      syncInputs();
      render();
      saveState();
      toast('已恢复默认设置');
    });

    dom.modalClose.addEventListener('click', closeModal);

    dom.modalMask.addEventListener('mousedown', function (event) {
      if (event.target === dom.modalMask) closeModal();
    });

    // 点到区域以外的地方就取消选中，否则删除按钮一直挂在那挡视线
    document.addEventListener('pointerdown', function (event) {
      if (selectedId === null) return;
      if (event.target.closest && event.target.closest('.child')) return;
      const active = document.activeElement;
      if (active && active.closest && active.closest('.child')) active.blur();
      selectArea(null);
    });

    document.addEventListener('keydown', handleKeydown);
  }

  /* ---------- 键盘 ---------- */

  const ARROW_DELTA = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1]
  };

  function handleKeydown(event) {
    const key = String(event.key || '');

    if (key === 'Tab') {
      trapFocus(event);
      return;
    }

    if (key === 'Escape') {
      if (!dom.modalMask.hidden) {
        closeModal();
      } else if (action) {
        cancelAction();
      } else if (selectedId !== null) {
        selectArea(null);
      }
      return;
    }

    if (!dom.modalMask.hidden) return;

    const target = event.target;
    const tag = target && target.tagName;
    const isField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    const lower = key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && (lower === 'z' || lower === 'y')) {
      event.preventDefault();
      if (lower === 'y' || event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    if (isField || selectedId === null) return;

    const area = getArea(selectedId);
    if (!area) return;

    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      deleteArea(area.id);
      return;
    }

    const delta = ARROW_DELTA[key];
    if (!delta) return;
    event.preventDefault();

    const rect = event.shiftKey
      ? Model.clampRect({
        row: area.row,
        col: area.col,
        rowSpan: area.rowSpan + delta[0],
        colSpan: area.colSpan + delta[1]
      }, state.columns, state.rows)
      : Model.clampRect({
        row: area.row + delta[0],
        col: area.col + delta[1],
        rowSpan: area.rowSpan,
        colSpan: area.colSpan
      }, state.columns, state.rows);

    const unchanged = rect.row === area.row && rect.col === area.col &&
      rect.rowSpan === area.rowSpan && rect.colSpan === area.colSpan;
    if (unchanged || Model.findOverlap(rect, state.areas, area.id)) return;

    pushHistory();
    area.row = rect.row;
    area.col = rect.col;
    area.rowSpan = rect.rowSpan;
    area.colSpan = rect.colSpan;
    renderAreas();
    saveState();
  }

  /* ---------- 启动 ---------- */

  function init() {
    const restored = loadState();
    if (!restored) {
      state.colTracks = Model.createTracks(state.columns);
      state.rowTracks = Model.createTracks(state.rows);
    }
    syncInputs();
    bindEvents();
    render();
    // 窗口缩放、字体变化都会让滚动条出现或消失，滚动条高度得跟着重算
    if (window.ResizeObserver) {
      stageObserver = new ResizeObserver(syncRowUnitsPadding);
      stageObserver.observe(dom.stageScroll);
    }
    if (restored && state.areas.length) {
      toast('已恢复上次的布局');
    }
  }

  init();
})();
