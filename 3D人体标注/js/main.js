/* main.js —— 3D人体标注：界面装配、拾取与交互 */
(function () {
  'use strict';

  var KEY = 'body-annot-v1';

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  var params = { gender: 'male', height: 172, weight: 62, bust: 88, waist: 74, hip: 90 };
  var opts = { privacy: false, mode: 'mark', radius: 2.0, typeId: 'pain', autoGirth: true };

  var viewer = $('viewer');
  var canvas = $('scene');
  var tip = $('hoverTip');

  var renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: true
  });
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f7);
  var camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);
  var orbit = new window.SimpleOrbit(camera, canvas);
  var store = new window.Annotations.Store(scene);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b5, 0.86));
  var key = new THREE.DirectionalLight(0xffffff, 0.62);
  key.position.set(0.6, 1.1, 1.0);
  scene.add(key);
  var fill = new THREE.DirectionalLight(0xffffff, 0.34);
  fill.position.set(-0.8, 0.4, -1.0);
  scene.add(fill);

  /* 悬停预览圈 */
  var preview = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.06, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.75 })
  );
  preview.visible = false;
  preview.raycast = function () {};
  scene.add(preview);

  var body = null;
  var ray = new THREE.Raycaster();
  var Z = new THREE.Vector3(0, 0, 1);

  function ctx() {
    return { height: params.height, privacy: opts.privacy, gender: params.gender };
  }
  /* ---------------- 人体构建 / 重建 ---------------- */

  function disposeBody() {
    if (!body) return;
    scene.remove(body.group);
    body.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
    });
    Object.keys(body.materials).forEach(function (k) {
      if (body.materials[k] && body.materials[k].dispose) body.materials[k].dispose();
    });
    body = null;
  }

  function applyPrivacy() {
    if (!body) return;
    body.wear.forEach(function (m) { m.visible = !opts.privacy; });
  }

  /** 重建人体，并把已有标注重新贴回体表 */
  function rebuild() {
    disposeBody();
    body = window.BodyModel.build(params);
    scene.add(body.group);
    applyPrivacy();
    if (store.items.length) store.reproject(body.parts, params.height, ctx());
  }

  /* ---------------- 视角 ---------------- */

  var VIEW_ANGLE = {
    front: { theta: 0, phi: Math.PI / 2 },
    back: { theta: Math.PI, phi: Math.PI / 2 },
    left: { theta: Math.PI / 2, phi: Math.PI / 2 },
    right: { theta: -Math.PI / 2, phi: Math.PI / 2 },
    top: { theta: 0, phi: 0.22 }
  };

  function fullDist() {
    return (params.height * 1.06) / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  function setView(name) {
    var a = VIEW_ANGLE[name] || VIEW_ANGLE.front;
    orbit.flyTo({ theta: a.theta, phi: a.phi });
  }

  /** 聚焦到某个部位 */
  function focusOn(name) {
    if (!body) return;
    if (name === 'all') {
      orbit.flyTo({ target: new THREE.Vector3(0, params.height * 0.52, 0), distance: fullDist() });
      return;
    }
    var p = body.landmarks[name];
    if (!p) return;
    var d = name === 'torso' ? params.height * 0.52
      : name === 'head' ? params.height * 0.30 : params.height * 0.16;
    orbit.flyTo({ target: p.clone(), distance: d });
  }
  /* ---------------- 拾取 ---------------- */

  var ndc = new THREE.Vector2();

  function setNdc(e) {
    var r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return r;
  }

  function hitBody(e) {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    var hs = ray.intersectObjects(body.parts, false);
    return hs.length ? hs[0] : null;
  }

  function hitAnn(e) {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    var hs = ray.intersectObjects(store.group.children, true);
    return hs.length ? store.findByObject(hs[0].object) : null;
  }

  function showTip(text, e, rect) {
    tip.textContent = text;
    tip.classList.add('is-on');
    var x = clamp(e.clientX - rect.left, 136, Math.max(136, rect.width - 136));
    var y = clamp(e.clientY - rect.top, 42, Math.max(42, rect.height - 6));
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() {
    tip.classList.remove('is-on');
  }

  on(canvas, 'pointermove', function (e) {
    if (!body) return;
    var rect = canvas.getBoundingClientRect();
    if (opts.mode === 'erase') {
      preview.visible = false;
      var a = hitAnn(e);
      if (a) showTip('删除 #' + a.no + '　' + (a.desc || a.part), e, rect);
      else hideTip();
      return;
    }
    var h = hitBody(e);
    if (!h) {
      preview.visible = false;
      hideTip();
      return;
    }
    var n = window.Annotations.worldNormal(h);
    preview.position.copy(h.point).addScaledVector(n, 0.1);
    preview.quaternion.setFromUnitVectors(Z, n);
    preview.scale.setScalar(opts.radius);
    preview.visible = opts.mode === 'mark';
    showTip(window.Anatomy.describe(h.object, h.point, n, ctx()).text, e, rect);
  });

  on(canvas, 'pointerleave', function () {
    preview.visible = false;
    hideTip();
  });
  on(canvas, 'pointerup', function (e) {
    if (e.button !== 0 || orbit.dragged || !body) return;
    if (opts.mode === 'erase') {
      var del = hitAnn(e);
      if (del) {
        var no = del.no;
        store.remove(del);
        toast('已删除标注 #' + no);
      }
      return;
    }
    var pick = hitAnn(e);
    if (pick) {
      store.select(pick);
      return;
    }
    if (opts.mode !== 'mark') {
      store.select(null);
      return;
    }
    var h = hitBody(e);
    if (!h) return;
    var n = window.Annotations.worldNormal(h);
    var d = window.Anatomy.describe(h.object, h.point, n, ctx());
    var it = store.add({
      point: h.point, normal: n, radius: opts.radius, typeId: opts.typeId,
      part: d.part, desc: d.text, height: params.height
    });
    store.select(it);
  });

  /* ---------------- 渲染循环 ---------------- */

  function resize() {
    var w = viewer.clientWidth;
    var h = viewer.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function loop() {
    if (dirty) {
      dirty = false;
      rebuild();
    }
    orbit.tick();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  if (window.ResizeObserver) new ResizeObserver(resize).observe(viewer);
  on(window, 'resize', resize);

  /* ---------------- 轻提示 ---------------- */

  var toastEl = $('toast');
  var toastTimer = 0;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2000);
  }

  /* ---------------- 标注列表 ---------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function labeled(grid, name, node) {
    grid.appendChild(el('span', null, name));
    grid.appendChild(node);
    return node;
  }

  function card(it) {
    var t = window.Annotations.typeOf(it.typeId);
    var box = el('article', 'ann-card' + (store.selected === it ? ' is-active' : ''));
    box.dataset.id = it.id;

    var top = el('div', 'ann-top');
    var no = el('span', 'ann-no', String(it.no));
    no.style.background = t.color;
    var desc = el('div', 'ann-desc', it.desc || it.part || '');
    desc.contentEditable = 'true';
    desc.spellcheck = false;
    desc.title = '可直接修改这段描述';
    on(desc, 'input', function () {
      it.desc = desc.textContent.replace(/\s+/g, ' ').trim();
      it.edited = true;
      save();
    });
    on(desc, 'keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); desc.blur(); }
    });
    top.appendChild(no);
    top.appendChild(desc);
    box.appendChild(top);

    var sub = el('div', 'ann-sub', subText(it));
    box.appendChild(sub);

    if (store.selected === it) {
      box.appendChild(editor(it, function () {
        sub.textContent = subText(it);
        no.style.background = window.Annotations.typeOf(it.typeId).color;
      }));
    }

    on(box, 'pointerdown', function (e) {
      if (e.target.closest('.ann-desc, .ann-grid, .ann-acts')) return;
      if (store.selected !== it) store.select(it);
    });
    return box;
  }
  function subText(it) {
    var t = window.Annotations.typeOf(it.typeId);
    return t.name + ' · 程度 ' + it.severity + '/10 · 直径约 '
      + (it.radius * 2).toFixed(1) + 'cm' + (it.since ? ' · ' + it.since : '');
  }

  /** 选中项的编辑区 */
  function editor(it, refresh) {
    var frag = document.createDocumentFragment();
    var grid = el('div', 'ann-grid');

    var sel = document.createElement('select');
    window.Annotations.TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      if (t.id === it.typeId) o.selected = true;
      sel.appendChild(o);
    });
    on(sel, 'change', function () {
      it.typeId = sel.value;
      store.setColorOf(it);
      refresh();
      save();
    });
    labeled(grid, '类型', sel);

    var sev = document.createElement('input');
    sev.type = 'range';
    sev.min = '1';
    sev.max = '10';
    sev.step = '1';
    sev.value = String(it.severity);
    on(sev, 'input', function () {
      it.severity = parseInt(sev.value, 10);
      refresh();
      save();
    });
    labeled(grid, '程度', sev);

    var rad = document.createElement('input');
    rad.type = 'range';
    rad.min = '0.6';
    rad.max = '9';
    rad.step = '0.2';
    rad.value = String(it.radius);
    on(rad, 'input', function () {
      it.radius = parseFloat(rad.value);
      store.place(it);
      refresh();
      save();
    });
    labeled(grid, '范围', rad);

    var since = document.createElement('input');
    since.type = 'date';
    since.value = it.since || '';
    on(since, 'change', function () {
      it.since = since.value;
      refresh();
      save();
    });
    labeled(grid, '起始', since);

    var note = document.createElement('textarea');
    note.rows = 2;
    note.placeholder = '例如：垂直于指尖方向的切口，长约 1cm';
    note.value = it.note || '';
    on(note, 'input', function () { it.note = note.value; save(); });
    labeled(grid, '说明', note);

    frag.appendChild(grid);

    var acts = el('div', 'ann-acts');
    var bf = el('button', 'btn tiny', '定位');
    on(bf, 'click', function () { flyToItem(it); });
    var bd = el('button', 'btn tiny danger', '删除');
    on(bd, 'click', function () {
      var no = it.no;
      store.remove(it);
      toast('已删除标注 #' + no);
    });
    acts.appendChild(bf);
    acts.appendChild(bd);
    frag.appendChild(acts);
    return frag;
  }
  function flyToItem(it) {
    var n = it.normal;
    orbit.flyTo({
      target: it.point.clone(),
      distance: clamp(it.radius * 8, 14, 46),
      theta: Math.atan2(n.x, n.z),
      phi: clamp(Math.acos(clamp(n.y, -1, 1)), 0.18, Math.PI - 0.18)
    });
  }

  function renderList() {
    var host = $('annList');
    $('annCount').textContent = store.items.length;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!store.items.length) {
      host.appendChild(el('div', 'ann-empty', '还没有标注。切换到「标注」模式后，在人体上点击即可圈出位置。'));
      return;
    }
    store.items.forEach(function (it) { host.appendChild(card(it)); });
  }

  store.onChange = function () {
    renderList();
    save();
  };

  /* ---------------- 本地存档 ---------------- */

  var saveTimer = 0;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          params: params,
          opts: {
            privacy: opts.privacy, radius: opts.radius,
            typeId: opts.typeId, autoGirth: opts.autoGirth
          },
          ann: store.toJSON()
        }));
      } catch (err) { /* 隐私模式下可能不可用，忽略 */ }
    }, 320);
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }
  /* ---------------- 参数控件 ---------------- */

  var dirty = false;
  var pairs = {};

  function scheduleRebuild() { dirty = true; }

  function pair(key, rangeId, numId) {
    var r = $(rangeId);
    var n = $(numId);
    var lo = parseFloat(r.min);
    var hi = parseFloat(r.max);

    function apply(v, silent) {
      v = clamp(Math.round(v), lo, hi);
      params[key] = v;
      r.value = String(v);
      n.value = String(v);
      if (!silent) onParam(key);
    }

    on(r, 'input', function () { apply(parseFloat(r.value), false); });
    on(n, 'change', function () { apply(parseFloat(n.value) || params[key], false); });
    pairs[key] = { set: function (v) { apply(v, true); }, dom: [r, n] };
    apply(params[key], true);
    return pairs[key];
  }

  function syncGirth() {
    if (!opts.autoGirth) return;
    var g = window.BodyModel.autoGirth(params.gender, params.height, params.weight);
    pairs.bust.set(g.bust);
    pairs.waist.set(g.waist);
    pairs.hip.set(g.hip);
  }

  function toggleGirthInputs() {
    ['bust', 'waist', 'hip'].forEach(function (k) {
      pairs[k].dom.forEach(function (d) { d.disabled = opts.autoGirth; });
    });
  }

  function onParam(key) {
    if (key === 'height' || key === 'weight') {
      syncGirth();
    } else if (opts.autoGirth) {
      opts.autoGirth = false;
      $('autoGirth').checked = false;
      toggleGirthInputs();
    }
    scheduleRebuild();
    save();
  }

  /** 分段按钮：data-v 为取值 */
  function segment(id, get, set) {
    var host = $(id);
    function paint() {
      Array.prototype.forEach.call(host.querySelectorAll('[data-v]'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.v === get() ? 'true' : 'false');
      });
    }
    on(host, 'click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      set(b.dataset.v);
      paint();
    });
    paint();
    return paint;
  }
  function app() {
    return {
      renderer: renderer, scene: scene, camera: camera, orbit: orbit,
      store: store, params: params, helpers: [preview], restore: resize
    };
  }

  function download(url, name) {
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  var modal = $('reportModal');

  function openModal(url, name) {
    $('reportImg').src = url;
    var a = $('reportDownload');
    a.href = url;
    a.download = name;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    $('reportImg').removeAttribute('src');
    $('reportDownload').removeAttribute('href');
  }

  function setMode(v) {
    opts.mode = v;
    viewer.dataset.mode = v;
    preview.visible = false;
    hideTip();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('文字摘要已复制');
      }, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? '文字摘要已复制' : '复制失败，请手动选择文本');
    }
  }
  /* ---------------- 导入 / 导出 ---------------- */

  function exportJSON() {
    var data = {
      tool: '3D人体标注', version: 1, date: window.Report.today(),
      params: params, privacy: opts.privacy, ann: store.toJSON()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    download(url, '身体标注-' + window.Report.today() + '.json');
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /** 应用一份存档 / 导入文件 */
  function applyData(data) {
    if (!data) return;
    if (data.opts && typeof data.opts.autoGirth === 'boolean') opts.autoGirth = data.opts.autoGirth;
    if (data.params) {
      if (data.params.gender) params.gender = data.params.gender;
      ['height', 'weight', 'bust', 'waist', 'hip'].forEach(function (k) {
        if (typeof data.params[k] === 'number') pairs[k].set(data.params[k]);
      });
    }
    var pv = data.opts ? data.opts.privacy : data.privacy;
    if (typeof pv === 'boolean') opts.privacy = pv;
    if (data.opts && typeof data.opts.radius === 'number') opts.radius = data.opts.radius;
    if (data.opts && data.opts.typeId) opts.typeId = data.opts.typeId;
    syncUI();
    rebuild();
    store.fromJSON(data.ann, params.height);
    if (store.items.length) store.reproject(body.parts, params.height, ctx());
  }

  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data = null;
      try { data = JSON.parse(String(fr.result)); } catch (err) { data = null; }
      if (!data || (!data.ann && !data.params)) {
        toast('文件格式不正确');
        return;
      }
      applyData(data);
      toast('已导入 ' + ((data.ann && data.ann.length) || 0) + ' 处标注');
    };
    fr.onerror = function () { toast('文件读取失败'); };
    fr.readAsText(file, 'utf-8');
  }
  /* ---------------- 控件装配 ---------------- */

  var paintGender, paintMode, paintType;

  function syncUI() {
    if (paintGender) paintGender();
    if (paintMode) paintMode();
    if (paintType) paintType();
    $('privacy').checked = opts.privacy;
    $('autoGirth').checked = opts.autoGirth;
    toggleGirthInputs();
    $('inRadius').value = String(opts.radius);
    $('radiusVal').textContent = opts.radius.toFixed(1) + ' cm';
    viewer.dataset.mode = opts.mode;
  }

  function wire() {
    pair('height', 'inHeight', 'numHeight');
    pair('weight', 'inWeight', 'numWeight');
    pair('bust', 'inBust', 'numBust');
    pair('waist', 'inWaist', 'numWaist');
    pair('hip', 'inHip', 'numHip');

    paintGender = segment('genderSeg', function () { return params.gender; }, function (v) {
      params.gender = v;
      syncGirth();
      scheduleRebuild();
      save();
    });

    paintMode = segment('modeSeg', function () { return opts.mode; }, function (v) { setMode(v); });

    paintType = segment('typeChips', function () { return opts.typeId; }, function (v) {
      opts.typeId = v;
      save();
    });

    on($('autoGirth'), 'change', function () {
      opts.autoGirth = $('autoGirth').checked;
      toggleGirthInputs();
      syncGirth();
      scheduleRebuild();
      save();
    });

    on($('privacy'), 'change', function () {
      opts.privacy = $('privacy').checked;
      applyPrivacy();
      if (body && store.items.length) store.reproject(body.parts, params.height, ctx());
      save();
    });
    on($('inRadius'), 'input', function () {
      opts.radius = parseFloat($('inRadius').value);
      $('radiusVal').textContent = opts.radius.toFixed(1) + ' cm';
      preview.scale.setScalar(opts.radius);
      save();
    });

    on($('resetBody'), 'click', function () {
      params.gender = 'male';
      opts.autoGirth = true;
      pairs.height.set(172);
      pairs.weight.set(62);
      syncGirth();
      syncUI();
      rebuild();
      orbit.flyTo({ target: new THREE.Vector3(0, params.height * 0.52, 0), distance: fullDist() });
      toast('已恢复默认体型');
    });

    on($('viewBar'), 'click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) setView(b.dataset.view);
    });

    on($('focusSel'), 'change', function () {
      focusOn($('focusSel').value);
    });

    on($('clearAnn'), 'click', function () {
      if (!store.items.length) return;
      if (!window.confirm('确定清空全部 ' + store.items.length + ' 处标注？')) return;
      store.clear();
      toast('已清空标注');
    });

    on($('btnReport'), 'click', function () {
      toast('正在生成报告…');
      setTimeout(function () {
        var cv = window.Report.buildImage(app());
        openModal(cv.toDataURL('image/png'), '身体标注报告-' + window.Report.today() + '.png');
      }, 40);
    });

    on($('btnShot'), 'click', function () {
      var cv = window.Report.shot(app(), 1000, 1300);
      download(cv.toDataURL('image/png'), '身体标注截图-' + window.Report.today() + '.png');
      toast('已保存当前视角截图');
    });
    on($('btnCopy'), 'click', function () {
      copyText(window.Report.textSummary(app()));
    });

    on($('btnExport'), 'click', exportJSON);

    on($('btnImport'), 'click', function () { $('fileImport').click(); });

    on($('fileImport'), 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) readFile(f);
      e.target.value = '';
    });

    on($('reportClose'), 'click', closeModal);
    on(modal, 'click', function (e) {
      if (e.target === modal) closeModal();
    });
    on(window, 'keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    wire();
    var saved = loadSaved();
    if (saved) {
      applyData(saved);
    } else {
      syncGirth();
      syncUI();
      rebuild();
    }
    orbit.set({
      target: new THREE.Vector3(0, params.height * 0.52, 0),
      distance: fullDist(), theta: 0, phi: Math.PI / 2
    });
    resize();
    renderList();
    loop();
  }

  init();
})();
