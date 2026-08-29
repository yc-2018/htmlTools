#!/usr/bin/env node
/* 用 MakeHuman 的 CC0 素材生成「3D人体标注」用的 assets/body.glb + assets/body-regions.json。
 *
 * 用法（在 3D人体标注 目录下执行，需要 Node 14+ 和一次联网）：
 *     node tools/make-body-glb.js
 *     node tools/make-body-glb.js --out assets --cache tools/.mh-cache
 *
 * 参数：
 *     --out DIR      输出目录，默认 assets
 *     --cache DIR    素材缓存目录，默认 tools/.mh-cache（下载过就不再联网）
 *     --no-regions   只出 body.glb
 *     --quiet        少打日志
 *
 * 素材来自 makehumancommunity/makehuman 仓库，其中 base mesh、targets、weights
 * 都是 CC0 1.0（见该仓库 LICENSE.md 的 C 节），可以随便打包分发。
 * 拿到的东西：
 *   * data/3dobjs/base.obj        基础网格，body 组 13378 个四边形 → 26756 三角面
 *   * data/rigs/default_weights.mhw  顶点权重，用来划分部位（相当于 Blender 的顶点组）
 *   * data/targets/**.target      形变数据，组合成 female / fatUp / bustUp … 这些形变目标
 *
 * MakeHuman 的坐标系正好和这个工具一致：Y 轴朝上、面朝 +Z、模型自己的左手在 +X，
 * 单位是分米，这里统一乘 10 换成厘米。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/';
const ETH = ['african', 'asian', 'caucasian'];   // 默认三个族裔各占 1/3，取平均当中性
const SEX = ['male', 'female'];

/* 形变目标 → 由哪些 .target 文件加权而来；base 是「年轻男性、常规体重」 */
const MORPHS = [
  ['female', 'sexDiff'],
  ['fatUp', 'universal-*-young-averagemuscle-maxweight'],
  ['fatDown', 'universal-*-young-averagemuscle-minweight'],
  ['bustUp', 'measure-bust-circ-incr'],
  ['bustDown', 'measure-bust-circ-decr'],
  ['waistUp', 'measure-waist-circ-incr'],
  ['waistDown', 'measure-waist-circ-decr'],
  ['hipUp', 'measure-hips-circ-incr'],
  ['hipDown', 'measure-hips-circ-decr'],
  ['muscleUp', 'universal-*-young-maxmuscle-averageweight']
];

const LIMB_AXES = { aPos: '前面', aNeg: '后面', lPos: '外侧', lNeg: '内侧' };
const HORIZ_AXES = { aPos: '前面', aNeg: '后面', lPos: '上面', lNeg: '下面' };
const WAIST = 0.616;                   // 与 js/body-model.js 的 L.waist 一致
/* 骨骼名 → [区键, kind, 中文名, 附加字段]；从上往下匹配，落不到规则上的都算躯干 */
const RULES = [
  [/^finger1/, 'thumb', 'finger', '拇指', {}],
  [/^finger2/, 'index', 'finger', '食指', {}],
  [/^finger3/, 'middle', 'finger', '中指', {}],
  [/^finger4/, 'ring', 'finger', '无名指', {}],
  [/^finger5/, 'little', 'finger', '小指', {}],
  [/^(metacarpal|wrist)/, 'hand', 'palm', '手', {}],
  [/^lowerarm/, 'forearm', 'limb', '前臂', { t0: '靠近肘部', t1: '靠近腕部' }],
  [/^upperarm/, 'upperarm', 'limb', '上臂', { t0: '靠近肩部', t1: '靠近肘部' }],
  [/^toe/, 'toe', 'toe', '脚趾', { noFacing: true }],
  [/^foot/, 'foot', 'foot', '脚', {}],
  [/^lowerleg/, 'shin', 'limb', '小腿', { t0: '靠近膝部', t1: '靠近脚踝' }],
  [/^upperleg/, 'thigh', 'limb', '大腿', { t0: '靠近大腿根部', t1: '靠近膝部' }],
  [/^neck/, 'neck', 'neck', '颈部', {}],
  [/^(head|jaw|eye|oculi|orbicularis|oris|levator|risorius|special|temporalis|tongue)/,
    'head', 'head', '头部', {}],
  [/^breast/, 'breast', 'breast', '乳房', {}]
];
const TORSO = ['torso', 'torso', '躯干', '', {}];
/* 这几类整体只留一个区：头部要靠完整的下巴~头顶范围分段，拆成左右反而算错 */
const NO_SIDE = ['head', 'neck', 'torso'];

