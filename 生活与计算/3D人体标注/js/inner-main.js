/* inner-main.js —— 内部结构页：解剖层面板、拾取、结构信息与跨页标注
 * 体型参数只读地借用体表标注页那份记录（localStorage['body-annot-v1']，绝不回写，免得冲掉标注），
 * 这一页自己的图层与体型设置存在 localStorage['body-inner-v1']
 */
(function () {
  'use strict';

  var KEY = 'body-inner-v1';
  var ANN_KEY = 'body-annot-v1';
  var V = THREE.Vector3;

  function $(id) { return document.getElementById(id); }
  function on(o, ev, fn) { if (o) o.addEventListener(ev, fn); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var params = { gender: 'male', height: 170, weight: 60, bust: 88, waist: 74, hip: 90 };
  /* layers：图层 id → {on:是否显示, d:剥到第几级}；source：'real' 真实解剖数据 / 'proc' 程序化示意 */
  var opts = { privacy: false, source: 'real', layers: {} };

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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b5, 0.86));
  var keyLight = new THREE.DirectionalLight(0xffffff, 0.62);
  keyLight.position.set(0.6, 1.1, 1.0);
  scene.add(keyLight);
  var fillLight = new THREE.DirectionalLight(0xffffff, 0.34);
  fillLight.position.set(-0.8, 0.4, -1.0);
  scene.add(fillLight);

  var SYS = window.InnerModel.SYSTEMS;
  var model = null;
  var dirty = false;
  var ray = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  var selName = '';        /* 选中的件按名字记，重建模型后还能落回同一件 */
  var hidden = {};         /* 手动隐藏的件：名字 → true */
  var anns = [];           /* 从体表标注页读来的标记 */

  /* 选中高亮：把选中件的网格克隆一份，关掉深度测试盖在上面，不参与拾取 */
  var hlMat = new THREE.MeshBasicMaterial({
    color: 0xffcf5a, transparent: true, opacity: 0.55, depthTest: false
  });
  var hl = new THREE.Group();
  scene.add(hl);

  var annMat = new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.92, depthTest: false });
  var annGroup = new THREE.Group();
  var annGeo = null;
  scene.add(annGroup);

  /* ---------------- 选中与高亮 ---------------- */

  function selected() {
    if (!model || !selName) return null;
    for (var i = 0; i < model.items.length; i++) {
      if (model.items[i].name === selName) return model.items[i];
    }
    return null;
  }

  function clearHl() {
    while (hl.children.length) hl.remove(hl.children[0]);
  }

  /** 重摆高亮：克隆共用几何，所以重建模型前一定要先清掉（几何会被 dispose） */
  function paintHl() {
    clearHl();
    var it = selected();
    if (!it) return;
    it.meshes.forEach(function (m) {
      if (!m.visible) return;
      var c = m.clone();
      c.material = hlMat;
      c.renderOrder = 20;
      c.raycast = function () {};
      hl.add(c);
    });
  }

  function select(it) {
    if (it) reveal(it);
    selName = it ? it.name : '';
    paintHl();
    renderInfo();
    paintActive();
  }

  function sysOf(id) {
    for (var i = 0; i < SYS.length; i++) {
      if (SYS[i].id === id) return SYS[i];
    }
    return null;
  }

  /** 私密层关着时，生殖系统的件不进清单，也不当「底下是什么」的答案。
   *  其它层就算这会儿关着或者剥掉了，清单里照样能找到——点一下会自动开回来 */
  function usable(it) {
    var s = sysOf(it.sys);
    return !(s && s.priv && !opts.privacy);
  }

  /** 点到一件躺在隐藏图层里的结构：顺手把那一层开出来、剥到它所在的那一级 */
  function reveal(it) {
    var s = sysOf(it.sys);
    if (!s) return;
    if (s.priv && !opts.privacy) {
      toast('「' + s.name + '」这一层是关着的，勾上「显示生殖系统」才看得见');
      return;
    }
    var q = st(s), msg = '';
    if (!q.on) {
      q.on = true;
      msg = '已打开「' + s.name + '」这一层';
    }
    if (it.lv > q.d || it.to < q.d) {
      q.d = it.lv;
      msg = (msg ? msg + '，并' : '已') + '把它剥到「' + lvName(s, it.lv) + '」这一级';
    }
    if (!msg) return;
    paintLayers();
    save();
    toast(msg + '，不然看不见它');
  }

  /** 某一点附近能看的几件（隐藏的私密层不算） */
  function nearAt(p, n) {
    if (!model) return [];
    return model.near(p, (n || 4) + 6).filter(function (q) {
      return usable(q.item);
    }).slice(0, n || 4);
  }

  /* ---------------- 解剖层面板 ----------------
     每层两件事：开关（眼睛）和涂层深度（滑块）。
     滑块最右边 = 这一层完完整整摆着，往左拉一格剥掉最外的一层，最左边是最里面那一级。
     滑块值存的是「还剩几级没剥」，和存进设置里的深度 d 方向相反：拉得越多显示越多 */

  var rows = {};

  /** 这一层有几级：真实解剖数据的级数由 manifest 说，和程序化那套不一样 */
  function lvs(s) { return window.InnerModel.levels(s); }
  function lvName(s, d) {
    var a = lvs(s);
    return (a[clamp(d, 0, a.length - 1)] || a[0]).n;
  }

  /** 这一层此刻的状态（没记过就用默认）；生殖层没勾私密就当关着 */
  function st(s) {
    var q = opts.layers[s.id];
    if (!q || typeof q !== 'object') {
      q = { on: s.on !== false, d: 0 };
      opts.layers[s.id] = q;
    }
    if (typeof q.on !== 'boolean') q.on = s.on !== false;
    q.d = clamp(Math.round(q.d) || 0, 0, lvs(s).length - 1);
    return q;
  }

  function live(s) {
    var q = st(s);
    return { on: q.on && !(s.priv && !opts.privacy), d: q.d };
  }

  function applyLayer(s) {
    var v = live(s), q = rows[s.id], n = lvs(s).length;
    if (model) {
      model.setShown(s.id, v.on);
      model.setDepth(s.id, v.d);
    }
    if (!q) return;
    /* 滑块方向和深度相反：最右是完整一层（d=0），往左才剥 */
    q.range.value = String((n - 1) - v.d);
    q.range.disabled = n < 2 || !v.on;
    q.val.textContent = n < 2 ? '单层' : lvName(s, v.d) + '（' + (v.d + 1) + '/' + n + '）';
    q.eye.setAttribute('aria-pressed', v.on ? 'true' : 'false');
    q.eye.textContent = v.on ? '●' : '○';
    q.row.classList.toggle('is-off', !v.on);
  }

  /** 把面板和模型上每一层都同步到当前设置 */
  function paintLayers() {
    SYS.forEach(applyLayer);
  }

  function buildLayers() {
    var host = $('layerList');
    host.innerHTML = '';
    SYS.forEach(function (s) {
      var n = lvs(s).length;
      var row = el('div', 'lay-row');
      var sw = el('span', 'sw');
      sw.style.background = '#' + ('000000' + s.color.toString(16)).slice(-6);
      var nm = el('span', 'nm', s.name);
      if (s.note) nm.title = s.note;

      var eye = el('button', 'eye', '●');
      eye.type = 'button';
      eye.setAttribute('aria-label', '显示或隐藏' + s.name);
      on(eye, 'click', function () {
        var q = st(s);
        if (s.priv && !opts.privacy) {
          toast('「' + s.name + '」要先勾上「显示生殖系统」');
          return;
        }
        q.on = !q.on;
        if (q.on) ensureReal([s.id]);
        applyLayer(s);
        save();
      });

      var deep = el('div', 'lay-deep');
      var r = document.createElement('input');
      r.type = 'range';
      r.min = '0';
      r.max = String(Math.max(0, n - 1));
      r.step = '1';
      r.setAttribute('aria-label', s.name + ' 涂层深度（最右完整，往左剥）');
      r.title = '往左拉：一层层剥进去（' + lvs(s).map(function (x) { return x.n; }).join(' → ') + '）';
      var vl = el('span', 'vl');
      on(r, 'input', function () {
        /* 最右边是完整的一层，往左每拉一格就剥掉最外面的一级 */
        st(s).d = clamp((n - 1) - (parseInt(r.value, 10) || 0), 0, n - 1);
        applyLayer(s);
        renderInfo();
        save();
      });
      deep.appendChild(r);
      deep.appendChild(vl);

      [sw, nm, eye, deep].forEach(function (x) { row.appendChild(x); });
      host.appendChild(row);
      rows[s.id] = { row: row, range: r, val: vl, eye: eye };
    });
    paintLayers();
  }

  /* ---------------- 构建 / 重建 ---------------- */

  /* ---------------- 模型来源 ----------------
     真实解剖（BodyParts3D）按图层下载：manifest 先来（各系统的涂层级名），
     再把当下开着的层的包取下来；读不到就退回程序化，页面照常能用。 */

  var paintSrc = function () {};

  function srcNote(text) {
    var n = $('srcNote');
    if (n) n.textContent = text;
  }

  /** 现在开着的层 */
  function onIds() {
    return SYS.filter(function (s) { return live(s).on; }).map(function (s) { return s.id; });
  }

  function realNote() {
    var bytes = 0, n = 0;
    (window.InnerMesh.loaded() || []).forEach(function (sid) {
      var r = window.InnerMesh.info(sid);
      if (r) {
        bytes += r.bytes;
        n += r.n;
      }
    });
    return '真实解剖数据（BodyParts3D，成年男性一具）：已加载 ' + n + ' 件、约 '
      + (bytes / 1048576).toFixed(1) + ' MB，别的图层打开时再下。'
      + '这份标本里没有的小件（甲状腺、扁桃体、淋巴结、乙状结肠、脊髓下段，以及女性生殖器官和外生殖器）'
      + '由本页现算补上，说明里写着「示意结构」。'
      + '标本的手臂是垂着的，所以这个模式下半透明体表也按这个姿势摆手臂，手骨才对得上；'
      + '手臂上的标注红点会跟着换算过来。';
  }

  function useProc(why) {
    opts.source = 'proc';
    window.InnerModel.setMode('proc');
    paintSrc();
    buildLayers();
    dirty = true;
    srcNote(why || '现在用的是这一页现算的示意结构：男女都有，跟着身高体重三围变，但形状是简化的。');
  }

  function applySource(src, quiet) {
    if (src !== 'real') {
      useProc();
      save();
      return;
    }
    opts.source = 'real';
    srcNote('正在取真实解剖数据…');
    window.InnerMesh.ready(function (err) {
      if (err) {
        useProc('读不到 assets/inner/manifest.json（' + err + '），已切回程序化。'
          + 'file:// 直接打开不行，得用本地服务器。');
        if (!quiet) toast('没读到真实解剖数据，先用程序化的');
        save();
        return;
      }
      window.InnerMesh.loadAll(onIds(), function (e2) {
        if (e2 && !window.InnerMesh.loaded().length) {
          useProc('真实解剖数据下载失败（' + e2 + '），已切回程序化。');
          if (!quiet) toast('真实解剖数据下载失败，先用程序化的');
          save();
          return;
        }
        window.InnerModel.setMode('real');
        buildLayers();
        dirty = true;
        srcNote(realNote());
        save();
        if (!quiet) toast('已换成真实解剖数据');
      });
    });
  }

  /** 真实解剖模式下，把这几层还没下载的包补下来。
   *  「恢复默认」「勾上生殖系统」「点开某一层」之后都得叫它一次：
   *  光把眼睛点亮不下包，那一层的模型里一件也没有，看着就是「亮不起来」。 */
  function ensureReal(ids) {
    var IM = window.InnerMesh;
    if (opts.source !== 'real' || !IM) return;
    var need = (ids || []).filter(function (sid) {
      /* 数据集只有男性一具，女性的生殖器官是本页现算的，不用白下这一包 */
      if (sid === 'repro' && params.gender === 'female') return false;
      return IM.known(sid) && !IM.has(sid);
    });
    if (!need.length) return;
    var kb = 0;
    var names = need.map(function (sid) {
      var r = IM.info(sid);
      if (r) kb += r.bytes / 1024;
      return '「' + ((sysOf(sid) || {}).name || sid) + '」';
    });
    toast('正在下载' + (names.length > 3 ? names.length + ' 个图层' : names.join(''))
      + '（约 ' + (kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB') + '）…');
    IM.loadAll(need, function (err) {
      if (err) toast('有图层没下下来：' + err + '，其余的已经装上了');
      buildLayers();
      dirty = true;
      srcNote(realNote());
    });
  }

  function applyHidden() {
    if (!model) return;
    model.items.forEach(function (it) { it.off = !!hidden[it.name]; });
    model.refresh();
  }

  /** 能点到的网格：关掉的层、剥掉的级、单独藏起来的件都不算（r128 的拾取不看 visible） */
  function pickable() {
    if (!model) return [];
    return model.pickable().filter(function (m) { return m.visible; });
  }

  function renderCount() {
    if (!model) return;
    $('itemCount').textContent = String(model.items.filter(function (it) {
      return it.meshes.length && usable(it);
    }).length);
  }

  function rebuild() {
    clearHl();
    if (model) {
      scene.remove(model.group);
      model.dispose();
      model = null;
    }
    model = window.InnerModel.build(params);
    scene.add(model.group);
    paintLayers();
    applyHidden();
    paintHl();
    renderCount();
    buildAnnMarkers();
    renderSearch();
    renderAnnList();
    renderInfo();
  }

  /* ---------------- 视角 ---------------- */

  var VIEW_ANGLE = {
    front: { theta: 0, phi: Math.PI / 2 },
    back: { theta: Math.PI, phi: Math.PI / 2 },
    left: { theta: Math.PI / 2, phi: Math.PI / 2 },
    right: { theta: -Math.PI / 2, phi: Math.PI / 2 }
  };

  /* 聚焦区域：f 是身高比例的高度，z 是前后偏移，d 是相机距离（都按身高算） */
  var FOCUS = {
    head: { f: 0.925, z: 0.012, d: 0.30 },
    chest: { f: 0.720, z: 0.000, d: 0.38 },
    belly: { f: 0.595, z: 0.000, d: 0.36 },
    pelvis: { f: 0.510, z: 0.000, d: 0.32 },
    spine: { f: 0.700, z: -0.050, d: 0.66 }
  };

  function fullDist() {
    return (params.height * 1.06) / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  function setView(name) {
    var a = VIEW_ANGLE[name] || VIEW_ANGLE.front;
    orbit.flyTo({ theta: a.theta, phi: a.phi });
  }

  function focusOn(name) {
    var H = params.height;
    var f = FOCUS[name];
    if (!f) {
      orbit.flyTo({ target: new V(0, H * 0.52, 0), distance: fullDist() });
      return;
    }
    orbit.flyTo({ target: new V(0, H * f.f, H * f.z), distance: H * f.d });
  }

  function flyToItem(it) {
    orbit.flyTo({ target: it.center.clone(), distance: Math.max(it.radius * 4.5, params.height * 0.10) });
  }

  /* ---------------- 拾取 ---------------- */

  function setNdc(e) {
    var r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return r;
  }

  function hitItem(e) {
    setNdc(e);
    ray.setFromCamera(ndc, camera);
    var hs = ray.intersectObjects(pickable(), false);
    return hs.length ? hs[0].object.userData.item : null;
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
    if (!model) return;
    var rect = canvas.getBoundingClientRect();
    var it = hitItem(e);
    if (!it) {
      hideTip();
      canvas.style.cursor = '';
      return;
    }
    showTip(it.name + '　' + it.sysName, e, rect);
    canvas.style.cursor = 'pointer';
  });
  on(canvas, 'pointerleave', function () {
    hideTip();
    canvas.style.cursor = '';
  });

  /* 拖过就是在转视角，不当点选 */
  var down = null;
  on(canvas, 'pointerdown', function (e) {
    down = { x: e.clientX, y: e.clientY, b: e.button };
  });
  on(canvas, 'pointerup', function (e) {
    var d = down;
    down = null;
    if (!d || d.b !== 0 || e.button !== 0) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) return;
    select(hitItem(e));
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

  var toastEl = $('toast');
  var toastTimer = 0;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2000);
  }

  /* ---------------- 结构信息 ---------------- */

  function renderInfo() {
    var box = $('infoBox');
    var acts = $('infoActs');
    box.innerHTML = '';
    var it = selected();
    if (!it) {
      box.appendChild(el('p', 'info-empty', '还没有选中任何结构：在模型上点一下，或者用下面的搜索。'));
      acts.hidden = true;
      return;
    }
    box.appendChild(el('div', 'info-name', it.name));
    box.appendChild(el('div', 'info-sys', it.sysName + (it.side ? '　' + it.side + '侧' : '')
      + (lvs(sysOf(it.sys) || {}).length > 1 ? '　·　涂层：' + it.lvName : '')));
    if (it.note) box.appendChild(el('p', 'info-note', it.note));
    box.appendChild(el('p', 'info-note', '大致高度：离脚底 ' + Math.round(it.center.y) + ' cm。'));
    if (!it.meshes.some(function (m) { return m.visible; })) {
      box.appendChild(el('p', 'info-note', '它这会儿没显示出来：把「' + it.sysName + '」这一层的滑块拉到「' + it.lvName + '」就能看见。'));
    }
    acts.hidden = false;
    $('btnHideIt').textContent = hidden[it.name] ? '显示这件' : '隐藏这件';
  }

  /** 一行可点的结构 */
  function pickRow(name, sub, fn) {
    var b = el('button', 'pick-item');
    b.type = 'button';
    b.appendChild(el('span', 'p-n', name));
    if (sub) b.appendChild(el('span', 'p-s', sub));
    on(b, 'click', fn);
    return b;
  }

  function paintActive() {
    Array.prototype.forEach.call($('searchList').querySelectorAll('.pick-item'), function (b) {
      b.classList.toggle('is-active', b.dataset.nm === selName);
    });
  }

  var SEARCH_CAP = 80;

  function renderSearch() {
    var host = $('searchList');
    host.innerHTML = '';
    if (!model) return;
    var q = ($('searchIn').value || '').trim();
    var list = model.items.filter(function (it) {
      if (!it.meshes.length || !usable(it)) return false;
      return !q || it.name.indexOf(q) >= 0 || it.sysName.indexOf(q) >= 0 || it.side === q;
    });
    if (!list.length) {
      host.appendChild(el('p', 'info-empty', '没找到「' + q + '」，换个说法试试，比如「腰椎」「肋」「肠」。'));
      return;
    }
    list.slice(0, SEARCH_CAP).forEach(function (it) {
      var b = pickRow(it.name, it.sysName + (it.lv > 0 ? '·' + it.lvName : ''), function () {
        select(it);
        flyToItem(it);
      });
      b.dataset.nm = it.name;
      if (it.name === selName) b.classList.add('is-active');
      host.appendChild(b);
    });
    if (list.length > SEARCH_CAP) {
      host.appendChild(el('p', 'panel-note', '还有 ' + (list.length - SEARCH_CAP) + ' 件，输入关键字继续找。'));
    }
  }

  /* ---------------- 来自体表标注的标记 ---------------- */

  /** 读体表标注页那份记录（只读）；顺便把它的 params 返回去当体型的兜底 */
  function readOuter() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(ANN_KEY) || 'null'); } catch (err) { d = null; }
    anns = (d && Array.isArray(d.ann)) ? d.ann.filter(function (a) {
      return a && a.pNorm && a.pNorm.length === 3;
    }) : [];
    return d;
  }

  /* 标记存的是体表标注页那套 A 字站姿下的相对坐标；真实解剖模式里外壳的手臂换过姿势，
     所以要经 model.fromAnnot 搬一次，手臂上的标记才还贴在皮肤上 */
  function annPoint(a) {
    var p = new V(a.pNorm[0], a.pNorm[1], a.pNorm[2]).multiplyScalar(params.height);
    return (model && model.fromAnnot) ? model.fromAnnot(p) : p;
  }

  function buildAnnMarkers() {
    while (annGroup.children.length) annGroup.remove(annGroup.children[0]);
    if (annGeo) {
      annGeo.dispose();
      annGeo = null;
    }
    if (!anns.length) return;
    annGeo = new THREE.SphereGeometry(params.height * 0.006, 10, 8);
    anns.forEach(function (a) {
      var m = new THREE.Mesh(annGeo, annMat);
      m.position.copy(annPoint(a));
      m.renderOrder = 24;
      m.raycast = function () {};
      annGroup.add(m);
    });
  }

  function annTitle(a, i) {
    return '#' + (i + 1) + '　' + (a.desc || a.part || '未命名');
  }

  function renderAnnList() {
    var host = $('annList');
    host.innerHTML = '';
    $('annCount').textContent = String(anns.length);
    if (!anns.length) {
      host.appendChild(el('p', 'info-empty', '体表标注页还没有记录。去那一页标几处，这里就会跟着出现红点。'));
      return;
    }
    anns.forEach(function (a, i) {
      var p = annPoint(a);
      var near = nearAt(p, 4);
      host.appendChild(pickRow(annTitle(a, i), near.length ? near[0].item.name : '', function () {
        showNear(a, i, p, near);
      }));
    });
  }

  /** 点开一处体表标记：飞过去，并把底下最近的几件列成可点的按钮 */
  function showNear(a, i, p, near) {
    orbit.flyTo({ target: p.clone(), distance: params.height * 0.24 });
    selName = '';
    paintHl();
    paintActive();
    var box = $('infoBox');
    box.innerHTML = '';
    box.appendChild(el('div', 'info-name', annTitle(a, i)));
    box.appendChild(el('div', 'info-sys', '来自体表标注 · 离脚底约 ' + Math.round(p.y) + ' cm'));
    box.appendChild(el('p', 'info-note', near.length ? '这一处底下最近的几件（由近到远）：' : '这一处附近没算出结构，试试把图层都打开。'));
    near.forEach(function (n) {
      box.appendChild(pickRow(n.item.name, n.item.sysName, function () {
        select(n.item);
        flyToItem(n.item);
      }));
    });
    $('infoActs').hidden = true;
  }

  /* ---------------- 存取 ---------------- */

  var saveTimer = 0;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          params: params,
          opts: { privacy: opts.privacy, source: opts.source, layers: opts.layers }
        }));
      } catch (err) { /* 无痕模式或空间满：不存也能照常用 */ }
    }, 320);
  }

  function note(text) {
    var n = $('syncNote');
    if (n) n.textContent = text;
  }

  function take(src) {
    Object.keys(params).forEach(function (k) {
      if (src[k] != null) params[k] = src[k];
    });
  }

  /** 老版本存的是每层的不透明度（一个数），换成 {on, d} 的涂层状态 */
  function takeLayers(src) {
    if (!src) return;
    var out = {};
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (typeof v === 'number') out[k] = { on: v > 0.02, d: 0 };
      else if (v && typeof v === 'object') out[k] = { on: v.on !== false, d: Math.round(v.d) || 0 };
    });
    opts.layers = out;
  }

  function loadSaved() {
    var mine = null;
    try { mine = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (err) { mine = null; }
    var outer = readOuter();
    if (mine && mine.params) {
      take(mine.params);
      if (mine.opts) {
        opts.privacy = !!mine.opts.privacy;
        if (mine.opts.source === 'proc' || mine.opts.source === 'real') opts.source = mine.opts.source;
        takeLayers(mine.opts.layers);
      }
      note('体型参数是这一页自己存的，改它不会动到体表标注页那份。');
      return;
    }
    if (outer && outer.params) {
      take(outer.params);
      if (outer.opts) opts.privacy = !!outer.opts.privacy;
      note('体型参数沿用体表标注页里填的那份（' + params.height + ' cm · ' + params.weight + ' kg），三围也一起带过来了。');
      return;
    }
    note('体表标注页还没有记录，先用默认体型：男 · 170 cm · 60 kg。');
  }

  /* ---------------- 体型参数 ---------------- */

  /** 改了性别/身高/体重就按公式重算三围（这一页不单独给三围输入框） */
  function onParam() {
    var g = window.BodyModel.autoGirth(params.gender, params.height, params.weight);
    params.bust = g.bust;
    params.waist = g.waist;
    params.hip = g.hip;
    dirty = true;
    save();
  }

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
      if (!silent) onParam();
    }

    on(r, 'input', function () { apply(parseFloat(r.value), false); });
    on(n, 'change', function () { apply(parseFloat(n.value) || params[key], false); });
    apply(params[key], true);
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

  /* ---------------- 事件接线 ---------------- */

  function wire() {
    pair('height', 'inHeight', 'numHeight');
    pair('weight', 'inWeight', 'numWeight');
    segment('genderSeg', function () { return params.gender; }, function (v) {
      params.gender = v;
      onParam();
    });
    paintSrc = segment('srcSeg', function () { return opts.source; }, function (v) {
      if (v === opts.source) return;
      applySource(v, false);
    });

    var pv = $('privacy');
    pv.checked = opts.privacy;
    on(pv, 'change', function () {
      opts.privacy = pv.checked;
      paintLayers();
      var it = selected();
      if (it && !usable(it)) selName = '';
      paintHl();
      renderCount();
      renderSearch();
      renderAnnList();
      renderInfo();
      save();
      toast(opts.privacy ? '已打开生殖系统这一层' : '已关掉生殖系统这一层');
      if (opts.privacy) ensureReal(onIds());
    });

    on($('layHideAll'), 'click', function () {
      SYS.forEach(function (s) { st(s).on = false; });
      paintLayers();
      save();
      toast('全部图层已隐藏，点任意一行的圆点就能再打开');
    });
    on($('layReset'), 'click', function () {
      opts.layers = {};
      paintLayers();
      save();
      toast('已恢复默认图层：体表、骨骼与内脏开着，肌肉和淋巴关着');
      ensureReal(onIds());
    });

    on($('viewBar'), 'click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) setView(b.dataset.view);
    });
    on($('focusSel'), 'change', function () { focusOn($('focusSel').value); });

    on($('btnFocus'), 'click', function () {
      var it = selected();
      if (it) flyToItem(it);
    });
    on($('btnHideIt'), 'click', function () {
      var it = selected();
      if (!it) return;
      if (hidden[it.name]) delete hidden[it.name]; else hidden[it.name] = true;
      applyHidden();
      paintHl();
      renderInfo();
      toast(hidden[it.name] ? '已隐藏「' + it.name + '」' : '已显示「' + it.name + '」');
    });
    on($('btnClearSel'), 'click', function () { select(null); });

    on($('searchIn'), 'input', renderSearch);
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    loadSaved();
    buildLayers();
    wire();
    rebuild();
    orbit.set({
      target: new V(0, params.height * 0.52, 0),
      distance: fullDist(), theta: 0, phi: Math.PI / 2
    });
    resize();
    loop();
    /* 先把程序化的示意结构摆上，真实解剖数据取到了再换过去 */
    if (opts.source === 'real') applySource('real', true);
  }

  init();
})();
