/* bp3d-lib.js —— BodyParts3D 数据的读取、合并、简化、量化
 * 只在打包时（node）用，网页一个字都不会加载它。
 * 数据源：http://lifesciencedb.jp/bp3d/  （partof / isa 两套表 + 每个部件一个 obj）
 * 授权：CC BY 4.0（旧 obj 文件头里写的是 CC BY-SA 2.1 Japan），署名见 assets/inner/LICENSE-BodyParts3D.txt
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** BP3D 原始数据放哪：默认 /tmp/bp3d，可用环境变量 BP3D 覆盖 */
const SRC = process.env.BP3D || '/tmp/bp3d';
const OBJ = path.join(SRC, 'partof_BP3D_4.0_obj_99');

function tsv(f, skip) {
  return fs.readFileSync(path.join(SRC, f), 'utf8').split('\n')
    .slice(skip ? 1 : 0).map(function (l) { return l.replace(/\r$/, '').split('\t'); })
    .filter(function (r) { return r.length > 1; });
}

/* ---------------- 概念表：partof 和 isa 两套合成一套 ----------------
   names: FMA → 英文名   elems: FMA → [FJ…]（部件文件名）   kids: FMA → [FMA…] */
const names = new Map(), elems = new Map(), kids = new Map();
['partof', 'isa'].forEach(function (k) {
  tsv(k + '_parts_list_e.txt', 1).forEach(function (r) {
    if (!names.has(r[0])) names.set(r[0], r[2]);
  });
  tsv(k + '_element_parts.txt', 1).forEach(function (r) {
    if (!elems.has(r[0])) elems.set(r[0], new Set());
    elems.get(r[0]).add(r[2]);
  });
  tsv(k + '_inclusion_relation_list.txt', 1).forEach(function (r) {
    if (!kids.has(r[0])) kids.set(r[0], new Set());
    kids.get(r[0]).add(r[2]);
  });
});

function els(id) { return [].concat.apply([], [].concat(id).map(function (x) {
  return [...(elems.get(x) || [])];
})); }
function kidsOf(id) { return [...(kids.get(id) || [])]; }
function nameOf(id) { return names.get(id) || id; }

/** 把一个概念摊平成「一个部件文件 = 一件」的叶子概念列表（同一份几何只留一个） */
function leaves(roots) {
  const out = [], seen = new Set(), used = new Set(), res = [];
  [].concat(roots).forEach(function (root) {
    (function walk(id) {
      if (seen.has(id)) return;
      seen.add(id);
      const e = elems.get(id) || new Set(), ch = kidsOf(id);
      if (e.size === 1 || !ch.length) { if (e.size) out.push(id); return; }
      ch.forEach(walk);
    })(root);
  });
  out.forEach(function (id) {
    const k = [...elems.get(id)].sort().join('+');
    if (used.has(k)) return;
    used.add(k);
    res.push(id);
  });
  return res;
}

/* ---------------- obj → 顶点/三角 ----------------
   BP3D 的 obj 是 `v x y z` + `f a//na b//nb c//nc`，法线不要（网页里自己算）。
   坐标换算：原始是毫米、Z 轴朝上、Y 轴朝后；本站是厘米、Y 轴朝上、+Z 朝前、+X 是人体自己的左手边。
   脚底 z=-78.1mm 对齐到 y=0，前后方向以整具身体的中面为 z=0。 */
const MM = 0.1;            // 毫米 → 厘米
const Z0 = -78.111;        // 原始坐标里的脚底
const Y0 = -100.768;       // 原始坐标里的前后中面

function readObj(fj) {
  const txt = fs.readFileSync(path.join(OBJ, fj + '.obj'), 'utf8');
  const pos = [], idx = [];
  let i = 0;
  while (i < txt.length) {
    let j = txt.indexOf('\n', i);
    if (j < 0) j = txt.length;
    const c = txt.charCodeAt(i);
    if (c === 118 && txt.charCodeAt(i + 1) === 32) {          // 'v '
      const p = txt.slice(i + 2, j).split(' ');
      pos.push((+p[0]) * MM, (+p[2] - Z0) * MM, -(+p[1] - Y0) * MM);
    } else if (c === 102 && txt.charCodeAt(i + 1) === 32) {    // 'f '
      const p = txt.slice(i + 2, j).trim().split(/\s+/);
      for (let k = 2; k < p.length; k++) {                     // 万一是多边形就扇形切开
        idx.push((parseInt(p[0], 10) - 1), (parseInt(p[k - 1], 10) - 1), (parseInt(p[k], 10) - 1));
      }
    }
    i = j + 1;
  }
  return { pos: pos, idx: idx };
}