/* 两段之间补出来的关节区：[近端, 远端, 中文名, 方位词] */
const JOINTS = [
  ['upperarm', 'forearm', '肘',
    { aPos: '肘窝(前面)', aNeg: '肘尖(后面)', lPos: '外侧', lNeg: '内侧' }],
  ['forearm', 'hand', '腕',
    { aPos: '掌侧(手心一侧)', aNeg: '背侧(手背一侧)', lPos: '拇指一侧', lNeg: '小指一侧' }],
  ['thigh', 'shin', '膝',
    { aPos: '膝盖前面(髌骨)', aNeg: '膝后(腘窝)', lPos: '外侧', lNeg: '内侧' }],
  ['shin', 'foot', '踝',
    { aPos: '踝前方', aNeg: '跟腱(后面)', lPos: '外踝', lNeg: '内踝' }]
];

/* 输出顺序；躯干必须排第一，页面查不到面时拿它兜底 */
const RANK = ['torso', 'head', 'neck', 'breast', 'upperarm', '肘', 'forearm', '腕',
  'hand', 'thumb', 'index', 'middle', 'ring', 'little',
  'thigh', '膝', 'shin', '踝', 'foot', 'toe'];
/* ---------------- 通用小工具 ---------------- */

const opt = { out: 'assets', cache: path.join(__dirname, '.mh-cache'), regions: true, quiet: false };
process.argv.slice(2).forEach(function (a, i, all) {
  if (a === '--out') opt.out = all[i + 1];
  else if (a === '--cache') opt.cache = all[i + 1];
  else if (a === '--no-regions') opt.regions = false;
  else if (a === '--quiet') opt.quiet = true;
});

function log() {
  if (!opt.quiet) console.log.apply(console, ['[body]'].concat([].slice.call(arguments)));
}

function die(msg) {
  console.log('[body] 出错：' + msg);
  process.exit(1);
}

/** 下载并缓存一个素材文件，已经在缓存里就直接读 */
function grab(rel) {
  const file = path.join(opt.cache, rel.replace(/[\/]/g, '_'));
  if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file, 'utf8'));
  return new Promise(function (ok, no) {
    https.get(RAW + rel, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        no(new Error('HTTP ' + res.statusCode + ' ' + rel));
        return;
      }
      const bufs = [];
      res.on('data', function (b) { bufs.push(b); });
      res.on('end', function () {
        const txt = Buffer.concat(bufs).toString('utf8');
        fs.mkdirSync(opt.cache, { recursive: true });
        fs.writeFileSync(file, txt);
        ok(txt);
      });
    }).on('error', no);
  });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const len = a => Math.sqrt(dot(a, a));
const norm = a => mul(a, 1 / (len(a) || 1));
const r5 = v => [+v[0].toFixed(5), +v[1].toFixed(5), +v[2].toFixed(5)];

function mean(ps) {
  let s = [0, 0, 0];
  ps.forEach(function (p) { s = addv(s, p); });
  return mul(s, 1 / Math.max(1, ps.length));
}
/* ---------------- 素材解析 ---------------- */

