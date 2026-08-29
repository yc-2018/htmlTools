/* body-model.js —— 按性别 / 身高 / 体重 / 三围参数化生成人体网格
 * 世界坐标单位 = 厘米；脚底 y=0；人体面朝 +Z；人体自身左侧 = +X
 */
(function () {
  'use strict';

  var V = THREE.Vector3;
  var AXIS_Y = new V(0, 1, 0);
  var AXIS_Z = new V(0, 0, 1);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /** 由围度(cm)与截面「深/宽」比，求椭圆截面的半宽 a 与半深 b */
  function girth(c, k) {
    var rm = c / (Math.PI * 2);
    var a = rm * Math.sqrt(2 / (1 + k * k));
    return { a: a, b: k * a };
  }

  /** 依据性别 / 身高 / 体重推算三围参考值 */
  function autoGirth(gender, height, weight) {
    var bmi = weight / Math.pow(height / 100, 2);
    var hk = 0.58 + 0.42 * (height / 170);
    var t = gender === 'female'
      ? { b: 2.00 * bmi + 42, w: 2.35 * bmi + 17, h: 2.10 * bmi + 50 }
      : gender === 'neutral'
        ? { b: 2.10 * bmi + 41, w: 2.34 * bmi + 21, h: 2.00 * bmi + 50 }
        : { b: 2.20 * bmi + 40, w: 2.32 * bmi + 25, h: 1.90 * bmi + 51 };
    return {
      bust: Math.round(t.b * hk),
      waist: Math.round(t.w * hk),
      hip: Math.round(t.h * hk)
    };
  }

  /** 各部位相对身高的比例系数 */
  function props(g) {
    var f = g === 'female', n = g === 'neutral';
    return {
      shoulderW: f ? 0.223 : (n ? 0.235 : 0.246),
      neckR: f ? 0.030 : 0.034,
      upperArmR: f ? 0.027 : 0.030,
      elbowR: f ? 0.024 : 0.026,
      foreR: f ? 0.024 : 0.026,
      wristR: f ? 0.015 : 0.017,
      thighR: f ? 0.054 : 0.052,
      kneeR: f ? 0.035 : 0.037,
      calfR: f ? 0.029 : 0.031,
      ankleR: f ? 0.019 : 0.021,
      chestK: f ? 0.76 : 0.72,
      waistK: 0.75,
      hipK: f ? 0.80 : 0.76,
      abduct: f ? 0.62 : 0.66
    };
  }

  /* 纵向标志点（占身高比例） */
  var L = {
    top: 1.000, chin: 0.868, neck: 0.816, shoulder: 0.806, armpit: 0.758,
    bust: 0.715, underbust: 0.668, waist: 0.616, iliac: 0.576,
    hip: 0.520, crotch: 0.482, knee: 0.285, ankle: 0.043
  };
  /* ---------------- 几何工具 ---------------- */

  /** 以 dir 为局部 +Y 轴，ref 为局部 +Z 参考方向，构造正交基 */
  function frame(dir, ref) {
    var y = dir.clone().normalize();
    var r = (ref || AXIS_Z).clone();
    if (Math.abs(y.dot(r)) > 0.96) r = Math.abs(y.dot(AXIS_Y)) > 0.96 ? AXIS_Z.clone() : AXIS_Y.clone();
    var z = r.sub(y.clone().multiplyScalar(y.dot(r))).normalize();
    var x = new V().crossVectors(y, z);
    return { x: x, y: y, z: z };
  }

  function applyFrame(obj, f) {
    var m = new THREE.Matrix4().makeBasis(f.x, f.y, f.z);
    obj.quaternion.setFromRotationMatrix(m);
  }

  /** 圆锥台状肢体，沿 from→to 生成，可选圆头与轮廓函数 */
  function tube(from, to, r0, r1, opt) {
    opt = opt || {};
    var len = from.distanceTo(to);
    var steps = opt.steps || 8;
    var pts = [];
    var i, a, r;
    if (opt.round0) {
      for (i = 0; i <= 4; i++) {
        a = (i / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector2(Math.max(0.002, r0 * Math.sin(a)), -0.85 * r0 * Math.cos(a)));
      }
    } else {
      pts.push(new THREE.Vector2(0.002, 0));
    }
    for (i = 0; i <= steps; i++) {
      if (i === 0 && opt.round0) continue;
      var t = i / steps;
      r = (r0 + (r1 - r0) * t) * (opt.profile ? opt.profile(t) : 1);
      pts.push(new THREE.Vector2(Math.max(0.002, r), t * len));
    }
    if (opt.round1) {
      for (i = 1; i <= 4; i++) {
        a = (i / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector2(Math.max(0.002, r1 * Math.cos(a)), len + 0.85 * r1 * Math.sin(a)));
      }
    } else {
      pts.push(new THREE.Vector2(0.002, len));
    }
    var mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, opt.seg || 18));
    mesh.position.copy(from);
    applyFrame(mesh, frame(to.clone().sub(from), opt.ref));
    return mesh;
  }
  /** 球体（可按局部基与三轴缩放做成椭球） */
  function blob(center, r, f, scale) {
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14));
    mesh.position.copy(center);
    if (f) applyFrame(mesh, f);
    if (scale) mesh.scale.set(scale.x, scale.y, scale.z);
    return mesh;
  }

  /** 由一组截面环放样成躯干；环需按 y 从低到高排列 */
  function loft(rings, seg, capBottom, capTop) {
    var pos = [], idx = [];
    var i, j, t, s, c, e, x, z, d, r;
    for (i = 0; i < rings.length; i++) {
      r = rings[i];
      e = 2 / r.n;
      for (j = 0; j <= seg; j++) {
        t = (j / seg) * Math.PI * 2;
        s = Math.sin(t);
        c = Math.cos(t);
        x = r.a * Math.sign(s) * Math.pow(Math.abs(s), e);
        d = c >= 0 ? r.bF : r.bB;
        z = d * Math.sign(c) * Math.pow(Math.abs(c), e);
        pos.push(x, r.y, z);
      }
    }
    for (i = 0; i < rings.length - 1; i++) {
      for (j = 0; j < seg; j++) {
        var a0 = i * (seg + 1) + j;
        var b0 = a0 + 1;
        var c0 = a0 + seg + 1;
        var d0 = c0 + 1;
        idx.push(a0, b0, c0, b0, d0, c0);
      }
    }
    if (capBottom) {
      var cb = pos.length / 3;
      pos.push(0, rings[0].y - 0.5, 0);
      for (j = 0; j < seg; j++) idx.push(cb, j + 1, j);
    }
    if (capTop) {
      var ct = pos.length / 3;
      var top = rings.length - 1;
      pos.push(0, rings[top].y + 0.5, 0);
      for (j = 0; j < seg; j++) idx.push(ct, top * (seg + 1) + j, top * (seg + 1) + j + 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
  /* ---------------- 人体构建 ---------------- */

  function build(p) {
    var H = p.height;
    var q = props(p.gender);
    var bmi = p.weight / Math.pow(H / 100, 2);
    var fat = clamp(Math.pow(bmi / 22, 0.5), 0.80, 1.42);
    var chest = girth(p.bust, q.chestK);
    var waist = girth(p.waist, q.waistK);
    var hip = girth(p.hip, q.hipK);
    var sw = q.shoulderW * H;
    var isF = p.gender === 'female';

    var group = new THREE.Group();
    var parts = [];
    var wear = [];
    var matSkin = new THREE.MeshStandardMaterial({ color: 0xdccfc2, roughness: 0.66, metalness: 0.02 });
    var matWear = new THREE.MeshStandardMaterial({ color: 0x59616e, roughness: 0.9, metalness: 0.0 });

    function add(mesh, region) {
      mesh.material = matSkin;
      mesh.userData.region = region;
      group.add(mesh);
      parts.push(mesh);
      return mesh;
    }

    function addWear(mesh) {
      mesh.material = matWear;
      mesh.raycast = function () {};
      group.add(mesh);
      wear.push(mesh);
      return mesh;
    }

    /* ---- 躯干截面 ---- */
    var belly = 1 + 0.18 * (fat - 1);
    var rings = [
      { f: L.crotch - 0.036, a: hip.a * 0.66, bF: hip.b * 0.58, bB: hip.b * 0.64, n: 2.5 },
      { f: L.crotch, a: hip.a * 0.86, bF: hip.b * 0.80, bB: hip.b * 0.94, n: 2.4 },
      { f: L.hip, a: hip.a * 0.95, bF: hip.b * 0.86, bB: hip.b * 1.14, n: 2.3 },
      { f: L.iliac, a: lerp(waist.a, hip.a, 0.60), bF: lerp(waist.b, hip.b, 0.45) * belly, bB: lerp(waist.b, hip.b, 0.50) * 0.98, n: 2.2 },
      { f: L.waist, a: waist.a, bF: waist.b * belly, bB: waist.b * 0.95, n: 2.1 },
      { f: L.underbust, a: lerp(waist.a, chest.a, 0.58), bF: lerp(waist.b, chest.b, 0.52), bB: lerp(waist.b, chest.b, 0.55) * 0.97, n: 2.2 },
      { f: L.bust, a: chest.a, bF: chest.b * (isF ? 0.93 : 1.02), bB: chest.b * 0.95, n: 2.3 },
      { f: L.armpit, a: chest.a * 0.97, bF: chest.b * 0.95, bB: chest.b * 0.92, n: 2.4 },
      { f: L.shoulder, a: sw * 0.42, bF: chest.b * 0.80, bB: chest.b * 0.78, n: 2.5 },
      { f: L.neck, a: sw * 0.29, bF: chest.b * 0.56, bB: chest.b * 0.52, n: 2.4 }
    ];
    function profileAt(f) {
      if (f <= rings[0].f) return rings[0];
      for (var i = 0; i < rings.length - 1; i++) {
        if (f <= rings[i + 1].f) {
          var t = (f - rings[i].f) / (rings[i + 1].f - rings[i].f);
          return {
            f: f,
            a: lerp(rings[i].a, rings[i + 1].a, t),
            bF: lerp(rings[i].bF, rings[i + 1].bF, t),
            bB: lerp(rings[i].bB, rings[i + 1].bB, t),
            n: lerp(rings[i].n, rings[i + 1].n, t)
          };
        }
      }
      return rings[rings.length - 1];
    }

    /** 取躯干轮廓的一段并向外偏移，用于生成内衣 */
    function band(f0, f1, off, steps) {
      var rs = [];
      for (var i = 0; i <= steps; i++) {
        var f = lerp(f0, f1, i / steps);
        var pr = profileAt(f);
        rs.push({ y: f * H, a: pr.a + off, bF: pr.bF + off, bB: pr.bB + off, n: pr.n });
      }
      return rs;
    }

    add(new THREE.Mesh(loft(rings.map(function (r) {
      return { y: r.f * H, a: r.a, bF: r.bF, bB: r.bB, n: r.n };
    }), 44, true, true)), { kind: 'torso', name: '躯干' });

    /* ---- 内衣（默认遮挡私密部位） ---- */
    addWear(new THREE.Mesh(loft(band(L.crotch - 0.030, L.hip + 0.030, 0.55, 8), 44, false, false)));
    if (isF) {
      addWear(new THREE.Mesh(loft(band(L.underbust + 0.006, L.bust + 0.028, 0.6, 5), 44, false, false)));
    }

    /* ---- 女性胸部 ---- */
    var breastR = 0;
    if (isF) {
      breastR = clamp(0.028 * H + (p.bust - p.waist) * 0.18, 0.026 * H, 0.062 * H);
      [1, -1].forEach(function (side) {
        var c = new V(side * chest.a * 0.46, L.bust * H + 0.004 * H, chest.b * 0.80);
        add(blob(c, breastR, null, { x: 1, y: 0.92, z: 0.78 }), {
          kind: 'breast', name: (side > 0 ? '左' : '右') + '侧胸部', side: side > 0 ? '左' : '右',
          center: c, aVec: AXIS_Z.clone(), lVec: new V(side, 0, 0)
        });
        addWear(blob(c, breastR * 1.06, null, { x: 1, y: 0.92, z: 0.78 }));
      });
    }
    /* ---- 头颈 ---- */
    var neck0 = new V(0, L.neck * H - 0.012 * H, 0);
    var neck1 = new V(0, L.chin * H + 0.004 * H, 0.004 * H);
    add(tube(neck0, neck1, q.neckR * H * Math.pow(fat, 0.4) * 1.08, q.neckR * H * Math.pow(fat, 0.4)), {
      kind: 'neck', name: '颈部', from: neck0, to: neck1,
      aVec: AXIS_Z.clone(), lVec: new V(1, 0, 0)
    });

    var headC = new V(0, (L.chin + (L.top - L.chin) * 0.52) * H, 0.006 * H);
    var headHalf = (L.top - L.chin) * H * 0.53;
    add(blob(headC, 1, null, { x: 0.047 * H, y: headHalf, z: 0.058 * H }), {
      kind: 'head', name: '头部', center: headC, half: headHalf, top: L.top * H, chin: L.chin * H
    });
    [1, -1].forEach(function (side) {
      var c = new V(side * 0.046 * H, headC.y - 0.004 * H, -0.002 * H);
      add(blob(c, 0.017 * H, null, { x: 0.36, y: 1, z: 0.62 }), {
        kind: 'blob', name: (side > 0 ? '左' : '右') + '耳', center: c,
        aVec: AXIS_Z.clone(), lVec: new V(side, 0, 0),
        axes: { aPos: '耳前', aNeg: '耳后', lPos: '外侧', lNeg: '贴头一侧' }
      });
    });

    var landmarks = { head: headC.clone(), torso: new V(0, L.waist * H, 0) };

    /* ---- 四肢 ---- */
    [1, -1].forEach(function (side) {
      var sn = side > 0 ? '左' : '右';
      var lat = new V(side, 0, 0);

      /* 肩（三角肌） */
      var shC = new V(side * sw * 0.46, L.shoulder * H - 0.016 * H, 0);
      add(blob(shC, q.upperArmR * H * fat * 1.45, null, { x: 1, y: 0.9, z: 0.95 }), {
        kind: 'blob', name: sn + '肩', center: shC, aVec: AXIS_Z.clone(), lVec: lat.clone(),
        axes: { aPos: '肩前', aNeg: '肩后', lPos: '肩外侧', lNeg: '靠颈一侧' }
      });

      /* 上臂 / 肘 / 前臂 / 腕 */
      var dir1 = new V(side * Math.sin(q.abduct), -Math.cos(q.abduct), 0.06).normalize();
      var abd2 = q.abduct * 0.84;
      var dir2 = new V(side * Math.sin(abd2), -Math.cos(abd2), 0.12).normalize();
      var shoulder = new V(side * sw * 0.47, L.shoulder * H - 0.022 * H, 0);
      var elbow = shoulder.clone().addScaledVector(dir1, 0.184 * H);
      var wrist = elbow.clone().addScaledVector(dir2, 0.146 * H);
      function antOf(dir) {
        return AXIS_Z.clone().sub(dir.clone().multiplyScalar(dir.dot(AXIS_Z))).normalize();
      }

      function latOf(dir) {
        var v = new V().crossVectors(dir, AXIS_Z).normalize();
        if (v.dot(lat) < 0) v.negate();
        return v;
      }

      var LIMB_AXES = { aPos: '前面', aNeg: '后面', lPos: '外侧', lNeg: '内侧' };

      function limb(name, from, to, r0, r1, opt, t0, t1) {
        var dir = to.clone().sub(from).normalize();
        return add(tube(from, to, r0, r1, opt), {
          kind: 'limb', name: sn + name, side: sn, from: from.clone(), to: to.clone(),
          aVec: antOf(dir), lVec: latOf(dir), axes: LIMB_AXES, t0: t0, t1: t1
        });
      }

      function joint(name, center, r, dir, axes) {
        return add(blob(center, r), {
          kind: 'blob', name: sn + name, side: sn, center: center.clone(),
          aVec: dir ? antOf(dir) : AXIS_Z.clone(), lVec: dir ? latOf(dir) : lat.clone(),
          axes: axes || LIMB_AXES
        });
      }

      limb('上臂', shoulder, elbow, q.upperArmR * H * fat * 1.06, q.elbowR * H * fat, {
        profile: function (t) { return 1 + 0.10 * Math.exp(-Math.pow((t - 0.30) / 0.30, 2)); }
      }, '靠近肩部', '靠近肘部');
      joint('肘', elbow, q.elbowR * H * fat * 1.05, dir1, { aPos: '肘窝(前面)', aNeg: '肘尖(后面)', lPos: '外侧', lNeg: '内侧' });
      limb('前臂', elbow, wrist, q.foreR * H * fat * 1.16, q.wristR * H * fat, {
        profile: function (t) { return 1 + 0.10 * Math.exp(-Math.pow((t - 0.18) / 0.26, 2)); }
      }, '靠近肘部', '靠近腕部');
      joint('腕', wrist, q.wristR * H * fat * 1.06, dir2, { aPos: '掌侧(手心一侧)', aNeg: '背侧(手背一侧)', lPos: '拇指一侧', lNeg: '小指一侧' });

      /* 手（含五指与各指关节） */
      landmarks[side > 0 ? 'handL' : 'handR'] = buildHand(side, sn, wrist, dir2, add, H, q, fat);
      /* 大腿 / 膝 / 小腿 / 踝 / 足 */
      var hipJ = new V(side * 0.060 * H, L.crotch * H + 0.020 * H, 0);
      var knee = new V(side * 0.070 * H, L.knee * H, 0.006 * H);
      var ankle = new V(side * 0.066 * H, L.ankle * H, -0.006 * H);
      limb('大腿', hipJ, knee, q.thighR * H * fat, q.kneeR * H * fat * 0.94, {
        profile: function (t) { return 1 + 0.09 * Math.exp(-Math.pow((t - 0.12) / 0.30, 2)); }
      }, '靠近大腿根部', '靠近膝部');
      joint('膝', knee, q.kneeR * H * fat, knee.clone().sub(hipJ), {
        aPos: '膝盖前面(髌骨)', aNeg: '膝后(腘窝)', lPos: '外侧', lNeg: '内侧'
      });
      limb('小腿', knee, ankle, q.calfR * H * fat * 1.10, q.ankleR * H * fat, {
        profile: function (t) { return 1 + 0.26 * Math.exp(-Math.pow((t - 0.20) / 0.26, 2)); }
      }, '靠近膝部', '靠近脚踝');
      joint('脚踝', ankle, q.ankleR * H * fat * 1.10, ankle.clone().sub(knee), {
        aPos: '前面', aNeg: '后面(跟腱)', lPos: '外踝一侧', lNeg: '内踝一侧'
      });
      landmarks[side > 0 ? 'footL' : 'footR'] = buildFoot(side, sn, ankle, add, H, q, fat);
    });

    return {
      group: group,
      parts: parts,
      wear: wear,
      materials: { skin: matSkin, wear: matWear },
      height: H,
      landmarks: landmarks,
      L: L
    };
  }
  /* ---------------- 手：手掌 + 五指 + 各指关节 ---------------- */

  function buildHand(side, sn, wrist, distal, add, H, q, fat) {
    var palmDir = AXIS_Z.clone().sub(distal.clone().multiplyScalar(distal.dot(AXIS_Z))).normalize();
    var latAxis = new V().crossVectors(distal, palmDir);
    var thumbSign = (latAxis.x * side) >= 0 ? 1 : -1;
    var thumbDir = latAxis.clone().multiplyScalar(thumbSign);
    var AXES = { aPos: '掌侧(手心一侧)', aNeg: '背侧(手背一侧)', lPos: '拇指一侧', lNeg: '小指一侧' };
    var palmLen = 0.056 * H, palmW = 0.050 * H, palmT = 0.020 * H;
    var palmC = wrist.clone().addScaledVector(distal, palmLen * 0.52);
    var basis = { x: latAxis, y: distal, z: palmDir };
    var k = Math.pow(fat, 0.35);

    add(blob(palmC, 1, basis, { x: palmW * 0.5 * k, y: palmLen * 0.5, z: palmT * 0.5 * k }), {
      kind: 'palm', name: sn + '手', side: sn, center: palmC,
      aVec: palmDir, lVec: thumbDir, axes: AXES
    });

    /** 生成一根手指：分节 + 关节球，并回写「距指尖」参考点 */
    function digit(label, start, dir0, lens, r0, jointNames, segNames) {
      var pts = [start.clone()], dirs = [];
      var cur = start.clone(), cd = dir0.clone(), i;
      for (i = 0; i < lens.length; i++) {
        dirs.push(cd.clone());
        cur = cur.clone().addScaledVector(cd, lens[i]);
        pts.push(cur.clone());
        cd = cd.clone().addScaledVector(palmDir, 0.07).normalize();
      }
      var tip = pts[lens.length].clone().addScaledVector(dirs[lens.length - 1], r0 * 0.8);
      for (i = 0; i < lens.length; i++) {
        var ra = r0 * Math.pow(0.9, i);
        var rb = r0 * Math.pow(0.9, i + 1);
        add(blob(pts[i], ra * 1.2), {
          kind: 'digitJoint', name: label + jointNames[i], side: sn, center: pts[i].clone(),
          aVec: palmDir, lVec: thumbDir, axes: AXES, tip: tip
        });
        add(tube(pts[i], pts[i + 1], ra, rb, { round1: i === lens.length - 1, seg: 14, ref: palmDir }), {
          kind: 'finger', name: label + segNames[i], side: sn,
          from: pts[i].clone(), to: pts[i + 1].clone(),
          aVec: palmDir, lVec: thumbDir, axes: AXES, tip: tip,
          t0: '靠近' + jointNames[i], t1: i === lens.length - 1 ? '靠近指尖' : '靠近' + jointNames[i + 1]
        });
      }
    }
    var SEG = ['近节', '中节', '末节'];
    var JOINT = ['掌指关节', '近端指间关节', '远端指间关节(最外侧关节)'];
    var digits = [
      { n: '食指', x: 0.0190, len: 0.044, r: 0.0058, sp: 0.10 },
      { n: '中指', x: 0.0065, len: 0.048, r: 0.0060, sp: 0.02 },
      { n: '无名指', x: -0.0065, len: 0.045, r: 0.0056, sp: -0.05 },
      { n: '小指', x: -0.0190, len: 0.036, r: 0.0048, sp: -0.13 }
    ];
    var base0 = palmC.clone().addScaledVector(distal, palmLen * 0.48);
    digits.forEach(function (d) {
      var start = base0.clone().addScaledVector(thumbDir, d.x * H);
      var dir = distal.clone().addScaledVector(thumbDir, d.sp).addScaledVector(palmDir, 0.08).normalize();
      var total = d.len * H;
      digit(sn + '手' + d.n, start, dir, [total * 0.45, total * 0.32, total * 0.23], d.r * H * k, JOINT, SEG);
    });

    /* 拇指 */
    var tStart = palmC.clone()
      .addScaledVector(thumbDir, palmW * 0.40)
      .addScaledVector(distal, -palmLen * 0.22);
    var tDir = distal.clone().multiplyScalar(0.55).addScaledVector(thumbDir, 0.82).addScaledVector(palmDir, 0.16).normalize();
    digit(sn + '手拇指', tStart, tDir, [0.031 * H, 0.025 * H], 0.0072 * H * k,
      ['掌指关节', '指间关节(最外侧关节)'], ['近节', '末节']);

    return palmC.clone().addScaledVector(distal, 0.035 * H);
  }

  /* ---------------- 足：脚掌 + 五趾 ---------------- */

  function buildFoot(side, sn, ankle, add, H, q, fat) {
    var footC = new V(ankle.x, 0.034 * H, 0.026 * H);
    var lat = new V(side, 0, 0);
    add(blob(footC, 1, null, { x: 0.037 * H, y: 0.034 * H, z: 0.072 * H }), {
      kind: 'foot', name: sn + '脚', side: sn, center: footC, aVec: AXIS_Y.clone(), lVec: lat.clone()
    });
    var offs = [-0.021, -0.007, 0.004, 0.014, 0.023];
    var rs = [0.0092, 0.0070, 0.0066, 0.0060, 0.0052];
    var lens = [0.030, 0.028, 0.026, 0.023, 0.019];
    var names = ['大脚趾', '第二趾', '第三趾', '第四趾', '小脚趾'];
    var k = Math.pow(fat, 0.3);
    for (var i = 0; i < 5; i++) {
      var from = new V(footC.x + side * offs[i] * H, 0.0215 * H, 0.088 * H);
      var to = new V(from.x, 0.0205 * H, (0.088 + lens[i]) * H);
      var r = rs[i] * H * k;
      add(tube(from, to, r, r * 0.88, { round1: true, seg: 14, ref: AXIS_Y }), {
        kind: 'toe', name: sn + '脚' + names[i], side: sn, from: from, to: to,
        aVec: AXIS_Y.clone(), lVec: lat.clone(), tip: to.clone().add(new V(0, 0, r * 0.8)),
        axes: { aPos: '趾背(上面)', aNeg: '趾腹(下面)', lPos: '靠小脚趾一侧', lNeg: '靠大脚趾一侧' },
        t0: '靠近趾根', t1: '靠近趾尖'
      });
    }
    return new V(footC.x, 0.030 * H, 0.05 * H);
  }

  window.BodyModel = { build: build, autoGirth: autoGirth, girth: girth, L: L };
})();
