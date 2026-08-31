/* bp3d-build.js —— 把 BodyParts3D 的原始 obj 打成本站自己的 .ibp 包
 *
 *   node tools/bp3d-build.js            打全部系统
 *   node tools/bp3d-build.js resp bone  只打这几个
 *   BP3D=/path/to/bp3d node tools/...   指定原始数据目录（默认 /tmp/bp3d）
 *
 * 产物放在 assets/inner/：每个系统一个 <sys>.ibp + 一份 manifest.json。
 * 网页只读这两样，这个脚本本身不会被网页加载。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./bp3d-lib.js');
const ZH = require('./bp3d-zh.js');
const T = require('./bp3d-parts.js');

const OUT = path.join(__dirname, '..', 'assets', 'inner');
/* 肌肉的三个根：muscle organ 和它的两个兄弟 zone / head，大肌肉散落在这三处 */
const MUSCLE_ROOTS = ['FMA5022', 'FMA10474', 'FMA85453'];
const RIGHT_LOBE = new Set(['FMA7333', 'FMA7383', 'FMA7337']);

const warn = [];
function say() { console.log.apply(console, arguments); }

/* ---------------- 元件集合 ---------------- */
/** 被丢弃概念（血管网、神经网、筋膜…）包含的所有部件 */
const dropped = new Set(lib.els(T.drop));

/** 去掉落在 DROP 里的部件；但整件都在 DROP 里的（点名要的大血管主干）原样保留 */
function applyDrop(set) {
  let allIn = true;
  set.forEach(function (e) { if (!dropped.has(e)) allIn = false; });
  if (allIn) return set;
  const out = new Set();
  set.forEach(function (e) { if (!dropped.has(e)) out.add(e); });
  return out;
}