/** base.obj：顶点表（分米）+ body 组的四边形；其它组（helper-*、joint-*）不要 */
function parseObj(txt) {
  const verts = [], quads = [];
  let group = null;
  txt.split('\n').forEach(function (ln) {
    if (ln[0] === 'v' && ln[1] === ' ') {
      const p = ln.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (ln[0] === 'g' && ln[1] === ' ') {
      group = ln.slice(2).trim();
    } else if (ln[0] === 'f' && ln[1] === ' ' && group === 'body') {
      const f = ln.trim().split(/\s+/).slice(1).map(s => +s.split('/')[0] - 1);
      if (f.length === 4) quads.push(f);
      else die('body 组里出现了 ' + f.length + ' 边形，脚本只认四边形');
    }
  });
  return { verts: Float64Array.from(verts), quads: quads };
}

/** .target：每行「顶点号 dx dy dz」，注释以 # 开头 */
function parseTarget(txt) {
  const out = [];
  txt.split('\n').forEach(function (ln) {
    if (!ln || ln[0] === '#') return;
    const p = ln.trim().split(/\s+/);
    if (p.length < 4) return;
    out.push(+p[0], +p[1], +p[2], +p[3]);
  });
  return Float64Array.from(out);
}

/** 把一个 target 按系数累加到整张顶点位移表上 */
function accum(dst, t, k) {
  for (let i = 0; i < t.length; i += 4) {
    const v = t[i] * 3;
    dst[v] += t[i + 1] * k;
    dst[v + 1] += t[i + 2] * k;
    dst[v + 2] += t[i + 3] * k;
  }
}

function need() {
  const list = ['3dobjs/base.obj', 'rigs/default_weights.mhw'];
  ETH.forEach(e => SEX.forEach(s =>
    list.push('targets/macrodetails/' + e + '-' + s + '-young.target')));
  SEX.forEach(function (s) {
    ['averagemuscle-maxweight', 'averagemuscle-minweight', 'maxmuscle-averageweight']
      .forEach(t => list.push('targets/macrodetails/universal-' + s + '-young-' + t + '.target'));
  });
  ['bust', 'waist', 'hips'].forEach(m => ['incr', 'decr'].forEach(d =>
    list.push('targets/measure/measure-' + m + '-circ-' + d + '.target')));
  return list;
}
/* ---------------- 形变目标组合 ---------------- */

function ethMean(tgt, sex, n) {
  const d = new Float64Array(n * 3);
  ETH.forEach(e => accum(d, tgt['targets/macrodetails/' + e + '-' + sex + '-young.target'],
    1 / ETH.length));
  return d;
}

/** 体重、肌肉这几个 target 分男女两份，取平均当中性用 */
function sexMean(tgt, tail, n) {
  const d = new Float64Array(n * 3);
  SEX.forEach(s => accum(d,
    tgt['targets/macrodetails/universal-' + s + '-young-' + tail + '.target'], 1 / SEX.length));
  return d;
}

/** 返回基础形态（年轻男性、常规体重）和十个形变目标的位移表 */
function compose(tgt, n) {
  const male = ethMean(tgt, 'male', n), female = ethMean(tgt, 'female', n);
  const morphs = MORPHS.map(function (m) {
    const spec = m[1];
    let d = new Float64Array(n * 3);
    if (spec === 'sexDiff') {
      for (let i = 0; i < d.length; i++) d[i] = female[i] - male[i];
    } else if (spec.indexOf('universal-') === 0) {
      d = sexMean(tgt, spec.replace('universal-*-young-', ''), n);
    } else {
      accum(d, tgt['targets/measure/' + spec + '.target'], 1);
    }
    return { name: m[0], d: d };
  });
  return { base: male, morphs: morphs };
}

/* ---------------- 网格：取 body 组、三角化、居中落地 ---------------- */

function buildMesh(obj, base, morphs) {
  const n = obj.verts.length / 3;
  const full = new Float64Array(n * 3);
  for (let i = 0; i < full.length; i++) full[i] = (obj.verts[i] + base[i]) * 10;  // 分米→厘米

  const map = new Int32Array(n).fill(-1), keep = [];
  obj.quads.forEach(q => q.forEach(function (v) {
    if (map[v] < 0) { map[v] = keep.length; keep.push(v); }
  }));
  const m = keep.length;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9;
  keep.forEach(function (v) {
    x0 = Math.min(x0, full[v * 3]); x1 = Math.max(x1, full[v * 3]);
    y0 = Math.min(y0, full[v * 3 + 1]);
  });
  const cx = (x0 + x1) / 2;
  const pos = new Float32Array(m * 3);
  keep.forEach(function (v, k) {
    pos[k * 3] = full[v * 3] - cx;
    pos[k * 3 + 1] = full[v * 3 + 1] - y0;
    pos[k * 3 + 2] = full[v * 3 + 2];
  });

  const tri = new Uint16Array(obj.quads.length * 6);
  obj.quads.forEach(function (q, i) {
    const a = map[q[0]], b = map[q[1]], c = map[q[2]], d = map[q[3]];
    tri.set([a, b, c, a, c, d], i * 6);
  });

  /* 中轴 z 按腰部一条窄带估，和 mesh-model.js 的 axisZ 一个算法；
     不做这一步的话页面加载时会自己平移几何，分区表的 z 就和网格错开了 */
  let H = 0;
  for (let i = 1; i < pos.length; i += 3) H = Math.max(H, pos[i]);
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i + 1] / H - WAIST) > 0.03 || Math.abs(pos[i]) > H * 0.06) continue;
    lo = Math.min(lo, pos[i + 2]);
    hi = Math.max(hi, pos[i + 2]);
  }
  const cz = lo > hi ? 0 : (lo + hi) / 2;
  for (let i = 2; i < pos.length; i += 3) pos[i] -= cz;

  const ms = morphs.map(function (t) {
    const d = new Float32Array(m * 3);
    keep.forEach(function (v, k) {
      d[k * 3] = t.d[v * 3] * 10;
      d[k * 3 + 1] = t.d[v * 3 + 1] * 10;
      d[k * 3 + 2] = t.d[v * 3 + 2] * 10;
    });
    /* MakeHuman 的宏目标顺带改身高（男女差了十几厘米），可页面是靠整体缩放调身高的，
       形变再动身高就会和身高滑块打架。这里按 y 比例把整体拉伸抽掉，只留体型差别 */
    let top = 0;
    for (let i = 0; i < m; i++) top = Math.max(top, pos[i * 3 + 1] + d[i * 3 + 1]);
    const dH = top - H;
    if (Math.abs(dH) > 1e-4) {
      for (let i = 0; i < m; i++) d[i * 3 + 1] -= pos[i * 3 + 1] / H * dH;
    }
    return { name: t.name, d: d, dH: dH };
  });

  return {
    pos: pos, tri: tri, keep: keep, quads: obj.quads,
    nor: normals(pos, tri), morphs: ms
  };
}
function normals(pos, tri) {
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const w = cross(u, v);
    for (let k = 0; k < 3; k++) {
      nor[a + k] += w[k]; nor[b + k] += w[k]; nor[c + k] += w[k];
    }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  return nor;
}

