'use strict';

/* =====================================================================
   ASCII 表格解析：把 +---+ 边框的纯文本表格（MySQL / freva ascii-table /
   psql 等）拆成二维数组，再输出 Markdown / CSV / TSV / JSON / HTML。
   ===================================================================== */

/* ---------- 示例：两张表格 + 前后说明文字 ---------- */
const SAMPLE = [
  '商品code为:28020297,商品名称为:爱酒君比利时风味小麦啤酒[1L],商品规格为:1*6,货位code为:01050111的库存信息不存在',
  '库存信息：',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+--------------+-----------+-----------------+--------+-------------+----------+-------------+-------------------+-------------------+',
  '|binId              |ownerId            |productId|vendorId|QpcStr|ProductionBatch|ProductionDate     |objectId           |objectType|stockType     |containerId|secondContainerId|totalQty| availableQty| frozenQty| intransitQty| intransitFrozenQty| similarStandardQty|',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+--------------+-----------+-----------------+--------+-------------+----------+-------------+-------------------+-------------------+',
  '|1389733219487494202|1389733185127758631|88917295 |4432    |1*6   |20261026       |2026-10-26 00:00:00|1389730419168811115|DC        |STOCK_TYPE:RTN|null       |null             |180.000 |180.000      |0.000     |0.000        |0.000              |0.000              |',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+--------------+-----------+-----------------+--------+-------------+----------+-------------+-------------------+-------------------+',
  '',
  '来源货位占货信息：',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+-----------------+-----------+-----------------+-------+',
  '|binId              |ownerId            |productId|vendorId|QpcStr|ProductionBatch|ProductionDate     |objectId           |objectType|stockType        |containerId|secondContainerId|qty    |',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+-----------------+-----------+-----------------+-------+',
  '|1389733219487494202|1389733185127758631|88917295 |4432    |1*6   |20261026       |2026-10-26 00:00:00|1389730419168811115|DC        |STOCK_TYPE:NORMAL|null       |null             |180.000|',
  '+-------------------+-------------------+---------+--------+------+---------------+-------------------+-------------------+----------+-----------------+-----------+-----------------+-------+'
].join('\n');

/* =====================================================================
   状态与元素
   ===================================================================== */
const state = {
  tables: [], notes: [], segments: [], active: 0,
  format: 'md', pane: 'preview', mode: 'flow',
  joinMode: 'stack',          // stack=纵向追加 / key=按键关联
  keyCols: [],                // 按键关联的键列（规范化列名）
  rev: 0                      // 解析版本号，供拼接结果缓存失效
};

const $ = id => document.getElementById(id);
const el = {
  src: $('srcText'), srcLn: $('srcLn'), srcStat: $('srcStat'), statText: $('statText'),
  outTabs: $('outTabs'), outFormat: $('outFormat'),
  previewPane: $('previewPane'), previewWrap: $('previewWrap'),
  codePane: $('codePane'), codePre: $('codePre'),
  tablesBar: $('tablesBar'), notesBox: $('notesBox'), notesSum: $('notesSum'), notesText: $('notesText'),
  optHeader: $('optHeader'), optEscape: $('optEscape'), optNull: $('optNull'), optBlank: $('optBlank'),
  joinOpts: $('joinOpts'), baseSel: $('baseSel'), optSource: $('optSource'), optDedup: $('optDedup'),
  joinModeSeg: $('joinModeSeg'), keyWrap: $('keyWrap'), keyBox: $('keyBox'),
  optExpand: $('optExpand'), optAlias: $('optAlias'), optSourceWrap: $('optSourceWrap'),
  outStat: $('outStat'), sizeStat: $('sizeStat'), toast: $('toast')
};

/* =====================================================================
   工具函数（与主工具同款，保证终端对齐算法一致）
   ===================================================================== */
const escHtml = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const isWide = ch => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch);
const vw = s => { let w = 0; for (const ch of String(s)) w += isWide(ch) ? 2 : 1; return w; };
const padEnd = (s, n) => { const d = n - vw(s); return d > 0 ? s + ' '.repeat(d) : s; };

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), 1600);
}

/* =====================================================================
   解析：文本 → 表格数组
   ===================================================================== */
const BORDER_RE = /^\s*\+(?:[-=]+\+)+\s*$/;   // +------+------+
const ROW_RE = /^\s*\|.*\|\s*$/;              // |a|b|