/** 英文名 → { base, side }：剥掉 "long head of …" 这类前缀和左右，剩下的就是肌肉本名 */
function baseName(en) {
  let s = (en || '').toLowerCase().trim(), side = '';
  s = s.replace(/\b(left|right)\b/g, function (m) {
    side = m === 'left' ? '左' : '右';
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  while (/^[a-z\- ]+? of /.test(s)) s = s.replace(/^[a-z\- ]+? of /, '');
  return { base: s.trim(), side: side };
}

let MUS = null;
/** 「肌肉本名 + 左右」→ 部件集合 */
function muscleIndex() {
  if (MUS) return MUS;
  MUS = new Map();
  lib.leaves(MUSCLE_ROOTS).forEach(function (id) {
    const b = baseName(lib.nameOf(id));
    const k = b.base + '|' + b.side;
    if (!MUS.has(k)) MUS.set(k, new Set());
    const dst = MUS.get(k);
    (lib.elems.get(id) || new Set()).forEach(function (e) { dst.add(e); });
  });
  return MUS;
}

/* ---------------- 一条对照表 → 若干「件」 ---------------- */
function mk(sys, name, side, p, set, en) {
  return {
    sys: sys, name: name, side: side || '', note: p.note || '',
    lv: p.lv || 0, to: p.to == null ? 99 : p.to, tri: p.tri || 0,
    keep: p.keep ? 1 : 0, auto: p.autoFlag ? 1 : 0,
    els: set, en: en || ''
  };
}

/** m: 按肌肉本名取，左右各成一件 */
function fromMuscle(sys, p) {
  const idx = muscleIndex(), out = [];
  ['右', '左', ''].forEach(function (side) {
    const set = idx.get(p.m + '|' + side);
    if (!set || !set.size) return;
    out.push(mk(sys, side + p.cn, side, p, applyDrop(new Set(set)), p.m));
  });
  if (!out.length) warn.push('肌肉没找到：' + p.m + '（' + p.cn + '）');
  return out;
}

/** auto:'leaf' 自动展开：每个叶子概念一件，名字过 bp3d-zh 翻译。
    带 only 时不往下摊平，而是从根往下找第一层名字匹配的概念就收（肺段这种本身还有子部件）。 */
function matchWalk(root, re) {
  const out = [], seen = new Set();
  (function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    if (re.test(lib.nameOf(id))) { out.push(id); return; }
    lib.kidsOf(id).forEach(walk);
  })(root);
  return out;
}

function fromAuto(sys, p) {
  const out = [], used = new Set();
  [].concat(p.roots).forEach(function (root) {
    const hint = RIGHT_LOBE.has(root) ? '右' : (p.zh === 'seg' ? '左' : '');
    const ids = p.only ? matchWalk(root, p.only) : lib.leaves([root]);
    ids.forEach(function (id) {
      const en = lib.nameOf(id);
      const set = applyDrop(new Set(lib.elems.get(id) || []));
      if (!set.size) return;
      const key = [...set].sort().join('+');
      if (used.has(key)) return;
      used.add(key);
      const t = p.zh === 'seg' ? ZH.seg(en, hint) : ZH.zh(en);
      if (t.miss) warn.push('没译：' + en);
      const q = { note: p.note || '', lv: p.lv || 0, tri: p.tri || 0, to: p.to, keep: p.keep, autoFlag: 1 };
      if (q.to == null) q.to = p.axial ? (p.axial.test(en) ? 1 : 0) : 99;
      out.push(mk(sys, t.side + t.cn, t.side, q, set, en));
    });
  });
  return out;
}

/** 一个系统的全部件（还没做重复归属） */
function expand(s) {
  const out = [];
  s.parts.forEach(function (p) {
    if (p.auto === 'leaf') { fromAuto(s.sys, p).forEach(function (x) { out.push(x); }); return; }
    if (p.m) { fromMuscle(s.sys, p).forEach(function (x) { out.push(x); }); return; }
    const set = applyDrop(new Set(lib.els([].concat(p.id))));
    if (!set.size) { warn.push('没有几何：' + p.id + '（' + p.cn + '）'); return; }
    out.push(mk(s.sys, p.cn, '', p, set, lib.nameOf([].concat(p.id)[0])));
  });
  return out;
}

/* 同一份几何被两件都盖到、而且两件在某个涂层级上会同时可见时，
   归给更细的那件（元件少的；一样细就手写的那件优先，因为手写的带说明）。
   不同涂层级上重名不算冲突，因为它们不会同时出现；标了 keep 的件（如支气管树）不参与让让。 */
function bothVisible(a, b) {
  return Math.max(a.lv, b.lv) <= Math.min(a.to, b.to);
}

function dedup(items) {
  const list = items.filter(function (it) { return !it.keep; })
    .sort(function (a, b) { return (a.els.size - b.els.size) || (a.auto - b.auto); });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!bothVisible(list[i], list[j])) continue;
      list[i].els.forEach(function (e) { list[j].els.delete(e); });
    }
  }
  return items.filter(function (it) {
    if (it.els.size) return true;
    warn.push('被更细的件吃光了，跳过：' + it.sys + ' ' + it.name);
    return false;
  });
}

/* ---------------- 几何：读 obj → 合并 → 简化 ---------------- */
const objMiss = new Set();

function geom(it) {
  const list = [];
  [...it.els].sort().forEach(function (fj) {
    if (!fs.existsSync(path.join(lib.OBJ, fj + '.obj'))) { objMiss.add(fj); return; }
    list.push(lib.readObj(fj));
  });
  if (!list.length) return null;
  return lib.decimate(lib.merge(list), it.tri);
}

/* ---------------- 打包 ----------------
   .ibp = 'IBP1' + uint32 头长 + 头部 JSON(utf8, 补到 4 字节) + 数据区
   数据区里每件先放 int16 顶点、再放索引，各自补到 4 字节，网页端可以直接开 TypedArray 视图。 */
function buf(ta) {
  return Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
}
function pad4(n) { return (4 - (n & 3)) & 3; }
function r6(x) { return +x.toPrecision(8); }

