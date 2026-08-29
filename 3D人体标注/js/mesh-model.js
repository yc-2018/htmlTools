/* mesh-model.js —— 用外部人体网格(GLB)作为模型源
   对外接口与 body-model.js 保持一致：
     MeshModel.load(cb)      异步加载并缓存资源
     MeshModel.build(params) → { group, parts, wear, materials, height, landmarks }
   资源放在 3D人体标注/assets/ 下，格式说明见 assets/README.md */
(function () {
  'use strict';

  var V = THREE.Vector3;
  var DIR = './assets/';
  var GLB = DIR + 'body.glb';
  var SPEC = DIR + 'body-regions.json';

  /* 规范 morph 名；GLB 里没有的直接忽略，不报错 */
  var MORPHS = ['female', 'fatUp', 'fatDown', 'bustUp', 'bustDown',
    'waistUp', 'waistDown', 'hipUp', 'hipDown', 'muscleUp'];

  var cache = null;
  var queue = null;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function L() { return window.BodyModel.L; }

  /* ---------------- 资源加载 ---------------- */

  function firstMesh(root) {
    var found = null;
    root.traverse(function (o) {
      if (!found && o.isMesh && o.geometry && o.geometry.attributes.position) found = o;
    });
    return found;
  }

  /** 分区表是可选的，读不到就走自动分区 */
  function fetchSpec(cb) {
    if (!window.fetch) { cb(null); return; }
    fetch(SPEC).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(cb).catch(function () { cb(null); });
  }

  /** 只加载一次；加载中重复调用共用同一次请求 */
  function load(cb) {
    if (cache) { cb(null, cache); return; }
    if (queue) { queue.push(cb); return; }
    queue = [cb];

    function done(err, data) {
      var qs = queue;
      queue = null;
      if (!err) cache = data;
      qs.forEach(function (f) { f(err, data); });
    }

    if (!THREE.GLTFLoader) { done('缺少 vendor/GLTFLoader-r128.js'); return; }
    new THREE.GLTFLoader().load(GLB, function (gltf) {
      var mesh = firstMesh(gltf.scene);
      if (!mesh) { done('GLB 里没有找到网格'); return; }
      fetchSpec(function (spec) {
        try {
          done(null, prepare(mesh, spec || {}));
        } catch (e) {
          done('解析失败：' + (e && e.message ? e.message : e));
        }
      });
    }, null, function (e) {
      /* 有些静态托管（EdgeOne Pages、Netlify 这类）对缺失的文件不返回 404，
         而是回一张首页 HTML，于是这里拿到的是网页而不是 GLB，报错长得像 JSON 解析失败 */
      var m = e && e.message ? e.message : '';
      done(/JSON|magic|Unexpected/i.test(m)
        ? GLB + ' 返回的不是 GLB（服务器可能用首页顶替了缺失的文件），请确认文件已放进 assets/'
        : '读不到 ' + GLB + '，请先按 assets/README.md 放好资源（file:// 下需用本地服务器打开）');
    });
  }
  /* ---------------- 预处理：摆正、落地、量身高 ---------------- */

  /** 用腰部一条窄带估计身体中轴的 z，免得拿鼻尖和脚跟去算中心 */
  function axisZ(geo, H) {
    var pos = geo.attributes.position;
    var y0 = (L().waist - 0.03) * H, y1 = (L().waist + 0.03) * H;
    var lo = 1e9, hi = -1e9;
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i);
      if (y < y0 || y > y1 || Math.abs(pos.getX(i)) > H * 0.06) continue;
      lo = Math.min(lo, pos.getZ(i));
      hi = Math.max(hi, pos.getZ(i));
    }
    return lo > hi ? 0 : (lo + hi) / 2;
  }

  /** 只按顶点本身求包围盒：geo.computeBoundingBox() 会把形变目标的极值也算进去，
      拿它量身高会把「最胖 + 最高」的那个虚拟外壳当成人，身高和落地都会偏 */
  function bboxOf(geo) {
    return new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
  }

  /** 把网格烘成「脚在 y=0、左右前后居中、单位 cm」的静态几何 */
  function prepare(mesh, spec) {
    mesh.updateWorldMatrix(true, false);
    var geo = mesh.geometry;
    geo.applyMatrix4(mesh.matrixWorld);
    if (spec.rotateY) geo.rotateY(spec.rotateY * Math.PI / 180);

    var bb = bboxOf(geo);
    /* 单位自动识别：整体高度小于 3 就当成米 */
    if (bb.max.y - bb.min.y < 3) {
      geo.scale(100, 100, 100);
      bb = bboxOf(geo);
    }
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0);
    var H = bboxOf(geo).max.y;
    /* 中轴按腰部估，直接用包围盒中点会被鼻尖和脚跟带偏 */
    geo.translate(0, 0, -axisZ(geo, H));
    geo.computeBoundingBox();        // 这一份留给 three 做视锥剔除和射线预筛，含形变余量正好
    geo.computeBoundingSphere();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.userData.shared = true;      // 多次 build 复用，main.js 的 dispose 要跳过

    var out = {
      geo: geo,
      height: H,
      tri: (geo.index ? geo.index.count : geo.attributes.position.count) / 3,
      morph: morphIndex(geo, mesh)
    };
    regionsOf(out, spec);
    out.bands = wearSpans(out);
    return out;
  }

  /** morph 名 → 索引。没写名字的 GLB 按 MORPHS 顺序对应 */
  function morphIndex(geo, mesh) {
    var count = geo.morphAttributes.position ? geo.morphAttributes.position.length : 0;
    var dict = mesh.morphTargetDictionary;
    var map = {};
    var named = 0;
    MORPHS.forEach(function (k) {
      if (dict && dict[k] != null) { map[k] = dict[k]; named++; }
    });
    if (!named) {
      MORPHS.forEach(function (k, i) { if (i < count) map[k] = i; });
    }
    return { dict: map, count: count };
  }
  /* ---------------- 分区：三角面索引 → 部位元数据 ---------------- */

  var LIMB_AXES = { aPos: '前面', aNeg: '后面', lPos: '外侧', lNeg: '内侧' };

  /** 优先用分区表；面数不符或没有表就按几何自动分区 */
  function regionsOf(out, spec) {
    var faces = spec.faces || (spec.facesB64 ? unpack(spec.facesB64) : null);
    if (spec.regions && faces && faces.length === out.tri) {
      out.regions = spec.regions.map(function (r) { return scaleRegion(r, out.height); });
      out.faceMap = faces;
    } else {
      if (spec.regions) console.warn('body-regions.json 的面数与 GLB 不符，改用自动分区');
      autoRegions(out);
    }
    out.landmarks = landmarksOf(out);
  }

  /** facesB64：每面一字节的区号，base64 编码 */
  function unpack(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /** 分区表里的长度都按身高归一化存放，这里还原成 cm */
  function scaleRegion(r, H) {
    var o = {
      kind: r.kind, name: r.name, side: r.side, axes: r.axes || LIMB_AXES,
      t0: r.t0 || '靠近上端', t1: r.t1 || '靠近下端', zone: r.zone, noFacing: r.noFacing
    };
    ['from', 'to', 'center', 'tip', 'ext'].forEach(function (k) {
      if (r[k]) o[k] = new V(r[k][0] * H, r[k][1] * H, r[k][2] * H);
    });
    ['aVec', 'lVec'].forEach(function (k) {
      o[k] = r[k] ? new V(r[k][0], r[k][1], r[k][2]).normalize() : null;
    });
    if (!o.aVec) o.aVec = new V(0, 0, 1);
    if (!o.lVec) o.lVec = new V(r.side === '右' ? -1 : 1, 0, 0);
    ['zSpan', 'half', 'top', 'chin'].forEach(function (k) {
      if (r[k] != null) o[k] = r[k] * H;
    });
    return o;
  }
  /* ---------------- 没有分区表时的几何自动分区 ---------------- */

  var ARM_SEG = [
    { hi: 0.40, kind: 'limb', name: '上臂', t0: '靠近肩部', t1: '靠近肘部' },
    { hi: 0.46, kind: 'blob', name: '肘', axes: { aPos: '肘窝(前面)', aNeg: '肘尖(后面)', lPos: '外侧', lNeg: '内侧' } },
    { hi: 0.71, kind: 'limb', name: '前臂', t0: '靠近肘部', t1: '靠近腕部' },
    { hi: 0.77, kind: 'blob', name: '腕', axes: { aPos: '掌侧(手心一侧)', aNeg: '背侧(手背一侧)', lPos: '拇指一侧', lNeg: '小指一侧' } },
    { hi: 9, kind: 'palm', name: '手' }
  ];

  /* 腿按身高比例切段（A 型/T 型姿势下腿都是竖直的），hi 为上界 */
  var LEG_SEG = [
    { hi: 0.043, kind: 'foot', name: '脚' },
    { hi: 0.075, kind: 'blob', name: '踝', axes: { aPos: '踝前方', aNeg: '跟腱(后面)', lPos: '外踝', lNeg: '内踝' } },
    { hi: 0.255, kind: 'limb', name: '小腿', t0: '靠近膝部', t1: '靠近脚踝' },
    { hi: 0.315, kind: 'blob', name: '膝', axes: { aPos: '膝盖前面(髌骨)', aNeg: '膝后(腘窝)', lPos: '外侧', lNeg: '内侧' } },
    { hi: 9, kind: 'limb', name: '大腿', t0: '靠近大腿根部', t1: '靠近膝部' }
  ];

  /** 逐面取质心，后面所有归类都基于质心 */
  function centroids(geo, tri) {
    var pos = geo.attributes.position;
    var idx = geo.index;
    var out = new Float32Array(tri * 3);
    var v = new V();
    for (var i = 0; i < tri; i++) {
      var x = 0, y = 0, z = 0;
      for (var k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i * 3 + k) : i * 3 + k);
        x += v.x; y += v.y; z += v.z;
      }
      out[i * 3] = x / 3;
      out[i * 3 + 1] = y / 3;
      out[i * 3 + 2] = z / 3;
    }
    return out;
  }
  /* 量不出空隙时的兜底半宽（占身高比例，按高度分段） */
  function defWidth(f) {
    var t = [[0.50, 0.105], [0.56, 0.100], [0.64, 0.092], [0.72, 0.100], [0.80, 0.115]];
    for (var i = 0; i < t.length; i++) if (f <= t[i][0]) return t[i][1];
    return 0.125;
  }

  /** 逐层量躯干的横向半宽（按身高归一化），用来把手臂和躯干分开：
      从中线沿 |x| 往外走，遇到明显空隙就认为到了手臂；
      腋下附近两者连在一起量不出空隙，就以腰部那层为基准向上下限幅，避免一路量到指尖 */
  function torsoWidth(geo, H) {
    var pos = geo.attributes.position;
    var F0 = 0.44, F1 = 0.90, N = 20, GAP = 0.014;
    var df = (F1 - F0) / N;
    var lay = [], w = [], i, k;
    for (k = 0; k < N; k++) lay.push([]);
    for (i = 0; i < pos.count; i++) {
      var f = pos.getY(i) / H;
      if (f < F0 || f >= F1) continue;
      lay[Math.floor((f - F0) / df)].push(Math.abs(pos.getX(i)) / H);
    }
    for (k = 0; k < N; k++) {
      var xs = lay[k].sort(function (a, b) { return a - b; });
      var lim = 0;
      for (i = 0; i < xs.length; i++) {
        if (xs[i] - lim > GAP) break;
        lim = xs[i];
      }
      lim += GAP * 0.5;
      /* 走不出宽度说明这层网格太稀，空隙判据失效，用兜底值 */
      w.push(lim < 0.05 ? defWidth(F0 + (k + 0.5) * df) : Math.min(lim, 0.16));
    }
    var mid = Math.min(N - 1, Math.max(0, Math.floor((L().waist - F0) / df)));
    for (k = mid + 1; k < N; k++) w[k] = Math.min(w[k], w[k - 1] * 1.15);
    for (k = mid - 1; k >= 0; k--) w[k] = Math.min(w[k], w[k + 1] * 1.15);
    return { f0: F0, df: df, n: N, w: w };
  }

  function widthAt(prof, f) {
    var k = Math.floor((f - prof.f0) / prof.df);
    return prof.w[Math.min(prof.n - 1, Math.max(0, k))];
  }

  /** 一组三角面的质心均值与包围范围 */
  function stats(cen, grp, g) {
    var mean = new V(), min = new V(1e9, 1e9, 1e9), max = new V(-1e9, -1e9, -1e9), n = 0;
    for (var i = 0; i < grp.length; i++) {
      if (grp[i] !== g) continue;
      var x = cen[i * 3], y = cen[i * 3 + 1], z = cen[i * 3 + 2];
      mean.x += x; mean.y += y; mean.z += z;
      min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
      n++;
    }
    mean.divideScalar(n || 1);
    return { n: n, mean: mean, min: min, max: max };
  }

  /** 肢体的前后 / 侧向参考轴；轴向偏水平时（T 型姿势的手臂）侧向换成上下 */
  function limbFrame(dir, s) {
    var d = dir.clone().normalize();
    var aVec = new V(0, 0, 1).addScaledVector(d, -d.z);
    if (aVec.lengthSq() < 0.01) aVec.set(0, 1, 0).addScaledVector(d, -d.y);
    aVec.normalize();
    var lVec = new V().crossVectors(d, aVec).normalize();
    var horiz = Math.abs(d.y) < 0.5;
    if (horiz ? lVec.y < 0 : lVec.x * s < 0) lVec.negate();
    return {
      aVec: aVec, lVec: lVec,
      axes: horiz ? { aPos: '前面', aNeg: '后面', lPos: '上面', lNeg: '下面' } : LIMB_AXES
    };
  }

  /** 手臂：以「离躯干最近处 → 离它最远处」定轴，A 型与 T 型姿势都成立 */
  function armAxis(cen, grp, g, H) {
    var i, near = 1e9;
    for (i = 0; i < grp.length; i++) {
      if (grp[i] === g) near = Math.min(near, Math.abs(cen[i * 3]));
    }
    var from = new V(), n = 0;
    for (i = 0; i < grp.length; i++) {
      if (grp[i] !== g || Math.abs(cen[i * 3]) > near + H * 0.02) continue;
      from.x += cen[i * 3]; from.y += cen[i * 3 + 1]; from.z += cen[i * 3 + 2];
      n++;
    }
    if (!n) return null;
    from.divideScalar(n);
    var far = -1, to = from.clone(), p = new V();
    for (i = 0; i < grp.length; i++) {
      if (grp[i] !== g) continue;
      p.set(cen[i * 3], cen[i * 3 + 1], cen[i * 3 + 2]);
      var d = p.distanceToSquared(from);
      if (d > far) { far = d; to.copy(p); }
    }
    var len = Math.sqrt(Math.max(far, 1e-6));
    return { from: from, to: to, len: len, dir: to.clone().sub(from).divideScalar(len) };
  }
  /* 段落自带的方位词更准（肘窝/拇指侧），但轴向偏水平时侧向词要让给参考轴 */
  function segAxes(seg, fr) {
    if (!seg.axes) return fr.axes;
    if (fr.axes === LIMB_AXES) return seg.axes;
    return { aPos: seg.axes.aPos, aNeg: seg.axes.aNeg, lPos: fr.axes.lPos, lNeg: fr.axes.lNeg };
  }

  /** 建一个区；没给的量（中心、端点）留给 finish() 按实际面反填 */
  function mkRegion(seg, sn, fr, extra) {
    var r = {
      kind: seg.kind, name: sn + (seg.name || ''), side: sn,
      aVec: fr.aVec.clone(), lVec: fr.lVec.clone(), axes: segAxes(seg, fr)
    };
    if (seg.kind === 'limb') { r.t0 = seg.t0; r.t1 = seg.t1; }
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  /** 反填中心 / 端点 / 头顶下巴 / 脚的前后跨度 */
  function finish(reg, faces, cen, H) {
    for (var id = 0; id < reg.length; id++) {
      var r = reg[id];
      var s = stats(cen, faces, id);
      r.faceCount = s.n;
      if (!r.center) r.center = s.mean.clone();
      if (r.kind === 'head') {
        r.chin = s.n ? s.min.y : L().chin * H;
        r.top = H;
        r.half = (r.top - r.chin) * 0.5;
      } else if (r.kind === 'foot') {
        r.zSpan = Math.max((s.max.z - s.min.z) * 0.5, H * 0.008);
      } else if ((r.kind === 'limb' || r.kind === 'neck') && !r.from) {
        r.from = new V(s.mean.x, s.n ? s.max.y : 0, s.mean.z);
        r.to = new V(s.mean.x, s.n ? s.min.y : 0, s.mean.z);
        if (r.kind === 'neck') { var t = r.from; r.from = r.to; r.to = t; }
      }
    }
  }
  /** 按几何位置把每个三角面归到部位，精度不如分区表，但零配置可用 */
  function autoRegions(out) {
    var H = out.height, Lm = L(), tri = out.tri;
    var cen = centroids(out.geo, tri);
    var prof = torsoWidth(out.geo, H);
    var grp = new Uint8Array(tri);   // 0躯干 1头 2颈 3左臂 4右臂 5左腿 6右腿
    var i;
    for (i = 0; i < tri; i++) {
      var x = cen[i * 3] / H, y = cen[i * 3 + 1] / H, ax = Math.abs(x);
      grp[i] = y >= Lm.chin ? 1
        : (y >= Lm.neck && ax < 0.10) ? 2
          : (ax > widthAt(prof, y) && y > 0.20 && y < 0.875) ? (x > 0 ? 3 : 4)
            : y < Lm.crotch ? (x >= 0 ? 5 : 6) : 0;
    }

    var mid = { aVec: new V(0, 0, 1), lVec: new V(1, 0, 0), axes: LIMB_AXES };
    var reg = [
      mkRegion({ kind: 'torso', name: '躯干' }, '', mid),
      mkRegion({ kind: 'head', name: '头部' }, '', mid),
      mkRegion({ kind: 'neck', name: '颈部' }, '', mid)
    ];
    var faces = new Uint8Array(tri);
    for (i = 0; i < tri; i++) if (grp[i] === 1 || grp[i] === 2) faces[i] = grp[i];

    [[3, '左', 1], [4, '右', -1]].forEach(function (a) {
      var axis = armAxis(cen, grp, a[0], H);
      if (!axis) return;
      var fr = limbFrame(axis.dir, a[2]);
      var lo = 0;
      var ids = ARM_SEG.map(function (seg) {
        var hi = Math.min(seg.hi, 1);
        function at(t) { return axis.from.clone().addScaledVector(axis.dir, axis.len * t); }
        reg.push(mkRegion(seg, a[1], fr, seg.kind === 'limb'
          ? { from: at(lo), to: at(hi) } : { center: at((lo + hi) / 2) }));
        lo = seg.hi;
        return reg.length - 1;
      });
      var p = new V();
      for (var j = 0; j < tri; j++) {
        if (grp[j] !== a[0]) continue;
        p.set(cen[j * 3], cen[j * 3 + 1], cen[j * 3 + 2]).sub(axis.from);
        var t = p.dot(axis.dir) / axis.len;
        for (var k = 0; k < ARM_SEG.length; k++) {
          if (t <= ARM_SEG[k].hi) { faces[j] = ids[k]; break; }
        }
      }
    });
    legRegions(reg, faces, cen, grp, H);
    finish(reg, faces, cen, H);
    out.regions = reg;
    out.faceMap = faces;
  }
  /** 腿在两种姿势下都是竖直的，直接按身高比例切段；脚再按前后分两块 */
  function legRegions(reg, faces, cen, grp, H) {
    var tri = faces.length;
    [[5, '左', 1], [6, '右', -1]].forEach(function (a) {
      var fr = limbFrame(new V(0, -1, 0), a[2]);
      var i, footZ = 0, fn = 0;
      for (i = 0; i < tri; i++) {
        if (grp[i] === a[0] && cen[i * 3 + 1] / H <= LEG_SEG[0].hi) { footZ += cen[i * 3 + 2]; fn++; }
      }
      footZ = fn ? footZ / fn : 0;

      var ids = LEG_SEG.map(function (seg) {
        if (seg.kind !== 'foot') {
          reg.push(mkRegion(seg, a[1], fr));
          return reg.length - 1;
        }
        return ['rear', 'fore'].map(function (z) {
          reg.push(mkRegion(seg, a[1], fr, { zone: z }));
          return reg.length - 1;
        });
      });

      for (i = 0; i < tri; i++) {
        if (grp[i] !== a[0]) continue;
        var y = cen[i * 3 + 1] / H;
        for (var k = 0; k < LEG_SEG.length; k++) {
          if (y > LEG_SEG[k].hi) continue;
          faces[i] = k ? ids[k] : ids[0][cen[i * 3 + 2] >= footZ ? 1 : 0];
          break;
        }
      }
    });
  }

  /** focusOn 用的观察点 */
  function landmarksOf(out) {
    var H = out.height;
    var lm = { torso: new V(0, L().waist * H, 0) };
    out.regions.forEach(function (r) {
      if (!r.center) return;
      if (r.kind === 'head') lm.head = r.center.clone();
      if (r.kind === 'palm') lm[r.side === '右' ? 'handR' : 'handL'] = r.center.clone();
      if (r.kind === 'foot' && r.zone !== 'fore') {
        lm[r.side === '右' ? 'footR' : 'footL'] = r.center.clone();
      }
    });
    if (!lm.head) lm.head = new V(0, H * 0.93, 0);
    return lm;
  }
  /* ---------------- 内衣带（私密部位遮挡） ---------------- */

  var RING_SEG = 40;

  /** 采样一段高度里的横截面半轴；只取躯干那些面的顶点，手臂就撑不宽带子 */
  function sampleBand(out, f0, f1, steps) {
    var geo = out.geo, H = out.height;
    var pos = geo.attributes.position, idx = geo.index;
    var y0 = f0 * H, y1 = f1 * H, dy = (y1 - y0) / steps;
    var a = [], bF = [], bB = [], i, k, t, c;
    for (i = 0; i <= steps; i++) { a.push(0); bF.push(0); bB.push(0); }
    for (t = 0; t < out.tri; t++) {
      var r = out.regions[out.faceMap[t]];
      if (!r || r.kind !== 'torso') continue;
      for (c = 0; c < 3; c++) {
        var vi = idx ? idx.getX(t * 3 + c) : t * 3 + c;
        var y = pos.getY(vi);
        if (y < y0 || y > y1) continue;
        var x = pos.getX(vi), z = pos.getZ(vi);
        k = Math.round((y - y0) / dy);
        a[k] = Math.max(a[k], Math.abs(x));
        if (z >= 0) bF[k] = Math.max(bF[k], z); else bB[k] = Math.max(bB[k], -z);
      }
    }
    /* 采样不到的层用邻层补，否则带子上会出现半径为 0 的细腰 */
    var ok = 0;
    for (k = 0; k <= steps; k++) if (a[k] > 0) ok++;
    if (ok < 2) return null;
    fill(a); fill(bF); fill(bB);
    return { y0: y0, dy: dy, steps: steps, a: a, bF: bF, bB: bB };
  }

  function fill(arr) {
    var i, last = 0;
    for (i = 0; i < arr.length; i++) { if (arr[i] > 0) last = arr[i]; else arr[i] = last; }
    for (i = arr.length - 1; i >= 0; i--) { if (arr[i] > 0) last = arr[i]; else arr[i] = last; }
  }

  function wearSpans(out) {
    var Lm = L();
    return {
      brief: sampleBand(out, Lm.crotch - 0.030, Lm.hip + 0.030, 8),
      bust: sampleBand(out, Lm.underbust + 0.004, Lm.bust + 0.030, 6)
    };
  }
  /** 一圈超椭圆点，前后深度可以不同 */
  function ring(y, a, bF, bB, n) {
    var pts = [], e = 2 / n;
    for (var i = 0; i < RING_SEG; i++) {
      var t = i / RING_SEG * Math.PI * 2;
      var c = Math.cos(t), s = Math.sin(t);
      var d = s >= 0 ? bF : bB;
      pts.push(new V(
        a * Math.sign(c) * Math.pow(Math.abs(c), e),
        y,
        d * Math.sign(s) * Math.pow(Math.abs(s), e)
      ));
    }
    return pts;
  }

  /** 把采样出来的若干圈缝成一根开口筒，稍微放大避免和皮肤穿插 */
  function bandMesh(span, mat) {
    var rings = [], i, j;
    for (i = 0; i <= span.steps; i++) {
      rings.push(ring(span.y0 + span.dy * i,
        span.a[i] * 1.035, span.bF[i] * 1.035, span.bB[i] * 1.035, 2.3));
    }
    var vert = [], idx = [];
    rings.forEach(function (r) {
      r.forEach(function (p) { vert.push(p.x, p.y, p.z); });
    });
    for (i = 0; i + 1 < rings.length; i++) {
      for (j = 0; j < RING_SEG; j++) {
        var j2 = (j + 1) % RING_SEG;
        var a0 = i * RING_SEG + j, b0 = i * RING_SEG + j2;
        idx.push(a0, a0 + RING_SEG, b0 + RING_SEG, a0, b0 + RING_SEG, b0);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vert, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, mat);
    mesh.raycast = function () {};
    return mesh;
  }
  /* ---------------- 形体参数 → morph 权重 ---------------- */

  /** 一对增减 morph：正差值给 Up，负差值给 Down */
  function axis(w, key, d, span) {
    var t = clamp(d / span, -1, 1);
    w[key + 'Up'] = Math.max(0, t);
    w[key + 'Down'] = Math.max(0, -t);
  }

  /** 以 autoGirth 给出的「同身高体重的常规三围」为中位，三围差值驱动 morph */
  function weights(p) {
    var g = window.BodyModel.autoGirth(p.gender, p.height, p.weight);
    var bmi = p.weight / Math.pow(p.height / 100, 2);
    var f = clamp((bmi - 21.5) / 10, -1, 1);
    var w = {
      female: p.gender === 'female' ? 1 : (p.gender === 'neutral' ? 0.5 : 0),
      fatUp: Math.max(0, f),
      fatDown: Math.max(0, -f)
    };
    axis(w, 'bust', p.bust - g.bust, 14);
    axis(w, 'waist', p.waist - g.waist, 16);
    axis(w, 'hip', p.hip - g.hip, 14);
    return w;
  }

  function applyMorph(mesh, ref, p) {
    if (!ref.morph.count || !mesh.morphTargetInfluences) return;
    var w = weights(p);
    var inf = mesh.morphTargetInfluences;
    for (var i = 0; i < inf.length; i++) inf[i] = 0;
    Object.keys(w).forEach(function (key) {
      var j = ref.morph.dict[key];
      if (j != null && j < inf.length) inf[j] = clamp(w[key], 0, 1);
    });
  }

  /** 区里的长度量按身高比例缩放；方向向量是只读的，可以共用 */
  function scaled(r, k) {
    var o = {};
    Object.keys(r).forEach(function (key) { o[key] = r[key]; });
    ['from', 'to', 'center', 'tip', 'ext'].forEach(function (key) {
      if (r[key]) o[key] = r[key].clone().multiplyScalar(k);
    });
    ['zSpan', 'half', 'top', 'chin'].forEach(function (key) {
      if (r[key] != null) o[key] = r[key] * k;
    });
    return o;
  }
  /* ---------------- 组装 ---------------- */

  /** 与 BodyModel.build 同签名同返回结构，main.js 可以直接换源 */
  function build(p) {
    var ref = cache;
    if (!ref) throw new Error('外部模型还没加载完，先调用 MeshModel.load');

    /* 身高用整体缩放实现；morph 只管胖瘦与三围 */
    var k = p.height / ref.height;
    var MAT = {
      skin: new THREE.MeshStandardMaterial({
        color: 0xdccfc2, roughness: 0.66, metalness: 0.02,
        morphTargets: true, morphNormals: true
      }),
      wear: new THREE.MeshStandardMaterial({
        color: 0x59616e, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide
      })
    };

    var group = new THREE.Group();
    group.scale.setScalar(k);

    var mesh = new THREE.Mesh(ref.geo, MAT.skin);
    applyMorph(mesh, ref, p);
    var regions = ref.regions.map(function (r) { return scaled(r, k); });
    mesh.userData.regions = regions;
    mesh.userData.faceMap = ref.faceMap;
    mesh.userData.region = regions[0];    // 查不到面时的兜底
    group.add(mesh);

    var wear = [];
    if (ref.bands.brief) wear.push(bandMesh(ref.bands.brief, MAT.wear));
    if (p.gender !== 'male' && ref.bands.bust) wear.push(bandMesh(ref.bands.bust, MAT.wear));
    wear.forEach(function (m) { group.add(m); });

    var landmarks = {};
    Object.keys(ref.landmarks).forEach(function (key) {
      landmarks[key] = ref.landmarks[key].clone().multiplyScalar(k);
    });
    group.updateMatrixWorld(true);

    return {
      group: group, parts: [mesh], wear: wear, materials: MAT,
      height: p.height, landmarks: landmarks, L: L()
    };
  }

  window.MeshModel = { load: load, build: build, ready: function () { return !!cache; } };
})();