/* 朴素切分：按竖线切，适用于单元格内不含竖线的绝大多数日志表格 */
function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(t => t.trim());
}

/* 边框行里每个 + 的位置，就是各列的显示列号 */
function borderBounds(line) {
  const pos = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '+') pos.push(i);
  return pos;
}

/* 兜底切分：按显示宽度取列（单元格内含 | 时用，中文按 2 宽计） */
function sliceByDisplay(line, bounds) {
  const chars = Array.from(line);
  const starts = [];
  let col = 0;
  for (const ch of chars) { starts.push(col); col += isWide(ch) ? 2 : 1; }
  const out = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    let s = '';
    for (let j = 0; j < chars.length; j++) if (starts[j] > a && starts[j] < b) s += chars[j];
    out.push(s.trim());
  }
  return out;
}

function buildTable(block) {
  const borders = block.filter(l => BORDER_RE.test(l));
  const rowLines = block.filter(l => ROW_RE.test(l));
  if (!rowLines.length) return null;

  const bounds = borders.length ? borderBounds(borders[0]) : null;
  let cols = bounds && bounds.length > 1 ? bounds.length - 1 : splitCells(rowLines[0]).length;
  if (!cols) return null;

  const rows = rowLines.map(line => {
    let cells = splitCells(line);
    if (cells.length !== cols && bounds && bounds.length - 1 === cols) {
      const alt = sliceByDisplay(line, bounds);
      if (alt.length === cols) cells = alt;
    }
    while (cells.length < cols) cells.push('');
    if (cells.length > cols) cells.length = cols;
    return cells;
  });

  return { cols, rows };
}

/* 一张表从边框行（或无顶线时的 | 行）开始，到不再是表格行为止 */
function isTableStart(lines, i) {
  if (BORDER_RE.test(lines[i])) return true;
  return ROW_RE.test(lines[i]) && i + 1 < lines.length && BORDER_RE.test(lines[i + 1]);
}

/* 解析整段文本：tables 用于单表视图，segments 保留「文字 / 表格」的原始顺序用于平铺视图 */
function parseText(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  const notes = [];
  const segments = [];
  let buf = [];

  const flush = () => {
    const s = buf.join('\n').replace(/^\n+|\n+$/g, '');
    buf = [];
    if (s.trim()) segments.push({ type: 'text', text: s });
  };

  let i = 0;
  while (i < lines.length) {
    if (isTableStart(lines, i)) {
      flush();
      const block = [];
      const from = i;
      while (i < lines.length && (BORDER_RE.test(lines[i]) || ROW_RE.test(lines[i]))) {
        block.push(lines[i]);
        i++;
      }
      const t = buildTable(block);
      if (t) {
        t.from = from + 1;
        t.to = i;
        t.index = tables.length;
        tables.push(t);
        segments.push({ type: 'table', table: t });
      }
      continue;
    }
    if (lines[i].trim()) notes.push(lines[i].trim());
    buf.push(lines[i]);
    i++;
  }
  flush();
  return { tables, notes, segments };
}

/* =====================================================================
   选项与预处理
   ===================================================================== */
function readOpts() {
  return {
    header: el.optHeader.checked,
    escape: el.optEscape.checked,
    nullAsEmpty: el.optNull.checked,
    blank: el.optBlank.value
  };
}

function prepare(t, opts) {
  const fix = v => {
    let s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
    if (opts.nullAsEmpty && s === 'null') s = '';
    return s === '' ? opts.blank : s;
  };
  const rows = t.rows.map(r => r.map(fix));
  return {
    cols: t.cols,
    head: opts.header ? rows[0] : null,
    body: opts.header ? rows.slice(1) : rows
  };
}

/* =====================================================================
   输出格式
   ===================================================================== */
function formatMarkdown(p, opts) {
  const esc = s => opts.escape ? s.replace(/\|/g, '\\|') : s;
  const head = p.head || Array.from({ length: p.cols }, (_, i) => '列' + (i + 1));
  const line = cells => '| ' + cells.map(esc).join(' | ') + ' |';
  const out = [line(head), '| ' + head.map(() => '---').join(' | ') + ' |'];
  p.body.forEach(r => out.push(line(r)));
  return out.join('\n');
}

