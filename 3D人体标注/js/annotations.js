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
    var label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: labelTexture(this.items.length + 1, t.color), depthWrite: false, sizeAttenuation: true
    }));
    g.add(dome, ring, sel, label);
    this.group.add(g);

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
      _p: { dome: dome, ring: ring, sel: sel, label: label }
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
    var ls = Math.max(2.4, r * 0.85);
    pr.label.scale.set(ls, ls, 1);
    pr.label.position.copy(p).addScaledVector(n, r + ls * 0.55);
  };

  Store.prototype.setColorOf = function (item) {
    var t = typeOf(item.typeId);
    var color = new THREE.Color(t.color);
    item._p.dome.material.color.copy(color);
    item._p.ring.material.color.copy(color);
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

  Store.prototype.remove = function (item) {
    var i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.group.remove(item.obj);
    item.obj.children.forEach(function (c) {
      if (c.material) c.material.dispose();
    });
    if (this.selected === item) this.selected = null;
    this.renumber();
    this.emit();
  };

  Store.prototype.clear = function () {
    while (this.items.length) {
      var it = this.items.pop();
      this.group.remove(it.obj);
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
          var d = window.Anatomy.describe(hits[0].object, it.point, it.normal, ctx);
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