function packSystem(s) {
  const items = dedup(expand(s));
  const blob = [], head = { sys: s.sys, levels: s.levels, items: [] };
  let off = 0, tris = 0, verts = 0;
  items.forEach(function (it) {
    const g = geom(it);
    if (!g || !g.idx.length) { warn.push('没读到几何，跳过：' + s.sys + ' ' + it.name); return; }
    const q = lib.quantize(g);
    const pb = buf(q.q), ib = buf(q.idx);
    const rec = {
      n: it.name, lv: it.lv, to: it.to, v: q.verts, t: q.tris,
      big: q.big ? 1 : 0, mn: q.mn.map(r6), sc: q.sc.map(r6),
      p: [off, pb.length]
    };
    blob.push(pb);
    off += pb.length;
    const p1 = pad4(off);
    if (p1) { blob.push(Buffer.alloc(p1)); off += p1; }
    rec.i = [off, ib.length];
    blob.push(ib);
    off += ib.length;
    const p2 = pad4(off);
    if (p2) { blob.push(Buffer.alloc(p2)); off += p2; }
    if (it.side) rec.s = it.side;
    if (it.note) rec.d = it.note;
    if (it.en) rec.en = it.en;
    head.items.push(rec);
    tris += q.tris;
    verts += q.verts;
  });

  const hj = Buffer.from(JSON.stringify(head), 'utf8');
  const hp = Buffer.alloc(pad4(hj.length));
  const top = Buffer.alloc(8);
  top.write('IBP1', 0, 'ascii');
  top.writeUInt32LE(hj.length, 4);      // 写真实长度，读的一端自己往上取整到 4
  const out = Buffer.concat([top, hj, hp].concat(blob));
  fs.writeFileSync(path.join(OUT, s.sys + '.ibp'), out);
  return { sys: s.sys, file: s.sys + '.ibp', levels: s.levels, n: head.items.length, tris: tris, verts: verts, bytes: out.length };
}

/* ---------------- 主流程 ---------------- */
function kb(n) { return (n / 1024).toFixed(0) + 'KB'; }

function main() {
  const only = process.argv.slice(2).filter(function (a) { return a[0] !== '-'; });
  fs.mkdirSync(OUT, { recursive: true });
  const mf = path.join(OUT, 'manifest.json');
  let man = { ref: T.ref, src: 'BodyParts3D/Anatomography, CC BY 4.0', systems: [] };
  if (fs.existsSync(mf)) {
    try { man = JSON.parse(fs.readFileSync(mf, 'utf8')); man.ref = T.ref; } catch (e) { /* 坏了就重建 */ }
  }
  if (!Array.isArray(man.systems)) man.systems = [];

  let total = 0;
  T.systems.forEach(function (s) {
    if (only.length && only.indexOf(s.sys) < 0) return;
    const t0 = Date.now();
    const r = packSystem(s);
    total += r.bytes;
    say([r.sys, r.n + '件', r.levels.length + '级', r.tris + '三角', kb(r.bytes),
      ((Date.now() - t0) / 1000).toFixed(1) + 's'].join('\t'));
    const i = man.systems.findIndex(function (x) { return x.sys === r.sys; });
    const rec = { sys: r.sys, file: r.file, levels: r.levels, n: r.n, tris: r.tris, bytes: r.bytes };
    if (i < 0) man.systems.push(rec); else man.systems[i] = rec;
  });

  const ord = T.systems.map(function (s) { return s.sys; });
  man.systems.sort(function (a, b) { return ord.indexOf(a.sys) - ord.indexOf(b.sys); });
  fs.writeFileSync(mf, JSON.stringify(man));
  say('---');
  say('本次共 ' + kb(total) + '；manifest 里合计 ' +
    kb(man.systems.reduce(function (a, x) { return a + x.bytes; }, 0)));
  if (objMiss.size) say('缺 obj 文件 ' + objMiss.size + ' 个：' + [...objMiss].slice(0, 8).join(' ') + (objMiss.size > 8 ? ' …' : ''));
  if (warn.length) {
    say('提示 ' + warn.length + ' 条：');
    warn.slice(0, 60).forEach(function (w) { say('  ' + w); });
    if (warn.length > 60) say('  …还有 ' + (warn.length - 60) + ' 条');
  }
}

main();
