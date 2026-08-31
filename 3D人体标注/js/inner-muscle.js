/* inner-muscle.js —— 肌肉图层：只做体表摸得到、日常最常说酸痛的那些大块
 * 默认不透明度是 0（肌肉一开就把内脏全挡住了），需要时用面板滑块拉出来
 */
(function () {
  'use strict';

  var V = THREE.Vector3;

  function build(cx) {
    var H = cx.H, item = cx.item, ell = cx.ell, tube = cx.tube;

    /** 躯干前面的一点：x 用半宽占比（±1 到体侧皮肤），zt=0 在椎体、1 在前面皮肤 */
    function W(xa, f, zt) {
      var s = cx.sec(f), zb = cx.spineZ(f);
      return new V(xa * s.a, f * H, zb + (s.bF - zb) * zt);
    }
    /** 躯干后面的一点：zt=0 在椎体、1 在后背皮肤 */
    function B(xa, f, zt) {
      var s = cx.sec(f), zb = cx.spineZ(f);
      return new V(xa * s.a, f * H, zb + (-s.bB - zb) * zt);
    }
    function A(f) { return cx.sec(f).a; }
    function D(f) { var s = cx.sec(f); return s.bF - cx.spineZ(f); }

    /* ---------------- 躯干 ---------------- */
    item('muscle', '膈肌', [ell(W(0, 0.658, 0.32), A(0.658) * 0.86, 0.019 * H, D(0.658) * 0.72, null, 18)],
      { note: '胸腔和腹腔之间的那层肉膜，吸气的主力；打嗝就是它在抽' });

    [1, -1].forEach(function (side) {
      var sn = side > 0 ? '左' : '右';

      item('muscle', sn + '胸锁乳突肌', [tube(
        new V(side * 0.028 * H, 0.876 * H, cx.headZ - 0.022 * H), W(side * 0.10, 0.788, 0.86),
        0.011 * H, 0.009 * H, { seg: 12, steps: 3 })],
        { side: sn, note: '把头转到一侧时对面脖子上鼓起来的那一条；落枕多是它' });

      item('muscle', sn + '斜方肌', [
        ell(B(side * 0.30, 0.790, 0.86), A(0.790) * 0.42, 0.030 * H, 0.011 * H, null, 14),
        ell(B(side * 0.34, 0.730, 0.88), A(0.730) * 0.34, 0.040 * H, 0.010 * H, null, 14)
      ], { side: sn, note: '脖子根到肩膀那一片；久坐低头僵硬发酸的就是它的上部' });

      item('muscle', sn + '菱形肌与背阔肌', [
        ell(B(side * 0.46, 0.700, 0.82), A(0.700) * 0.42, 0.048 * H, 0.010 * H, null, 14),
        ell(B(side * 0.54, 0.640, 0.80), A(0.640) * 0.36, 0.036 * H, 0.010 * H, null, 14)
      ], { side: sn, note: '肩胛之间到腰背的一大片，把手臂往下往后拉的主力' });

      item('muscle', sn + '竖脊肌', [tube(
        new V(side * 0.016 * H, 0.782 * H, cx.spineZ(0.782) - 0.016 * H),
        new V(side * 0.021 * H, 0.552 * H, cx.spineZ(0.552) - 0.020 * H),
        0.013 * H, 0.017 * H, { seg: 12, steps: 5 })],
        { side: sn, note: '脊柱两侧那两条纵向的肉棱；腰背劳损、闪腰后僵住的多是它' });

      /* 深层：这两条藏在竖脊肌和内脏之间，腰痛查不出原因时常是它们 */
      item('muscle', sn + '腰方肌', [tube(
        new V(side * 0.030 * H, 0.646 * H, cx.spineZ(0.646) - 0.004 * H),
        new V(side * 0.042 * H, 0.556 * H, cx.spineZ(0.556) - 0.002 * H),
        0.011 * H, 0.013 * H, { seg: 10, steps: 4 })],
        { side: sn, note: '最下一根肋骨连到髂骨上缘，贴在腰椎侧后方；单侧腰眼酸痛常和它有关' });

      item('muscle', sn + '髂腰肌', [tube(
        new V(side * 0.018 * H, 0.640 * H, cx.spineZ(0.640) + 0.014 * H),
        cx.limb[side > 0 ? 'l' : 'r'].hip.clone().add(new V(0, -0.012 * H, 0.006 * H)),
        0.013 * H, 0.010 * H, { seg: 12, steps: 5 })],
        { side: sn, note: '从腰椎前面穿过骨盆接到大腿骨内上方，抬腿的主力；久坐会缩短，站直时把腰往前拽' });

      item('muscle', sn + '胸大肌', [ell(W(side * 0.44, 0.738, 0.84), A(0.738) * 0.38, 0.032 * H, D(0.738) * 0.10, null, 14)],
        { side: sn, note: '前胸那一片，女性的乳房就叠在它前面' });

      item('muscle', sn + '腹直肌', [tube(W(side * 0.16, 0.664, 0.93), W(side * 0.20, 0.512, 0.93),
        0.014 * H, 0.012 * H, { seg: 12, steps: 5 })],
        { side: sn, note: '肚子正中两侧的直条，练出来就是腹肌；正中的白线把左右分开' });

      item('muscle', sn + '腹外斜肌', [ell(W(side * 0.80, 0.594, 0.56), A(0.594) * 0.20, 0.044 * H, D(0.594) * 0.34, null, 14)],
        { side: sn, note: '腰的侧面，管转身和侧弯' });

      item('muscle', sn + '臀大肌', [ell(B(side * 0.56, 0.508, 0.72), A(0.508) * 0.36, 0.038 * H, 0.026 * H, null, 16)],
        { side: sn, note: '屁股上那块最厚的肌肉；打针打的就是它的外上部' });
    });
    /* ---------------- 四肢 ----------------
       手臂和腿都近乎竖直，所以前后直接用 ±Z 偏一点就够了 */
    var FZ = 1;
    ['l', 'r'].forEach(function (k) {
      var b = cx.limb[k], sn = b.sn, side = b.side;

      item('muscle', sn + '三角肌', [ell(b.shoulder.clone().add(new V(side * 0.009 * H, 0.005 * H, 0)),
        0.026 * H, 0.034 * H, 0.028 * H, null, 16)],
        { side: sn, note: '包在肩膀外面的那顶「帽子」，抬手臂靠它；打针也常打这里' });

      item('muscle', sn + '肱二头肌', [tube(
        b.shoulder.clone().addScaledVector(b.d1, 0.036 * H).add(new V(0, 0, FZ * 0.014 * H)),
        b.elbow.clone().addScaledVector(b.d1, -0.016 * H).add(new V(0, 0, FZ * 0.012 * H)),
        0.016 * H, 0.013 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '上臂前面鼓起来的那块，屈肘的主力' });
      item('muscle', sn + '肱三头肌', [tube(
        b.shoulder.clone().addScaledVector(b.d1, 0.026 * H).add(new V(0, 0, -0.015 * H)),
        b.elbow.clone().addScaledVector(b.d1, -0.008 * H).add(new V(0, 0, -0.013 * H)),
        0.017 * H, 0.013 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '上臂后面那块，伸直手肘靠它' });
      item('muscle', sn + '前臂屈肌群', [tube(
        b.elbow.clone().addScaledVector(b.d2, 0.016 * H).add(new V(0, 0, FZ * 0.012 * H)),
        b.wrist.clone().addScaledVector(b.d2, -0.024 * H).add(new V(0, 0, FZ * 0.008 * H)),
        0.017 * H, 0.010 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '前臂靠手心那一侧，握东西、打字用的就是它们' });
      item('muscle', sn + '前臂伸肌群', [tube(
        b.elbow.clone().addScaledVector(b.d2, 0.014 * H).add(new V(0, 0, -0.013 * H)),
        b.wrist.clone().addScaledVector(b.d2, -0.022 * H).add(new V(0, 0, -0.009 * H)),
        0.016 * H, 0.010 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '前臂靠手背那一侧，上端就是「网球肘」痛的地方' });

      item('muscle', sn + '股四头肌', [tube(
        b.hip.clone().add(new V(0, -0.026 * H, FZ * 0.018 * H)),
        b.knee.clone().add(new V(0, 0.034 * H, FZ * 0.016 * H)),
        0.030 * H, 0.019 * H, { seg: 14, steps: 5 })],
        { side: sn, note: '大腿前面一大块，伸膝、上楼、起身全靠它；下端的肌腱包着髌骨' });
      item('muscle', sn + '腘绳肌(股二头肌等)', [tube(
        b.hip.clone().add(new V(0, -0.020 * H, -0.020 * H)),
        b.knee.clone().add(new V(0, 0.040 * H, -0.018 * H)),
        0.025 * H, 0.016 * H, { seg: 14, steps: 5 })],
        { side: sn, note: '大腿后面那几条，弯膝盖用；久坐后拉伸会觉得紧的就是它' });
      item('muscle', sn + '小腿三头肌(腓肠肌)与跟腱', [
        tube(b.knee.clone().add(new V(0, -0.036 * H, -0.019 * H)),
          b.ankle.clone().add(new V(0, 0.078 * H, -0.017 * H)), 0.027 * H, 0.011 * H, { seg: 14, steps: 5 }),
        tube(b.ankle.clone().add(new V(0, 0.078 * H, -0.017 * H)),
          new V(b.ankle.x, 0.026 * H, b.ankle.z - 0.030 * H), 0.008 * H, 0.007 * H, { seg: 10, steps: 3 })
      ], { side: sn, note: '小腿后面的「腿肚子」，抽筋常在这里；下端收成跟腱接到脚跟骨上' });
      item('muscle', sn + '小腿前群(胫骨前肌)', [tube(
        b.knee.clone().add(new V(side * 0.010 * H, -0.044 * H, FZ * 0.015 * H)),
        b.ankle.clone().add(new V(side * 0.004 * H, 0.024 * H, FZ * 0.011 * H)),
        0.014 * H, 0.008 * H, { seg: 12, steps: 4 })],
        { side: sn, note: '小腿骨外侧那条，勾脚背用；跑多了发炎就是「胫前疼」' });
    });
  }

  window.InnerMuscle = { build: build };
})();

