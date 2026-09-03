/* 简易轨道控制器：拖拽旋转 / 滚轮缩放 / 中键或 Shift 拖拽平移 / 触摸单指旋转、双指捏合缩放、同时按中点平移 */
(function () {
  'use strict';

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function Orbit(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 90, 0);
    this.distance = 280;
    this.theta = 0;                 // 水平角，0 表示正对人体正面
    this.phi = Math.PI / 2;         // 垂直角
    this.minDistance = 8;
    this.maxDistance = 700;
    this.rotateSpeed = 0.0055;
    this.leftRotate = true;         // 标注模式下由外部关闭
    this.dragged = false;           // 本次按下是否发生过拖动
    this._pointers = new Map();
    this._act = null;               // 'rotate' | 'pan'
    this._last = { x: 0, y: 0 };
    this._pinch = 0;
    this._mid = null;               // 双指中点，移动它即平移（触屏唯一的平移入口）
    this._anim = null;
    this._bind();
    this.update();
  }

  Orbit.prototype._bind = function () {
    var self = this;
    var dom = this.dom;

    dom.addEventListener('pointerdown', function (e) {
      /* 中键/右键的浏览器默认行为（自动滚动、粘贴）会顶掉平移操作 */
      if (e.button === 1 || e.button === 2) e.preventDefault();
      dom.setPointerCapture(e.pointerId);
      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      self.dragged = false;
      if (self._pointers.size === 2) {
        self._act = 'pinch';
        self._pinch = self._pointerGap();
        self._mid = self._pointerMid();
        return;
      }
      var pan = e.button === 1 || e.shiftKey || (e.button === 2 && e.ctrlKey);
      if (pan) self._act = 'pan';
      else if (e.button === 2 || e.button === 0) {
        // 标注模式下左键留给标注，右键仍可旋转
        if (e.button === 0 && !self.leftRotate) self._act = null;
        else self._act = 'rotate';
      }
      self._last.x = e.clientX;
      self._last.y = e.clientY;
    });

    dom.addEventListener('pointermove', function (e) {
      if (!self._pointers.has(e.pointerId)) return;
      self._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (self._act === 'pinch') {
        var gap = self._pointerGap();
        var mid = self._pointerMid();
        var moved = false;
        if (self._pinch > 0 && gap > 0) {
          self.distance = clamp(self.distance * (self._pinch / gap), self.minDistance, self.maxDistance);
          self._pinch = gap;
          moved = true;
        }
        /* 两指距离管缩放，两指中点的移动管平移：手机上没有中键，平移只能走这里 */
        if (self._mid && mid) {
          var mx = mid.x - self._mid.x;
          var my = mid.y - self._mid.y;
          if (Math.abs(mx) + Math.abs(my) > 0.5) {
            self.pan(mx, my);
            moved = true;
          }
        }
        self._mid = mid;
        if (moved) {
          self.dragged = true;
          self.update();
        }
        return;
      }
      if (!self._act) return;
      var dx = e.clientX - self._last.x;
      var dy = e.clientY - self._last.y;
      self._last.x = e.clientX;
      self._last.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) self.dragged = true;
      if (self._act === 'rotate') {
        self._anim = null;
        self.theta -= dx * self.rotateSpeed;
        self.phi = clamp(self.phi - dy * self.rotateSpeed, 0.08, Math.PI - 0.08);
      } else {
        self.pan(dx, dy);
      }
      self.update();
    });

    function release(e) {
      self._pointers.delete(e.pointerId);
      if (self._pointers.size < 2 && self._act === 'pinch') {
        self._act = null;
        self._mid = null;
      }
      if (self._pointers.size === 0) self._act = null;
    }

    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('lostpointercapture', release);
    dom.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    /* pointerdown 的 preventDefault 不会阻止兼容性鼠标事件，
       所以中键的自动滚动还得在 mousedown / auxclick 上单独拦一次 */
    dom.addEventListener('mousedown', function (e) {
      if (e.button === 1) e.preventDefault();
    });
    dom.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });

    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      self._anim = null;
      var k = Math.pow(1.0016, e.deltaY);
      self.distance = clamp(self.distance * k, self.minDistance, self.maxDistance);
      self.update();
    }, { passive: false });
  };

  Orbit.prototype._pointerGap = function () {
    var pts = Array.from(this._pointers.values());
    if (pts.length < 2) return 0;
    var dx = pts[0].x - pts[1].x;
    var dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  Orbit.prototype._pointerMid = function () {
    var pts = Array.from(this._pointers.values());
    if (pts.length < 2) return null;
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  };

  /** 沿屏幕方向平移观察点 */
  Orbit.prototype.pan = function (dx, dy) {
    this._anim = null;
    var k = this.distance * 0.0022;
    var right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(up, dy * k);
  };

  /** 平滑移动到指定视角 */
  Orbit.prototype.flyTo = function (opt, ms) {
    var to = {
      tx: opt.target ? opt.target.x : this.target.x,
      ty: opt.target ? opt.target.y : this.target.y,
      tz: opt.target ? opt.target.z : this.target.z,
      d: opt.distance == null ? this.distance : clamp(opt.distance, this.minDistance, this.maxDistance),
      th: opt.theta == null ? this.theta : opt.theta,
      ph: opt.phi == null ? this.phi : clamp(opt.phi, 0.08, Math.PI - 0.08)
    };
    // 选择最近的等价角度，避免绕远路
    while (to.th - this.theta > Math.PI) to.th -= Math.PI * 2;
    while (to.th - this.theta < -Math.PI) to.th += Math.PI * 2;
    this._anim = {
      t0: performance.now(),
      dur: ms == null ? 460 : ms,
      from: { tx: this.target.x, ty: this.target.y, tz: this.target.z, d: this.distance, th: this.theta, ph: this.phi },
      to: to
    };
  };

  /** 立即设置视角（不动画） */
  Orbit.prototype.set = function (opt) {
    if (opt.target) this.target.copy(opt.target);
    if (opt.distance != null) this.distance = clamp(opt.distance, this.minDistance, this.maxDistance);
    if (opt.theta != null) this.theta = opt.theta;
    if (opt.phi != null) this.phi = clamp(opt.phi, 0.08, Math.PI - 0.08);
    this._anim = null;
    this.update();
  };

  Orbit.prototype.tick = function () {
    var a = this._anim;
    if (!a) return false;
    var t = a.dur <= 0 ? 1 : Math.min(1, (performance.now() - a.t0) / a.dur);
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    this.target.set(
      a.from.tx + (a.to.tx - a.from.tx) * e,
      a.from.ty + (a.to.ty - a.from.ty) * e,
      a.from.tz + (a.to.tz - a.from.tz) * e
    );
    this.distance = a.from.d + (a.to.d - a.from.d) * e;
    this.theta = a.from.th + (a.to.th - a.from.th) * e;
    this.phi = a.from.ph + (a.to.ph - a.from.ph) * e;
    if (t >= 1) this._anim = null;
    this.update();
    return true;
  };

  Orbit.prototype.update = function () {
    var d = this.distance;
    var sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + d * sp * Math.sin(this.theta),
      this.target.y + d * Math.cos(this.phi),
      this.target.z + d * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  };

  window.SimpleOrbit = Orbit;
})();
