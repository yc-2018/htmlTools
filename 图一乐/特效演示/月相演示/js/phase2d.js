/**
 * 右半屏：从地球上看到的月相。
 *
 * 绘制思路 —— 先把完整月面画在离屏画布上，正式绘制时画两遍：
 * 整盘压暗一遍得到暗面（地球反照下仍隐约可辨），再把"被太阳照亮的那块"
 * 剪裁出来画一遍亮面。明暗分界（终结线）是一条半宽随月相变化的半椭圆。
 */
var Phase2D = (function () {

  var disk = null, DISK_R = 256;

  /* 固定种子的伪随机，保证每次刷新月面细节一致 */
  function rng(seed) {
    var s = seed;
    return function () {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  /** 离屏绘制一张正对观察者的满月盘 */
  function buildDisk() {
    var R = DISK_R, c = document.createElement('canvas');
    c.width = c.height = R * 2;
    var g = c.getContext('2d'), rand = rng(20260929);

    g.save();
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();

    g.fillStyle = '#cdc7bb';
    g.fillRect(0, 0, R * 2, R * 2);

    // 月海：正面那几块显眼的暗色玄武岩平原
    var maria = [
      [-0.30, -0.36, 0.30, 0.26], [0.04, -0.46, 0.26, 0.20], [0.30, -0.22, 0.22, 0.24],
      [-0.44, 0.02, 0.22, 0.20], [-0.10, -0.08, 0.24, 0.22], [0.20, 0.22, 0.18, 0.16],
      [-0.26, 0.38, 0.20, 0.15], [0.44, 0.30, 0.15, 0.17]
    ];
    maria.forEach(function (m) {
      var x = R + m[0] * R, y = R + m[1] * R, rx = m[2] * R, ry = m[3] * R;
      var grd = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      grd.addColorStop(0, 'rgba(122,118,112,.85)');
      grd.addColorStop(0.72, 'rgba(150,145,136,.5)');
      grd.addColorStop(1, 'rgba(180,174,164,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, y, rx, ry, m[0] * 0.7, 0, Math.PI * 2); g.fill();
    });

    // 撞击坑：越靠边缘越扁，模拟球面的透视收缩
    for (var i = 0; i < 260; i++) {
      var a = rand() * Math.PI * 2,
          d = Math.sqrt(rand()) * R * 0.985,
          x = R + Math.cos(a) * d, y = R + Math.sin(a) * d,
          r = Math.pow(rand(), 2.6) * R * 0.075 + R * 0.006,
          squash = Math.sqrt(Math.max(0.05, 1 - (d / R) * (d / R)));  // 边缘压扁
      g.save();
      g.translate(x, y); g.rotate(a); g.scale(squash, 1);
      g.fillStyle = 'rgba(96,93,88,' + (0.1 + rand() * 0.2) + ')';
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(240,236,228,' + (0.12 + rand() * 0.26) + ')';
      g.lineWidth = Math.max(0.6, r * 0.2);
      g.beginPath(); g.arc(-r * 0.1, -r * 0.1, r * 0.92, 0, Math.PI * 2); g.stroke();
      g.restore();
    }

    // 第谷坑的辐射纹
    (function rays() {
      var cx = R - 0.1 * R, cy = R + 0.62 * R;
      for (var k = 0; k < 26; k++) {
        var a = rand() * Math.PI * 2, len = (0.3 + rand() * 0.8) * R;
        g.strokeStyle = 'rgba(245,242,235,' + (0.05 + rand() * 0.1) + ')';
        g.lineWidth = 1.5 + rand() * 5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.stroke();
      }
      g.fillStyle = 'rgba(248,245,240,.5)';
      g.beginPath(); g.arc(cx, cy, R * 0.035, 0, Math.PI * 2); g.fill();
    })();

    // 临边昏暗：球面边缘接收到的阳光更斜，亮度自然下降
    var limb = g.createRadialGradient(R, R, R * 0.55, R, R, R);
    limb.addColorStop(0, 'rgba(0,0,0,0)');
    limb.addColorStop(1, 'rgba(24,22,20,.42)');
    g.fillStyle = limb;
    g.fillRect(0, 0, R * 2, R * 2);

    g.restore();
    return c;
  }

  /** 月面只生成一次，之后每帧复用 */
  function getDisk() {
    return disk || (disk = buildDisk());
  }

  /**
   * 亮区边界路径 —— 观察者视角版。
   *
   * 在一个随观察者转动的局部坐标里作图：a 轴指向"亮限方向"(bright limb，被照亮那侧
   * 边缘的方位角 psi，由 3D 几何给出)，b 轴与之垂直。对每个 b，月盘半宽 h=√(r²−b²)：
   *   亮限一侧在 a = +h（月盘边缘）
   *   终结线在   a = t·h，其中 t = 1 − 2·照亮比例：
   *     新月 t=+1（终结线贴亮限，无亮区）、上下弦 t=0（半亮）、满月 t=−1（终结线到对侧，全亮）
   * 于是终结线是一条半椭圆。整套 (a,b) 再按 psi 旋进画布坐标，
   * 亮面朝向、终结线倾角就随观察者纬度和月亮在其天空中的位置一起变——
   * 换到南半球时 psi 翻 180°，月相自然左右上下颠倒。
   */
  function litPath(g, cx, cy, r, illum, psi) {
    var t = 1 - 2 * illum,
        ca = Math.cos(psi), sa = Math.sin(psi),
        N = 180, i, b, h;

    // 局部 (a,b) → 画布：a 沿亮限方向，b 垂直；画布 y 向下，故用 cy − imgy
    function line(a, b, first) {
      var x = cx + (a * ca - b * sa),
          y = cy - (a * sa + b * ca);
      if (first) g.moveTo(x, y); else g.lineTo(x, y);
    }

    g.beginPath();
    for (i = 0; i <= N; i++) {                 // 亮限半圆 a=+h
      b = -r + 2 * r * i / N;
      h = Math.sqrt(Math.max(0, r * r - b * b));
      line(h, b, i === 0);
    }
    for (i = N; i >= 0; i--) {                  // 终结线 a=t·h
      b = -r + 2 * r * i / N;
      h = Math.sqrt(Math.max(0, r * r - b * b));
      line(t * h, b, false);
    }
    g.closePath();
  }

  /** 八相名称：以各相的中心点为界划分 */
  function phaseName(p) {
    p = (p % 1 + 1) % 1;
    var e = 1 / 16;   // 新月/上弦/满月/下弦 各自占中心 ±1/16
    if (p < e || p >= 1 - e) return '新月';
    if (p < 0.25 - e) return '蛾眉月';
    if (p < 0.25 + e) return '上弦月';
    if (p < 0.5 - e) return '盈凸月';
    if (p < 0.5 + e) return '满月';
    if (p < 0.75 - e) return '亏凸月';
    if (p < 0.75 + e) return '下弦月';
    return '残月';
  }

  /** 被照亮的面积占比 */
  function illumination(p) {
    return (1 - Math.cos(Math.PI * 2 * p)) / 2;
  }

  /**
   * 把月相画到 2D 画布上 —— 现在是从观察者的实际视线推出来的。
   * @param {CanvasRenderingContext2D} g
   * @param {{illum:number, psi:number}} view
   *        illum 照亮比例(由日-月-地几何算)，psi 亮限在观察者天空里的方位角
   * @param {{state:string, sep:number, ru:number}} [ecl] 月食几何（单位：月球半径）
   */
  function draw(g, view, ecl) {
    var W = g.canvas.width, H = g.canvas.height,
        cx = W / 2, cy = H / 2,
        r = Math.min(W, H) * 0.39,
        src = getDisk(),
        lit = view.illum;

    g.clearRect(0, 0, W, H);

    // 月盘外的微光晕，越接近满月越明显
    var halo = g.createRadialGradient(cx, cy, r, cx, cy, r * 1.85);
    halo.addColorStop(0, 'rgba(198,214,255,' + (0.03 + lit * 0.12) + ')');
    halo.addColorStop(1, 'rgba(198,214,255,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, r * 1.85, 0, Math.PI * 2); g.fill();

    var dx = cx - r, dy = cy - r, dw = r * 2;

    // ① 暗面：整盘画出来再乘一层暗蓝。用 multiply 而不是盖半透明色，
    //    月海和撞击坑的明暗结构才能按比例保留下来 —— 这是"暗面可见"的关键。
    //    现实里这点微光来自地球反照，老话讲的"新月抱旧月"。
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.drawImage(src, dx, dy, dw, dw);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#2b3663';
    g.fillRect(dx, dy, dw, dw);
    g.restore();

    // ② 亮面：剪裁到被阳光照到的那一块，再把原图画一遍。
    //    终结线保持锐利 —— 月球没有大气，明暗分界本来就是一条硬边。
    if (lit > 0.001) {
      g.save();
      litPath(g, cx, cy, r, view.illum, view.psi);
      g.clip();
      g.drawImage(src, dx, dy, dw, dw);
      g.restore();
    }

    // ③ 月食：地影落在月面上。本影里并不是全黑 —— 阳光经地球大气折射后
    //    仍有一部分红光拐进本影，所以月全食是暗铜红色，就是俗称的"血月"。
    //    影圆的半径和偏移都来自 3D 场景的真实几何，不是凑出来的效果。
    if (ecl && ecl.state !== 'none' && ecl.ru > 0) {
      g.save();
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();

      // 地影圆心画在月面右侧 —— 满月时月球从地影的一侧穿过，
      // 这里只取"偏离多远"的量，方位固定，够表达遮挡程度
      var sx = cx + ecl.sep * r, sr = ecl.ru * r;

      g.globalCompositeOperation = 'multiply';
      var deep = g.createRadialGradient(sx, cy, sr * 0.2, sx, cy, sr);
      deep.addColorStop(0, '#5a1c14');      // 本影中心最暗，偏红
      deep.addColorStop(0.82, '#8a3524');
      deep.addColorStop(1, '#c8968a');      // 影边过渡，避免硬边
      g.fillStyle = deep;
      g.beginPath(); g.arc(sx, cy, sr, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // ④ 盘缘细线，把月球从背景里勾出来
    g.strokeStyle = 'rgba(150,170,215,.28)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }

  return {
    draw: draw,
    phaseName: phaseName,
    illumination: illumination
  };
})();
