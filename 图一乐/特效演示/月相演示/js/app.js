/** 把 3D 场景、2D 月相和控件绑到同一个相位量上驱动。 */
(function () {
  var SYNODIC = 29.53;          // 朔望月长度（天）
  var SECONDS_PER_MONTH = 20;   // 1× 速度下走完一个朔望月所需的秒数

  var $ = function (id) { return document.getElementById(id); };

  var age = 0,                  // 月龄（天），唯一的状态量
      playing = true,
      speed = parseFloat($('speed').value),
      lastDrawn = -1,
      lastEclState = '';

  var g2 = $('canvas2d').getContext('2d');

  Scene3D.init($('canvas3d'), $('labels'));
  Scene3D.onViewChange(function (isTop) {
    // 视角偏离默认俯视后，把"重置俯视"按钮点亮提示
    $('btnTop').classList.toggle('hint', !isTop);
  });

  /* ---------------- 同步渲染 ---------------- */

  function phase() { return (age % SYNODIC) / SYNODIC; }

  function sync() {
    var p = phase();
    Scene3D.setPhase(p);

    var ecl = Scene3D.eclipse();
    // 相位没动但食状态变了（比如拖了交点角滑块）也要重画
    if (Math.abs(p - lastDrawn) > 1e-4 || ecl.state !== lastEclState) {
      lastDrawn = p;
      lastEclState = ecl.state;
      Phase2D.draw(g2, p, ecl);

      var name = Phase2D.phaseName(p);
      $('phaseName').textContent = name;
      $('mIllum').textContent = Math.round(Phase2D.illumination(p) * 100) + '%';
      $('mAngle').textContent = (p * 360).toFixed(1) + '°';
      $('mAge').textContent = age.toFixed(2) + ' 天';
      $('ageOut').textContent = age.toFixed(2) + ' 天';
      Scene3D.setMoonLabel('月球 · ' + name);

      // 新月前后必然看不见：月亮和太阳同方向，谁在夜里就一定背对月亮
      var canSee = Scene3D.observerCanSee(),
          warn = $('obsWarn');
      if (canSee) {
        warn.hidden = true;
      } else {
        warn.textContent = '此刻观测者看不到月亮（在地平线下或正值白天）';
        warn.hidden = false;
      }
      // 第一人称里同步提示，好解释为什么画面只剩天空和地平线
      $('fpHint').hidden = !(fpOn && !canSee);
    }
  }

  /* ---------------- 主循环 ---------------- */

  var last = performance.now();
  (function loop(now) {
    var dt = Math.min((now - last) / 1000, 0.1);   // 切到后台再回来时不要跳一大步
    last = now;

    if (playing) {
      age = (age + dt * speed * SYNODIC / SECONDS_PER_MONTH) % SYNODIC;
      $('age').value = age;
    }
    sync();
    Scene3D.render();
    requestAnimationFrame(loop);
  })(last);

  /* ---------------- 控件 ---------------- */

  $('age').addEventListener('input', function () {
    age = parseFloat(this.value);
    setPlaying(false);
    sync();
  });

  $('speed').addEventListener('input', function () {
    speed = parseFloat(this.value);
    $('speedOut').textContent = speed.toFixed(1) + '×';
  });

  $('btnPlay').addEventListener('click', function () { setPlaying(!playing); });

  function setPlaying(v) {
    playing = v;
    $('btnPlay').textContent = v ? '暂停' : '播放';
    $('btnPlay').classList.toggle('on', v);
  }

  $('btnTop').addEventListener('click', function () { Scene3D.resetTopView(true); });
  $('btnFocus').addEventListener('click', function () { Scene3D.focusOn('moon'); });

  // 第一人称：和俯视按钮互斥，点第二次退回轨道视角
  var fpOn = false;
  $('btnFP').addEventListener('click', function () {
    fpOn = !fpOn;
    Scene3D.setViewMode(fpOn ? 'fp' : 'orbit');
  });
  Scene3D.onModeChange(function (mode) {
    fpOn = (mode === 'fp');
    $('btnFP').classList.toggle('on', fpOn);
    // 第一人称下相机由观测者位置决定，旋转/平移/聚焦都无意义
    ['btnFocus', 'btnTop'].forEach(function (id) { $(id).disabled = fpOn; });
    if (!fpOn) $('fpHint').hidden = true;
    else lastDrawn = -1;          // 进入第一人称时立刻算一次可见性提示
  });

  $('btnMore').addEventListener('click', function () {
    var box = $('more'), open = box.hidden;
    box.hidden = !open;
    this.textContent = open ? '更多 ▴' : '更多 ▾';
    this.classList.toggle('on', open);
  });

  /* 观测者：点击地球放置，或按钮放回背光面 */
  Scene3D.onObserverPick(function () {
    lastDrawn = -1;              // 逼一次重绘，好刷新"看不见"提示
    sync();
  });
  $('btnObsReset').addEventListener('click', function () {
    Scene3D.resetObserver();
    lastDrawn = -1;
    sync();
  });

  /* 交点角：0° 是食季，此时朔望必然成食 */
  $('nodeAngle').addEventListener('input', function () {
    var deg = parseFloat(this.value);
    Scene3D.setNodeAngle(deg);
    $('nodeAngleOut').textContent = deg + '°';
    sync();                      // 暂停时也要立刻看到食状态的变化
  });

  /* 食状态提示 */
  var ECLIPSE_TEXT = {
    total: '月全食 — 月球整个进入地球本影',
    partial: '月偏食 — 月球部分进入本影',
    penumbral: '半影月食 — 月球只掠过半影，肉眼几乎看不出'
  };
  Scene3D.onEclipse(function (state) {
    var tag = $('eclipseTag');
    if (ECLIPSE_TEXT[state]) {
      tag.textContent = ECLIPSE_TEXT[state];
      tag.hidden = false;
    } else {
      tag.hidden = true;
    }
  });

  [['btnOrbit', Scene3D.showOrbits], ['btnShadow', Scene3D.showShadow],
   ['btnRay', Scene3D.showRays], ['btnObs', Scene3D.showObserver],
   ['btnLabel', Scene3D.showLabels]]
    .forEach(function (pair) {
      var btn = $(pair[0]);
      btn.addEventListener('click', function () {
        var on = !btn.classList.contains('on');
        btn.classList.toggle('on', on);
        pair[1](on);
      });
    });

  /* 键盘：空格播放/暂停，← → 逐日拨动，R 回到俯视 */
  window.addEventListener('keydown', function (e) {
    // 焦点在滑块或按钮上时交给控件自己处理，否则空格和方向键会被响应两次
    if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;

    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setPlaying(false);
      var d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.25);
      age = (age + d + SYNODIC) % SYNODIC;
      $('age').value = age;
      sync();
    } else if (e.key === 'r' || e.key === 'R') {
      Scene3D.resetTopView(true);
    } else if (e.key === 'f' || e.key === 'F') {
      fpOn = !fpOn;
      Scene3D.setViewMode(fpOn ? 'fp' : 'orbit');
    }
  });

  /* ---------------- 2D 画布尺寸自适应 ---------------- */

  function fit2d() {
    var box = $('phaseWrap'),
        size = Math.max(180, Math.min(box.clientWidth, box.clientHeight) - 8),
        dpr = Math.min(window.devicePixelRatio, 2),
        cv = $('canvas2d');
    cv.style.width = cv.style.height = size + 'px';
    cv.width = cv.height = Math.round(size * dpr);
    lastDrawn = -1;   // 尺寸变了要强制重画
  }
  window.addEventListener('resize', fit2d);
  fit2d();

  /* 首次交互后淡出拖动提示 */
  var hint = $('hintDrag'),
      hintEvents = ['pointerdown', 'wheel', 'keydown'];
  function dismissHint() {
    hint.style.opacity = 0;
    hintEvents.forEach(function (ev) { window.removeEventListener(ev, dismissHint); });
  }
  hintEvents.forEach(function (ev) { window.addEventListener(ev, dismissHint); });
  setTimeout(dismissHint, 8000);

  sync();
})();
