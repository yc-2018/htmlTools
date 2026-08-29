/* anatomy.js —— 把「点到了模型上的哪里」翻译成中文部位描述 */
(function () {
  'use strict';

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /** 去掉括号补充说明，便于做次要方位的短标签 */
  function shorten(s) {
    return String(s).replace(/[（(][^）)]*[）)]/g, '');
  }

  /** 由径向向量求朝向描述（主方向 + 明显的次方向） */
  function facing(radial, region) {
    var ax = region.axes || { aPos: '前面', aNeg: '后面', lPos: '外侧', lNeg: '内侧' };
    var da = radial.dot(region.aVec);
    var dl = radial.dot(region.lVec);
    var aName = da >= 0 ? ax.aPos : ax.aNeg;
    var lName = dl >= 0 ? ax.lPos : ax.lNeg;
    var main, sec, ratio;
    if (Math.abs(da) >= Math.abs(dl)) {
      main = aName; sec = lName; ratio = Math.abs(dl) / (Math.abs(da) || 1e-6);
    } else {
      main = lName; sec = aName; ratio = Math.abs(da) / (Math.abs(dl) || 1e-6);
    }
    return ratio > 0.55 ? main + '偏' + shorten(sec) : main;
  }

  /** 沿肢体轴向定位 */
  function along(region, point) {
    var axis = region.to.clone().sub(region.from);
    var len = axis.length();
    axis.normalize();
    var t = clamp(point.clone().sub(region.from).dot(axis) / len, 0, 1);
    var foot = region.from.clone().addScaledVector(axis, t * len);
    var radial = point.clone().sub(foot);
    if (radial.lengthSq() < 1e-8) radial.copy(region.aVec);
    return {
      t: t,
      label: t < 0.3 ? region.t0 : (t > 0.72 ? region.t1 : '中段'),
      radial: radial.normalize()
    };
  }
  /* ---------- 躯干分区表（由下往上按 min 判定，min 为占身高比例） ---------- */
  var BANDS = [
    {
      min: 0.790,
      f: function (s, m) { return m ? '颈根前方(锁骨上窝)' : s + '侧锁骨上方'; },
      b: function (s, m) { return m ? '后颈根部(大椎附近)' : s + '侧后颈根'; },
      s: function (s) { return s + '肩上方(斜方肌)'; }
    },
    {
      min: 0.745,
      f: function (s, m) { return m ? '前胸上部正中' : s + '侧锁骨/前胸上部'; },
      b: function (s, m) { return m ? '上背部正中' : s + '侧上背部(肩胛上方)'; },
      s: function (s) { return s + '肩前下方/腋窝上缘'; }
    },
    {
      min: 0.690,
      f: function (s, m) { return m ? '胸骨正中(前胸中部)' : s + '侧胸部'; },
      b: function (s, m) { return m ? '两肩胛之间(上背正中)' : s + '侧肩胛区'; },
      s: function (s) { return s + '侧胸(腋下)'; }
    },
    {
      min: 0.648,
      f: function (s, m) { return m ? '胸骨下端/上腹正中偏上' : s + '侧胸下缘(肋弓)'; },
      b: function (s, m) { return m ? '中背部正中(脊柱)' : s + '侧中背部'; },
      s: function (s) { return s + '侧胸下部/肋侧'; }
    },
    {
      min: 0.598,
      f: function (s, m) { return m ? '上腹部(胃区)' : s + '上腹部(肋弓下)'; },
      b: function (s, m) { return m ? '腰背正中(脊柱)' : s + '侧腰部'; },
      s: function (s) { return s + '侧腹/肋下'; }
    },
    {
      min: 0.552,
      f: function (s, m) { return m ? '中腹部(肚脐周围)' : s + '侧中腹部'; },
      b: function (s, m) { return m ? '下腰部正中' : s + '侧下腰部'; },
      s: function (s) { return s + '侧腰'; }
    },
    {
      min: 0.502,
      f: function (s, m) { return m ? '下腹部正中(脐下)' : s + '下腹部'; },
      b: function (s, m) { return m ? '骶尾部(尾椎附近)' : s + '侧臀部上方'; },
      s: function (s) { return s + '髋部外侧(髂骨)'; }
    },
    {
      min: -1,
      f: function (s, m) { return m ? '下腹/耻骨区' : s + '侧腹股沟(大腿根)'; },
      b: function (s, m) { return m ? '两侧臀部之间' : s + '侧臀部'; },
      s: function (s) { return s + '髋外侧/大腿根外侧'; }
    }
  ];
  function torso(point, normal, ctx) {
    var H = ctx.height;
    var f = point.y / H;
    var side = point.x >= 0 ? '左' : '右';
    var mid = Math.abs(point.x) < H * 0.024;
    var band = BANDS[BANDS.length - 1];
    for (var i = 0; i < BANDS.length; i++) {
      if (f >= BANDS[i].min) { band = BANDS[i]; break; }
    }
    var lateral = Math.abs(normal.x) > Math.abs(normal.z) * 1.15;
    var front = normal.z >= 0;
    if (normal.y > 0.7 && f > 0.78) return side + '肩上方(斜方肌)';
    var name = lateral ? band.s(side, mid) : (front ? band.f(side, mid) : band.b(side, mid));

    /* 私密部位：默认给粗略说法，开启后才给精确名称 */
    if (!lateral && f < 0.502) {
      if (front) name = ctx.privacy ? (mid ? '外生殖区(耻骨区)' : side + '侧腹股沟(大腿根)') : (mid ? '下腹/胯部(内衣遮挡区)' : side + '侧腹股沟');
      else name = ctx.privacy ? (mid ? '臀沟/肛周区域' : side + '侧臀部') : (mid ? '臀部中间(内衣遮挡区)' : side + '侧臀部');
    }
    if (!lateral && front && ctx.gender !== 'female' && f >= 0.648 && f < 0.745 && !mid && ctx.privacy) {
      name = side + '侧胸部(乳区)';
    }
    return name;
  }

  function head(region, point, normal, ctx) {
    var f = (point.y - region.chin) / (region.top - region.chin);
    var side = point.x >= 0 ? '左' : '右';
    var mid = Math.abs(point.x) < ctx.height * 0.015;
    if (normal.y > 0.74) return f > 0.8 ? '头顶' : side + '侧头部上方';
    var lateral = Math.abs(normal.x) > Math.abs(normal.z) * 1.1;
    if (lateral) {
      if (f > 0.74) return side + '侧头部(颞部上方)';
      if (f > 0.46) return side + '太阳穴/颞部';
      return side + '下颌角/腮部';
    }
    if (normal.z >= 0) {
      if (f > 0.80) return '前额上部(发际线附近)';
      if (f > 0.64) return mid ? '额头正中' : side + '侧额头';
      if (f > 0.50) return mid ? '眉心(鼻根上方)' : side + '眼周(眼睑外围)';
      if (f > 0.34) return mid ? '鼻梁两侧' : side + '颧骨/面颊';
      if (f > 0.24) return mid ? '人中(鼻下)' : side + '面颊下部';
      if (f > 0.14) return mid ? '口周(唇缘皮肤)' : side + '嘴角外侧';
      return '下巴(颏部)';
    }
    if (f > 0.66) return mid ? '后脑(枕部)' : side + '侧后脑';
    if (f > 0.42) return side + '耳后/枕下';
    return '后颈上方(后发际)';
  }
  /** 五官这类小部件：把命中点换算成按半轴归一化的局部坐标 */
  function normRadial(r, point) {
    var v = point.clone().sub(r.center);
    var e = r.ext;
    return {
      l: v.dot(r.lVec) / (e ? e.x : 1),
      y: v.y / (e ? e.y : 1),
      a: v.dot(r.aVec) / (e ? e.z : 1)
    };
  }

  function eye(r, point) {
    var n = normRadial(r, point);
    if (Math.abs(n.y) >= Math.abs(n.l)) return r.side + (n.y >= 0 ? '侧上眼睑' : '侧下眼睑');
    return r.side + (n.l >= 0 ? '侧外眼角(靠太阳穴)' : '侧内眼角(靠鼻侧)');
  }

  function ear(r, point) {
    var n = normRadial(r, point);
    if (n.y > 0.55) return r.side + '耳上部(耳廓上缘)';
    if (n.y < -0.52) return r.side + '耳垂';
    if (n.a < -0.42) return r.side + '耳后(耳廓与头之间)';
    if (n.l > 0.35) return r.side + '耳廓外侧面';
    return r.side + '耳中部(耳孔附近)';
  }

  function neck(region, point, normal, ctx) {
    var side = point.x >= 0 ? '左' : '右';
    if (Math.abs(normal.x) > Math.abs(normal.z) * 1.1) return side + '侧颈部';
    if (normal.z >= 0) {
      return point.y > (region.from.y + region.to.y) / 2 ? '颈前上部(下巴下方)' : '颈前(喉部/气管一侧)';
    }
    return '后颈(颈椎一侧)';
  }

  function palm(region, point) {
    var radial = point.clone().sub(region.center);
    var da = radial.dot(region.aVec);
    var dl = radial.dot(region.lVec);
    var name;
    if (Math.abs(da) >= Math.abs(dl) * 0.85) {
      if (da >= 0) {
        name = '手心(掌面)';
        if (dl > radial.length() * 0.42) name = '手掌大鱼际(拇指下方肌肉)';
        else if (dl < -radial.length() * 0.42) name = '手掌小鱼际(小指下方)';
      } else {
        name = '手背';
      }
    } else {
      name = dl >= 0 ? '手掌拇指侧(桡侧)' : '手掌小指侧(尺侧)';
    }
    return region.name + name;
  }

  function foot(region, point, normal, ctx) {
    var span = region.zSpan || ctx.height * 0.046;
    var dz = (point.z - region.center.z) / span;
    var lat = normal.dot(region.lVec);
    var fore = region.zone === 'fore';
    if (normal.y < -0.5) {
      return region.name + '底' + (fore
        ? (dz > 0.4 ? '(脚趾根部下方)' : '(前脚掌)')
        : (dz < -0.35 ? '(脚跟)' : '(足弓/中部)'));
    }
    if (normal.y > 0.45) return region.name + '背' + (fore ? '(靠近脚趾)' : '(踝前/中段)');
    if (!fore && dz < -0.55) return region.name + '后跟';
    if (Math.abs(lat) > Math.abs(normal.z)) return region.name + (lat >= 0 ? '外侧(小脚趾一侧)' : '内侧(足弓一侧)');
    return region.name + (fore ? '前缘(脚趾根部)' : '中段');
  }

  function breast(region, point, ctx) {
    if (!ctx.privacy) return region.name + '(内衣遮挡区)';
    var radial = point.clone().sub(region.center).normalize();
    var da = radial.dot(region.aVec);
    if (da > 0.86) return region.side + '侧乳头/乳晕区';
    if (radial.y < -0.55) return region.side + '侧乳房下缘(乳房下皱褶)';
    if (radial.y > 0.6) return region.side + '侧乳房上方';
    var dl = radial.dot(region.lVec);
    return region.side + '侧乳房' + (dl >= 0 ? '外侧(靠腋窝)' : '内侧(靠胸骨)');
  }
  /** 从一次命中里取出部位元数据；整体一张网格的模型按三角面索引查分区表 */
  function regionOf(mesh, faceIndex) {
    var ud = mesh && mesh.userData;
    if (!ud) return null;
    if (ud.faceMap && ud.regions && faceIndex != null) {
      var r = ud.regions[ud.faceMap[faceIndex]];
      if (r) return r;
    }
    return ud.region || null;
  }

  /**
   * 解析一次射线命中，返回中文描述
   * @param {THREE.Mesh} mesh 命中的网格
   * @param {THREE.Vector3} point 命中点（世界坐标，单位 cm）
   * @param {THREE.Vector3} normal 命中点法线（世界坐标，已归一化）
   * @param {Object} ctx { height, privacy, gender }
   * @param {number} [faceIndex] 命中的三角面序号，单网格模型靠它查部位
   */
  function describe(mesh, point, normal, ctx, faceIndex) {
    var r = regionOf(mesh, faceIndex);
    if (!r) return { part: '人体', text: '人体' };
    var part = r.name || '人体';
    var bits = [];

    switch (r.kind) {
      case 'torso':
        part = torso(point, normal, ctx);
        break;
      case 'head':
        part = head(r, point, normal, ctx);
        break;
      case 'neck':
        part = neck(r, point, normal, ctx);
        break;
      case 'palm':
        part = palm(r, point);
        break;
      case 'foot':
        part = foot(r, point, normal, ctx);
        break;
      case 'breast':
        part = breast(r, point, ctx);
        break;
      case 'eye':
        part = eye(r, point);
        break;
      case 'ear':
        part = ear(r, point);
        break;
      case 'face':
        /* 鼻尖、鼻翼这类小部件，名字本身已足够精确 */
        break;
      case 'sym':
        part = r.name + (Math.abs(point.x) < ctx.height * 0.007
          ? '正中' : (point.x >= 0 ? '左半侧' : '右半侧'));
        break;
      case 'limb':
      case 'finger':
      case 'toe': {
        var a = along(r, point);
        if (!r.noFacing) bits.push(facing(a.radial, r));
        bits.push(a.label);
        break;
      }
      case 'digitJoint':
      case 'blob': {
        var radial = point.clone().sub(r.center);
        if (radial.lengthSq() > 1e-8) bits.push(facing(radial.normalize(), r));
        break;
      }
      default:
        break;
    }

    /* 手指 / 脚趾附带「距指(趾)尖」距离，便于精确描述 */
    if (r.tip) {
      var d = point.distanceTo(r.tip);
      bits.push('距' + (r.kind === 'toe' ? '趾' : '指') + '尖约 ' + d.toFixed(1) + 'cm');
    }
    var text = bits.length ? part + ' ' + bits.join('，') : part;
    return { part: part, text: text };
  }

  window.Anatomy = { describe: describe };
})();
