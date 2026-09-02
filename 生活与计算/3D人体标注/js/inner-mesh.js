/* inner-mesh.js —— 真实解剖数据（BodyParts3D）的加载与装配
 *
 * 数据在 assets/inner/：manifest.json 列出每个系统一个 .ibp 包，按图层用到才下载。
 * .ibp 是本站自己的小格式（tools/bp3d-build.js 生成）：
 *   'IBP1' + uint32 头部 JSON 字节数 + 头部 JSON（补到 4 字节对齐）+ 数据区
 *   数据区每件依次放 int16 顶点、索引（uint16 或 uint32），各自补到 4 字节；
 *   顶点按每件自己的包围盒定标，还原公式 p = (q + 32767) * sc + mn；法线在这里现算。
 *
 * 数据来源：BodyParts3D/Anatomography，© The Database Center for Life Science，CC BY 4.0
 * 详见 assets/inner/LICENSE-BodyParts3D.txt
 */
(function () {
  'use strict';

  var DIR = './assets/inner/';
  var packs = {};        /* 系统 id → { levels:[名], items:[{n,lv,to,note,side,geo}] } */
  var pending = {};      /* 正在下载的：系统 id → [回调] */
  var man = null;        /* manifest */
  var lastErr = '';

  function get(url, type) {
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return type === 'json' ? r.json() : r.arrayBuffer();
    });
  }

  /** 把一件的 int16 顶点还原成 Float32，并算好法线 */
  function geoOf(buf, base, r) {
    var q = new Int16Array(buf, base + r.p[0], r.v * 3);
    var pos = new Float32Array(r.v * 3);
    for (var i = 0; i < r.v; i++) {
      pos[i * 3] = (q[i * 3] + 32767) * r.sc[0] + r.mn[0];
      pos[i * 3 + 1] = (q[i * 3 + 1] + 32767) * r.sc[1] + r.mn[1];
      pos[i * 3 + 2] = (q[i * 3 + 2] + 32767) * r.sc[2] + r.mn[2];
    }
    var n = r.t * 3;
    var idx = r.big ? new Uint32Array(buf, base + r.i[0], n) : new Uint16Array(buf, base + r.i[0], n);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx.slice(0), 1));
    g.computeVertexNormals();
    /* 这份几何在多次重建之间共用，inner-model 的 dispose 不要动它 */
    g.userData.shared = true;
    return g;
  }

  function parse(buf) {
    var dv = new DataView(buf);
    var tag = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (tag !== 'IBP1') throw new Error('不是 .ibp 文件');
    var hl = dv.getUint32(4, true);
    var head = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf, 8, hl)));
    var base = 8 + ((hl + 3) & ~3);
    var items = head.items.map(function (r) {
      return {
        n: r.n, lv: r.lv, to: r.to, note: r.d || '', side: r.s || '',
        en: r.en || '', tris: r.t, geo: geoOf(buf, base, r)
      };
    });
    return { sys: head.sys, levels: head.levels || [], items: items };
  }

  /* ---------------- 对外 ---------------- */

  /** 先取 manifest：拿到每个系统的涂层级名（各系统级数不一样），顺手写回 InnerModel.SYSTEMS */
  function ready(cb) {
    if (man) { cb(null, man); return; }
    get(DIR + 'manifest.json', 'json').then(function (d) {
      man = d;
      (man.systems || []).forEach(function (r) {
        var s = find(r.sys);
        if (s) s.lvReal = (r.levels || []).map(function (n) { return { n: n }; });
      });
      cb(null, man);
    }).catch(function (e) {
      lastErr = String(e && e.message || e);
      cb(lastErr);
    });
  }

  function find(sid) {
    var L = window.InnerModel.SYSTEMS;
    for (var i = 0; i < L.length; i++) { if (L[i].id === sid) return L[i]; }
    return null;
  }

  function known(sid) {
    if (!man) return false;
    return (man.systems || []).some(function (r) { return r.sys === sid; });
  }

  function has(sid) { return !!packs[sid]; }

  /** 加载一个系统的包（重复调用只会下一次）；cb(err) */
  function load(sid, cb) {
    cb = cb || function () {};
    if (packs[sid]) { cb(null); return; }
    if (!known(sid)) { cb('没有 ' + sid + ' 的真实解剖数据'); return; }
    if (pending[sid]) { pending[sid].push(cb); return; }
    pending[sid] = [cb];
    var rec = (man.systems || []).filter(function (r) { return r.sys === sid; })[0];
    get(DIR + rec.file).then(function (buf) {
      packs[sid] = parse(buf);
      done(sid, null);
    }).catch(function (e) {
      lastErr = String(e && e.message || e);
      done(sid, lastErr);
    });
  }

  function done(sid, err) {
    var list = pending[sid] || [];
    delete pending[sid];
    list.forEach(function (f) { f(err); });
  }

  /** 一次要好几个系统，全部落地（成功或失败）后回调一次 */
  function loadAll(ids, cb) {
    var left = 0, err = null;
    ids.filter(known).forEach(function (sid) {
      left++;
      load(sid, function (e) {
        if (e) err = e;
        if (--left === 0) cb(err);
      });
    });
    if (!left) cb(null);
  }

  /** 把已经下载好的件装到正在构建的模型上（inner-model.js 在真实解剖模式下调它）。
   *  数据是一具 171.95 cm 的成年男性，这里按身高等比放大，胖瘦只微调左右和前后。 */
  function attach(cx) {
    var refH = (man && man.ref && man.ref.height) || 171.95;
    var k = cx.H / refH;
    var kw = k * (1 + 0.16 * (cx.fat - 1));
    var n = 0;
    Object.keys(packs).forEach(function (sid) {
      if (sid === 'repro' && cx.isF) return;      /* 数据集只有男性，女性这一层留空 */
      packs[sid].items.forEach(function (r) {
        var m = new THREE.Mesh(r.geo);
        m.scale.set(kw, k, kw);
        cx.item(sid, r.n, m, { lv: r.lv, to: r.to, note: r.note, side: r.side });
        n++;
      });
    });
    return n;
  }

  /** 已经装得上的系统（面板用来提示哪几层还在下载） */
  function loaded() { return Object.keys(packs); }

  function info(sid) {
    if (!man) return null;
    return (man.systems || []).filter(function (r) { return r.sys === sid; })[0] || null;
  }

  window.InnerMesh = {
    ready: ready, load: load, loadAll: loadAll, attach: attach,
    has: has, known: known, loaded: loaded, info: info,
    err: function () { return lastErr; }
  };
})();
