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

  /* 头部截面表：[从下巴算起的高度比例, 半宽×, 前半深×, 后半深×, 超椭圆指数] */
  var HEAD = [
    [0.000, 0.30, 0.42, 0.34, 2.40],
    [0.075, 0.50, 0.68, 0.56, 2.40],
    [0.170, 0.70, 0.86, 0.74, 2.35],
    [0.280, 0.84, 0.96, 0.86, 2.30],
    [0.400, 0.93, 1.00, 0.93, 2.25],
    [0.520, 0.99, 0.99, 0.98, 2.20],
    [0.640, 1.00, 0.95, 1.00, 2.15],
    [0.760, 0.97, 0.90, 1.00, 2.10],
    [0.860, 0.88, 0.82, 0.93, 2.10],
    [0.930, 0.72, 0.66, 0.76, 2.10],
    [0.975, 0.50, 0.46, 0.54, 2.10],
    [1.000, 0.22, 0.20, 0.24, 2.10]
  ];

  function headProf(t) {
    if (t <= HEAD[0][0]) return HEAD[0];
    for (var i = 0; i < HEAD.length - 1; i++) {
      if (t <= HEAD[i + 1][0]) {
        var k = (t - HEAD[i][0]) / (HEAD[i + 1][0] - HEAD[i][0]);
        return [t,
          lerp(HEAD[i][1], HEAD[i + 1][1], k),
          lerp(HEAD[i][2], HEAD[i + 1][2], k),
          lerp(HEAD[i][3], HEAD[i + 1][3], k),
          lerp(HEAD[i][4], HEAD[i + 1][4], k)];
      }
    }
    return HEAD[HEAD.length - 1];
  }

  /** 面部前表面在（高度比例 t，横向 x）处的 z（相对头部中心） */
  function faceZ(t, x, HW, HD) {
    var p = headProf(t);
    var a = p[1] * HW;
    var u = Math.min(1, Math.abs(x) / a);
    return p[2] * HD * Math.pow(Math.max(0, 1 - Math.pow(u, p[4])), 1 / p[4]);
  }

  function sideX(t, HW) { return headProf(t)[1] * HW; }
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
    var mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, opt.seg || 22));
    mesh.position.copy(from);
    applyFrame(mesh, frame(to.clone().sub(from), opt.ref));
    return mesh;
  }
  /** 球体（可按局部基与三轴缩放做成椭球）；seg 用于关节这类需要更圆的部件 */
  function blob(center, r, f, scale, seg) {
    var w = seg || 24;
    var mesh = new THREE.Mesh(new THREE.SphereGeometry(r, w, Math.round(w * 0.7)));
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
  /* ---------------- 面部 ---------------- */

  /**
   * 生成五官：鼻、眼、眉、唇、耳，每一件都是独立可点击的部位
   * @param {Function} add 加入可拾取部位
   * @param {Function} deco 加入纯装饰件
   */
  function face(add, deco, MAT, H, chinY, hh, HW, HD, headZ) {
    /** 面部表面点：t 为从下巴起算的高度比例，x 为横向偏移，out 为向前突出量 */
    function P(t, x, out) {
      return new V(x, chinY + t * hh, headZ + faceZ(t, x, HW, HD) + (out || 0));
    }
    var AX = { aPos: '前面', aNeg: '后面', lPos: '左侧', lNeg: '右侧' };
    var sides = [1, -1];

    /* 鼻：鼻梁 + 鼻尖 + 两侧鼻翼 */
    var nRoot = P(0.545, 0, 0.001 * H);
    var nTip = P(0.345, 0, 0.013 * H);
    add(tube(nRoot, nTip, 0.0052 * H, 0.0102 * H, { seg: 16, steps: 4, ref: AXIS_Z }), {
      kind: 'limb', name: '鼻梁(鼻背)', from: nRoot.clone(), to: nTip.clone(), noFacing: true,
      aVec: AXIS_Z.clone(), lVec: new V(1, 0, 0), axes: AX,
      t0: '靠鼻根(两眼之间)', t1: '靠鼻尖'
    });
    add(blob(nTip, 1, null, { x: 0.0105 * H, y: 0.0095 * H, z: 0.0105 * H }), {
      kind: 'face', name: '鼻尖'
    });
    sides.forEach(function (s) {
      var c = P(0.312, s * 0.0112 * H, 0.003 * H);
      add(blob(c, 1, null, { x: 0.0078 * H, y: 0.0068 * H, z: 0.0088 * H }), {
        kind: 'face', name: (s > 0 ? '左' : '右') + '鼻翼(鼻孔外侧)'
      });
    });

    /* 眼：眼白可点击，瞳孔只是装饰 */
    sides.forEach(function (s) {
      var ex = s * 0.0212 * H;
      var ec = P(0.515, ex, -0.0016 * H);
      var ext = new V(0.0136 * H, 0.0076 * H, 0.0076 * H);
      add(blob(ec, 1, null, { x: ext.x, y: ext.y, z: ext.z }), {
        kind: 'eye', name: (s > 0 ? '左' : '右') + '眼', side: s > 0 ? '左' : '右',
        center: ec.clone(), ext: ext, aVec: AXIS_Z.clone(), lVec: new V(s, 0, 0)
      }, MAT.eye);
      deco(blob(P(0.515, ex, 0.0036 * H), 1, null,
        { x: 0.0050 * H, y: 0.0050 * H, z: 0.0030 * H }), MAT.iris);
    });
    /* 眉 */
    sides.forEach(function (s) {
      var b0 = P(0.583, s * 0.0075 * H, 0.0008 * H);
      var b1 = P(0.601, s * 0.0300 * H, 0.0008 * H);
      add(tube(b0, b1, 0.0054 * H, 0.0030 * H, { seg: 12, steps: 4, round1: true, ref: AXIS_Z }), {
        kind: 'limb', name: (s > 0 ? '左' : '右') + '眉', noFacing: true,
        from: b0.clone(), to: b1.clone(),
        aVec: AXIS_Z.clone(), lVec: new V(s, 0, 0), axes: AX,
        t0: '眉头(靠鼻侧)', t1: '眉尾(靠外侧)'
      }, MAT.hair);
    });

    /* 唇 */
    add(blob(P(0.206, 0, -0.0022 * H), 1, null,
      { x: 0.0152 * H, y: 0.0042 * H, z: 0.0068 * H }), { kind: 'sym', name: '上唇' }, MAT.lip);
    add(blob(P(0.160, 0, -0.0022 * H), 1, null,
      { x: 0.0136 * H, y: 0.0052 * H, z: 0.0072 * H }), { kind: 'sym', name: '下唇' }, MAT.lip);

    /* 耳 */
    sides.forEach(function (s) {
      var t = 0.48;
      var ext = new V(0.0062 * H, 0.0170 * H, 0.0112 * H);
      var c = new V(s * (sideX(t, HW) - 0.0012 * H), chinY + t * hh, headZ - 0.006 * H);
      add(blob(c, 1, null, { x: ext.x, y: ext.y, z: ext.z }), {
        kind: 'ear', name: (s > 0 ? '左' : '右') + '耳', side: s > 0 ? '左' : '右',
        center: c.clone(), ext: ext, aVec: AXIS_Z.clone(), lVec: new V(s, 0, 0)
      });
    });
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
    var MAT = {
      skin: matSkin,
      wear: matWear,
      eye: new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.3, metalness: 0.0 }),
      iris: new THREE.MeshStandardMaterial({ color: 0x3b2f2a, roughness: 0.35, metalness: 0.0 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x4a3f3a, roughness: 0.85, metalness: 0.0 }),
      lip: new THREE.MeshStandardMaterial({ color: 0xc98d86, roughness: 0.55, metalness: 0.0 })
    };

    function add(mesh, region, mat) {
      mesh.material = mat || matSkin;
      mesh.userData.region = region;
      group.add(mesh);
      parts.push(mesh);
      return mesh;
    }

    /** 纯装饰件（瞳孔一类）：不参与拾取，也不受私密开关影响 */
    function addDeco(mesh, mat) {
      mesh.material = mat || matSkin;
      mesh.raycast = function () {};
      group.add(mesh);
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
    var chinY = L.chin * H, topY = L.top * H, hh = topY - chinY;
    var HW = 0.047 * H, HD = 0.058 * H, headZ = 0.012 * H;

    /* 颈顶抬到下颌内部并限制粗细，保证胖体型也不会从下巴两侧穿出来 */
    var neckR = Math.min(q.neckR * H * Math.pow(fat, 0.4), 0.037 * H);
    var neck0 = new V(0, L.neck * H - 0.012 * H, 0);
    var neck1 = new V(0, chinY + 0.040 * H, 0.004 * H);
    add(tube(neck0, neck1, neckR * 1.08, neckR), {
      kind: 'neck', name: '颈部', from: neck0, to: neck1,
      aVec: AXIS_Z.clone(), lVec: new V(1, 0, 0)
    });

    var headC = new V(0, chinY + hh * 0.55, headZ);
    var headMesh = new THREE.Mesh(loft(HEAD.map(function (r) {
      return { y: chinY + r[0] * hh, a: r[1] * HW, bF: r[2] * HD, bB: r[3] * HD, n: r[4] };
    }), 40, true, true));
    headMesh.position.z = headZ;
    add(headMesh, {
      kind: 'head', name: '头部', center: headC, half: hh * 0.5, top: topY, chin: chinY
    });
    face(add, addDeco, MAT, H, chinY, hh, HW, HD, headZ);

    var landmarks = { head: headC.clone(), torso: new V(0, L.waist * H, 0) };

    /* ---- 四肢 ---- */
    [1, -1].forEach(function (side) {
      var sn = side > 0 ? '左' : '右';
      var lat = new V(side, 0, 0);

      /* 肩（三角肌） */
      var shC = new V(side * sw * 0.46, L.shoulder * H - 0.016 * H, 0);
      add(blob(shC, q.upperArmR * H * fat * 1.45, null, { x: 1, y: 0.9, z: 0.95 }, 32), {
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

      /* 关节球要略粗于相邻肢体端面，端面藏进球里，外形才是圆的 */
      function joint(name, center, r, dir, axes) {
        return add(blob(center, r, null, null, 32), {
          kind: 'blob', name: sn + name, side: sn, center: center.clone(),
          aVec: dir ? antOf(dir) : AXIS_Z.clone(), lVec: dir ? latOf(dir) : lat.clone(),
          axes: axes || LIMB_AXES
        });
      }

      /* 关节球比相邻端面粗，前臂/小腿的肌腹峰值下移，
         鼓起的位置由 profile 承担，端面则收进关节球里 */
      var elbowR = q.elbowR * H * fat * 1.15;
      var wristR = q.wristR * H * fat * 1.12;
      var foreBase = elbowR * 0.92;
      var foreEnd = wristR * 0.90;
      var foreAmp = clamp(q.foreR * H * fat * 1.16 /
        (foreBase + (foreEnd - foreBase) * 0.34) - 1, 0, 0.45);
      limb('上臂', shoulder, elbow, q.upperArmR * H * fat * 1.06, elbowR * 0.90, {
        profile: function (t) { return 1 + 0.10 * Math.exp(-Math.pow((t - 0.30) / 0.30, 2)); }
      }, '靠近肩部', '靠近肘部');
      joint('肘', elbow, elbowR, dir1, { aPos: '肘窝(前面)', aNeg: '肘尖(后面)', lPos: '外侧', lNeg: '内侧' });
      limb('前臂', elbow, wrist, foreBase, foreEnd, {
        profile: function (t) { return 1 + foreAmp * Math.exp(-Math.pow((t - 0.34) / 0.22, 2)); }
      }, '靠近肘部', '靠近腕部');
      joint('腕', wrist, wristR, dir2, { aPos: '掌侧(手心一侧)', aNeg: '背侧(手背一侧)', lPos: '拇指一侧', lNeg: '小指一侧' });

      /* 手（含五指与各指关节） */
      landmarks[side > 0 ? 'handL' : 'handR'] = buildHand(side, sn, wrist, dir2, add, H, q, fat);
      /* 大腿 / 膝 / 小腿 / 踝 / 足
         髋部位置与大腿粗细都跟着臀围走，臀腿衔接才不会脱节 */
      var hipHalf = hip.a * 0.95;
      var thighTopR = clamp(hipHalf * 0.46 * Math.pow(fat, 0.18), 0.034 * H, 0.075 * H);
      var hipX = clamp(hipHalf - thighTopR * 0.95, 0.026 * H, 0.080 * H);
      var hipJ = new V(side * hipX, L.crotch * H + 0.030 * H, 0);
      var knee = new V(side * Math.max(0.030 * H, hipX * 0.84), L.knee * H, 0.006 * H);
      var ankle = new V(side * Math.max(0.028 * H, hipX * 0.78), L.ankle * H, -0.006 * H);
      var kneeR = q.kneeR * H * fat * 1.06;
      var calfBase = kneeR * 0.88;
      var calfEnd = q.ankleR * H * fat;
      var calfAmp = clamp(q.calfR * H * fat * 1.24 /
        (calfBase + (calfEnd - calfBase) * 0.34) - 1, 0, 0.5);
      limb('大腿', hipJ, knee, thighTopR, kneeR * 0.90, {
        round0: true,
        profile: function (t) { return 1 - 0.05 * t + 0.05 * Math.exp(-Math.pow(t / 0.26, 2)); }
      }, '靠近大腿根部', '靠近膝部');
      joint('膝', knee, kneeR, knee.clone().sub(hipJ), {
        aPos: '膝盖前面(髌骨)', aNeg: '膝后(腘窝)', lPos: '外侧', lNeg: '内侧'
      });
      limb('小腿', knee, ankle, calfBase, calfEnd, {
        profile: function (t) { return 1 + calfAmp * Math.exp(-Math.pow((t - 0.34) / 0.22, 2)); }
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
      materials: MAT,
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
    var lat = new V(side, 0, 0);
    var k = Math.pow(fat, 0.22);
    var AXES = {
      aPos: '脚背(上面)', aNeg: '脚底(下面)',
      lPos: '外侧(小脚趾一侧)', lNeg: '内侧(足弓一侧)'
    };

    /* 后足（脚跟+足弓）与前足（脚掌垫）分两块，脚才有前薄后厚的变化 */
    var rearZ = 0.046 * H;
    var rearC = new V(ankle.x, 0.0215 * H, 0);
    add(blob(rearC, 1, null, { x: 0.0250 * H * k, y: 0.0215 * H, z: rearZ }), {
      kind: 'foot', zone: 'rear', zSpan: rearZ, name: sn + '脚', side: sn,
      center: rearC.clone(), aVec: AXIS_Y.clone(), lVec: lat.clone(), axes: AXES
    });

    var foreZ = 0.036 * H;
    var foreC = new V(ankle.x + side * 0.002 * H, 0.0165 * H, 0.050 * H);
    add(blob(foreC, 1, null, { x: 0.0280 * H * k, y: 0.0165 * H, z: foreZ }), {
      kind: 'foot', zone: 'fore', zSpan: foreZ, name: sn + '脚', side: sn,
      center: foreC.clone(), aVec: AXIS_Y.clone(), lVec: lat.clone(), axes: AXES
    });

    var offs = [-0.0190, -0.0065, 0.0035, 0.0125, 0.0210];
    var rs = [0.0066, 0.0051, 0.0047, 0.0043, 0.0038];
    var lens = [0.0255, 0.0238, 0.0221, 0.0196, 0.0162];
    var names = ['大脚趾', '第二趾', '第三趾', '第四趾', '小脚趾'];
    for (var i = 0; i < 5; i++) {
      var from = new V(foreC.x + side * offs[i] * H, 0.0135 * H, 0.070 * H);
      var to = new V(from.x, 0.0125 * H, (0.070 + lens[i]) * H);
      var r = rs[i] * H * k;
      add(tube(from, to, r, r * 0.9, { round1: true, seg: 14, ref: AXIS_Y }), {
        kind: 'toe', name: sn + '脚' + names[i], side: sn, from: from, to: to,
        aVec: AXIS_Y.clone(), lVec: lat.clone(), tip: to.clone().add(new V(0, 0, r * 0.8)),
        axes: { aPos: '趾背(上面)', aNeg: '趾腹(下面)', lPos: '靠小脚趾一侧', lNeg: '靠大脚趾一侧' },
        t0: '靠近趾根', t1: '靠近趾尖'
      });
    }
    return new V(rearC.x, 0.026 * H, 0.030 * H);
  }

  window.BodyModel = { build: build, autoGirth: autoGirth, girth: girth, L: L };
})();