/* ---------------- 分区：拿顶点权重当顶点组用 ---------------- */

/** 每个顶点归到权重最大的那根骨头 */
function vertexBones(weights, n) {
  const best = new Float64Array(n), name = new Array(n);
  Object.keys(weights).forEach(function (bone) {
    weights[bone].forEach(function (p) {
      if (p[1] > best[p[0]]) { best[p[0]] = p[1]; name[p[0]] = bone; }
    });
  });
  return name;
}

function metaOf(bone) {
  if (!bone) return TORSO;
  const s = /\.L$/.test(bone) ? '左' : (/\.R$/.test(bone) ? '右' : '');
  for (let i = 0; i < RULES.length; i++) {
    const r = RULES[i];
    if (r[0].test(bone)) {
      const side = NO_SIDE.indexOf(r[1]) >= 0 ? '' : s;
      return [r[1] + side, r[2], side + r[3], side, r[4]];
    }
  }
  return TORSO;
}

/** 每个四边形取四个角里的多数派，两个三角面共用；平票时取第一个 */
function assign(mesh, bones) {
  const metas = {}, fk = new Array(mesh.tri.length / 3);
  mesh.quads.forEach(function (q, i) {
    const cnt = {}, pick = {};
    let bestK = null, bestN = 0;
    q.forEach(function (v) {
      const m = metaOf(bones[v]);
      pick[m[0]] = m;
      cnt[m[0]] = (cnt[m[0]] || 0) + 1;
      if (cnt[m[0]] > bestN) { bestN = cnt[m[0]]; bestK = m[0]; }
    });
    metas[bestK] = pick[bestK];
    fk[i * 2] = fk[i * 2 + 1] = pick[bestK];
  });
  metas.torso = metas.torso || TORSO;
  return { fk: fk, metas: metas };
}
/** 三角面重心，按身高归一化 */
function centroids(mesh, H) {
  const out = [], p = mesh.pos, t = mesh.tri;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    out.push([(p[a] + p[b] + p[c]) / 3 / H,
      (p[a + 1] + p[b + 1] + p[c + 1]) / 3 / H,
      (p[a + 2] + p[b + 2] + p[c + 2]) / 3 / H]);
  }
  return out;
}

