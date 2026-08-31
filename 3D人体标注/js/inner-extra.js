/* inner-extra.js —— 真实解剖模式下的补件
 *
 * BodyParts3D 那具标本里没有的东西（甲状腺、扁桃体、淋巴结、乙状结肠、脊髓下段、
 * 女性生殖器官、阴茎阴囊），用这一页程序化的那一份补上，名字前面在说明里写明「示意」。
 * 做法是借 inner-organs 的现算几何，只留白名单里的那几件，其余当场丢掉——
 * 这样补件的位置照样跟着身高体重三围走，不用再写第二套坐标。
 */
(function () {
  'use strict';

  /* 每个系统留哪几件：正则 → 这件在真实数据的涂层里占哪一段（lv 属于第几级，to 剥到第几级为止） */
  var KEEP = {
    resp: [
      [/扁桃体/, { lv: 0, to: 1 }],
      [/^喉\(含声带\)$/, { lv: 0, to: 1 }]
    ],
    dig: [
      [/^乙状结肠$/, { lv: 0, to: 0 }]
    ],
    endo: [
      [/^甲状腺$/, { lv: 0, to: 99 }]
    ],
    lymph: [
      [/淋巴结群/, { lv: 0, to: 99 }]
    ],
    nerve: [
      [/^脊髓$/, { lv: 0, to: 2, rename: '脊髓(示意全长)', note: '真实数据只到上颈段，这一条是按脊柱现算的全长示意' }],
      [/^马尾/, { lv: 0, to: 2 }],
      [/坐骨神经/, { lv: 0, to: 2 }]
    ],
    /* 男性只缺外生殖器；女性那一整套真实数据里都没有（标本是男性），所以整层都补 */
    reproM: [
      [/阴茎|阴囊/, { lv: 0, to: 99 }]
    ],
    reproF: [
      [/./, { lv: 0, to: 99 }]
    ]
  };

  function ruleFor(sid, name, isF) {
    var key = sid === 'repro' ? (isF ? 'reproF' : 'reproM') : sid;
    var rules = KEEP[key];
    for (var i = 0; rules && i < rules.length; i++) {
      if (rules[i][0].test(name)) return rules[i][1];
    }
    return null;
  }

  /** 在真实解剖模式下补件；have 是已经装上真实数据的系统 id 列表，
   *  某个系统真实数据一件都没装上时不补（那一层整体交给程序化更整齐）。 */
  function build(cx, have) {
    if (!window.InnerOrgans) return 0;
    var ok = {};
    (have || []).forEach(function (s) { ok[s] = 1; });
    var real = cx.item;
    var n = 0;

    cx.item = function (sid, name, meshes, opt) {
      var list = [].concat(meshes);
      var r = ok[sid] === 1 || sid === 'repro' ? ruleFor(sid, name, cx.isF) : null;
      if (!r) {
        list.forEach(function (m) { if (m.geometry) m.geometry.dispose(); });
        return null;
      }
      opt = opt || {};
      var note = r.note || opt.note || '';
      n++;
      return real(sid, r.rename || name, list, {
        side: opt.side || '', color: opt.color, lv: r.lv, to: r.to,
        note: '示意结构（真实数据里没有这一件）：' + note
      });
    };
    try {
      window.InnerOrgans.build(cx);
    } finally {
      cx.item = real;
    }
    return n;
  }

  window.InnerExtra = { build: build };
})();
