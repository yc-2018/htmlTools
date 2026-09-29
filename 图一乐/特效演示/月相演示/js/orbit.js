/**
 * 轨道相机 —— 拖动旋转、滚轮/双指缩放、中键或右键平移、缓动归位。
 *
 * 用四元数而不是 (phi, theta) 球坐标。球坐标要把 up 固定成 +Y，于是相机一旦
 * 接近极轴就必须 clamp 住，表现为"上下翻过一面就拖不动了"，而且越靠近极点，
 * 水平拖动越像画面绕视线打转（万向锁）。四元数没有极点：上下永远是俯仰，
 * 左右永远是偏航，可以一直翻下去。
 *
 * 姿态 quat 定义为"从默认朝向到当前朝向"的旋转。默认朝向 = 相机位于 +Z、
 * up 为 +Y，正好俯视黄道面，所以"重置俯视"就是让 quat 回到单位四元数。
 */

// 复用，避免每次拖动都新建对象
var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
var _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
var _XA = new THREE.Vector3(1, 0, 0), _YA = new THREE.Vector3(0, 1, 0),
    _ZA = new THREE.Vector3(0, 0, 1);

function OrbitCam(camera, dom) {
  this.camera = camera;
  this.dom = dom;

  this.rotateSpeed = 1;
  this.zoomSpeed = 1;
  this.damping = 0.14;
  this.minDistance = 0.45;
  this.maxDistance = 400;
  this.enabled = true;              // 第一人称接管期间关掉
  this.onUserInput = null;

  this.target = new THREE.Vector3();
  this._tgt = new THREE.Vector3();
  this.quat = new THREE.Quaternion();
  this._quat = new THREE.Quaternion();
  this.radius = 24;
  this._radius = 24;

  this._pointers = {};
  this._pinch = 0;
  this._mid = null;
  this._panning = false;
  this._bind();
}

OrbitCam.prototype._bind = function () {
  var self = this, dom = this.dom;

  function ids() { return Object.keys(self._pointers); }

  dom.addEventListener('pointerdown', function (e) {
    if (!self.enabled) return;
    self._pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    // 中键 / 右键 / Shift+左键 = 平移，其余为旋转
    self._panning = (e.button === 1 || e.button === 2 || e.shiftKey);
    if (self._panning) e.preventDefault();   // 中键默认是自动滚动，得挡掉
    if (ids().length === 1) dom.setPointerCapture(e.pointerId);
    self._pinch = 0;
    self._mid = null;
  });

  dom.addEventListener('pointermove', function (e) {
    if (!self.enabled) return;
    var p = self._pointers[e.pointerId];
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!dx && !dy) return;

    var list = ids();
    if (list.length === 1) {
      if (self._panning) self._pan(dx, dy);
      else self._rotate(dx, dy);
      self._notify();
    } else if (list.length === 2) {
      var a = self._pointers[list[0]], b = self._pointers[list[1]],
          d = Math.hypot(a.x - b.x, a.y - b.y),
          mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // 指间距变化 → 缩放；两指中心平移 → 平移
      if (self._pinch) self._zoom(Math.pow(self._pinch / d, self.zoomSpeed));
      if (self._mid) self._pan(mx - self._mid.x, my - self._mid.y);
      self._pinch = d;
      self._mid = { x: mx, y: my };
      self._notify();
    }
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
    dom.addEventListener(ev, function (e) {
      delete self._pointers[e.pointerId];
      self._pinch = 0;
      self._mid = null;
      self._panning = false;
    });
  });

  dom.addEventListener('wheel', function (e) {
    if (!self.enabled) return;
    e.preventDefault();
    self._zoom(Math.pow(1.0016, e.deltaY * self.zoomSpeed));
    self._notify();
  }, { passive: false });

  // 右键要用来平移，得关掉右键菜单；中键的自动滚动也一并挡住
  dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  dom.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
};

OrbitCam.prototype._notify = function () {
  if (this.onUserInput) this.onUserInput();
};

/**
 * 绕相机自身的两条轴做增量旋转，所以不管已经翻到什么姿态，
 * 上下拖动始终是俯仰、左右拖动始终是偏航。右乘 = 在局部坐标系里转。
 */
OrbitCam.prototype._rotate = function (dx, dy) {
  var k = Math.PI * 2 * this.rotateSpeed / this.dom.clientHeight;
  _q1.setFromAxisAngle(_YA, -dx * k);   // 局部 up
  _q2.setFromAxisAngle(_XA, -dy * k);   // 局部 right
  this._quat.multiply(_q1).multiply(_q2).normalize();
};

OrbitCam.prototype._zoom = function (factor) {
  this._radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._radius * factor));
};

/**
 * 平移注视点。像素位移按当前距离换算成世界距离，
 * 于是拉近之后平移自动变慢，手感才跟手。
 */
OrbitCam.prototype._pan = function (dx, dy) {
  var cam = this.camera,
      worldH = 2 * this.radius * Math.tan(cam.fov * Math.PI / 360),
      k = worldH / this.dom.clientHeight;

  var right = _v1.setFromMatrixColumn(cam.matrix, 0),
      up = _v2.setFromMatrixColumn(cam.matrix, 1);

  this._tgt.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
};

/** 每帧调用：把姿态、距离、注视点各朝目标缓动一步，再摆好相机 */
OrbitCam.prototype.update = function () {
  var k = this.damping;
  this.quat.slerp(this._quat, k);
  this.radius += (this._radius - this.radius) * k;
  this.target.lerp(this._tgt, k);
  this.apply();
};

/** 按当前姿态摆相机。第一人称退出时也要用，所以单独拆出来 */
OrbitCam.prototype.apply = function () {
  var cam = this.camera;
  cam.position.copy(this.target)
     .add(_v1.copy(_ZA).applyQuaternion(this.quat).multiplyScalar(this.radius));
  cam.up.copy(_YA).applyQuaternion(this.quat);
  cam.lookAt(this.target);
};

/**
 * 指定要看哪里、从什么姿态看。
 * @param {{center?: THREE.Vector3, dist?: number, quat?: THREE.Quaternion}} v
 *        quat 省略表示保持当前姿态；传单位四元数即回到默认俯视
 * @param {boolean} animate false 表示立刻就位
 */
OrbitCam.prototype.setView = function (v, animate) {
  if (v.center) this._tgt.copy(v.center);
  if (v.dist != null) {
    this._radius = Math.max(this.minDistance, Math.min(this.maxDistance, v.dist));
  }
  if (v.quat) this._quat.copy(v.quat).normalize();

  if (!animate) {
    this.quat.copy(this._quat);
    this.radius = this._radius;
    this.target.copy(this._tgt);
  }
  this.update();
};

/** 当前姿态离默认俯视有多远（弧度），用来判断要不要提示"重置俯视" */
OrbitCam.prototype.tiltFromDefault = function () {
  return 2 * Math.acos(Math.min(1, Math.abs(this._quat.w)));
};