function members(fk, key) {
  const out = [];
  for (let i = 0; i < fk.length; i++) if (fk[i][0] === key) out.push(i);
  return out;
}

/** 两趟最远点法求主轴端点，比 PCA 省事且够用 */
function axisOf(pts) {
  const m = mean(pts);
  let p1 = pts[0], best = -1;
  pts.forEach(function (p) { const d = len(sub(p, m)); if (d > best) { best = d; p1 = p; } });
  let p2 = pts[0]; best = -1;
  pts.forEach(function (p) { const d = len(sub(p, p1)); if (d > best) { best = d; p2 = p; } });
  return [p1, p2];
}

/** 把两段交界处的一圈面单独拿出来当关节区 */
function carve(res, cen, prox, dist, name, axes, side, band) {
  const ia = members(res.fk, prox + side), ib = members(res.fk, dist + side);
  if (ia.length < 24 || ib.length < 24) return;
  const ends = axisOf(ia.concat(ib).map(i => cen[i]));
  const ln = len(sub(ends[1], ends[0]));
  if (ln < 1e-6) return;
  const d = mul(sub(ends[1], ends[0]), 1 / ln);
  const t = i => dot(sub(cen[i], ends[0]), d) / ln;
  const avg = a => a.reduce((s, i) => s + t(i), 0) / a.length;
  const star = (avg(ia) + avg(ib)) / 2;
  const hit = ia.concat(ib).filter(i => Math.abs(t(i) - star) < band);
  if (hit.length < 12) return;
  const meta = [name + side, 'blob', side + name, side, { axes: axes, _dir: d }];
  res.metas[meta[0]] = meta;
  hit.forEach(function (i) { res.fk[i] = meta; });
}

/** 脚分成前脚掌和后脚跟两块，描述能精确到脚跟 / 足弓 */
function splitFoot(res, cen, side) {
  const idx = members(res.fk, 'foot' + side);
  if (idx.length < 40) return;
  const zs = idx.reduce((s, i) => s + cen[i][2], 0) / idx.length;
  const rear = ['footrear' + side, 'foot', side + '脚', side, { zone: 'rear' }];
  const fore = ['footfore' + side, 'foot', side + '脚', side, { zone: 'fore' }];
  res.metas[rear[0]] = rear;
  res.metas[fore[0]] = fore;
  delete res.metas['foot' + side];
  idx.forEach(function (i) { res.fk[i] = cen[i][2] >= zs ? fore : rear; });
}
/** 肢体的前后 / 侧向参考轴；轴向偏水平时侧向词换成上下（和 mesh-model.js 一致） */
function limbFrame(dv, s) {
  const d = norm(dv);
  let a = sub([0, 0, 1], mul(d, d[2]));
  if (dot(a, a) < 0.01) a = sub([0, 1, 0], mul(d, d[1]));
  a = norm(a);
  let l = norm(cross(d, a));
  const horiz = Math.abs(d[1]) < 0.5;
  if (horiz ? l[1] < 0 : l[0] * (s || 1) < 0) l = mul(l, -1);
  return { a: a, l: l, ax: horiz ? HORIZ_AXES : LIMB_AXES };
}

/** 手是扁的：薄的那个方向就是掌面法线，掌心朝身体中线一侧 */
function palmFrame(pts, m, d, s, thumb) {
  const f = limbFrame(d, s);
  const span = function (u) {
    let lo = 1e9, hi = -1e9;
    pts.forEach(function (p) {
      const v = dot(sub(p, m), u);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    });
    return hi - lo;
  };
  let nv = span(f.a) <= span(f.l) ? f.a : f.l;
  if (nv[0] * (s || 1) > 0) nv = mul(nv, -1);
  let t = null;
  if (thumb) {
    t = sub(thumb, m);
    t = sub(t, mul(nv, dot(t, nv)));
    t = sub(t, mul(d, dot(t, d)));
  }
  if (!t || len(t) < 1e-6) {
    t = cross(d, nv);
    if (t[2] < 0) t = mul(t, -1);
  }
  return { n: norm(nv), t: norm(t) };
}

