/* report.js —— 把标注渲染成可保存的图文报告 / 文字摘要 */
(function () {
  'use strict';

  var GENDER_CN = { male: '男', female: '女', neutral: '中性' };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /** 临时改变渲染尺寸与相机，渲染一帧并返回 WebGL 画布 */
  function renderView(app, w, h, theta, phi, target, dist) {
    var r = app.renderer;
    var cam = app.camera;
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    cam.aspect = w / h;
    var sp = Math.sin(phi);
    cam.position.set(
      target.x + dist * sp * Math.sin(theta),
      target.y + dist * Math.cos(phi),
      target.z + dist * sp * Math.cos(theta)
    );
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    /* 号牌是按相机方向摆的，报告用的是另一套机位，渲染前得重新摆一次 */
    if (app.store && app.store.faceCamera) app.store.faceCamera(cam);
    r.render(app.scene, cam);
    return r.domElement;
  }

  /** 正对某个标注的视角 */
  function angleOfNormal(n) {
    return {
      theta: Math.atan2(n.x, n.z),
      phi: clamp(Math.acos(clamp(n.y, -1, 1)), 0.18, Math.PI - 0.18)
    };
  }

  function wrap(g, text, x, y, maxW, lh, maxLines) {
    var line = '';
    var lines = [];
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (g.measureText(test).width > maxW && line) {
        lines.push(line);
        line = text[i];
        if (maxLines && lines.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && (!maxLines || lines.length < maxLines)) lines.push(line);
    lines.forEach(function (t, k) { g.fillText(t, x, y + k * lh); });
    return y + lines.length * lh;
  }
  var W = 1180, PAD = 22, GAP = 16;
  var VW = 560, VH = 720;          // 单个视角图尺寸
  var THUMB = 152;                 // 标注特写缩略图
  var ROW = 176;

  var VIEWS = [
    { name: '正面', theta: 0, phi: Math.PI / 2 },
    { name: '背面', theta: Math.PI, phi: Math.PI / 2 },
    { name: '左侧面', theta: Math.PI / 2, phi: Math.PI / 2 },
    { name: '右侧面', theta: -Math.PI / 2, phi: Math.PI / 2 }
  ];

  function paramLine(p) {
    return '性别 ' + (GENDER_CN[p.gender] || p.gender)
      + ' · 身高 ' + p.height + 'cm'
      + ' · 体重 ' + p.weight + 'kg'
      + ' · 胸围 ' + p.bust + 'cm'
      + ' · 腰围 ' + p.waist + 'cm'
      + ' · 臀围 ' + p.hip + 'cm';
  }

  function head(g, p, n) {
    g.fillStyle = '#0f172a';
    g.font = 'bold 34px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText('身体标注报告', PAD, 50);
    g.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillStyle = '#64748b';
    g.textAlign = 'right';
    g.fillText(today() + ' · 共 ' + n + ' 处标注', W - PAD, 48);
    g.textAlign = 'left';
    g.fillText(paramLine(p), PAD, 80);
    g.strokeStyle = '#e2e8f0';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD, 96.5);
    g.lineTo(W - PAD, 96.5);
    g.stroke();
  }
  /** 让身高 H 的人体在竖直方向铺满画面所需的相机距离 */
  function fitDist(H, fov) {
    return (H * 1.06) / (2 * Math.tan(fov * Math.PI / 360));
  }

  function frameBox(g, x, y, w, h) {
    g.strokeStyle = '#e2e8f0';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /**
   * 生成完整报告画布
   * @param {Object} app { renderer, scene, camera, store, params, helpers }
   * @returns {HTMLCanvasElement}
   */
  function buildImage(app) {
    var items = app.store.items;
    var p = app.params;
    var H = p.height;
    var bodyTarget = new THREE.Vector3(0, H * 0.52, 0);
    var bodyDist = fitDist(H, app.camera.fov);

    var listTop = 96 + 18 + 2 * (VH + 30) + 8;
    var rowsH = items.length ? items.length * ROW : 64;
    var total = listTop + 46 + rowsH + 66;

    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = Math.round(total);
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);

    /* 报告用白底，且隐藏悬停辅助物 */
    var bg = app.scene.background;
    var hidden = [];
    (app.helpers || []).forEach(function (o) {
      if (o && o.visible) { hidden.push(o); o.visible = false; }
    });
    app.scene.background = new THREE.Color(0xf6f8fb);

    try {
      head(g, p, items.length);

      /* 四向全身图 */
      VIEWS.forEach(function (v, i) {
        var x = PAD + (i % 2) * (VW + GAP);
        var y = 96 + 18 + Math.floor(i / 2) * (VH + 30);
        var src = renderView(app, VW, VH, v.theta, v.phi, bodyTarget, bodyDist);
        g.drawImage(src, x, y, VW, VH);
        frameBox(g, x, y, VW, VH);
        g.fillStyle = '#475569';
        g.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
        g.textAlign = 'center';
        g.fillText(v.name, x + VW / 2, y + VH + 21);
        g.textAlign = 'left';
      });

      rows(g, app, items, listTop);
    } finally {
      app.scene.background = bg;
      hidden.forEach(function (o) { o.visible = true; });
      if (app.restore) app.restore();
    }
    return cv;
  }
  /** 编号圆牌 */
  function badge(g, no, color, x, y, r) {
    g.beginPath();
    g.arc(x + r, y + r, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold ' + (String(no).length > 1 ? 17 : 20) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(no), x + r, y + r + 1);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }

  function rows(g, app, items, top) {
    g.fillStyle = '#0f172a';
    g.font = 'bold 21px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('标注清单', PAD, top + 24);
    g.strokeStyle = '#e2e8f0';
    g.beginPath();
    g.moveTo(PAD, top + 40.5);
    g.lineTo(W - PAD, top + 40.5);
    g.stroke();

    if (!items.length) {
      g.fillStyle = '#94a3b8';
      g.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText('暂无标注。请在三维人体上点击标记后再生成报告。', PAD, top + 76);
      return;
    }

    var tx = PAD + THUMB + 22;
    var tw = W - PAD - tx;
    items.forEach(function (it, i) {
      var y = top + 46 + i * ROW;
      var t = window.Annotations.typeOf(it.typeId);
      var a = angleOfNormal(it.normal);
      var d = clamp(it.radius * 7.2, 11, 36);
      var src = renderView(app, THUMB, THUMB, a.theta, a.phi, it.point, d);
      g.drawImage(src, PAD, y + 8, THUMB, THUMB);
      frameBox(g, PAD, y + 8, THUMB, THUMB);

      badge(g, it.no, t.color, tx, y + 10, 17);
      g.fillStyle = '#0f172a';
      g.font = 'bold 19px "PingFang SC","Microsoft YaHei",sans-serif';
      var yy = wrap(g, it.desc || it.part || '未命名部位', tx + 46, y + 32, tw - 46, 26, 2);

      g.fillStyle = '#475569';
      g.font = '15px "PingFang SC","Microsoft YaHei",sans-serif';
      var meta = t.name + ' · 程度 ' + it.severity + '/10 · 圈选直径约 '
        + (it.radius * 2).toFixed(1) + 'cm';
      if (it.since) meta += ' · 起始 ' + it.since;
      g.fillText(meta, tx, yy + 10);
      yy += 34;

      if (it.desc && it.part && it.desc !== it.part) {
        g.fillStyle = '#64748b';
        yy = wrap(g, '所在部位：' + it.part, tx, yy, tw, 24, 1) + 4;
      }
      if (it.note) {
        g.fillStyle = '#334155';
        wrap(g, '补充说明：' + it.note, tx, yy, tw, 24, 2);
      }

      g.strokeStyle = '#eef2f7';
      g.beginPath();
      g.moveTo(PAD, y + ROW - 6.5);
      g.lineTo(W - PAD, y + ROW - 6.5);
      g.stroke();
    });

    var fy = top + 46 + items.length * ROW + 30;
    g.fillStyle = '#94a3b8';
    g.font = '14px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('本报告由「3D人体标注」工具生成，仅用于帮助描述身体位置，不构成任何医疗诊断或建议。', PAD, fy);
  }
  /** 按当前视角截图，返回画布（w/h 为像素尺寸） */
  function shot(app, w, h) {
    var o = app.orbit;
    var bg = app.scene.background;
    var hidden = [];
    (app.helpers || []).forEach(function (x) {
      if (x && x.visible) { hidden.push(x); x.visible = false; }
    });
    var cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    try {
      var src = renderView(app, w, h, o.theta, o.phi, o.target, o.distance);
      var g = cv.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.drawImage(src, 0, 0, w, h);
    } finally {
      app.scene.background = bg;
      hidden.forEach(function (x) { x.visible = true; });
      if (app.restore) app.restore();
    }
    return cv;
  }

  /** 纯文字摘要，便于直接粘贴给医生或家人 */
  function textSummary(app) {
    var items = app.store.items;
    var out = ['身体标注记录（' + today() + '）', '基本信息：' + paramLine(app.params), ''];
    if (!items.length) {
      out.push('（暂无标注）');
    } else {
      items.forEach(function (it) {
        var t = window.Annotations.typeOf(it.typeId);
        out.push(it.no + '. ' + (it.desc || it.part || '未命名部位'));
        var meta = '   类型：' + t.name + ' ｜ 程度 ' + it.severity + '/10 ｜ 圈选直径约 '
          + (it.radius * 2).toFixed(1) + 'cm';
        if (it.since) meta += ' ｜ 起始 ' + it.since;
        out.push(meta);
        if (it.desc && it.part && it.desc !== it.part) out.push('   所在部位：' + it.part);
        if (it.note) out.push('   补充说明：' + it.note);
      });
    }
    out.push('');
    out.push('说明：位置基于参数化人体模型标注，仅用于沟通描述，不构成医疗诊断或建议。');
    return out.join('\n');
  }

  window.Report = {
    buildImage: buildImage,
    shot: shot,
    textSummary: textSummary,
    today: today,
    paramLine: paramLine
  };
})();