/** 把若干部件拼成一件 */
function merge(list) {
  const pos = [], idx = [];
  list.forEach(function (m) {
    const off = pos.length / 3;
    for (let i = 0; i < m.pos.length; i++) pos.push(m.pos[i]);
    for (let i = 0; i < m.idx.length; i++) idx.push(m.idx[i] + off);
  });
  return { pos: pos, idx: idx };
}

/* ---------------- 网格简化：顶点聚类 ----------------
   把空间切成小格子，一格里的顶点合成一个（取平均），再把退化成线的三角丢掉。
   比二次误差简化糙一点，但不会把薄壁捅穿，而且几百个部件跑得完。 */
function bbox(pos) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return { mn: mn, mx: mx };
}

function cluster(mesh, g) {
  const pos = mesh.pos, idx = mesh.idx, b = bbox(pos);
  const nx = Math.max(1, Math.ceil((b.mx[0] - b.mn[0]) / g) + 1);
  const ny = Math.max(1, Math.ceil((b.mx[1] - b.mn[1]) / g) + 1);
  const cell = new Map(), map = new Int32Array(pos.length / 3);
  const acc = [];
  for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
    const ix = Math.floor((pos[i] - b.mn[0]) / g);
    const iy = Math.floor((pos[i + 1] - b.mn[1]) / g);
    const iz = Math.floor((pos[i + 2] - b.mn[2]) / g);
    const key = ix + nx * (iy + ny * iz);
    let c = cell.get(key);
    if (c === undefined) { c = acc.length / 4; cell.set(key, c); acc.push(0, 0, 0, 0); }
    map[v] = c;
    acc[c * 4] += pos[i];
    acc[c * 4 + 1] += pos[i + 1];
    acc[c * 4 + 2] += pos[i + 2];
    acc[c * 4 + 3]++;
  }
  const np = new Array(acc.length / 4 * 3);
  for (let c = 0; c < acc.length / 4; c++) {
    const n = acc[c * 4 + 3] || 1;
    np[c * 3] = acc[c * 4] / n;
    np[c * 3 + 1] = acc[c * 4 + 1] / n;
    np[c * 3 + 2] = acc[c * 4 + 2] / n;
  }
  const ni = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = map[idx[i]], c = map[idx[i + 1]], d = map[idx[i + 2]];
    if (a !== c && c !== d && a !== d) ni.push(a, c, d);
  }
  return { pos: np, idx: ni };
}

/** 简化到不超过 target 个三角：格子从细往粗试，够了就停 */
function decimate(mesh, target) {
  const tris = mesh.idx.length / 3;
  if (!target || tris <= target) return mesh;
  const b = bbox(mesh.pos);
  const diag = Math.hypot(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1], b.mx[2] - b.mn[2]) || 1;
  let lo = diag / 900, hi = diag / 6, out = null;
  for (let i = 0; i < 12; i++) {
    const g = Math.sqrt(lo * hi);
    const m = cluster(mesh, g);
    if (m.idx.length / 3 > target) { lo = g; } else { hi = g; out = m; }
    if (hi / lo < 1.06) break;
  }
  return (out && out.idx.length) ? out : cluster(mesh, diag / 6);
}

/* ---------------- 打包 ----------------
   自己的小格式（.ibp）：顶点压成 int16（每件按自己的包围盒定标，精度约 bbox/65534），
   三角用 uint16 / uint32 索引。头部 JSON 描述每件的名字、图层、涂层区间和数据偏移。
   一个三角约 9 字节，比 glb 省，网页端几十行就能读完。 */
function quantize(mesh) {
  const b = bbox(mesh.pos), n = mesh.pos.length / 3;
  const sc = [0, 1, 2].map(function (k) { return Math.max(1e-6, (b.mx[k] - b.mn[k]) / 65534); });
  const q = new Int16Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      q[i * 3 + k] = Math.round((mesh.pos[i * 3 + k] - b.mn[k]) / sc[k]) - 32767;
    }
  }
  const big = n > 65535;
  const idx = big ? new Uint32Array(mesh.idx) : new Uint16Array(mesh.idx);
  return { q: q, idx: idx, big: big, mn: b.mn, sc: sc, verts: n, tris: idx.length / 3 };
}

module.exports = {
  SRC: SRC, OBJ: OBJ, tsv: tsv, names: names, elems: elems, kids: kids,
  els: els, kidsOf: kidsOf, nameOf: nameOf, leaves: leaves,
  readObj: readObj, merge: merge, bbox: bbox, cluster: cluster,
  decimate: decimate, quantize: quantize
};