function formatDelimited(p, sep) {
  const cell = s => (s.includes(sep) || s.includes('"') || /[\r\n]/.test(s))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
  const rows = (p.head ? [p.head] : []).concat(p.body);
  return rows.map(r => r.map(cell).join(sep)).join('\n');
}

function formatJSON(p) {
  if (!p.head) return JSON.stringify(p.body, null, 2);
  const used = Object.create(null);
  const keys = p.head.map((h, i) => {
    const base = h || 'col' + (i + 1);
    used[base] = (used[base] || 0) + 1;
    return used[base] === 1 ? base : base + '_' + used[base];
  });
  const list = p.body.map(r => {
    const o = {};
    keys.forEach((k, i) => { o[k] = r[i] == null ? '' : r[i]; });
    return o;
  });
  return JSON.stringify(list, null, 2);
}

function formatHTML(p) {
  const out = ['<table>'];
  if (p.head) {
    out.push('  <thead>');
    out.push('    <tr>' + p.head.map(h => '<th>' + escHtml(h) + '</th>').join('') + '</tr>');
    out.push('  </thead>');
  }
  out.push('  <tbody>');
  p.body.forEach(r => {
    out.push('    <tr>' + r.map(c => '<td>' + escHtml(c) + '</td>').join('') + '</tr>');
  });
  out.push('  </tbody>');
  out.push('</table>');
  return out.join('\n');
}

function formatAscii(p) {
  const rows = (p.head ? [p.head] : []).concat(p.body);
  const widths = Array.from({ length: p.cols }, (_, c) => {
    let w = 1;
    rows.forEach(r => { w = Math.max(w, vw(r[c] || '')); });
    return w;
  });
  const border = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const line = r => '|' + widths.map((w, i) => ' ' + padEnd(r[i] || '', w) + ' ').join('|') + '|';
  const out = [border];
  if (p.head) out.push(line(p.head), border);
  p.body.forEach(r => out.push(line(r)));
  out.push(border);
  return out.join('\n');
}

const EXT = { md: 'md', csv: 'csv', tsv: 'tsv', json: 'json', html: 'html', ascii: 'txt' };

/* =====================================================================
   多表拼接
   - 纵向追加 stack：以基准表字段为列，其余表按同名字段对齐后向下追加
   - 按键关联 key  ：以基准表行为准，按选定键列把其他表横向并进来
   字段别名（其他表=基准）用于列名不一致时对齐
   ===================================================================== */
const normKey = s => String(s == null ? '' : s).trim().toLowerCase();

/* 解析别名输入：qty=totalQty → 其他表的 qty 视为 totalQty */
function readAlias() {
  const map = Object.create(null);
  String(el.optAlias.value || '').split(/[\n,;]+/).forEach(line => {
    const parts = line.split('=');
    if (parts.length < 2) return;
    const from = normKey(parts[0]);
    const to = normKey(parts[1]);
    if (from && to && from !== to) map[from] = to;
  });
  return map;
}

/* 基准表的表头（无表头时用 列1/列2 占位） */
function baseHeader() {
  const base = state.tables[state.active];
  if (!base) return [];
  return readOpts().header && base.rows[0]
    ? base.rows[0].map((h, i) => String(h || '').trim() || '列' + (i + 1))
    : Array.from({ length: base.cols }, (_, i) => '列' + (i + 1));
}

/* 按键关联的键列：用户勾选的列，没勾时默认第 1 列 */
function keyIndexes(baseNorm) {
  const picked = baseNorm.map((k, i) => ({ k, i }))
    .filter(x => x.k && state.keyCols.indexOf(x.k) >= 0)
    .map(x => x.i);
  return picked.length ? picked : [0];
}

function joinNote(head, cls) {
  return '<div class="join-note">' + head + (cls ? ' · ' + cls : '') + '</div>';
}

