/* inner-bones.js —— 骨骼图层：脊柱（逐节命名）、胸廓、颅骨、上下肢与骨盆
 * 由 inner-model.js 传入的 cx 定位，所有尺寸都是身高的比例
 */
(function () {
  'use strict';

  var V = THREE.Vector3;
  var Z = new V(0, 0, 1);

  /* 脊柱分段：[名字, 代号, 起始高度比例, 结束高度比例, 节数, 椎体半径×H, 椎体高×H] */
  var SPINE = [
    { name: '颈椎', tag: 'C', f0: 0.876, f1: 0.808, n: 7, r: 0.0098, h: 0.0092 },
    { name: '胸椎', tag: 'T', f0: 0.796, f1: 0.642, n: 12, r: 0.0122, h: 0.0128 },
    { name: '腰椎', tag: 'L', f0: 0.634, f1: 0.558, n: 5, r: 0.0162, h: 0.0170 }
  ];

  /* 肋骨：12 对。kW 是该层半宽的占比（第 7、8 对最宽），deg 是从后正中线绕到前面的角度，
     drop 是从脊柱绕到胸骨时往下掉多少（肋骨是斜着往下走的，不是水平圈） */
  var RIB = {
    kW: [0.42, 0.56, 0.67, 0.75, 0.80, 0.84, 0.86, 0.86, 0.83, 0.77, 0.66, 0.52],
    deg: [132, 144, 150, 152, 152, 150, 147, 138, 126, 112, 92, 70],
    drop: [0.010, 0.015, 0.020, 0.025, 0.029, 0.033, 0.037, 0.041, 0.044, 0.046, 0.030, 0.022]
  };

  function build(cx) {
    var H = cx.H, item = cx.item, ell = cx.ell, tube = cx.tube, poly = cx.poly;
    var CART = 0xd9d2be;                     /* 软骨、椎间盘：比骨头灰一点 */

    /** 胸廓某一层的中心与半深：肋骨和胸骨都按它算，才会在前面对上 */
    function ribBox(f) {
      var s = cx.sec(f);
      var zb = cx.spineZ(f);
      var zf = s.bF * 0.62;                  /* 胸骨前面还压着一层胸肌／乳房 */
      return { zc: (zb + zf) / 2, dz: (zf - zb) / 2, a: s.a, zf: zf };
    }
    /* ---------------- 脊柱：24 节活动椎骨逐节成件 ---------------- */
    var vert = [];                           /* 记下每节的位置，椎间盘和肋骨都要挂上去 */
    SPINE.forEach(function (g) {
      for (var i = 0; i < g.n; i++) {
        var f = cx.lerp(g.f0, g.f1, i / (g.n - 1));
        var y = f * H, z = cx.spineZ(f), r = g.r * H, h = g.h * H;
        var code = g.tag + (i + 1);
        var ms = [tube(new V(0, y - h * 0.5, z), new V(0, y + h * 0.5, z), r, r * 1.04, { seg: 14, steps: 2 })];
        /* 棘突：胸椎又长又斜（背部正中一排摸到的就是它），颈腰段短而平 */
        var sp = g.tag === 'T' ? 1.0 : (g.tag === 'L' ? 0.70 : 0.52);
        ms.push(tube(new V(0, y, z - r * 0.8),
          new V(0, y - h * sp, z - r - h * sp * 1.2), r * 0.42, r * 0.24, { seg: 10, steps: 3 }));
        if (g.tag !== 'C') {                 /* 横突：胸椎上是肋骨的着力点 */
          [1, -1].forEach(function (s) {
            ms.push(tube(new V(0, y, z - r * 0.5),
              new V(s * r * 1.9, y + h * 0.10, z - r * 0.95), r * 0.30, r * 0.22, { seg: 8, steps: 2 }));
          });
        }
        var nm = '第' + (i + 1) + g.name + '(' + code + ')', note = '';
        if (g.tag === 'C' && i === 0) { nm = '第1颈椎(C1 寰椎)'; note = '托住颅骨的一节，点头的关节在这里'; }
        if (g.tag === 'C' && i === 1) { nm = '第2颈椎(C2 枢椎)'; note = '摇头（左右转）的关节在这里'; }
        if (g.tag === 'C' && i === 6) { note = '低头时后颈最突出的那个骨头尖'; }
        if (g.tag === 'T') { note = '第' + (i + 1) + '对肋骨从这一节长出去'; }
        if (g.tag === 'L') { note = '腰段承重最大，闪腰、腰痛多在这几节之间'; }
        var it = item('bone', nm, ms, { note: note });
        vert.push({ code: code, tag: g.tag, gname: g.name, idx: i, f: f, y: y, z: z, r: r, h: h, item: it });
      }
    });

    /* ---------------- 椎间盘 ----------------
       C1/C2 之间没有盘（那是个转轴关节），所以从 C2/C3 一直排到 L5/骶骨 */
    function disc(hi, lo, nm, note) {
      var r = (hi.r + lo.r) / 2;
      var m = tube(new V(0, lo.y + lo.h * 0.5, lo.z), new V(0, hi.y - hi.h * 0.5, hi.z),
        r * 1.02, r * 1.02, { seg: 14, steps: 2 });
      return item('bone', nm, [m], { note: note, color: CART });
    }
    for (var vi = 1; vi < vert.length - 1; vi++) {
      var lo = vert[vi + 1], hi = vert[vi];   /* vert 是自上而下排的 */
      var nm2, nt2 = '';
      if (lo.tag === hi.tag) nm2 = '第' + (hi.idx + 1) + '-' + (lo.idx + 1) + hi.gname + '间盘(' + hi.code + '/' + lo.code + ')';
      else nm2 = '椎间盘(' + hi.code + '/' + lo.code + ')';
      if (hi.tag === 'L' && hi.idx >= 2) nt2 = '腰4/5、腰5/骶1 是腰间盘突出最常见的位置';
      disc(hi, lo, nm2, nt2);
    }
    /* ---------------- 骶骨与尾骨 ---------------- */
    var L5 = vert[vert.length - 1];
    var syT = 0.545, syB = 0.504;
    var szT = cx.spineZ(syT), szB = cx.spineZ(syB) - 0.010 * H;
    var sacTop = { y: (syT - 0.004) * H, z: szT, r: 0.026 * H, h: 0.008 * H };
    disc(L5, sacTop, '第5腰椎-骶骨间盘(L5/S1)', '腰间盘突出最常见的一处，压到神经会顺着腿往下麻');

    var sacM = tube(new V(0, syT * H, szT), new V(0, syB * H, szB), 0.028 * H, 0.011 * H, { seg: 16, steps: 4, ref: Z });
    sacM.scale.set(1, 1, 0.52);
    item('bone', '骶骨(S1-S5)', [sacM], { note: '5 节骶椎长在一起的一块三角骨，卡在两侧髂骨之间' });
    var cocM = tube(new V(0, syB * H, szB), new V(0, 0.489 * H, szB + 0.014 * H), 0.009 * H, 0.004 * H, { seg: 12, steps: 3, ref: Z });
    item('bone', '尾骨', [cocM], { note: '脊柱最末端，往前弯；摔坐在地上容易伤到这里' });

    /* ---------------- 颅骨 ---------------- */
    var hh = cx.headTop - cx.chinY, hz = cx.headZ;
    item('bone', '颅骨(脑颅)', [ell(new V(0, cx.chinY + 0.66 * hh, hz - 0.006 * H), 0.042 * H, 0.044 * H, 0.048 * H, null, 20)],
      { note: '包住大脑的那一圈骨头' });
    item('bone', '面颅(上颌骨与颧骨)', [ell(new V(0, cx.chinY + 0.30 * hh, hz + 0.010 * H), 0.033 * H, 0.026 * H, 0.034 * H, null, 16)],
      { note: '眼眶下方到上排牙齿这一片' });
    item('bone', '下颌骨', [poly([
      new V(0.034 * H, cx.chinY + 0.30 * hh, hz - 0.026 * H),
      new V(0.032 * H, cx.chinY + 0.13 * hh, hz - 0.004 * H),
      new V(0.020 * H, cx.chinY + 0.05 * hh, hz + 0.024 * H),
      new V(0, cx.chinY + 0.045 * hh, hz + 0.030 * H),
      new V(-0.020 * H, cx.chinY + 0.05 * hh, hz + 0.024 * H),
      new V(-0.032 * H, cx.chinY + 0.13 * hh, hz - 0.004 * H),
      new V(-0.034 * H, cx.chinY + 0.30 * hh, hz - 0.026 * H)
    ], 0.0068 * H, 8)], { note: '下排牙齿所在的活动骨头，两端的关节就在耳朵前面' });
    /* ---------------- 胸廓：12 对肋骨 + 胸骨 ----------------
       肋骨不是水平的圈：从椎骨出发绕到前面时会往下掉一截，所以用极角参数化，
       第 1～7 对再补一段肋软骨接到胸骨上 */
    var thor = vert.filter(function (v) { return v.tag === 'T'; });
    thor.forEach(function (v, i) {
      var box = ribBox(v.f);
      var th1 = RIB.deg[i] * Math.PI / 180;
      var w = box.a * RIB.kW[i], drop = RIB.drop[i] * H;
      [1, -1].forEach(function (side) {
        var pts = [];
        for (var k = 0; k <= 8; k++) {
          var th = th1 * k / 8;
          pts.push(new V(side * w * Math.sin(th), v.y - drop * (k / 8), box.zc - box.dz * Math.cos(th)));
        }
        if (i < 7) {                          /* 肋软骨：斜着接到胸骨侧缘 */
          var fa = cx.lerp(0.776, 0.682, i / 6);
          pts.push(new V(side * 0.016 * H, fa * H, ribBox(fa).zf * 0.97));
        }
        var nm = (side > 0 ? '左' : '右') + '第' + (i + 1) + '肋骨';
        var note = i >= 10 ? '浮肋：前端不接胸骨，只连在腰侧的肌肉里' :
          (i >= 7 ? '前端不直接接胸骨，而是并到上一条肋软骨上，合成肋弓' : '');
        item('bone', nm, [poly(pts, 0.0055 * H, 6)], { side: side > 0 ? '左' : '右', note: note });
      });
    });

    var stT = 0.780, stB = 0.688;
    var stM = tube(new V(0, stT * H, ribBox(stT).zf), new V(0, stB * H, ribBox(stB).zf),
      0.023 * H, 0.014 * H, { seg: 14, steps: 4, ref: Z });
    stM.scale.set(1, 1, 0.30);
    item('bone', '胸骨', [stM], { note: '前胸正中那根竖着的板骨，两侧接着肋软骨' });
    var xiM = tube(new V(0, stB * H, ribBox(stB).zf), new V(0, 0.672 * H, ribBox(0.672).zf * 0.98),
      0.009 * H, 0.004 * H, { seg: 12, steps: 3, ref: Z });
    xiM.scale.set(1, 1, 0.42);
    item('bone', '剑突', [xiM], { note: '胸骨最下端的小尖，摸上去像个硬块，本来就有' });

    [1, -1].forEach(function (side) {
      var sn = side > 0 ? '左' : '右';
      item('bone', sn + '锁骨', [poly([
        new V(side * 0.013 * H, 0.778 * H, ribBox(0.778).zf * 0.95),
        new V(side * cx.sw * 0.22, 0.789 * H, ribBox(0.778).zf * 0.50),
        new V(side * cx.sw * 0.44, 0.792 * H, -0.004 * H)
      ], 0.0062 * H, 8)], { side: sn, note: '颈根前面摸得到的一横条，内端接胸骨、外端接肩峰' });

      var bB = cx.sec(0.752).bB;
      item('bone', sn + '肩胛骨', [
        ell(new V(side * cx.sw * 0.30, 0.752 * H, -bB * 0.70), 0.032 * H, 0.048 * H, 0.009 * H, null, 14),
        ell(new V(side * cx.sw * 0.44, 0.790 * H, -0.008 * H), 0.014 * H, 0.008 * H, 0.016 * H, null, 12)
      ], { side: sn, note: '后背上部的三角形板骨，外上角的肩峰就是肩膀最高点' });
    });
    /* ---------------- 上肢：肱骨、尺桡骨、手骨 ----------------
       手指的横向摊开要用「肢体轴 × 竖直」算出来的侧向，直接用 ±X 在抬手的姿势下会歪 */
    var FING = [
      { nm: '拇指', lat: 0.026, mc: 0.034, tip: 0.062, n: 2 },
      { nm: '食指', lat: 0.013, mc: 0.056, tip: 0.098, n: 3 },
      { nm: '中指', lat: 0.001, mc: 0.058, tip: 0.104, n: 3 },
      { nm: '无名指', lat: -0.012, mc: 0.055, tip: 0.098, n: 3 },
      { nm: '小指', lat: -0.023, mc: 0.050, tip: 0.086, n: 3 }
    ];

    ['l', 'r'].forEach(function (k) {
      var b = cx.limb[k], sn = b.sn, side = b.side;
      var lat = new V().crossVectors(b.d2, Z).normalize();
      if (lat.x * side < 0) lat.negate();                 /* lat 指向身体外侧＝拇指那一侧 */
      var pd = new V().crossVectors(lat, b.d2).normalize();  /* 掌心朝向 */

      item('bone', sn + '肱骨', [
        ell(b.shoulder.clone(), 0.017 * H, 0.017 * H, 0.017 * H, null, 14),
        tube(b.shoulder.clone().addScaledVector(b.d1, 0.012 * H), b.elbow, 0.012 * H, 0.014 * H, { seg: 14, steps: 4 })
      ], { side: sn, note: '上臂里唯一的一根长骨，上端的球头装在肩窝里' });

      item('bone', sn + '尺骨', [tube(
        b.elbow.clone().addScaledVector(lat, -0.007 * H).addScaledVector(b.d2, -0.010 * H),
        b.wrist.clone().addScaledVector(lat, -0.010 * H), 0.012 * H, 0.006 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '小指那一侧的骨头，上端就是摸到的肘尖' });
      item('bone', sn + '桡骨', [tube(
        b.elbow.clone().addScaledVector(lat, 0.010 * H).addScaledVector(b.d2, 0.006 * H),
        b.wrist.clone().addScaledVector(lat, 0.011 * H), 0.008 * H, 0.011 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '拇指那一侧的骨头，摔倒时手撑地最容易断的地方' });

      /** 手上某点：沿肢体轴走 d，横向偏 s，掌心方向偏 p（都按身高比例） */
      function hp(d, s, p) {
        return b.wrist.clone().addScaledVector(b.d2, d * H)
          .addScaledVector(lat, s * H).addScaledVector(pd, (p || 0) * H);
      }
      item('bone', sn + '腕骨(8块)', [ell(hp(0.016, 0), 0.019 * H, 0.013 * H, 0.011 * H, null, 14)],
        { side: sn, note: '腕关节里那一堆小骨头，腕痛、腕管问题都在这一带' });

      var mcs = [], phs = [];
      FING.forEach(function (fg) {
        var pOff = fg.nm === '拇指' ? 0.012 : 0;
        var a0 = hp(0.026, fg.lat * 0.40, pOff * 0.5);
        var a1 = hp(fg.mc, fg.lat, pOff);
        mcs.push(tube(a0, a1, 0.0046 * H, 0.0038 * H, { seg: 8, steps: 2 }));
        for (var j = 0; j < fg.n; j++) {       /* 指骨：拇指 2 节，其余 3 节 */
          var t0 = j / fg.n, t1 = (j + 1) / fg.n - 0.10 / fg.n;
          phs.push(tube(
            hp(cx.lerp(fg.mc, fg.tip, t0), fg.lat, pOff),
            hp(cx.lerp(fg.mc, fg.tip, t1), fg.lat, pOff),
            0.0036 * H - j * 0.0004 * H, 0.0032 * H - j * 0.0004 * H, { seg: 8, steps: 2 }));
        }
      });
      item('bone', sn + '掌骨(5块)', mcs, { side: sn, note: '手背上摸到的 5 根长骨，握拳时指关节就是它们的头' });
      item('bone', sn + '指骨(14块)', phs, { side: sn, note: '拇指 2 节，其余每指 3 节' });
    });
    /* ---------------- 骨盆与下肢 ----------------
       髂骨是一块朝外的薄板（所以左右方向最薄），下缘的窝接股骨头，
       后下方是坐骨结节（坐着时压在椅子上的那块），前下方两侧在正中合成耻骨联合 */
    var TOE = [
      { nm: '第1(大)', x: -0.020, mc: 0.055, tip: 0.103, n: 2 },
      { nm: '第2', x: -0.010, mc: 0.065, tip: 0.106, n: 3 },
      { nm: '第3', x: 0.000, mc: 0.064, tip: 0.100, n: 3 },
      { nm: '第4', x: 0.010, mc: 0.060, tip: 0.092, n: 3 },
      { nm: '第5(小)', x: 0.020, mc: 0.054, tip: 0.082, n: 3 }
    ];

    ['l', 'r'].forEach(function (k) {
      var b = cx.limb[k], sn = b.sn, side = b.side;
      var hipX = Math.abs(b.hip.x);
      var zPub = cx.sec(0.505).bF * 0.52;

      item('bone', sn + '髂骨(髋骨)', [
        ell(new V(side * cx.sec(0.560).a * 0.66, 0.543 * H, -0.002 * H), 0.013 * H, 0.038 * H, 0.036 * H, null, 16)
      ], { side: sn, note: '腰两侧摸到的那圈骨头边（髂骨翼），下缘的窝就是髋关节' });
      item('bone', sn + '坐骨(坐骨结节)', [
        tube(new V(side * hipX * 0.95, 0.503 * H, -0.008 * H), new V(side * 0.036 * H, 0.489 * H, -0.024 * H),
          0.009 * H, 0.008 * H, { seg: 10, steps: 3 }),
        ell(new V(side * 0.036 * H, 0.488 * H, -0.026 * H), 0.013 * H, 0.011 * H, 0.013 * H, null, 12)
      ], { side: sn, note: '坐着时压在椅面上的那块骨头，久坐酸痛常在这里' });
      item('bone', sn + '耻骨', [
        tube(new V(side * (hipX - 0.004 * H), 0.507 * H, 0.010 * H), new V(side * 0.009 * H, 0.500 * H, zPub),
          0.009 * H, 0.007 * H, { seg: 10, steps: 3 })
      ], { side: sn, note: '正中两块耻骨的接缝叫耻骨联合，生育时会略微松开' });
      item('bone', sn + '髋关节(髋臼)', [ell(b.hip.clone(), 0.022 * H, 0.022 * H, 0.022 * H, null, 14)],
        { side: sn, note: '大腿骨的球头就插在这个窝里，位置比很多人想的更靠内、更靠上', color: CART });

      var trX = side * (hipX + 0.026 * H);
      var shTop = new V(trX, b.hip.y - 0.012 * H, b.hip.z);
      item('bone', sn + '股骨(大腿骨)', [
        ell(b.hip.clone(), 0.017 * H, 0.017 * H, 0.017 * H, null, 14),
        tube(b.hip, shTop, 0.012 * H, 0.015 * H, { seg: 12, steps: 3 }),
        tube(shTop, b.knee, 0.015 * H, 0.014 * H, { seg: 14, steps: 4 })
      ], { side: sn, note: '全身最长的骨头；上端外侧的大转子就是髋部外面摸到的硬点' });
      item('bone', sn + '髌骨(膝盖骨)', [
        ell(new V(b.knee.x, b.knee.y + 0.008 * H, b.knee.z + 0.032 * H), 0.015 * H, 0.017 * H, 0.008 * H, null, 14)
      ], { side: sn, note: '膝盖前面那块活动的小圆骨，藏在大腿肌肉的肌腱里' });
      item('bone', sn + '胫骨(小腿骨)', [tube(
        new V(b.knee.x - side * 0.005 * H, b.knee.y - 0.008 * H, b.knee.z),
        b.ankle, 0.016 * H, 0.011 * H, { seg: 14, steps: 4 })],
        { side: sn, note: '小腿前面能直接摸到骨头的那一根，内踝是它的下端' });
      item('bone', sn + '腓骨', [tube(
        new V(b.knee.x + side * 0.020 * H, b.knee.y - 0.022 * H, b.knee.z - 0.002 * H),
        new V(b.ankle.x + side * 0.014 * H, b.ankle.y + 0.004 * H, b.ankle.z), 0.008 * H, 0.006 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '小腿外侧细的那根，上端的头和下端的外踝都摸得到' });

      /** 足上某点：横向偏 s、前后偏 z（相对踝，按身高比例） */
      function fp(s, y, z) { return new V(b.ankle.x + side * s * H, y * H, b.ankle.z + z * H); }
      item('bone', sn + '跟骨(脚跟)', [ell(fp(0, 0.022, -0.040), 0.016 * H, 0.021 * H, 0.028 * H, null, 14)],
        { side: sn, note: '脚后跟那块大骨头，跟腱接在它后上方，足底筋膜接在它前下方' });
      item('bone', sn + '跗骨(足舟骨等)', [ell(fp(0, 0.033, 0.012), 0.020 * H, 0.015 * H, 0.020 * H, null, 14)],
        { side: sn, note: '脚背中间那一堆小骨头，足弓就靠它们架起来' });
      var mts = [], tph = [];
      TOE.forEach(function (t) {
        mts.push(tube(fp(t.x * 0.35, 0.026, 0.024), fp(t.x, 0.015, t.mc), 0.0050 * H, 0.0040 * H, { seg: 8, steps: 2 }));
        for (var j = 0; j < t.n; j++) {
          var t0 = j / t.n, t1 = (j + 1) / t.n - 0.12 / t.n;
          tph.push(tube(fp(t.x, 0.012, cx.lerp(t.mc, t.tip, t0)), fp(t.x, 0.011, cx.lerp(t.mc, t.tip, t1)),
            0.0040 * H - j * 0.0005 * H, 0.0036 * H - j * 0.0005 * H, { seg: 8, steps: 2 }));
        }
      });
      item('bone', sn + '跖骨(5块)', mts, { side: sn, note: '脚背上的 5 根长骨，走路多了容易疲劳性骨折的部位' });
      item('bone', sn + '趾骨(14块)', tph, { side: sn, note: '大脚趾 2 节，其余每趾 3 节' });
    });
  }

  window.InnerBones = { build: build };
})();

