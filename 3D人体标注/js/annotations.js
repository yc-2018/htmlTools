/* annotations.js —— 标注数据与三维标记 */
(function () {
  'use strict';

  var TYPES = [
    { id: 'pain', name: '疼痛', color: '#e11d48' },
    { id: 'ache', name: '酸胀/僵硬', color: '#ea580c' },
    { id: 'numb', name: '麻木/刺痛', color: '#7c3aed' },
    { id: 'lump', name: '肿块/结节', color: '#2563eb' },
    { id: 'wound', name: '伤口/切口', color: '#0d9488' },
    { id: 'rash', name: '皮疹/瘙痒', color: '#db2777' },
    { id: 'bruise', name: '瘀青/出血', color: '#4f46e5' },
    { id: 'other', name: '其他', color: '#475569' }
  ];

  var GEO_DOME = new THREE.SphereGeometry(1, 22, 16);
  var GEO_RING = new THREE.TorusGeometry(1, 0.085, 8, 44);
  var GEO_SEL = new THREE.TorusGeometry(1.26, 0.05, 8, 44);
  var Z = new THREE.Vector3(0, 0, 1);
  var labelCache = {};

  function typeOf(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[0];
  }

  /** 号牌的世界尺寸：跟着圈选半径缩（半径可以小到 0.2cm，再配 2.4cm 的号牌就把圈盖住了）；
      1cm 下限保证数字还看得清，4.5cm 上限免得大圈配个巨牌 */
  function badgeSize(r) {
    return Math.min(4.5, Math.max(1.0, r * 1.1));
  }

  /** 命中点的世界法线 */
  function worldNormal(hit) {
    if (!hit.face) return new THREE.Vector3(0, 0, 1);
    var m = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    return hit.face.normal.clone().applyMatrix3(m).normalize();
  }

  /** 编号标签贴图 */
  function labelTexture(no, color) {
    var key = no + '|' + color;
    if (labelCache[key]) return labelCache[key];
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold ' + (String(no).length > 1 ? 62 : 76) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(no), 64, 70);
    var tex = new THREE.CanvasTexture(c);
    labelCache[key] = tex;
    return tex;
  }
  function Store(scene) {
    this.items = [];
    this.group = new THREE.Group();
    this.selected = null;
    this.onChange = null;
    this.seq = 0;
    scene.add(this.group);
  }

  Store.prototype.emit = function () {
    if (this.onChange) this.onChange();
  };

  /** 新建标注；data: { point, normal, radius, typeId, part, desc, height } */
  Store.prototype.add = function (data) {
    var t = typeOf(data.typeId);
    var color = new THREE.Color(t.color);
    var g = new THREE.Group();
    var dome = new THREE.Mesh(GEO_DOME, new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.42, depthWrite: false
    }));
    var ring = new THREE.Mesh(GEO_RING, new THREE.MeshBasicMaterial({ color: color }));
    var sel = new THREE.Mesh(GEO_SEL, new THREE.MeshBasicMaterial({ color: 0x111827 }));
    sel.visible = false;
    /* 号牌和引线都不吃深度测试：正视标记再往下俯视时，号牌落在身体前面那片皮肤上，
       照常测深度整块就陷进模型里看不见了。改成画在最上层，再由 faceCamera()
       在标记背对相机时整体藏掉，免得透过身体显示背面的号 */
    var label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(this.items.length + 1, t.color),
      depthTest: false, depthWrite: false, sizeAttenuation: true
    }));
    label.renderOrder = 12;
    /* 引线：标记密集时靠它认清号牌是谁的。两个顶点每帧由 faceCamera() 改 */
    var lead = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)),
      new THREE.LineBasicMaterial({ color: color, depthTest: false, depthWrite: false })
    );
    lead.renderOrder = 11;
    lead.frustumCulled = false;        /* 顶点是现算的，包围球一直是旧的 */
    lead.raycast = function () {};     /* 只是装饰，不参与拾取 */
    g.add(dome, ring, sel, lead, label);
    this.group.add(g);

    this.seq++;
    var item = {
      id: 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      no: this.items.length + 1,
      typeId: t.id,
      part: data.part || '',
      desc: data.desc || data.part || '',
      edited: false,
      severity: data.severity == null ? 5 : data.severity,
      note: data.note || '',
      since: data.since || '',
      radius: data.radius || 2,
      point: data.point.clone(),
      normal: data.normal.clone(),
      pNorm: data.point.clone().divideScalar(data.height),
      obj: g,
      /* 号牌左右错开的档位（−1/0/1），按创建顺序定，重新编号也不会跳 */
      _fan: (this.seq % 3) - 1,
      _p: { dome: dome, ring: ring, sel: sel, lead: lead, label: label }
    };
    g.userData.annId = item.id;
    g.children.forEach(function (c) { c.userData.annId = item.id; });
    this.items.push(item);
    this.place(item);
    this.emit();
    return item;
  };
  /** 依据 point / normal / radius 摆放标记 */
  Store.prototype.place = function (item) {
    var r = item.radius;
    var p = item.point;
    var n = item.normal;
    var pr = item._p;
    pr.dome.position.copy(p);
    pr.dome.scale.setScalar(r);
    var q = new THREE.Quaternion().setFromUnitVectors(Z, n);
    pr.ring.position.copy(p).addScaledVector(n, 0.12);
    pr.ring.quaternion.copy(q);
    pr.ring.scale.setScalar(r);
    pr.sel.position.copy(pr.ring.position);
    pr.sel.quaternion.copy(q);
    pr.sel.scale.setScalar(r);
    /* 编号跟着半径缩，小圈不再顶着一个大号牌 */
    var ls = badgeSize(r);
    pr.label.scale.set(ls, ls, 1);
    /* 号牌和引线的位置每帧由 faceCamera() 按相机方向现算，这儿只给个不难看的初值 */
    pr.label.position.copy(p).addScaledVector(n, r + ls);
  };

  var _up = new THREE.Vector3(), _rt = new THREE.Vector3(), _toCam = new THREE.Vector3(),
    _dir = new THREE.Vector3(), _at = new THREE.Vector3(), _end = new THREE.Vector3();

  /** 每帧调用：把号牌摆到标记圈的**屏幕**外侧并连上引线。
      只沿法线推是不行的——正视标记时法线就是视线方向，推多远都投影在圈心上，
      正好把标记点盖住；沿相机的上方向推，不论从哪个角度看都在圈外面 */
  Store.prototype.faceCamera = function (camera) {
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _rt.set(1, 0, 0).applyQuaternion(camera.quaternion);
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i], pr = it._p;
      _toCam.subVectors(camera.position, it.point).normalize();
      /* 标记背对相机时连号牌一起藏掉：它不吃深度测试，不然会透过身体露出背面的号 */
      var show = it.normal.dot(_toCam) > 0.02;
      pr.label.visible = show;
      pr.lead.visible = show;
      if (!show) continue;
      var r = it.radius, ls = badgeSize(r);
      /* 密集时按创建顺序把号牌左右扇开，配合引线才认得清谁是谁的 */
      var ang = it._fan * 0.32;
      _dir.copy(_up).multiplyScalar(Math.cos(ang)).addScaledVector(_rt, Math.sin(ang));
      _at.copy(it.point).addScaledVector(it.normal, 0.12);
      /* 半球轮廓在任何视角都是个半径 r 的圆，引线从它的边上起 */
      _end.copy(_at).addScaledVector(_dir, r);
      var pos = pr.lead.geometry.attributes.position;
      pos.setXYZ(0, _end.x, _end.y, _end.z);
      _end.addScaledVector(_dir, 0.2 + 0.25 * ls);
      pos.setXYZ(1, _end.x, _end.y, _end.z);
      pos.needsUpdate = true;
      /* 号牌圆面半径是贴图的 58/128，让它正好接在引线末端 */
      pr.label.position.copy(_end).addScaledVector(_dir, 0.453 * ls);
    }
  };

  Store.prototype.setColorOf = function (item) {
    var t = typeOf(item.typeId);
    var color = new THREE.Color(t.color);
    item._p.dome.material.color.copy(color);
    item._p.ring.material.color.copy(color);
    item._p.lead.material.color.copy(color);
    item._p.label.material.map = labelTexture(item.no, t.color);
    item._p.label.material.needsUpdate = true;
  };

  Store.prototype.renumber = function () {
    for (var i = 0; i < this.items.length; i++) {
      this.items[i].no = i + 1;
      this.setColorOf(this.items[i]);
    }
  };

  Store.prototype.select = function (item) {
    this.selected = item || null;
    for (var i = 0; i < this.items.length; i++) {
      this.items[i]._p.sel.visible = this.items[i] === this.selected;
      this.items[i]._p.dome.material.opacity = this.items[i] === this.selected ? 0.6 : 0.42;
    }
    this.emit();
  };

  /** 释放一个标注自己的资源；GEO_* 是几个标注共用的，不能跟着释放 */
  function discard(item) {
    item.obj.children.forEach(function (c) {
      if (c.material) c.material.dispose();
      if (c.isLine && c.geometry) c.geometry.dispose();
    });
  }

  Store.prototype.remove = function (item) {
    var i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.group.remove(item.obj);
    discard(item);
    if (this.selected === item) this.selected = null;
    this.renumber();
    this.emit();
  };

  Store.prototype.clear = function () {
    while (this.items.length) {
      var it = this.items.pop();
      this.group.remove(it.obj);
      discard(it);
    }
    this.selected = null;
    this.emit();
  };

  Store.prototype.findByObject = function (obj) {
    var id = obj && obj.userData ? obj.userData.annId : null;
    if (!id) return null;
    for (var i = 0; i < this.items.length; i++) if (this.items[i].id === id) return this.items[i];
    return null;
  };
  /** 体型变化后把标注重新贴到新模型表面 */
  Store.prototype.reproject = function (targets, height, ctx) {
    var ray = new THREE.Raycaster();
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var p = it.pNorm.clone().multiplyScalar(height);
      ray.set(p.clone().addScaledVector(it.normal, 40), it.normal.clone().negate());
      var hits = ray.intersectObjects(targets, false);
      if (hits.length) {
        it.point.copy(hits[0].point);
        it.normal.copy(worldNormal(hits[0]));
        it.pNorm.copy(it.point).divideScalar(height);
        if (!it.edited && window.Anatomy) {
          var d = window.Anatomy.describe(hits[0].object, it.point, it.normal, ctx, hits[0].faceIndex);
          it.part = d.part;
          it.desc = d.text;
        }
      } else {
        it.point.copy(p);
      }
      this.place(it);
    }
    this.emit();
  };

  Store.prototype.toJSON = function () {
    return this.items.map(function (it) {
      return {
        typeId: it.typeId, part: it.part, desc: it.desc, edited: it.edited,
        severity: it.severity, note: it.note, since: it.since, radius: it.radius,
        pNorm: [it.pNorm.x, it.pNorm.y, it.pNorm.z],
        normal: [it.normal.x, it.normal.y, it.normal.z]
      };
    });
  };

  /** 从 JSON 恢复；随后需调用 reproject 贴回体表 */
  Store.prototype.fromJSON = function (arr, height) {
    this.clear();
    var self = this;
    (arr || []).forEach(function (o) {
      if (!o || !o.pNorm) return;
      var pn = new THREE.Vector3(o.pNorm[0], o.pNorm[1], o.pNorm[2]);
      var nm = o.normal ? new THREE.Vector3(o.normal[0], o.normal[1], o.normal[2]).normalize() : new THREE.Vector3(0, 0, 1);
      var it = self.add({
        point: pn.clone().multiplyScalar(height), normal: nm, radius: o.radius || 2,
        typeId: o.typeId, part: o.part, desc: o.desc, severity: o.severity,
        note: o.note, since: o.since, height: height
      });
      it.edited = !!o.edited;
    });
    this.renumber();
    this.emit();
  };

  window.Annotations = {
    Store: Store,
    TYPES: TYPES,
    typeOf: typeOf,
    worldNormal: worldNormal
  };
})();
