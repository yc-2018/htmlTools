/**
 * 左半屏：日地月系统的 3D 俯视图。
 *
 * 坐标约定：黄道面 = XY 平面，+Z 指向北黄极（默认相机方向）。
 * 太阳固定在 -X 侧，平行光沿 +X 射向地球；月球在 XY 平面上绕地球逆时针公转。
 *
 * 白道倾角与交点线
 * ----------------
 * 月球轨道相对黄道倾斜 5.14°，倾斜所绕的那条轴叫交点线（轨道与黄道的交线）。
 * 交点线的方位角 Ω 是决定"这个月会不会发生食"的唯一参数：
 *
 *   Ω = 0°   交点线对准太阳 → 新月落在交点上（日食）、满月落在交点上（月食）
 *   Ω = 90°  交点线垂直于日地连线 → 朔望时月球离黄道面最远，全年无食
 *
 * 现实中 Ω 以 18.6 年周期退行，一年里有两段时间接近 0°，即"食季"，
 * 所以一年大约 2~3 次月食，而不是每月一次。早先的实现把倾斜轴写成了 X 轴
 * （即日地连线本身），等于把交点线永久焊死在 Ω = 0，导致每个朔望月都必然发生
 * 日食和月食 —— 这是错的，现在由 nodeAngle 控制。
 */