/* ---------- 纵向追加 ---------- */
function mergeStack(opts) {
  const list = state.tables;
  const ai = state.active;
  const alias = readAlias();
  const base = list[ai];
  const heads = baseHeader();
  const baseKeys = heads.map(normKey);
  const dropped = [];
  const collected = [];

  list.forEach((t, ti) => {
    const isBase = ti === ai;
    const map = Object.create(null);
    if (opts.header) {
      (t.rows[0] || []).forEach((h, i) => {
        let k = normKey(h);
        if (!isBase && alias[k]) k = alias[k];
        if (!(k in map)) map[k] = i;
        if (!isBase && k && baseKeys.indexOf(k) < 0) dropped.push(String(h || '').trim() || '列' + (i + 1));
      });
    }
    const from = opts.header ? 1 : 0;
    for (let r = from; r < t.rows.length; r++) {
      const cells = opts.header
        ? baseKeys.map(k => (k in map ? t.rows[r][map[k]] || '' : ''))
        : Array.from({ length: base.cols }, (_, c) => t.rows[r][c] || '');
      collected.push({ cells, from: ti });
    }
  });

  let data = collected;
  if (el.optDedup.checked) {
    const seen = new Set();
    data = collected.filter(c => {
      const k = c.cells.join('\u0001');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const withSource = el.optSource.checked;
  const rows = data.map(c => (withSource ? c.cells.concat(['表 ' + (c.from + 1)]) : c.cells));
  const cols = base.cols + (withSource ? 1 : 0);
  if (opts.header) rows.unshift(withSource ? heads.concat(['来源表']) : heads.slice());

  const uniqDropped = [...new Set(dropped)];
  let tail;
  if (uniqDropped.length) {
    tail = '已过滤字段 <b>' + uniqDropped.length + '</b> 个'
      + '<details class="drop-list"><summary>查看被过滤的字段</summary><div>'
      + escHtml(uniqDropped.join('、')) + '</div></details>';
  } else {
    tail = '字段全部命中';
  }

  return {
    table: { cols, rows },
    conflicts: null,
    dataRows: data.length,
    note: '基准 <b>表 ' + (ai + 1) + '</b> · 纵向追加 <b>' + list.length + '</b> 张表 · <b>'
      + data.length + '</b> 行',
    tail
  };
}

/* ---------- 按键关联 ---------- */
function mergeByKey(opts) {
  const list = state.tables;
  const ai = state.active;
  const base = list[ai];
  if (!opts.header) {
    return { error: '「按键关联」需要首行是表头，请先勾选设置里的「首行作为表头」。' };
  }
  const alias = readAlias();
  const heads = baseHeader();
  const baseNorm = heads.map(normKey);
  const kIdx = keyIndexes(baseNorm);
  const kNames = kIdx.map(i => baseNorm[i]);

  /* 其他表：与基准同名的列用于冲突比对，其余列作为新增列 */
  const extras = [];
  const dups = [];
  list.forEach((t, ti) => {
    if (ti === ai) return;
    (t.rows[0] || []).forEach((h, col) => {
      let k = normKey(h);
      if (alias[k]) k = alias[k];
      const bi = baseNorm.indexOf(k);
      if (bi >= 0) { dups.push({ ti, baseCol: bi, col }); return; }
      if (!k) return;
      let name = String(h || '').trim() || '列' + (col + 1);
      const taken = heads.concat(extras.map(e => e.name)).some(x => normKey(x) === normKey(name));
      if (taken) name = name + '@表' + (ti + 1);
      extras.push({ name, ti, col });
    });
  });

  /* 每张其他表建一份 键 → 行 的索引 */
  const lookups = list.map((t, ti) => {
    if (ti === ai) return null;
    const idxs = kNames.map(k => (t.rows[0] || []).findIndex(h => {
      let kk = normKey(h);
      if (alias[kk]) kk = alias[kk];
      return kk === k;
    }));
    if (idxs.some(i => i < 0)) return null;
    const map = new Map();
    for (let r = 1; r < t.rows.length; r++) {
      const key = idxs.map(i => normKey(t.rows[r][i])).join('\u0001');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t.rows[r]);
    }
    return map;
  });

  const expand = el.optExpand.checked;
  let rows = [];
  for (let r = 1; r < base.rows.length; r++) {
    rows.push({ cells: base.rows[r].slice(), conf: Object.create(null) });
  }

  list.forEach((t, ti) => {
    if (ti === ai) return;
    const lookup = lookups[ti];
    const ex = extras.filter(e => e.ti === ti);
    const dup = dups.filter(d => d.ti === ti);
    const next = [];
    rows.forEach(row => {
      const key = kIdx.map(i => normKey(row.cells[i])).join('\u0001');
      const hits = lookup ? (lookup.get(key) || []) : [];
      const use = hits.length ? (expand ? hits : [hits[0]]) : [null];
      use.forEach(m => {
        const cells = row.cells.slice();
        const conf = Object.create(null);
        Object.keys(row.conf).forEach(c => { conf[c] = row.conf[c]; });
        ex.forEach(e => cells.push(m ? (m[e.col] || '') : ''));
        if (m) {
          dup.forEach(d => {
            const a = String(row.cells[d.baseCol] || '').trim();
            const b = String(m[d.col] || '').trim();
            if (a && b && a !== b) {
              conf[d.baseCol] = (conf[d.baseCol] ? conf[d.baseCol] + '；' : '') + '表 ' + (ti + 1) + '：' + b;
            }
          });
        }
        next.push({ cells, conf });
      });
    });
    rows = next;
  });

  if (el.optDedup.checked) {
    const seen = new Set();
    rows = rows.filter(r => {
      const k = r.cells.join('\u0001');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const head = heads.concat(extras.map(e => e.name));
  const allRows = [head].concat(rows.map(r => r.cells));
  const conflicts = rows.map(r => r.conf);
  let conflictCount = 0;
  conflicts.forEach(c => { conflictCount += Object.keys(c).length; });

  const keyText = escHtml(kIdx.map(i => heads[i]).join(' + '));
  let tail = extras.length ? '新增字段 <i>' + escHtml(extras.map(e => e.name).slice(0, 8).join('、'))
    + (extras.length > 8 ? ' 等 ' + extras.length + ' 个' : '') + '</i>' : '无新增字段';
  if (conflictCount) tail += ' · <b>冲突 ' + conflictCount + ' 处</b>（黄底，悬停看各表取值）';

  return {
    table: { cols: head.length, rows: allRows },
    conflicts,
    dataRows: rows.length,
    note: '基准 <b>表 ' + (ai + 1) + '</b> · 按键关联 <i>' + keyText + '</i> · 关联 <b>'
      + list.length + '</b> 张表 · <b>' + rows.length + '</b> 行',
    tail
  };
}

let mergeCache = null;

function mergeView() {
  if (!state.tables.length) return null;
  const sig = [
    state.rev, state.joinMode, state.active, el.optHeader.checked, el.optSource.checked,
    el.optDedup.checked, el.optExpand.checked, el.optAlias.value, state.keyCols.join(',')
  ].join('\u0001');
  if (mergeCache && mergeCache.sig === sig) return mergeCache.value;
  const value = state.joinMode === 'key' ? mergeByKey(readOpts()) : mergeStack(readOpts());
  mergeCache = { sig, value };
  return value;
}

/* 当前用于预览/导出的表：单表模式取选中表，拼接模式取合并结果 */
function currentTable() {
  if (state.mode === 'join') {
    const m = mergeView();
    return m && m.table ? m.table : null;
  }
  return state.tables[state.active] || null;
}

function buildOutput() {
  const t = currentTable();
  if (!t) return '';
  const p = prepare(t, readOpts());
  switch (state.format) {
    case 'csv': return formatDelimited(p, ',');
    case 'tsv': return formatDelimited(p, '\t');
    case 'json': return formatJSON(p);
    case 'html': return formatHTML(p);
    case 'ascii': return formatAscii(p);
    default: return formatMarkdown(p, readOpts());
  }
}

/* =====================================================================
   渲染
   ===================================================================== */
function codeHtml(text) {
  if (!text) return '';
  if (state.format !== 'md') return escHtml(text);
  return text.split('\n').map(line => {
    if (/^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(line)) return '<span class="tok-dash">' + escHtml(line) + '</span>';
    return line.split('|').map(escHtml).join('<span class="tok-pipe">|</span>');
  }).join('\n');
}

function numericCols(p) {
  const flags = [];
  for (let c = 0; c < p.cols; c++) {
    let has = false, all = true;
    const check = v => {
      const s = String(v || '').trim();
      if (s === '') return;
      has = true;
      if (!/^-?\d+(\.\d+)?$/.test(s)) all = false;
    };
    if (p.head) check(p.head[c]);
    p.body.forEach(r => check(r[c]));
    flags.push(has && all);
  }
  return flags;
}

const EMPTY_TIP = '<p class="empty">还没有识别到表格。<br>把日志里带 <b>+---+</b> 边框的那几行整段粘到上面，或者点「示例」看效果。</p>';

function tableHtml(p, conflicts) {
  const num = numericCols(p);
  let html = '<table class="pv">';
  if (p.head) {
    html += '<thead><tr>' + p.head.map((v, i) =>
      '<th' + (num[i] ? ' class="num"' : '') + '>' + escHtml(v) + '</th>').join('') + '</tr></thead>';
  }
  html += '<tbody>' + p.body.map((r, ri) => '<tr>' + r.map((v, ci) => {
    const hit = conflicts && conflicts[ri] ? conflicts[ri][ci] : '';
    const cls = [num[ci] ? 'num' : '', v === 'null' ? 'nullv' : '', hit ? 'conflict' : ''].filter(Boolean).join(' ');
    return '<td' + (cls ? ' class="' + cls + '"' : '')
      + (hit ? ' title="' + escHtml('与基准表取值不同：' + hit) + '"' : '')
      + '>' + escHtml(v) + '</td>';
  }).join('') + '</tr>').join('') + '</tbody>';
  return html + '</table>';
}

/* 平铺全文：说明文字按原文渲染，每张表格就地转成 HTML 表格 */
function renderFlow() {
  const opts = readOpts();
  el.previewWrap.innerHTML = state.segments.map(seg => {
    if (seg.type === 'text') return '<pre class="flow-text">' + escHtml(seg.text) + '</pre>';
    const t = seg.table;
    return '<section class="flow-table">'
      + '<button type="button" class="chip flow-cap' + (t.index === state.active ? ' on' : '') + '"'
      + ' data-flow-idx="' + t.index + '" title="设为导出用的当前表">'
      + '表 ' + (t.index + 1) + ' · ' + t.cols + ' 列 × ' + t.rows.length + ' 行</button>'
      + tableHtml(prepare(t, opts))
      + '</section>';
  }).join('') || EMPTY_TIP;
}

function renderPreview() {
  el.previewWrap.classList.toggle('flow', state.mode === 'flow');
  if (!state.tables.length) { el.previewWrap.innerHTML = EMPTY_TIP; return; }
  if (state.mode === 'flow') { renderFlow(); return; }
  if (state.mode === 'join') {
    const m = mergeView();
    if (!m) { el.previewWrap.innerHTML = EMPTY_TIP; return; }
    if (m.error) { el.previewWrap.innerHTML = joinNote(escHtml(m.error)); return; }
    el.previewWrap.innerHTML = joinNote(m.note, m.tail)
      + tableHtml(prepare(m.table, readOpts()), m.conflicts);
    return;
  }
  const t = state.tables[state.active];
  el.previewWrap.innerHTML = tableHtml(prepare(t, readOpts()));
}

function renderTablesBar() {
  const list = state.tables;
  el.tablesBar.classList.toggle('hidden', state.mode !== 'single' || list.length < 2);
  el.tablesBar.innerHTML = list.map((t, i) =>
    '<button type="button" class="chip' + (i === state.active ? ' on' : '') + '" data-idx="' + i + '">'
    + '表 ' + (i + 1) + ' · ' + t.cols + ' 列 × ' + t.rows.length + ' 行</button>'
  ).join('');
}

function renderStats() {
  if (!state.tables.length) {
    el.outStat.textContent = '未解析到表格';
    el.sizeStat.textContent = '';
    el.statText.textContent = '等待粘贴';
    document.getElementById('statChip').classList.remove('warn');
    return;
  }
  if (state.mode === 'flow') {
    el.outStat.textContent = '全文平铺 · ' + state.tables.length + ' 张表 · ' + state.segments.length + ' 段';
  } else if (state.mode === 'join') {
    const m = mergeView();
    if (!m || m.error) {
      el.outStat.textContent = '多表拼接 · 无法合并';
    } else {
      el.outStat.textContent = '多表拼接 · '
        + (state.joinMode === 'key' ? '按键关联' : '纵向追加')
        + ' · 基准 表 ' + (state.active + 1)
        + ' · ' + m.table.cols + ' 列 × ' + m.dataRows + ' 行'
        + (state.tables.length > 1 ? ' · 共 ' + state.tables.length + ' 张表' : '');
    }
  } else {
    const t = state.tables[state.active];
    const ignored = state.notes.length ? ' · 忽略 ' + state.notes.length + ' 行文本' : '';
    el.outStat.textContent = '表 ' + (state.active + 1) + '/' + state.tables.length
      + ' · ' + t.cols + ' 列 × ' + t.rows.length + ' 行' + ignored;
  }
  const out = buildOutput();
  el.sizeStat.textContent = out.length + ' 字符';
  el.statText.textContent = state.tables.length + ' 张表 · 已同步';
  document.getElementById('statChip').classList.remove('warn');
}

function renderNotes() {
  const notes = state.notes;
  el.notesBox.classList.toggle('hidden', state.mode !== 'single' || !notes.length);
  if (!notes.length) return;
  el.notesSum.textContent = '非表格文本 · ' + notes.length + ' 行（已忽略）';
  el.notesText.textContent = notes.join('\n');
}

function renderBaseSelect() {
  el.baseSel.innerHTML = state.tables.map((t, i) =>
    '<option value="' + i + '">表 ' + (i + 1) + ' · ' + t.cols + ' 列 × ' + t.rows.length + ' 行</option>'
  ).join('');
  el.baseSel.value = String(state.active);
  el.baseSel.disabled = !state.tables.length;
  renderKeyBox();
}

/* 键列勾选列表：按基准表表头生成，勾选状态存在 state.keyCols 里 */
function renderKeyBox() {
  const heads = baseHeader().filter(h => normKey(h));
  const sig = heads.join('\u0001');
  if (el.keyBox.dataset.sig !== sig) {
    el.keyBox.dataset.sig = sig;
    el.keyBox.innerHTML = heads.map(h =>
      '<label class="key-chip" title="' + escHtml(h) + '">'
      + '<input type="checkbox" data-name="' + escHtml(normKey(h)) + '">'
      + '<span>' + escHtml(h) + '</span></label>'
    ).join('');
  }
  el.keyBox.querySelectorAll('input[data-name]').forEach(inp => {
    inp.checked = state.keyCols.indexOf(inp.dataset.name) >= 0;
  });
}

function renderJoinUI() {
  el.joinOpts.classList.toggle('hidden', state.mode !== 'join');
  if (el.baseSel.options.length === state.tables.length) el.baseSel.value = String(state.active);
  el.joinModeSeg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', b.dataset.join === state.joinMode));
  el.keyWrap.classList.toggle('hidden', state.joinMode !== 'key');
  el.optSourceWrap.classList.toggle('hidden', state.joinMode === 'key');
  renderKeyBox();
}

function render() {
  renderTablesBar();
  renderNotes();
  renderJoinUI();
  const out = buildOutput();
  el.codePre.innerHTML = codeHtml(out);
  if (state.pane === 'preview') renderPreview();
  renderStats();
}

function setPane(pane) {
  state.pane = pane;
  el.outTabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.pane === pane));
  el.previewPane.classList.toggle('hidden', pane !== 'preview');
  el.codePane.classList.toggle('hidden', pane !== 'code');
}

/* =====================================================================
   重新解析
   ===================================================================== */
function parseAndRender() {
  const { tables, notes, segments } = parseText(el.src.value);
  state.tables = tables;
  state.notes = notes;
  state.segments = segments;
  state.rev++;
  if (state.active > tables.length - 1) state.active = 0;
  renderBaseSelect();
  render();
}

/* =====================================================================
   原始文本区
   ===================================================================== */
function updateLines() {
  const n = el.src.value.split('\n').length;
  if (el.srcLn.dataset.n === String(n)) return;
  el.srcLn.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  el.srcLn.dataset.n = String(n);
  el.srcLn.scrollTop = el.src.scrollTop;
}

function updateSrcStat() {
  const text = el.src.value;
  const lines = text ? text.split('\n').length : 0;
  el.srcStat.textContent = text ? text.length + ' 字符 · ' + lines + ' 行' : '0 字符';
}

let timer = null;
el.src.addEventListener('input', () => {
  updateLines();
  updateSrcStat();
  clearTimeout(timer);
  timer = setTimeout(parseAndRender, 160);
});
el.src.addEventListener('scroll', () => { el.srcLn.scrollTop = el.src.scrollTop; });

/* 拖入文件直接读取 */
el.src.addEventListener('dragover', e => { e.preventDefault(); el.src.classList.add('dragover'); });
el.src.addEventListener('dragleave', () => el.src.classList.remove('dragover'));
el.src.addEventListener('drop', e => {
  e.preventDefault();
  el.src.classList.remove('dragover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { el.src.value = String(reader.result || ''); updateLines(); updateSrcStat(); parseAndRender(); };
  reader.readAsText(file);
});

/* =====================================================================
   按钮
   ===================================================================== */
$('btnSample').addEventListener('click', () => {
  el.src.value = SAMPLE;
  state.active = 0;
  updateLines();
  updateSrcStat();
  parseAndRender();
  toast('已填入示例');
});

$('btnPaste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { toast('剪贴板是空的'); return; }
    el.src.value = text;
    updateLines();
    updateSrcStat();
    parseAndRender();
    toast('已粘贴');
  } catch (e) {
    el.src.focus();
    toast('浏览器不允许读取剪贴板，请直接 Ctrl+V');
  }
});

$('btnClear').addEventListener('click', () => {
  el.src.value = '';
  state.active = 0;
  updateLines();
  updateSrcStat();
  parseAndRender();
  el.src.focus();
});

el.outTabs.addEventListener('click', e => {
  const btn = e.target.closest('button[data-pane]');
  if (!btn) return;
  setPane(btn.dataset.pane);
  if (state.pane === 'preview') renderPreview();
});

el.outFormat.addEventListener('change', () => {
  state.format = el.outFormat.value;
  render();
});

el.tablesBar.addEventListener('click', e => {
  const btn = e.target.closest('.chip[data-idx]');
  if (!btn) return;
  state.active = +btn.dataset.idx;
  render();
});

[el.optHeader, el.optEscape, el.optNull].forEach(node => node.addEventListener('change', render));
el.optBlank.addEventListener('input', render);

/* 预览方式：单表视图 / 平铺全文 / 多表拼接 */
document.querySelectorAll('input[name="pvMode"]').forEach(node => {
  node.addEventListener('change', () => {
    if (!node.checked) return;
    state.mode = node.value;
    render();
  });
});

/* 多表拼接：基准表、拼接方式、键列、选项 */
el.baseSel.addEventListener('change', () => {
  state.active = +el.baseSel.value || 0;
  render();
});

el.joinModeSeg.addEventListener('click', e => {
  const btn = e.target.closest('button[data-join]');
  if (!btn) return;
  state.joinMode = btn.dataset.join;
  render();
});

el.keyBox.addEventListener('change', () => {
  state.keyCols = [...el.keyBox.querySelectorAll('input[data-name]:checked')].map(inp => inp.dataset.name);
  render();
});

[el.optSource, el.optDedup, el.optExpand].forEach(node => node.addEventListener('change', render));

/* 别名输入：缓一点再合并 */
let aliasTimer = null;
el.optAlias.addEventListener('input', () => {
  clearTimeout(aliasTimer);
  aliasTimer = setTimeout(render, 150);
});

/* 平铺视图里点表格标签，切换「导出用」的当前表（只改类名，避免滚动跳动） */
el.previewWrap.addEventListener('click', e => {
  const btn = e.target.closest('.flow-cap[data-flow-idx]');
  if (!btn) return;
  state.active = +btn.dataset.flowIdx;
  el.previewWrap.querySelectorAll('.flow-cap').forEach(c =>
    c.classList.toggle('on', +c.dataset.flowIdx === state.active));
  el.codePre.innerHTML = codeHtml(buildOutput());
  renderStats();
  toast('已选表 ' + (state.active + 1) + ' 用于导出');
});

$('btnCopy').addEventListener('click', async () => {
  const out = buildOutput();
  if (!out) { toast('没有可复制的内容'); return; }
  try {
    await navigator.clipboard.writeText(out);
    toast('已复制 ' + state.format.toUpperCase());
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = out;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制');
  }
});

$('btnDownload').addEventListener('click', () => {
  const out = buildOutput();
  if (!out) { toast('没有可下载的内容'); return; }
  const name = 'ascii-table-' + (state.active + 1) + '.' + (EXT[state.format] || 'txt');
  const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已下载 ' + name);
});

/* =====================================================================
   初始化
   ===================================================================== */
setPane('preview');
updateLines();
updateSrcStat();
parseAndRender();