function ext(pts, i, big) {
  let v = big ? -1e9 : 1e9;
  pts.forEach(function (p) { v = big ? Math.max(v, p[i]) : Math.min(v, p[i]); });
  return v;
}
/** 按 kind 反填一个区需要的坐标与参考轴，长度都已按身高归一化 */
function geom(meta, pts, torsoC, thumb) {
  const kind = meta[1], side = meta[3], extra = meta[4];
  const s = side === '左' ? 1 : (side === '右' ? -1 : 0);
  const r = { kind: kind, name: meta[2] };
  if (side) r.side = side;
  Object.keys(extra).forEach(function (k) { if (k[0] !== '_') r[k] = extra[k]; });
  const m = mean(pts);
  let d = extra._dir || null;

  if (kind === 'neck') {
    /* 颈部又短又宽，最远点法会横着量，直接按上下端定轴（和自动分区一致） */
    r.from = r5([m[0], ext(pts, 1, false), m[2]]);
    r.to = r5([m[0], ext(pts, 1, true), m[2]]);
    d = [0, 1, 0];
  } else if (kind === 'limb' || kind === 'finger' || kind === 'toe') {
    let e = axisOf(pts);
    if (len(sub(e[0], torsoC)) > len(sub(e[1], torsoC))) e = [e[1], e[0]];
    r.from = r5(e[0]);
    r.to = r5(e[1]);
    if (kind === 'finger' || kind === 'toe') r.tip = r5(e[1]);
    d = sub(e[1], e[0]);
  } else if (kind === 'head') {
    r.center = r5(m);
    r.chin = +ext(pts, 1, false).toFixed(5);
    r.top = 1;
    r.half = +((r.top - r.chin) * 0.5).toFixed(5);
    return r;
  } else if (kind === 'torso') {
    r.center = r5(m);
    return r;
  } else {
    r.center = r5(m);
    if (kind === 'foot') {
      r.zSpan = +Math.max((ext(pts, 2, true) - ext(pts, 2, false)) * 0.5, 0.008).toFixed(5);
      d = [0, -1, 0];
    } else if (kind === 'palm') {
      const e = axisOf(pts);
      const f = palmFrame(pts, m, norm(sub(e[1], e[0])), s, thumb);
      r.aVec = r5(f.n);
      r.lVec = r5(f.t);
      return r;
    } else if (kind === 'breast') {
      r.aVec = [0, 0, 1];
      r.lVec = [s || 1, 0, 0];
      return r;
    }
  }
  if (!d || len(d) < 1e-9) d = [0, -1, 0];
  const f = limbFrame(d, s);
  r.aVec = r5(f.a);
  r.lVec = r5(f.l);
  let axes = extra.axes;
  /* 轴向偏水平时侧向词要让给参考轴，和 mesh-model.js 的 segAxes 一致 */
  if (axes && f.ax === HORIZ_AXES) {
    axes = { aPos: axes.aPos, aNeg: axes.aNeg, lPos: f.ax.lPos, lNeg: f.ax.lNeg };
  }
  r.axes = axes || f.ax;
  return r;
}
function rankOf(key) {
  for (let i = 0; i < RANK.length; i++) if (key.indexOf(RANK[i]) === 0) return i;
  return RANK.length;
}

