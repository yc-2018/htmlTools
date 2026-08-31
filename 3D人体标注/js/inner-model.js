/* inner-model.js —— 内部解剖视图的公共坐标系、图层注册与体表外壳
 * 坐标和体表标注页完全一致：单位厘米，脚底 y=0，人体面朝 +Z，人体自身左侧 = +X
 * 所有结构都按身高比例现算，是**示意模型**，不是真实解剖数据
 */
(function () {
  'use strict';

  var V = THREE.Vector3;
  var BM = window.BodyModel;
  var G = BM.geo;
  var L = BM.L;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /* ---------------- 图层（顺序即面板里的顺序：由外向内） ----------------
     每层的滑块不是透明度，而是**涂层深度**：满格是这一层的外表面，往里拉一格就剥开一层。
     lv 列出这一层有几级（从外到内），op 是这一层固定的不透明度（骨骼半透，好看见里面）。
     件登记时用 opt.lv 说明自己属于第几级、opt.to 说明剥到第几级就该让位。 */

  var SYSTEMS = [
    {
      id: 'skin', name: '体表(皮肤)', op: 0.16, color: 0xd9c3b0, on: true,
      note: '半透明外壳，只用来对位', lv: [{ n: '皮肤' }]
    },
    {
      id: 'muscle', name: '肌肉', op: 0.94, color: 0xa8453e, on: false,
      lv: [{ n: '浅层肌' }, { n: '深层肌' }]
    },
    {
      id: 'bone', name: '骨骼', op: 0.46, color: 0xe7e0cf, on: true,
      lv: [{ n: '全身骨骼' }, { n: '中轴骨与颅骨' }]
    },
    {
      id: 'heart', name: '心脏与大血管主干', op: 1.00, color: 0xb03a3a, on: true,
      lv: [{ n: '心脏与大血管' }, { n: '大血管主干' }]
    },
    {
      id: 'resp', name: '呼吸', op: 1.00, color: 0xe0928f, on: true,
      lv: [{ n: '肺与气道' }, { n: '气道与咽喉' }, { n: '气管与支气管' }]
    },
    {
      id: 'dig', name: '消化', op: 1.00, color: 0xc98a5e, on: true,
      lv: [{ n: '器官外形' }, { n: '消化管' }]
    },
    {
      id: 'urin', name: '泌尿', op: 1.00, color: 0xa2604a, on: true,
      lv: [{ n: '器官外形' }]
    },
    {
      id: 'repro', name: '生殖', op: 1.00, color: 0xc07f92, on: true, priv: true,
      lv: [{ n: '器官外形' }]
    },
    {
      id: 'endo', name: '内分泌', op: 1.00, color: 0xc25f52, on: true,
      lv: [{ n: '腺体' }]
    },
    {
      id: 'nerve', name: '脑与脊髓', op: 1.00, color: 0xd8c6bd, on: true,
      lv: [{ n: '脑外形' }, { n: '脑干与脊髓' }]
    },
    {
      id: 'lymph', name: '淋巴', op: 1.00, color: 0x9fbe63, on: false,
      lv: [{ n: '脾与淋巴结' }]
    }
  ];

  /* 程序化结构的涂层归属：件在登记时没写 lv/to 的，就按名字查这张表。
     规则从上往下第一条命中为准，都没中就是「一直留着」（lv 0、to 99）。
     to:0 = 剥一层就该让位的外层件；lv:1 = 只有剥进去才露出来的深层件。 */
  var PROC_LV = {
    bone: [
      [/椎|骶骨|尾骨|颅|下颌|肋|胸骨|剑突|舌骨/, { to: 1 }],
      [/./, { to: 0 }]
    ],
    heart: [[/^心脏$/, { to: 0 }]],
    resp: [
      [/肺.*叶/, { to: 0 }],
      [/喉|扁桃体|咽/, { to: 1 }]
    ],
    dig: [[/^肝脏$|^胆囊$|^胰$/, { to: 0 }]],
    nerve: [[/大脑半球/, { to: 0 }]],
    muscle: [
      [/膈肌|竖脊肌|腰方肌|髂腰肌/, { lv: 1 }],
      [/./, { to: 0 }]
    ]
  };

  function procLv(sid, name) {
    var rules = PROC_LV[sid];
    for (var i = 0; rules && i < rules.length; i++) {
      if (rules[i][0].test(name)) return rules[i][1];
    }
    return null;
  }

  function levels(s) {
    var a = (MODE === 'real' && s.lvReal && s.lvReal.length) ? s.lvReal : s.lv;
    return (a && a.length) ? a : [{ n: '单层' }];
  }

  /* 模型来源：'proc' 用这一页现算的示意结构，'real' 用 assets/inner 里的 BodyParts3D 数据。
     真实数据每个系统的涂层级数由 manifest 说（写在 s.lvReal 上），所以两种来源的层级不一样。 */
  var MODE = 'proc';
  function setMode(m) { MODE = (m === 'real') ? 'real' : 'proc'; }

  /* 真实解剖那具标本的手臂几乎是垂着的：肩关节约 0.81H、肘约 0.65H、腕约 0.518H，
     外展只有 5～8°，而本站体表那套人体是 A 字站姿（外展 38°），到手腕处能差出二十多厘米。
     所以真实模式下体表外壳按标本的姿势摆手臂，透明皮肤的手才和里面的手骨对得上。
     数值是从 assets/inner/bone.ibp 里肱骨、桡骨、掌骨的包围盒量出来的（参考身高 171.95 cm）。 */
  var ARM_REAL = { abduct: 0.095, drop: 0.006, upper: 0.1546, fore: 0.1291, lean: 0.04, back: -0.012 };
  var ARM_A = { abduct: null, drop: 0.022, upper: 0.184, fore: 0.146, lean: 0.06, back: 0 };
  function armPose() { return MODE === 'real' ? ARM_REAL : null; }

  /** 一条手臂的骨架：肩 → 肘 → 腕 → 指尖，公式和 body-model.js 里一致 */
  function armChain(H, q, ap) {
    var abd = ap.abduct == null ? q.abduct : ap.abduct;
    var out = {};
    [1, -1].forEach(function (side) {
      var d1 = new V(side * Math.sin(abd), -Math.cos(abd), ap.lean).normalize();
      var ab2 = abd * 0.84;
      var d2 = new V(side * Math.sin(ab2), -Math.cos(ab2), ap.lean * 2).normalize();
      var sh = new V(side * (q.shoulderW * H) * 0.47, L.shoulder * H - ap.drop * H, ap.back * H);
      var el = sh.clone().addScaledVector(d1, ap.upper * H);
      var wr = el.clone().addScaledVector(d2, ap.fore * H);
      out[side > 0 ? 'l' : 'r'] = {
        shoulder: sh, elbow: el, wrist: wr, d1: d1, d2: d2,
        /* 换算用的两段：上臂，以及「前臂 + 手」（手长约 0.105H，指尖也要能落进去） */
        seg: [[sh, el], [el, wr.clone().addScaledVector(d2, 0.105 * H)]]
      };
    });
    return out;
  }

  /** 一段的局部坐标架：u 沿轴，v 朝前，w 朝外侧 */
  function frameOf(p0, p1) {
    var u = p1.clone().sub(p0).normalize();
    var v = new V(0, 0, 1).addScaledVector(u, -u.z);
    if (v.lengthSq() < 1e-6) v.set(1, 0, 0);
    v.normalize();
    return { u: u, v: v, w: new V().crossVectors(u, v).normalize() };
  }

  /** 把体表标注页（A 字站姿）上的一点搬到当前姿势的手臂上。
   *  只管手臂附近的点：离轴线远的（躯干、头、腿）原样返回，
   *  上臂靠肩那一小段也不动，免得把胸口、肩窝的标记一起拽走。 */
  function poseMap(H, A, B) {
    var R = 0.062 * H;
    return function (p) {
      var best = null;
      ['l', 'r'].forEach(function (k) {
        A[k].seg.forEach(function (s, i) {
          var ab = s[1].clone().sub(s[0]);
          var t = clamp(p.clone().sub(s[0]).dot(ab) / ab.lengthSq(), 0, 1);
          if (i === 0 && t < 0.18) return;
          var q0 = s[0].clone().addScaledVector(ab, t);
          var d = p.distanceTo(q0);
          if (d <= R && (!best || d < best.d)) best = { d: d, k: k, i: i, t: t, off: p.clone().sub(q0) };
        });
      });
      if (!best) return p.clone();
      var a = A[best.k].seg[best.i], b = B[best.k].seg[best.i];
      var fa = frameOf(a[0], a[1]), fb = frameOf(b[0], b[1]);
      var out = b[0].clone().addScaledVector(b[1].clone().sub(b[0]), best.t);
      return out.addScaledVector(fb.v, best.off.dot(fa.v)).addScaledVector(fb.w, best.off.dot(fa.w));
    };
  }

  /** 复制一份体型参数并带上手臂姿势，交给 BodyModel.build */
  function withArm(p) {
    var o = {}, a = armPose();
    Object.keys(p).forEach(function (k) { o[k] = p[k]; });
    if (a) o.arm = a;
    return o;
  }

  /* ---------------- 体表外壳 ----------------
     外壳直接用体表页那套人体：轮廓完全一致，也不用再多一份几何。
     材质换成朝边缘渐亮的半透明料子（正对镜头的地方几乎透明，转过去的边缘才亮），
     这样一百多个零件叠在一起也不会糊成一团毛玻璃 */

  var SHELL_VS = [
    'varying vec3 vN;',
    'varying vec3 vV;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vN = normalize(normalMatrix * normal);',
    '  vV = normalize(-mv.xyz);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var SHELL_FS = [
    'uniform float uOp;',
    'uniform vec3 uColor;',
    'varying vec3 vN;',
    'varying vec3 vV;',
    'void main() {',
    '  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
    '  float a = uOp * (0.22 + 1.60 * pow(f, 2.2));',
    '  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n');
  function shellMaterial(color, op) {
    return new THREE.ShaderMaterial({
      uniforms: { uOp: { value: op == null ? 0.16 : op }, uColor: { value: new THREE.Color(color) } },
      vertexShader: SHELL_VS,
      fragmentShader: SHELL_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }

  /* ---------------- 躯干横截面 ----------------
     和 body-model.js 里放样躯干用的是同一组环，所以内部结构和外壳严丝合缝对得上 */

  function sections(p, q, fat) {
    var H = p.height;
    var isF = p.gender === 'female';
    var chest = BM.girth(p.bust, q.chestK);
    var waist = BM.girth(p.waist, q.waistK);
    var hip = BM.girth(p.hip, q.hipK);
    var sw = q.shoulderW * H;
    var belly = 1 + 0.18 * (fat - 1);
    return [
      { f: L.crotch, a: hip.a * 0.86, bF: hip.b * 0.80, bB: hip.b * 0.94 },
      { f: L.hip, a: hip.a * 0.95, bF: hip.b * 0.86, bB: hip.b * 1.14 },
      { f: L.iliac, a: lerp(waist.a, hip.a, 0.60), bF: lerp(waist.b, hip.b, 0.45) * belly, bB: lerp(waist.b, hip.b, 0.50) * 0.98 },
      { f: L.waist, a: waist.a, bF: waist.b * belly, bB: waist.b * 0.95 },
      { f: L.underbust, a: lerp(waist.a, chest.a, 0.58), bF: lerp(waist.b, chest.b, 0.52), bB: lerp(waist.b, chest.b, 0.55) * 0.97 },
      { f: L.bust, a: chest.a, bF: chest.b * (isF ? 0.93 : 1.02), bB: chest.b * 0.95 },
      { f: L.armpit, a: chest.a * 0.97, bF: chest.b * 0.95, bB: chest.b * 0.92 },
      { f: L.shoulder, a: sw * 0.42, bF: chest.b * 0.80, bB: chest.b * 0.78 },
      { f: L.neck, a: sw * 0.29, bF: chest.b * 0.56, bB: chest.b * 0.52 }
    ];
  }

  /* ---------------- 构建上下文 ----------------
     骨骼 / 内脏 / 肌肉三个文件都靠这个对象定位：几何工具 + 躯干截面 + 脊柱线 + 四肢关节点 */

  function context(p) {
    var H = p.height;
    var q = BM.props(p.gender);
    var bmi = p.weight / Math.pow(H / 100, 2);
    var fat = clamp(Math.pow(bmi / 22, 0.5), 0.80, 1.42);
    var R = sections(p, q, fat);
    var hip = BM.girth(p.hip, q.hipK);
    var sw = q.shoulderW * H;

    /** 某个身高比例处的躯干半宽 a / 前半深 bF / 后半深 bB（cm） */
    function sec(f) {
      if (f <= R[0].f) return R[0];
      for (var i = 0; i < R.length - 1; i++) {
        if (f <= R[i + 1].f) {
          var t = (f - R[i].f) / (R[i + 1].f - R[i].f);
          return {
            f: f, a: lerp(R[i].a, R[i + 1].a, t),
            bF: lerp(R[i].bF, R[i + 1].bF, t), bB: lerp(R[i].bB, R[i + 1].bB, t)
          };
        }
      }
      return R[R.length - 1];
    }
    /* 生理曲度：颈前凸、胸后凸、腰前凸。没有它侧面看就是一根直棍 */
    function curve(f) {
      return 0.014 * H * Math.exp(-Math.pow((f - 0.585) / 0.045, 2))
        - 0.010 * H * Math.exp(-Math.pow((f - 0.700) / 0.070, 2))
        + 0.012 * H * Math.exp(-Math.pow((f - 0.840) / 0.045, 2));
    }

    /** 椎体中心的 z：按背面深度的比例走（背部软组织薄，跟着背走比按身高估准），再叠曲度 */
    function spineZ(f) {
      return Math.min(-0.006 * H, -0.60 * sec(f).bB + curve(f));
    }

    function spine(f) { return new V(0, f * H, spineZ(f)); }

    /* 四肢关节点：公式照抄 body-model.js（含手臂姿势覆盖），骨头和肌肉才会落在肢体里面 */
    var limb = {};
    var arms = armChain(H, q, armPose() || ARM_A);
    [1, -1].forEach(function (side) {
      var a = arms[side > 0 ? 'l' : 'r'];
      var hipHalf = hip.a * 0.95;
      var thighR = clamp(hipHalf * 0.46 * Math.pow(fat, 0.18), 0.034 * H, 0.075 * H);
      var hipX = clamp(hipHalf - thighR * 0.95, 0.026 * H, 0.080 * H);
      limb[side > 0 ? 'l' : 'r'] = {
        side: side, sn: side > 0 ? '左' : '右',
        shoulder: a.shoulder, elbow: a.elbow, wrist: a.wrist, d1: a.d1, d2: a.d2,
        hip: new V(side * hipX, L.crotch * H + 0.030 * H, 0),
        knee: new V(side * Math.max(0.030 * H, hipX * 0.84), L.knee * H, 0.006 * H),
        ankle: new V(side * Math.max(0.028 * H, hipX * 0.78), L.ankle * H, -0.006 * H),
        thighR: thighR
      };
    });

    return {
      H: H, gender: p.gender, isF: p.gender === 'female', fat: fat, bmi: bmi,
      q: q, L: L, sw: sw, sec: sec, spine: spine, spineZ: spineZ, limb: limb,
      headZ: 0.012 * H, chinY: L.chin * H, headTop: L.top * H,
      lerp: lerp, clamp: clamp, V: V
    };
  }
  /* ---------------- 造件用的小工具 ---------------- */

  /** 椭球：给三个半轴长，比反复写 scale 清楚 */
  function ell(c, rx, ry, rz, f, seg) {
    return G.blob(c, 1, f || null, { x: rx, y: ry, z: rz }, seg || 18);
  }

  /** 顺着一串控制点长出一条管子：肠管、气管、血管、脊髓、韧带都靠它 */
  function poly(pts, r, rad, seg) {
    var c = new THREE.CatmullRomCurve3(pts);
    var n = seg || Math.max(10, (pts.length - 1) * 8);
    return new THREE.Mesh(new THREE.TubeGeometry(c, n, r, rad || 8, false));
  }

  /* ---------------- 装配 ---------------- */

  function build(p) {
    var cx = context(p);
    var H = cx.H;
    var group = new THREE.Group();
    var items = [];
    var mats = {};
    var sys = {};
    var seq = 0;

    SYSTEMS.forEach(function (s) {
      var g = new THREE.Group();
      group.add(g);
      sys[s.id] = {
        id: s.id, name: s.name, note: s.note || '', priv: !!s.priv,
        color: s.color, op: s.op, group: g, items: [], mats: [],
        levels: levels(s), depth: 0, on: s.on !== false
      };
    });

    /** 同一图层里同色的件共用一份材质：不透明度是这一层定死的，滑块只管剥层 */
    function material(sid, color) {
      var key = sid + ':' + color;
      if (mats[key]) return mats[key];
      var op = sys[sid].op;
      var m = new THREE.MeshStandardMaterial({
        color: color, roughness: 0.62, metalness: 0.02,
        transparent: op < 0.995, opacity: op, depthWrite: op > 0.9
      });
      mats[key] = m;
      sys[sid].mats.push(m);
      return m;
    }
    /** 登记一件结构：一件可以由多个网格拼成（椎骨=椎体+棘突），但只算一个可点的部位
     *  opt.lv：属于这一层的第几级（默认 0，最外面那级）
     *  opt.to：剥到第几级为止还留着（默认一直留着；外壳类的件写 0，剥开就该消失） */
    function item(sid, name, meshes, opt) {
      opt = opt || {};
      var s = sys[sid];
      var mat = material(sid, opt.color || s.color);
      var list = [].concat(meshes);
      /* 没写涂层归属的（程序化的件都没写），按名字查 PROC_LV */
      if (opt.lv == null && opt.to == null) {
        var d = procLv(sid, name);
        if (d) { if (d.lv != null) opt.lv = d.lv; if (d.to != null) opt.to = d.to; }
      }
      var lv = Math.min(opt.lv || 0, s.levels.length - 1);
      var it = {
        id: ++seq, sys: sid, sysName: s.name, name: name,
        note: opt.note || '', side: opt.side || '', meshes: list,
        lv: lv, to: opt.to == null ? 99 : opt.to,
        lvName: (s.levels[lv] || s.levels[0]).n,
        off: false, center: new V(), radius: 1
      };
      var box = new THREE.Box3();
      list.forEach(function (m) {
        m.material = mat;
        m.userData.item = it;
        m.updateMatrix();
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
        s.group.add(m);
      });
      box.getCenter(it.center);
      it.radius = Math.max(0.6, box.getSize(new V()).length() * 0.5);
      s.items.push(it);
      items.push(it);
      return it;
    }

    cx.ell = ell;
    cx.tube = G.tube;
    cx.blob = G.blob;
    cx.frame = G.frame;
    cx.poly = poly;
    cx.item = item;

    /* 体表外壳：直接借体表页那套人体，藏掉内衣与外生殖器，材质换成半透明的 */
    var shell = BM.build(withArm(p));
    var shellMat = shellMaterial(sys.skin.color, sys.skin.op);
    shell.group.traverse(function (o) {
      if (!o.isMesh) return;
      o.material = shellMat;
      o.renderOrder = 2;
    });
    (shell.wear || []).forEach(function (m) { m.visible = false; });
    (shell.priv || []).forEach(function (m) { m.visible = false; });
    sys.skin.group.add(shell.group);
    sys.skin.shellMat = shellMat;
    sys.skin.items.push({
      id: ++seq, sys: 'skin', sysName: sys.skin.name, name: '体表(皮肤)',
      note: '半透明外壳，用来判断内部结构在体表的哪个位置', meshes: [],
      lv: 0, to: 99, lvName: '皮肤', off: false,
      center: new V(0, H * 0.52, 0), radius: H * 0.3
    });
    /* 内部结构：真实解剖模式用 assets/inner 里下载好的包（缺的小件再用程序化的补），
       程序化模式用 inner-bones / inner-organs / inner-muscle 现算的示意结构 */
    var real = 0, extra = 0;
    if (MODE === 'real' && window.InnerMesh) real = window.InnerMesh.attach(cx);
    if (!real) {
      if (window.InnerBones) window.InnerBones.build(cx);
      if (window.InnerOrgans) window.InnerOrgans.build(cx);
      if (window.InnerMuscle) window.InnerMuscle.build(cx);
    } else if (window.InnerExtra) {
      extra = window.InnerExtra.build(cx, window.InnerMesh.loaded());
    }

    var model = {
      group: group, systems: SYSTEMS.map(function (s) { return sys[s.id]; }),
      sys: sys, items: items, height: H, cx: cx, real: !!real, extra: extra,
      landmarks: shell.landmarks,
      _shell: shell
    };

    /** 体表标注页的标记存的是 A 字站姿下的坐标。真实解剖模式里外壳的手臂换成了标本那副
     *  几乎垂着的姿势，手臂上的标记得跟着搬过去，不然会飘在半透明皮肤外面；
     *  躯干、头、腿的点原样返回。程序化模式两边姿势一样，直接照抄。 */
    model.fromAnnot = (MODE === 'real')
      ? poseMap(H, armChain(H, cx.q, ARM_A), armChain(H, cx.q, ARM_REAL))
      : function (p) { return p.clone(); };

    /** 一件此刻该不该露出来：自己没被单独藏起来，且当前剥到的深度落在它的区间里 */
    function shown(it) {
      var s = sys[it.sys];
      return !it.off && it.lv <= s.depth && s.depth <= it.to;
    }

    /** 把所有图层的显示状态重刷一遍（改深度、开关图层、单独藏某件之后都要叫它） */
    model.refresh = function () {
      SYSTEMS.forEach(function (s0) {
        var s = sys[s0.id];
        s.group.visible = s.on;
        s.items.forEach(function (it) {
          var v = shown(it);
          it.meshes.forEach(function (m) { m.visible = v; });
        });
      });
    };

    /** 剥到第几级：0 是这一层的外表面，越大越里面（超出范围自动夹住） */
    model.setDepth = function (sid, d) {
      var s = sys[sid];
      if (!s) return;
      s.depth = clamp(Math.round(d) || 0, 0, s.levels.length - 1);
      model.refresh();
    };

    /** 整层开关：关掉的层不显示也不参与拾取 */
    model.setShown = function (sid, on) {
      var s = sys[sid];
      if (!s) return;
      s.on = !!on;
      model.refresh();
    };

    /** 单独藏 / 显示某一件（按名字，重建模型后还能落回同一件） */
    model.setItemOff = function (name, off) {
      items.forEach(function (it) { if (it.name === name) it.off = !!off; });
      model.refresh();
    };

    /** 当前能点到的网格：关掉的层、剥掉的级、单独藏起来的件都不算 */
    model.pickable = function () {
      var out = [];
      SYSTEMS.forEach(function (s0) {
        var s = sys[s0.id];
        if (!s.on) return;
        s.items.forEach(function (it) {
          if (!shown(it)) return;
          it.meshes.forEach(function (m) { out.push(m); });
        });
      });
      return out;
    };

    /** 离某个点最近的几件内部结构：体表标注「这一处底下是什么」靠它回答。
     *  剥到里层才有的细节（肺泡、骨髓）不参与，除非那一级此刻正开着 */
    model.near = function (point, n) {
      var list = items.filter(function (it) {
        return it.meshes.length && (it.lv === 0 || shown(it));
      }).map(function (it) {
        return { item: it, d: Math.max(0, it.center.distanceTo(point) - it.radius * 0.8) };
      });
      list.sort(function (a, b) { return a.d - b.d; });
      return list.slice(0, n || 5);
    };
    model.dispose = function () {
      /* 真实解剖那份几何在多次重建之间共用（inner-mesh 里缓存着），不能在这里释放 */
      group.traverse(function (o) {
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      });
      Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
      shellMat.dispose();
      Object.keys(shell.materials).forEach(function (k) {
        if (shell.materials[k] && shell.materials[k].dispose) shell.materials[k].dispose();
      });
    };

    SYSTEMS.forEach(function (s) { model.setDepth(s.id, 0); });
    model.refresh();
    return model;
  }

  window.InnerModel = {
    build: build, SYSTEMS: SYSTEMS, levels: levels,
    setMode: setMode, mode: function () { return MODE; }
  };
})();