var Scene3D = (function () {

  // 尺寸与距离均非真实比例，只为在一屏内同时容纳三个天体
  var SUN_X = -11.5, SUN_R = 2.2,
      EARTH_R = 1.0, MOON_R = 0.38, ORBIT_R = 5.0,
      SYNODIC = 29.53;

  // 白道倾角。真实值 5.14°，但本场景把地月距离压到了 5 个地球半径（真实约 60），
  // 按真实倾角算出的"满月抬升量"只有 0.45，远小于地影宽度，于是每个月都必然沾到影子、
  // 却又永远进不了本影正中 —— 这正是"每次月偏食、从不月全食"的来由。
  // 为了让倾角真正把月球带离影子，这里放大到 20°：配合下面收窄的影锥，
  // 交点角 0° 时满月正中本影(月全食)，接近 90° 时完全避开(无食)，中间过渡出偏食。
  var INCL = 20 * Math.PI / 180;

  // 影锥的角半径（= 从地球看太阳的角半径）。真实太阳角半径约 0.26°，
  // 但画面里的太阳又大又近(角半径约 11°)，照它算影锥会粗得离谱、把整条轨道都罩进半影。
  // 所以影锥单独用一个偏小的角半径，画成细长锥，几何上才和"倾角能让月球躲开影子"自洽。
  var SHADOW_ANGLE = 2.4 * Math.PI / 180;

  // 交点线方位角（弧度）。默认 72°：一个既不发生食、又能明显看出轨道倾斜的角度
  var nodeAngle = 72 * Math.PI / 180;

  var SKY_R = 600;                   // 星空球半径，必须远大于相机最远距离，否则会飞出星空

  var scene, camera, renderer, controls, host, labelHost;
  var sunMesh, earthSpin, moonSpin, moonHolder, orbitGroup, orbitRing, rayGroup;
  var observerGroup, observerMark, sightLine, shadowGroup, umbraMesh, penumbraMesh;
  var rayLines;
  var labels = {};
  var isDefaultView = true, viewChangeCb = null;
  var viewMode = 'orbit', modeCb = null;
  var follow = null;                 // 相机正在跟随的天体，null 表示不跟随
  var IDENTITY = new THREE.Quaternion();
  var OBSERVER_H = 0.3;
  // 观测者是地球表面上一个固定的点，用世界坐标里的单位方向表示，不随时间跑动。
  // 默认 (1,0,0)：太阳在 −X，所以 +X 是背光面正中，观测者天然待在夜半球且一直留在那儿。
  var observerDir = new THREE.Vector3(1, 0, 0);
  var observerPickCb = null;         // 点击地球放置观测者后回调
  var eclipseCb = null;              // 食状态变化时回调，供界面提示
  var lastEclipse = '', lastEclipseInfo = { state: 'none', sep: 99, ru: 0, rp: 0 };
  var ZERO = new THREE.Vector3(0, 0, 0),
      Y_AXIS = new THREE.Vector3(0, 1, 0),
      nodeAxis = new THREE.Vector3(1, 0, 0),   // 交点线方向，由 nodeAngle 导出
      tmpV = new THREE.Vector3(),
      dirV = new THREE.Vector3(),
      _pV = new THREE.Vector3(), _pL = new THREE.Vector3(),
      _pUp = new THREE.Vector3(), _pRight = new THREE.Vector3();

  /** 由交点角算出交点线方向（黄道面内，与 +X 即日地连线成 nodeAngle 角） */
  function syncNodeAxis() {
    nodeAxis.set(Math.cos(nodeAngle), Math.sin(nodeAngle), 0);
  }

  /* ---------------- 构建 ---------------- */

  function init(canvasEl, labelEl) {
    host = canvasEl.parentNode;
    labelHost = labelEl;

    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // r152 起改名为 outputColorSpace，这里两种都兼容，缺哪个就跳过哪个
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    else if (THREE.SRGBColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(0, 0, 24);   // 正上方俯视：视线 -Z，up +Y，无万向锁

    controls = new OrbitCam(camera, renderer.domElement);
    controls.minDistance = 0.45;     // 允许凑到月球跟前
    controls.maxDistance = 260;      // 必须 < SKY_R，否则相机飞出星空球会看到一个黑球
    controls.onUserInput = markDirty;

    syncNodeAxis();

    buildStars();
    buildLights();
    buildBodies();
    buildOrbits();
    buildRays();
    buildShadow();
    buildObserver();
    buildLabels();
    bindEarthPick(canvasEl);

    resize();                       // 内部会按视口宽高比完成首次取景
    window.addEventListener('resize', resize);
  }

  /**
   * 点击地球放置观测者。难点是区分"点击"和"拖动旋转相机"——两者都从 pointerdown 起手。
   * 办法：记下按下的位置，抬起时若几乎没移动（<5px）才当成点击去打射线。
   * 射线打中地球就把命中点方向设为观测者位置；命中点用世界坐标，与地球自转无关。
   */
  function bindEarthPick(canvasEl) {
    var raycaster = new THREE.Raycaster(),
        ndc = new THREE.Vector2(),
        downX = 0, downY = 0, moved = false;

    canvasEl.addEventListener('pointerdown', function (e) {
      downX = e.clientX; downY = e.clientY; moved = false;
    });
    canvasEl.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) moved = true;
    });
    canvasEl.addEventListener('pointerup', function (e) {
      if (moved || viewMode === 'fp') return;   // 拖动过、或第一人称里，不处理
      var rect = canvasEl.getBoundingClientRect();
      ndc.set(
        (e.clientX - rect.left) / rect.width * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      var hit = raycaster.intersectObject(earthSpin, false)[0];
      if (hit) {
        observerDir.copy(hit.point).normalize();
        updateObserver();
        if (observerPickCb) observerPickCb();
      }
    });
  }

  function buildStars() {
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 48, 24),
      new THREE.MeshBasicMaterial({ map: Textures.stars(), side: THREE.BackSide, depthWrite: false })
    );
    scene.add(sky);
  }

  function buildLights() {
    // 太阳平行光：位置在太阳处、目标在地球处，于是光线沿 +X 平行射来。
    // DirectionalLight 的 target 必须也加进场景，否则方向不生效。
    var sunLight = new THREE.DirectionalLight(0xfff4e0, 1.35);
    sunLight.position.set(SUN_X, 0, 0);
    sunLight.target.position.set(0, 0, 0);
    scene.add(sunLight, sunLight.target);

    // 偏蓝的弱环境光：让背光面留下可辨的暗部而不是死黑
    // （否则新月那侧的月球会整个从画面里消失，也就看不出"月球始终在那里"）
    scene.add(new THREE.AmbientLight(0x3d4a78, 0.85));
  }

  function buildBodies() {
    // 太阳：自发光材质，不参与光照计算
    sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_R, 48, 32),
      new THREE.MeshBasicMaterial({ map: Textures.sun() })
    );
    sunMesh.position.set(SUN_X, 0, 0);
    scene.add(sunMesh);

    // 太阳外的光晕
    var glow = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_R * 1.28, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.16, side: THREE.BackSide })
    );
    sunMesh.add(glow);

    // 地球：tilt 组把球的极轴由 +Y 摆到 +Z，自转则是内层 mesh 绕自身 Y 轴
    var earthTilt = new THREE.Group();
    earthTilt.rotation.x = Math.PI / 2;
    earthSpin = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 64, 48),
      new THREE.MeshStandardMaterial({ map: Textures.earth(), roughness: 0.82, metalness: 0 })
    );
    earthTilt.add(earthSpin);
    scene.add(earthTilt);

    // 月球：holder 负责公转定位，内层同样 tilt + spin（潮汐锁定）
    moonHolder = new THREE.Group();
    var moonTilt = new THREE.Group();
    moonTilt.rotation.x = Math.PI / 2;
    moonSpin = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_R, 64, 48),
      new THREE.MeshStandardMaterial({ map: Textures.moon(), roughness: 0.96, metalness: 0 })
    );
    moonTilt.add(moonSpin);
    moonHolder.add(moonTilt);
    scene.add(moonHolder);
  }

  function buildOrbits() {
    orbitGroup = new THREE.Group();

    // 月球轨道圆
    var pts = [], i;
    for (i = 0; i <= 160; i++) {
      var a = i / 160 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * ORBIT_R, Math.sin(a) * ORBIT_R, 0));
    }
    var ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x6f86c8, transparent: true, opacity: 0.55 })
    );
    // 与 setPhase 用同一条交点线，否则画出来的轨道和月球实际位置对不上
    ring.quaternion.setFromAxisAngle(nodeAxis, INCL);
    orbitRing = ring;
    orbitGroup.add(ring);

    // 日—地连线：月相的参考基准轴
    var axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(SUN_X + SUN_R, 0, 0), new THREE.Vector3(ORBIT_R + 1.6, 0, 0)
      ]),
      new THREE.LineDashedMaterial({ color: 0xffd479, transparent: true, opacity: 0.3, dashSize: 0.34, gapSize: 0.26 })
    );
    axis.computeLineDistances();
    orbitGroup.add(axis);

    scene.add(orbitGroup);
  }

  var RAY_COUNT = 41, RAY_SPAN = 6.6;

  /**
   * 阳光。不是示意箭头，而是一排真的平行光线：每条都沿 +X 推进，
   * 与地球、月球求交，撞上谁就在谁的表面截断。
   *
   * 于是影子不用另外画 —— 光线被挡出来的那个空洞就是影锥，
   * 月球挡住射向地球的光就是日食，地球挡住射向月球的光就是月食。
   */
  function buildRays() {
    rayGroup = new THREE.Group();

    var pos = new Float32Array(RAY_COUNT * 2 * 3);
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    rayLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    rayGroup.add(rayLines);
    scene.add(rayGroup);
    updateRays();
  }

  /** 每帧重算光线端点：月球在动，它投下的影子也跟着动 */
  function updateRays() {
    var pos = rayLines.geometry.attributes.position,
        m = moonHolder.position,
        farX = ORBIT_R + 2.4;

    for (var i = 0; i < RAY_COUNT; i++) {
      var y = -RAY_SPAN + 2 * RAY_SPAN * i / (RAY_COUNT - 1),
          // 起点贴着太阳球面，超出太阳的那些从太阳所在截面出发
          x0 = SUN_X + Math.sqrt(Math.max(0, SUN_R * SUN_R - y * y)) * 0.99,
          x1 = farX;

      // 撞地球？球心在原点，光线走在 (t, y, 0) 上
      var dy = y, r2 = EARTH_R * EARTH_R - dy * dy;
      if (r2 > 0) x1 = Math.min(x1, -Math.sqrt(r2));

      // 撞月球？月球有 z 分量，要一并算进离轴距离
      var my = y - m.y, mr2 = MOON_R * MOON_R - my * my - m.z * m.z;
      if (mr2 > 0) x1 = Math.min(x1, m.x - Math.sqrt(mr2));

      pos.setXYZ(i * 2, x0, y, 0);
      pos.setXYZ(i * 2 + 1, x1, y, 0);
    }
    pos.needsUpdate = true;
    rayLines.geometry.computeBoundingSphere();
  }

  /**
   * 地球上的观测者：地表上一个由用户点击指定的固定点。
   * 从他脚下拉一条视线到月球，右半屏的 2D 月相就是沿这条视线看过去的样子。
   */
  function buildObserver() {
    observerGroup = new THREE.Group();

    // 小圆锥当人形，尖端朝天顶。带自发光，转到地球夜半球时也不会看不见
    observerMark = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, OBSERVER_H, 14),
      new THREE.MeshStandardMaterial({
        color: 0x63e6c8, emissive: 0x2ba98b, emissiveIntensity: 0.85, roughness: 0.6
      })
    );
    observerGroup.add(observerMark);

    // 视线：两个端点每帧改写，所以单独留一份 geometry
    sightLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({
        color: 0x63e6c8, transparent: true, opacity: 0.5, dashSize: 0.3, gapSize: 0.22
      })
    );
    observerGroup.add(sightLine);

    scene.add(observerGroup);
  }

  /**
   * 地球影锥。
   *
   * 本影(umbra，完全照不到阳光)是收敛锥：半径随距离按 tan(SHADOW_ANGLE) 递减，
   * 到顶点 L = Re / tan(SHADOW_ANGLE) 收成一点。半影(penumbra，只被太阳一部分照到)
   * 是发散锥，半径按同一角度递增。用 SHADOW_ANGLE 而非画面里那个大太阳的角半径，
   * 详见文件头部的说明 —— 否则半影会粗到把整条月球轨道都罩进去，永远躲不开。
   */
  function shadowGeometry() {
    var t = Math.tan(SHADOW_ANGLE),
        umbraLen = EARTH_R / t,          // 本影锥长
        penSlope = t,                    // 半影半张角的正切
        penLen = ORBIT_R + 2.2;          // 半影只画到轨道外一点
    return { umbraLen: umbraLen, penSlope: penSlope, penLen: penLen };
  }

  function buildShadow() {
    var g = shadowGeometry();
    shadowGroup = new THREE.Group();

    // 本影：真实锥顶远在 x=umbraLen(约 24)，全画出来会射穿整个画面，
    // 所以只画到半影同样的长度，做成收窄的圆台。CylinderGeometry 轴沿 +Y，转成沿 +X
    var umbraFar = EARTH_R * (1 - g.penLen / g.umbraLen);   // penLen 处的本影半径
    umbraMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(umbraFar, EARTH_R, g.penLen, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x0a0e1c, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    umbraMesh.rotation.z = -Math.PI / 2;
    umbraMesh.position.x = g.penLen / 2;
    shadowGroup.add(umbraMesh);

    // 半影：发散圆台，越远越粗。画得很淡，只用来说明"这里阳光被挡掉一部分"
    penumbraMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        EARTH_R + g.penLen * g.penSlope, EARTH_R, g.penLen, 48, 1, true
      ),
      new THREE.MeshBasicMaterial({
        color: 0x2a3358, transparent: true, opacity: 0.13,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    penumbraMesh.rotation.z = -Math.PI / 2;
    penumbraMesh.position.x = g.penLen / 2;
    shadowGroup.add(penumbraMesh);

    // 影锥中轴：延长线穿过月球轨道，一眼能看出满月时月球差了多少才进影子
    var axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(g.penLen, 0, 0)
      ]),
      new THREE.LineDashedMaterial({
        color: 0x8fa3d8, transparent: true, opacity: 0.35, dashSize: 0.22, gapSize: 0.2
      })
    );
    axis.computeLineDistances();
    shadowGroup.add(axis);

    scene.add(shadowGroup);
  }

  /**
   * 判断当前月球和地球影锥的关系。
   *
   * 影锥中轴是 +X 半轴（太阳在 -X，光沿 +X 射来）。设月球位置 p：
   *   p.x <= 0        月球在朝阳侧，不可能被地球挡住
   *   离轴距离 s      = √(p.y² + p.z²)
   *   该处本影半径 ru = Re·(1 − p.x / L)，超出锥长则为 0
   *   该处半影半径 rp = Re + p.x·penSlope
   * 再拿 s 与 ru、rp 加减月球半径比较，就能分出全食 / 偏食 / 半影食。
   *
   * @returns {{state:'none'|'penumbral'|'partial'|'total', sep:number, ru:number, rp:number}}
   *          sep/ru/rp 均以月球半径为单位：sep 是月心离影轴的距离，
   *          ru、rp 是该处本影/半影的半径。2D 视图靠这三个量把食画准。
   */
  function eclipseState() {
    var p = moonHolder.position,
        out = { state: 'none', sep: 99, ru: 0, rp: 0 };
    if (p.x <= 0) return out;

    var g = shadowGeometry(),
        s = Math.hypot(p.y, p.z),
        ru = Math.max(0, EARTH_R * (1 - p.x / g.umbraLen)),
        rp = EARTH_R + p.x * g.penSlope;

    out.sep = s / MOON_R;
    out.ru = ru / MOON_R;
    out.rp = rp / MOON_R;

    if (s + MOON_R <= ru) out.state = 'total';
    else if (s - MOON_R < ru) out.state = 'partial';
    else if (s - MOON_R < rp) out.state = 'penumbral';
    return out;
  }

  function buildLabels() {
    ['sun', 'earth', 'moon', 'observer'].forEach(function (key) {
      var d = document.createElement('div');
      d.className = 'label';
      d.dataset.body = key;
      labelHost.appendChild(d);
      labels[key] = d;
    });
    labels.sun.textContent = '太阳';
    labels.earth.textContent = '地球';
    labels.observer.textContent = '观测者';
  }

  /* ---------------- 每帧更新 ---------------- */

  /**
   * @param {number} phase 月相 0~1：0 新月（月球位于日地之间）、0.5 满月（月球在地球背阳侧）
   */
  function setPhase(phase) {
    var ang = Math.PI * 2 * phase;

    // 新月时月球朝太阳（-X），此后在 XY 平面上逆时针公转，
    // 最后绕交点线抬起白道倾角 —— 绕的是交点线而不是日地连线，这是不发生食的原因
    moonHolder.position
      .set(-Math.cos(ang) * ORBIT_R, -Math.sin(ang) * ORBIT_R, 0)
      .applyAxisAngle(nodeAxis, INCL);

    // 潮汐锁定：月球自转周期等于公转周期，始终以同一面朝向地球
    moonSpin.rotation.y = ang;
    // 地球自转：一个朔望月里自转约 29.53 圈
    earthSpin.rotation.y = ang * SYNODIC;

    updateObserver();
    updateRays();

    // 食状态只在等级变化时向外通知一次，避免每帧都动 DOM。
    // 几何量每帧都更新，2D 视图直接读 lastEclipseInfo
    lastEclipseInfo = eclipseState();
    if (lastEclipseInfo.state !== lastEclipse) {
      lastEclipse = lastEclipseInfo.state;
      if (eclipseCb) eclipseCb(lastEclipse);
    }
  }

  /**
   * 摆放观测者。
   *
   * 观测者是地球表面上一个固定的点（observerDir），不追着月球跑 —— 之前那个
   * "自动待在夜半球"的做法会在新月前后把观测者从地球一侧瞬移到另一侧，看起来就像
   * 地球突然转了半圈，其实是观测者在跳。现在位置只由用户点击决定，稳稳待着。
   *
   * 他能不能看见月亮，仍取决于两件事：所在处是不是夜里（太阳在 −X，x>0 的半球是夜），
   * 以及月亮在不在地平线以上（observerDir 与月球方向夹角小于 90°）。二者有一个不满足，
   * 就把标记压暗，一眼能看出"此刻这里看不到月亮"。
   */
  function updateObserver() {
    var dir = tmpV.copy(observerDir),
        m = dirV.copy(moonHolder.position).normalize();

    var daylight = dir.x <= 0,                  // 观测者所在处是白天
        altitude = dir.dot(m);                  // >0 月亮在地平线以上

    // 圆锥底面贴住地表，所以中心再往外挪半个锥高
    observerMark.position.copy(dir).multiplyScalar(EARTH_R + OBSERVER_H / 2);
    observerMark.quaternion.setFromUnitVectors(Y_AXIS, dir);   // 锥尖指向天顶

    // 白天或月亮在地平线下时压暗，一眼能看出"此刻看不见"
    var ok = !daylight && altitude > 0.02;
    observerMark.material.emissiveIntensity = ok ? 0.85 : 0.12;
    observerMark.material.color.setHex(ok ? 0x63e6c8 : 0x55606f);
    sightLine.material.opacity = ok ? 0.5 : 0.14;

    var pos = sightLine.geometry.attributes.position,
        foot = dir.clone().multiplyScalar(EARTH_R + OBSERVER_H);
    pos.setXYZ(0, foot.x, foot.y, foot.z);
    pos.setXYZ(1, moonHolder.position.x, moonHolder.position.y, moonHolder.position.z);
    pos.needsUpdate = true;
    sightLine.geometry.computeBoundingSphere();
    sightLine.computeLineDistances();     // 虚线间隔依赖线长，端点变了要重算

    observerMark.userData.visible = ok;
    observerMark.userData.dir = observerMark.userData.dir || new THREE.Vector3();
    observerMark.userData.dir.copy(dir);      // 第一人称要用这个方向架相机
  }

  function render() {
    if (viewMode === 'fp') {
      updateFirstPerson();
    } else {
      // 跟随中的天体在动，注视点每帧都要跟上
      if (follow) controls.setView({ center: follow.position }, true);
      controls.update();
    }
    renderer.render(scene, camera);
    updateLabels();
  }

  /** 天体标签：把世界坐标投影成屏幕坐标，驱动 HTML 覆盖层 */
  function updateLabels() {
    if (labelHost.style.display === 'none') return;
    var w = host.clientWidth, h = host.clientHeight;

    place(labels.sun, sunMesh.position, SUN_R);
    place(labels.earth, ZERO, EARTH_R);
    place(labels.moon, moonHolder.position, MOON_R);
    if (observerGroup.visible && observerMark.visible) {
      place(labels.observer, observerMark.position, OBSERVER_H);
    } else {
      labels.observer.style.opacity = 0;
    }

    // 锚点取天体正上方 radius 处，于是标签贴着天体一起缩放、一起旋转
    function place(el, worldPos, radius) {
      var q = tmpV.set(worldPos.x, worldPos.y + radius * 1.5, worldPos.z).project(camera);
      if (q.z > 1) { el.style.opacity = 0; return; }   // 落到相机背后
      el.style.opacity = 1;
      el.style.left = (q.x * 0.5 + 0.5) * w + 'px';
      el.style.top = (-q.y * 0.5 + 0.5) * h + 'px';
    }
  }

  /* ---------------- 相机视角 ---------------- */

  /** 计算一个恰好框住"太阳 + 整条月球轨道"的俯视距离，随视口宽高比自适应 */
  function frameAll() {
    var left = SUN_X - SUN_R * 1.15, right = ORBIT_R + 1.8,
        cx = (left + right) / 2,
        needW = right - left,
        needH = (ORBIT_R + 1.8) * 2,
        half = Math.tan(camera.fov * Math.PI / 360),
        d = Math.max(needH / 2 / half, needW / 2 / (half * camera.aspect)) * 1.04;
    return { center: new THREE.Vector3(cx, 0, 0), dist: Math.max(d, controls.minDistance + 1) };
  }

  /**
   * 恢复默认俯视角度：正对黄道面，太阳在左、地月系统居中。
   * 姿态回到单位四元数即为默认朝向，过渡交给控制器的缓动。
   */
  function resetTopView(animate) {
    setViewMode('orbit');
    follow = null;
    var f = frameAll();
    controls.setView({ center: f.center, dist: f.dist, quat: IDENTITY }, animate);
    setDefault(true);
  }

  /**
   * 第一人称：站在观测者所在的地面上抬头看天。相机固定在观测者头顶，只转动视线。
   *
   * "月球到太阳附近时视野会超级大旋转"的根源：新月时月球转到观测者的正下方(天底)
   * 附近，如果还硬要把视线指向它、再钳回地平线,那么视线的方位在月球掠过天底的一瞬间
   * 会从一侧甩到另一侧,表现为近 180° 的猛烈旋转。
   *
   * 对一个真实的地面观测者来说,月亮沉到地平线下就是看不见,他不会为此转圈。所以这里:
   * 月亮在地平线以上才跟踪它,沉下去就把视线**冻结**在原地不动;跟踪时还做阻尼平滑,
   * 于是月亮重新升起时是缓缓转过去,而不是猛甩。天底那段完全不跟踪,大旋转就不存在了。
   */
  var fpLook = new THREE.Vector3(), fpReady = false;

  function updateFirstPerson() {
    var zenith = observerMark.userData.dir;   // 观测者头顶方向(世界系)
    if (!zenith) return;

    camera.position.copy(zenith).multiplyScalar(EARTH_R + OBSERVER_H * 1.1);

    var toMoon = tmpV.copy(moonHolder.position).sub(camera.position).normalize(),
        elev = toMoon.dot(zenith);            // 沿天顶的分量 = 仰角正弦

    if (elev > 0.02) {
      // 月亮在地平线上:跟踪它,并阻尼平滑(可见弧是连续的,相邻帧方向接近,直接插值即可)
      if (!fpReady) { fpLook.copy(toMoon); fpReady = true; }
      else fpLook.lerp(toMoon, 0.12).normalize();
    } else if (!fpReady) {
      // 刚进第一人称时月亮恰在地平线下:先朝它的方位、贴着地平线,给个合理初始朝向
      var horiz = dirV.copy(toMoon).addScaledVector(zenith, -elev);
      if (horiz.lengthSq() < 1e-8) horiz.set(0, 0, 1).addScaledVector(zenith, -zenith.z);
      horiz.normalize();
      fpLook.copy(horiz).multiplyScalar(Math.sqrt(1 - 0.05 * 0.05)).addScaledVector(zenith, 0.05);
      fpReady = true;
    }
    // else: 月亮在地平线下且已初始化 —— 视线冻结不动

    // up 取黄北极 +Z;仅当视线几乎正对 +Z 时退用 +Y,避免 lookAt 退化打转
    camera.up.set(0, 0, 1);
    if (Math.abs(fpLook.z) > 0.98) camera.up.set(0, 1, 0);

    camera.lookAt(camera.position.x + fpLook.x,
                  camera.position.y + fpLook.y,
                  camera.position.z + fpLook.z);
  }

  /** @param {'orbit'|'fp'} mode */
  function setViewMode(mode) {
    if (viewMode === mode) return;
    viewMode = mode;
    controls.enabled = (mode === 'orbit');

    // 第一人称用窄视场，月球才有合适的大小；退出时恢复
    camera.fov = (mode === 'fp') ? 26 : 50;
    camera.updateProjectionMatrix();

    // 第一人称时相机就架在观测者头顶，那个圆锥和它的标签都会糊在镜头上
    observerMark.visible = (mode !== 'fp');
    labels.observer.style.display = (mode === 'fp') ? 'none' : '';
    if (mode === 'fp') fpReady = false;   // 重新进入时按当前月相初始化朝向

    if (mode === 'orbit') controls.apply();
    if (modeCb) modeCb(mode);
  }

  /** 用户一旦自行操作，就解除跟随并标记视角已偏离默认俯视 */
  function markDirty() {
    follow = null;
    setDefault(false);
  }

  function setDefault(v) {
    if (isDefaultView === v) return;
    isDefaultView = v;
    if (viewChangeCb) viewChangeCb(v);
  }

  function resize() {
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    // 仍停在默认俯视时跟着窗口重新取景；用户自己转过视角、
    // 或正处在第一人称里，就不要打扰他
    if (isDefaultView && viewMode === 'orbit') {
      var f = frameAll();
      controls.setView({ center: f.center, dist: f.dist, quat: IDENTITY }, false);
      setDefault(true);
    }
  }

  /**
   * 把相机送到某个天体近处细看。月球会一直跑，所以聚焦月球后要持续跟随，
   * 否则刚拉近它就飘出画面了。
   * @param {'moon'|'earth'|'sun'} what
   */
  function focusOn(what) {
    setViewMode('orbit');
    follow = (what === 'moon') ? moonHolder : null;
    var c = what === 'moon' ? moonHolder.position
          : what === 'sun' ? sunMesh.position : ZERO,
        d = what === 'moon' ? MOON_R * 7
          : what === 'sun' ? SUN_R * 4.5 : EARTH_R * 7;
    controls.setView({ center: c.clone(), dist: d }, true);
    setDefault(false);
  }

  /**
   * 从观察者视角推算 2D 该画成什么样。返回 {illum, psi}。
   *
   * illum(照亮比例) 由日-月-地几何定，与观察者站哪儿无关 —— 这是对的：地球相对
   * 地月距离就是个点，各地看到的"亮多少"几乎一样。设视线 V(地心→月)、月指向太阳 L：
   *   照亮比例 = (1 − L·V) / 2   （满月 L≈−V → 1，新月 L≈V → 0）
   *
   * psi(亮限方位角) 才依赖观察者：把观察者天顶投到与视线垂直的像平面当"上"，
   * 右 = V×上，构成他仰望这轮月亮时的画面坐标；再看太阳方向 L 投影到这张画面里指向哪，
   * 就是被照亮那半边的朝向。观察者挪到南半球，天顶反向 → 上/右都翻号 → psi 转 180°，
   * 月相随之上下左右颠倒，正如南北半球看月亮的差别。
   */
  function observerPhase() {
    _pV.copy(moonHolder.position).normalize();               // 地心 → 月
    // 太阳按平行光处理(与 3D 的 DirectionalLight 一致)：月指向太阳恒为 −X。
    // 这样上下弦恰好半亮、名称与画面一致，不受"太阳其实离得不够远"这个场景压缩的影响。
    _pL.set(-1, 0, 0);

    var illum = (1 - _pL.dot(_pV)) / 2;

    // 观察者天顶投到像平面(去掉沿视线的分量)作为"上"
    _pUp.copy(observerDir).addScaledVector(_pV, -observerDir.dot(_pV));
    if (_pUp.lengthSq() < 1e-6) {                            // 月在天顶，退化
      _pUp.set(0, 0, 1).addScaledVector(_pV, -_pV.z);
      if (_pUp.lengthSq() < 1e-6) _pUp.set(0, 1, 0);
    }
    _pUp.normalize();
    _pRight.crossVectors(_pV, _pUp).normalize();             // 观察者仰望时的画面向右

    var psi = Math.atan2(_pL.dot(_pUp), _pL.dot(_pRight));
    return { illum: illum, psi: psi };
  }

  return {
    init: init,
    setPhase: setPhase,
    render: render,
    resetTopView: resetTopView,
    focusOn: focusOn,
    observerPhase: observerPhase,
    setViewMode: setViewMode,
    onViewChange: function (cb) { viewChangeCb = cb; },
    onModeChange: function (cb) { modeCb = cb; },
    onEclipse: function (cb) { eclipseCb = cb; },
    isTopView: function () { return isDefaultView; },
    showOrbits: function (v) { orbitGroup.visible = v; },
    showRays: function (v) { rayGroup.visible = v; },
    showShadow: function (v) { shadowGroup.visible = v; },
    showObserver: function (v) { observerGroup.visible = v; },
    showLabels: function (v) { labelHost.style.display = v ? '' : 'none'; },
    setMoonLabel: function (text) { labels.moon.textContent = text; },
    onObserverPick: function (cb) { observerPickCb = cb; },
    /** 把观测者放回背光面正中（+X） */
    resetObserver: function () {
      observerDir.set(1, 0, 0);
      updateObserver();
    },
    setNodeAngle: function (deg) {
      nodeAngle = deg * Math.PI / 180;
      syncNodeAxis();
      orbitRing.quaternion.setFromAxisAngle(nodeAxis, INCL);
    },
    observerCanSee: function () { return !!observerMark.userData.visible; },
    eclipse: function () { return lastEclipseInfo; }
  };
})();