/** 顶点权重 → 分区表；返回 regions、每面区号和每区面数 */
function buildRegions(mesh, weights, nVerts, H) {
  const res = assign(mesh, vertexBones(weights, nVerts));
  const cen = centroids(mesh, H);
  ['左', '右', ''].forEach(function (side) {
    JOINTS.forEach(j => carve(res, cen, j[0], j[1], j[2], j[3], side, 0.085));
    splitFoot(res, cen, side);
  });

  const order = Object.keys(res.metas).sort(function (a, b) {
    return rankOf(a) - rankOf(b) || (a < b ? -1 : 1);
  });
  const ids = {}, pts = {};
  order.forEach(function (k, i) { ids[k] = i; pts[k] = []; });
  res.fk.forEach(function (m, i) { if (pts[m[0]]) pts[m[0]].push(cen[i]); });

  const torsoC = pts.torso.length ? mean(pts.torso) : [0, WAIST, 0];
  const thumb = {};
  ['左', '右', ''].forEach(function (s) {
    thumb[s] = pts['thumb' + s] && pts['thumb' + s].length ? mean(pts['thumb' + s]) : null;
  });
  const regions = order.map(function (k, i) {
    const meta = res.metas[k];
    const r = geom(meta, pts[k].length ? pts[k] : [torsoC], torsoC, thumb[meta[3]]);
    r.id = i;
    return r;
  });
  return {
    regions: regions,
    faces: res.fk.map(m => ids[m[0]]),
    counts: order.map(k => pts[k].length)
  };
}
/* ---------------- 写 GLB ---------------- */

function bounds(d, n) {
  const min = [1e30, 1e30, 1e30], max = [-1e30, -1e30, -1e30];
  for (let i = 0; i < d.length; i += n) {
    for (let k = 0; k < n; k++) {
      min[k] = Math.min(min[k], d[i + k]);
      max[k] = Math.max(max[k], d[i + k]);
    }
  }
  return { min: min.slice(0, n), max: max.slice(0, n) };
}

function writeGlb(file, mesh) {
  const views = [], accs = [], parts = [];
  let off = 0;

  function push(ta) {
    while (off % 4) { parts.push(Buffer.alloc(1)); off++; }
    const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
    views.push({ buffer: 0, byteOffset: off, byteLength: b.length });
    parts.push(b);
    off += b.length;
    return views.length - 1;
  }
  function acc(o) { accs.push(o); return accs.length - 1; }

  const n = mesh.pos.length / 3;
  const pb = bounds(mesh.pos, 3);
  const aPos = acc({ bufferView: push(mesh.pos), componentType: 5126, count: n,
    type: 'VEC3', min: pb.min, max: pb.max });
  const aNor = acc({ bufferView: push(mesh.nor), componentType: 5126, count: n, type: 'VEC3' });
  const aIdx = acc({ bufferView: push(mesh.tri), componentType: 5123,
    count: mesh.tri.length, type: 'SCALAR' });

  /* 形变位移大多只碰局部顶点，稀疏访问器能省掉大半体积；three r128 支持 */
  const targets = mesh.morphs.map(function (t) {
    const b = bounds(t.d, 3), hit = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(t.d[i * 3]) > 1e-4 || Math.abs(t.d[i * 3 + 1]) > 1e-4 ||
        Math.abs(t.d[i * 3 + 2]) > 1e-4) hit.push(i);
    }
    if (!hit.length || hit.length > n * 0.6) {
      return { POSITION: acc({ bufferView: push(t.d), componentType: 5126, count: n,
        type: 'VEC3', min: b.min, max: b.max }) };
    }
    const vals = new Float32Array(hit.length * 3);
    hit.forEach(function (v, k) {
      vals[k * 3] = t.d[v * 3];
      vals[k * 3 + 1] = t.d[v * 3 + 1];
      vals[k * 3 + 2] = t.d[v * 3 + 2];
    });
    const bi = push(Uint32Array.from(hit)), bv = push(vals);
    return { POSITION: acc({ componentType: 5126, count: n, type: 'VEC3',
      min: b.min, max: b.max,
      sparse: { count: hit.length, indices: { bufferView: bi, componentType: 5125 },
        values: { bufferView: bv } } }) };
  });
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: '2.0', generator: 'make-body-glb.js（网格来自 MakeHuman，CC0）' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'body' }],
    meshes: [{
      name: 'body',
      primitives: [{
        mode: 4,
        attributes: { POSITION: aPos, NORMAL: aNor },
        indices: aIdx,
        targets: targets
      }],
      weights: targets.map(() => 0),
      extras: { targetNames: mesh.morphs.map(t => t.name) }
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: accs
  };

  let js = Buffer.from(JSON.stringify(json), 'utf8');
  if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - js.length % 4, 0x20)]);  // 空格补齐
  let bn = bin;
  if (bn.length % 4) bn = Buffer.concat([bn, Buffer.alloc(4 - bn.length % 4)]);

  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0);                       // 'glTF'
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bn.length, 8);
  const h1 = Buffer.alloc(8), h2 = Buffer.alloc(8);
  h1.writeUInt32LE(js.length, 0); h1.writeUInt32LE(0x4E4F534A, 4);   // JSON
  h2.writeUInt32LE(bn.length, 0); h2.writeUInt32LE(0x004E4942, 4);   // BIN
  fs.writeFileSync(file, Buffer.concat([head, h1, js, h2, bn]));
  return { bytes: 12 + 8 + js.length + 8 + bn.length, sparse: accs.filter(a => a.sparse).length };
}
/* ---------------- 主流程 ---------------- */

