// 清单状态、模式高亮与 3D 外的勾选清单
(function () {
  'use strict';

  const D = window.XW_DATA;
  const KEY = 'yuanxing-xiewu:packed';
  const OVERLAY = '(max-width: 1080px)';

  const $ = id => document.getElementById(id);
  const refs = {
    canvas: $('scene'),
    loader: $('loader'),
    fallback: $('fallback'),
    stageHint: $('stage-hint'),
    hint: $('hint'),
    barFill: $('bar-fill'),
    bar: $('bar'),
    views: Array.from(document.querySelectorAll('.view[data-view]')),
    modes: Array.from(document.querySelectorAll('.mode')),
    openList: $('open-list'),
    reset: $('reset'),
    backdrop: $('drawer-backdrop'),
    drawer: $('drawer'),
    drawerSum: $('drawer-sum'),
    closeList: $('close-list'),
    onlyNeed: $('only-need'),
    list: $('drawer-list'),
    drawerReset: $('drawer-reset'),
    toast: $('toast')
  };

  const state = {
    mode: '',
    packed: new Set(),
    onlyNeed: false,
    hover: null,
    requiredSet: null
  };

  const overlayMq = window.matchMedia(OVERLAY);
  const TOTAL = D.ITEMS.length;

  let ready = false;
  let rooms = [];
  let rows = new Map();
  let toastTimer = 0;
  let resizeTimer = 0;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      arr.forEach(id => {
        if (D.ITEM_MAP[id]) state.packed.add(id);
      });
    } catch (err) { /* 本地存储不可用时静默跳过 */ }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(Array.from(state.packed)));
    } catch (err) { /* 忽略 */ }
  }

  function buildDrawer() {
    rooms = D.ROOMS.map(room => {
      const el = document.createElement('section');
      el.className = 'room-block';

      const title = document.createElement('h3');
      title.className = 'room-title';
      const name = document.createElement('span');
      name.textContent = room.name;
      const em = document.createElement('em');
      title.appendChild(name);
      title.appendChild(em);
      el.appendChild(title);

      const zones = room.zones.map(zone => {
        const zt = document.createElement('h4');
        zt.className = 'zone-title';
        zt.textContent = zone.name;
        el.appendChild(zt);
        zone.ids.forEach(id => {
          const it = D.ITEM_MAP[id];
          if (!it) return;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'row';
          row.dataset.id = id;
          row.dataset.tag = it.tag;
          row.innerHTML = '<span class="row-name"></span>' +
            '<span class="row-tag"></span>' +
            '<span class="row-check" aria-hidden="true"></span>';
          row.querySelector('.row-name').textContent = it.name;
          row.querySelector('.row-tag').textContent = D.TAG_LABEL[it.tag];
          row.title = it.name + ' · ' + D.TAG_LABEL[it.tag];
          row.addEventListener('click', () => toggle(id));
          row.addEventListener('pointerenter', () => sceneHover(id));
          row.addEventListener('pointerleave', () => sceneHover(null));
          el.appendChild(row);
          rows.set(id, row);
        });
        return { el: zt, ids: zone.ids.slice() };
      });

      refs.list.appendChild(el);
      return { el: el, em: em, zones: zones, ids: room.zones.reduce((a, z) => a.concat(z.ids), []) };
    });
  }

  function stats() {
    const ids = state.mode ? D.idsForMode(state.mode) : null;
    const set = ids ? new Set(ids) : null;
    const total = ids ? ids.length : TOTAL;
    const packed = ids ? ids.filter(id => state.packed.has(id)).length : state.packed.size;
    return { ids: ids, set: set, total: total, packed: packed };
  }

  function requiredOf(id) {
    return !state.mode || !!(state.requiredSet && state.requiredSet.has(id));
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    if (!mode) state.onlyNeed = false;
    const ids = mode ? D.idsForMode(mode) : null;
    state.requiredSet = ids ? new Set(ids) : null;
    updateUI();
    if (ready) window.XWScene.setMode(mode, ids);
    toast(mode ? '已切到' + D.MODE_LABEL[mode] + ' · 需带 ' + ids.length + ' 件' : '已取消出行方式');
  }

  function toggle(id) {
    const it = D.ITEM_MAP[id];
    if (!it) return;
    const wasPacked = state.packed.has(id);
    if (wasPacked) state.packed.delete(id);
    else state.packed.add(id);
    save();
    updateUI();
    const note = !wasPacked && state.mode && !requiredOf(id) ? '（这趟不用带）' : '';
    toast((wasPacked ? '已放回 · ' : '已收好 · ') + it.name + note);
  }

  function resetAll() {
    if (!state.packed.size) {
      toast('还没有收东西');
      return;
    }
    state.packed.clear();
    save();
    updateUI();
    toast('已全部放回');
  }

  function toast(msg) {
    if (overlayMq.matches && refs.drawer.classList.contains('show')) return;
    refs.toast.textContent = msg;
    refs.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 1700);
  }

  function updateDock(st) {
    const pct = st.total ? Math.round(st.packed / st.total * 100) : 0;
    refs.barFill.style.width = pct + '%';
    refs.bar.setAttribute('aria-valuenow', String(pct));
    refs.bar.setAttribute('aria-valuetext', st.packed + ' / ' + st.total);

    if (!state.mode) {
      refs.hint.textContent = state.packed.size
        ? '已收 ' + state.packed.size + ' 件 · 选个出行方式，看这趟要带什么'
        : '选个出行方式 · 物品在 3D 里高亮，勾选在清单里';
      return;
    }
    const label = D.MODE_LABEL[state.mode];
    if (st.packed === 0) {
      refs.hint.textContent = label + '需带 ' + st.total + ' 件 · 点高亮的物品或清单打勾';
    } else if (st.packed >= st.total) {
      refs.hint.textContent = label + '的 ' + st.total + ' 件都收好了，出发吧';
    } else {
      refs.hint.textContent = label + '需带 ' + st.total + ' 件 · 已收 ' + st.packed + ' 件';
    }
  }

  function updateDrawer(st) {
    const filter = !!state.mode && state.onlyNeed;
    rooms.forEach(meta => {
      let req = 0, reqPacked = 0, packed = 0, visible = 0;
      meta.zones.forEach(zone => {
        let zVisible = 0;
        zone.ids.forEach(id => {
          const row = rows.get(id);
          if (!row) return;
          const isReq = !state.mode || !!(state.requiredSet && state.requiredSet.has(id));
          const isPacked = state.packed.has(id);
          row.classList.toggle('checked', isPacked);
          row.classList.toggle('dim', !!state.mode && !isReq);
          row.setAttribute('aria-pressed', String(isPacked));
          const show = !filter || isReq;
          row.hidden = !show;
          if (show) zVisible++;
          if (isReq) {
            req++;
            if (isPacked) reqPacked++;
          }
          if (isPacked) packed++;
        });
        zone.el.hidden = zVisible === 0;
        if (zVisible) visible += zVisible;
      });
      meta.el.hidden = visible === 0;
      meta.em.textContent = state.mode
        ? '需带 ' + req + ' · 已收 ' + reqPacked
        : meta.ids.length + ' 件 · 已收 ' + packed;
    });

    if (!state.mode) {
      refs.drawerSum.textContent = '共 ' + TOTAL + ' 件 · 已收 ' + state.packed.size + ' 件';
    } else {
      refs.drawerSum.textContent = D.MODE_LABEL[state.mode] + '需带 ' + st.total + ' 件 · 已收 ' + st.packed + ' 件';
    }
    refs.onlyNeed.hidden = !state.mode;
    refs.onlyNeed.setAttribute('aria-pressed', String(!!state.onlyNeed));
  }

  function updateUI() {
    const st = stats();
    state.requiredSet = st.set;
    refs.modes.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode)));
    document.body.dataset.mode = state.mode;
    document.body.classList.toggle('has-mode', !!state.mode);
    updateDock(st);
    updateDrawer(st);
  }

  function sceneHover(id) {
    state.hover = id;
    if (ready) window.XWScene.setHover(id);
    refs.canvas.classList.toggle('hovering', !!id);
    rows.forEach((row, rid) => row.classList.toggle('scene-hover', rid === id));
  }

  function onHover(id) {
    if (id === state.hover) return;
    sceneHover(id);
  }

  function openDrawer() {
    if (!overlayMq.matches) return;
    clearTimeout(toastTimer);
    refs.toast.classList.remove('show');
    refs.drawer.classList.add('show');
    refs.backdrop.classList.add('show');
    refs.drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    refs.closeList.focus({ preventScroll: true });
  }

  function closeDrawer() {
    if (!overlayMq.matches || !refs.drawer.classList.contains('show')) return;
    refs.drawer.classList.remove('show');
    refs.backdrop.classList.remove('show');
    refs.drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    refs.openList.focus({ preventScroll: true });
  }

  function syncListMode() {
    if (overlayMq.matches) {
      if (!refs.drawer.classList.contains('show')) refs.drawer.setAttribute('aria-hidden', 'true');
    } else {
      refs.drawer.classList.remove('show');
      refs.backdrop.classList.remove('show');
      refs.drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = '';
    }
  }

  function syncView(name) {
    refs.views.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.view === name)));
  }

  function initUI() {
    refs.modes.forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode || ''));
    });
    refs.views.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!ready) return;
        window.XWScene.applyView(btn.dataset.view, false);
        syncView(btn.dataset.view);
      });
    });
    refs.openList.addEventListener('click', openDrawer);
    refs.closeList.addEventListener('click', closeDrawer);
    refs.backdrop.addEventListener('click', closeDrawer);
    refs.reset.addEventListener('click', resetAll);
    refs.drawerReset.addEventListener('click', resetAll);
    refs.onlyNeed.addEventListener('click', () => {
      state.onlyNeed = !state.onlyNeed;
      updateUI();
    });
  }

  function boot() {
    load();
    buildDrawer();
    initUI();
    updateUI();
    syncListMode();
    if (overlayMq.addEventListener) overlayMq.addEventListener('change', syncListMode);
    else overlayMq.addListener(syncListMode);

    let ok = false;
    try {
      ok = window.XWScene.init(refs.canvas, {
        onPick: toggle,
        onHover: onHover,
        onEscape: closeDrawer
      });
    } catch (err) {
      ok = false;
      if (window.console) console.error(err);
    }
    ready = !!ok;

    if (!ready) {
      refs.fallback.hidden = false;
      refs.loader.classList.add('hide');
      refs.stageHint.hidden = true;
      refs.views.forEach(btn => { btn.disabled = true; });
    } else {
      const active = window.XWScene.activeView();
      syncView(active);
      updateUI();
      requestAnimationFrame(() => {
        setTimeout(() => refs.loader.classList.add('hide'), 260);
      });
    }

    const stage = refs.canvas.parentElement;
    const onResize = () => {
      if (!ready) return;
      cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        window.XWScene.resize();
      });
    };
    if (window.ResizeObserver) {
      new ResizeObserver(onResize).observe(stage);
    } else {
      window.addEventListener('resize', onResize);
    }
    window.addEventListener('load', onResize);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
