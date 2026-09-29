/**
 * 程序化生成天体贴图 —— 不依赖任何外部图片，页面可离线打开。
 * 贴图只为让"月球始终以同一面朝向地球"和地球自转肉眼可辨，精度无需很高。
 */
var Textures = (function () {

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function toTexture(c) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  /** 月球：灰白底 + 月海暗斑 + 撞击坑 */
  function moon() {
    var W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#b5b0a6';
    g.fillRect(0, 0, W, H);

    // 月海：几块大面积暗区，集中在正面（贴图中部）
    var maria = [
      [0.30, 0.30, 0.10, 0.07], [0.38, 0.40, 0.07, 0.055], [0.22, 0.42, 0.05, 0.05],
      [0.44, 0.27, 0.06, 0.05], [0.52, 0.36, 0.045, 0.04], [0.33, 0.52, 0.06, 0.04],
      [0.18, 0.31, 0.04, 0.035], [0.60, 0.44, 0.035, 0.03]
    ];
    maria.forEach(function (m) {
      var grd = g.createRadialGradient(m[0] * W, m[1] * H, 0, m[0] * W, m[1] * H, m[2] * W);
      grd.addColorStop(0, 'rgba(104,102,100,.92)');
      grd.addColorStop(0.75, 'rgba(126,123,118,.55)');
      grd.addColorStop(1, 'rgba(140,136,130,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(m[0] * W, m[1] * H, m[2] * W, m[3] * H, 0, 0, Math.PI * 2);
      g.fill();
    });

    // 撞击坑：暗底 + 朝一侧的亮缘，制造起伏感
    for (var i = 0; i < 420; i++) {
      var x = Math.random() * W,
          y = Math.random() * H,
          r = Math.pow(Math.random(), 2.4) * 22 + 1.6;
      g.fillStyle = 'rgba(88,85,82,' + (0.10 + Math.random() * 0.22) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(226,222,214,' + (0.10 + Math.random() * 0.22) + ')';
      g.lineWidth = Math.max(0.7, r * 0.17);
      g.beginPath(); g.arc(x - r * 0.12, y - r * 0.12, r * 0.94, 0, Math.PI * 2); g.stroke();
    }

    // 细颗粒，避免大面积纯色
    for (var j = 0; j < 4200; j++) {
      g.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.05 + ')';
      g.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
    }
    return toTexture(c);
  }

  /** 地球：海洋底 + 大陆块 + 极冠 */
  function earth() {
    var W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d');
    var ocean = g.createLinearGradient(0, 0, 0, H);
    ocean.addColorStop(0, '#12406e');
    ocean.addColorStop(0.5, '#1a6fb5');
    ocean.addColorStop(1, '#12406e');
    g.fillStyle = ocean;
    g.fillRect(0, 0, W, H);

    // 大陆：以若干中心点堆叠不规则圆团，形成有海岸线感的块
    function landmass(cx, cy, scale, blobs) {
      for (var i = 0; i < blobs; i++) {
        var a = Math.random() * Math.PI * 2,
            d = Math.pow(Math.random(), 0.6) * scale,
            x = cx * W + Math.cos(a) * d * W * 0.5,
            y = cy * H + Math.sin(a) * d * H * 0.5,
            r = (0.012 + Math.random() * 0.035) * W * (1 - d / scale * 0.5);
        var green = 96 + Math.random() * 54;
        g.fillStyle = 'rgb(' + Math.round(56 + Math.random() * 40) + ',' +
                      Math.round(green) + ',' + Math.round(48 + Math.random() * 30) + ')';
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
    landmass(0.18, 0.34, 0.20, 90);  // 北美
    landmass(0.24, 0.66, 0.15, 60);  // 南美
    landmass(0.50, 0.36, 0.13, 55);  // 欧洲
    landmass(0.54, 0.60, 0.20, 95);  // 非洲
    landmass(0.72, 0.36, 0.24, 120); // 亚洲
    landmass(0.85, 0.74, 0.11, 40);  // 澳洲

    // 极冠
    [[0, '#eef4fb'], [H, '#e6eef8']].forEach(function (p) {
      var grd = g.createLinearGradient(0, p[0], 0, p[0] === 0 ? H * 0.13 : H * 0.87);
      grd.addColorStop(0, p[1]);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, p[0] === 0 ? 0 : H * 0.87, W, H * 0.13);
    });

    // 云带
    for (var k = 0; k < 150; k++) {
      var cw = 20 + Math.random() * 130, ch = 5 + Math.random() * 16;
      g.fillStyle = 'rgba(255,255,255,' + (0.07 + Math.random() * 0.2) + ')';
      g.beginPath();
      g.ellipse(Math.random() * W, Math.random() * H, cw, ch, 0, 0, Math.PI * 2);
      g.fill();
    }
    return toTexture(c);
  }

  /** 太阳：亮黄自发光表面，带米粒组织 */
  function sun() {
    var S = 512, c = canvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#ffd872';
    g.fillRect(0, 0, S, S);
    for (var i = 0; i < 2600; i++) {
      var r = 2 + Math.random() * 12;
      g.fillStyle = Math.random() > 0.45
        ? 'rgba(255,255,232,' + Math.random() * 0.55 + ')'
        : 'rgba(246,146,38,' + Math.random() * 0.4 + ')';
      g.beginPath(); g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2); g.fill();
    }
    return toTexture(c);
  }

  /** 星空：黑底白点，作为场景背景球的内壁贴图 */
  function stars() {
    var W = 2048, H = 1024, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#04060d';
    g.fillRect(0, 0, W, H);
    for (var i = 0; i < 2200; i++) {
      var x = Math.random() * W, y = Math.random() * H,
          r = Math.pow(Math.random(), 3) * 1.7 + 0.28,
          a = 0.25 + Math.random() * 0.75;
      g.fillStyle = 'rgba(255,255,255,' + a + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // 几片微弱星云
    for (var j = 0; j < 16; j++) {
      var nx = Math.random() * W, ny = Math.random() * H, nr = 90 + Math.random() * 230;
      var grd = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      grd.addColorStop(0, 'rgba(94,124,196,.075)');
      grd.addColorStop(1, 'rgba(94,124,196,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(nx, ny, nr, 0, Math.PI * 2); g.fill();
    }
    return toTexture(c);
  }

  return { moon: moon, earth: earth, sun: sun, stars: stars };
})();