function maxShift(d) {
  let m = 0;
  for (let i = 0; i < d.length; i += 3) {
    m = Math.max(m, Math.sqrt(d[i] * d[i] + d[i + 1] * d[i + 1] + d[i + 2] * d[i + 2]));
  }
  return m;
}

async function main() {
  const files = need();
  log('素材缓存目录：' + opt.cache);
  const raw = {};
  for (let i = 0; i < files.length; i++) {
    const had = fs.existsSync(path.join(opt.cache, files[i].replace(/[\/]/g, '_')));
    raw[files[i]] = await grab(files[i]).catch(e => die('取不到 ' + files[i] + '：' + e.message));
    if (!had) log('  下载 ' + files[i] + '（' + Math.round(raw[files[i]].length / 1024) + ' KB）');
  }

  const obj = parseObj(raw['3dobjs/base.obj']);
  const nVerts = obj.verts.length / 3;
  log('base.obj：顶点 ' + nVerts + '，body 四边形 ' + obj.quads.length);

  const tgt = {};
  files.forEach(function (f) { if (/\.target$/.test(f)) tgt[f] = parseTarget(raw[f]); });
  const cmp = compose(tgt, nVerts);
  const mesh = buildMesh(obj, cmp.base, cmp.morphs);
  let H = 0;
  for (let i = 1; i < mesh.pos.length; i += 3) H = Math.max(H, mesh.pos[i]);
  log('网格：顶点 ' + (mesh.pos.length / 3) + '，三角面 ' + (mesh.tri.length / 3) +
    '，身高 ' + H.toFixed(1) + ' cm');
  mesh.morphs.forEach(function (t) {
    log('  形变 ' + t.name.padEnd(10) + ' 最大位移 ' + maxShift(t.d).toFixed(2) +
      ' cm，抽掉的身高变化 ' + t.dH.toFixed(1) + ' cm');
  });

  const out = path.resolve(opt.out);
  fs.mkdirSync(out, { recursive: true });
  const glb = path.join(out, 'body.glb');
  const info = writeGlb(glb, mesh);
  log('已写出 ' + glb + '（' + Math.round(info.bytes / 1024) + ' KB，' +
    info.sparse + ' 个稀疏访问器）');
  if (!opt.regions) return;

  const weights = JSON.parse(raw['rigs/default_weights.mhw']).weights;
  const rg = buildRegions(mesh, weights, nVerts, H);
  if (rg.faces.length !== mesh.tri.length / 3) {
    die('分区表面数 ' + rg.faces.length + ' 和网格 ' + (mesh.tri.length / 3) + ' 不一致');
  }
  log('分区结果：');
  rg.regions.forEach(function (r, i) {
    log('  ' + String(i).padStart(2) + ' ' + r.kind.padEnd(7) + ' ' +
      r.name.padEnd(6) + ' ' + String(rg.counts[i]).padStart(6) + ' 面');
  });

  const data = { version: 1, rotateY: 0, regions: rg.regions, triangles: rg.faces.length };
  if (rg.regions.length > 255) data.faces = rg.faces;
  else data.facesB64 = Buffer.from(Uint8Array.from(rg.faces)).toString('base64');
  const spec = path.join(out, 'body-regions.json');
  fs.writeFileSync(spec, JSON.stringify(data, null, 1), 'utf8');
  log('已写出 ' + spec + '（' + rg.regions.length + ' 个区，' +
    Math.round(fs.statSync(spec).size / 1024) + ' KB）');
}

main().catch(e => die(e && e.stack ? e.stack : String(e)));
