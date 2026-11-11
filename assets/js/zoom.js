// zoom.js — 放大查阅层
//
// 职责：把 .rig 当成一块可平移、可缩放的画布，放大后用来读细节。
// 边界：只做视图变换——不改书体布局、不动页号与 URL、不接管翻页。
//       放大期间翻页由调用方（reader.js）经 Flipbook.setLocked 锁死，
//       否则拖动平移会和拖拽翻页抢同一个 pointerdown。
(function () {
  "use strict";

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  function ZoomPan(opts) {
    this.root = opts.root;    // 被 transform 的元素（.rig）
    this.stage = opts.stage;  // 用来算可视区的容器（.stage）
    this.min = opts.min || 1;
    this.max = opts.max || 4;
    this.enterScale = opts.enterScale || 2;
    this.onChange = opts.onChange || function () {};

    this.active = false;
    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;
    this.base = null;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;

    this.bind();
  }

  ZoomPan.prototype.isActive = function () { return this.active; };
  ZoomPan.prototype.scale = function () { return this.zoom; };

  // 未变换时的书体外框：缩放围绕它的中心，平移量也以它为基准
  ZoomPan.prototype.measure = function () {
    var prev = this.root.style.transform;
    this.root.style.transform = "none";
    var r = this.root.getBoundingClientRect();
    this.root.style.transform = prev;
    this.base = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    return this.base;
  };

  // 可视区 = 舞台的内边距盒：平移最多到这圈边界，不露出空白
  ZoomPan.prototype.frame = function () {
    var s = this.stage.getBoundingClientRect();
    var cs = window.getComputedStyle(this.stage);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    return { w: s.width - pl - pr, h: s.height - pt - pb };
  };

  ZoomPan.prototype.clampPan = function () {
    var f = this.frame();
    var mx = Math.max(0, (this.base.w * this.zoom - f.w) / 2);
    var my = Math.max(0, (this.base.h * this.zoom - f.h) / 2);
    this.tx = clamp(this.tx, -mx, mx);
    this.ty = clamp(this.ty, -my, my);
  };

  ZoomPan.prototype.apply = function () {
    if (this.active) {
      this.clampPan();
      this.root.style.transform =
        "translate(" + this.tx.toFixed(2) + "px, " + this.ty.toFixed(2) + "px) " +
        "scale(" + this.zoom.toFixed(4) + ")";
    } else {
      this.root.style.transform = "";
    }
    this.onChange(this.active, this.zoom);
  };

  ZoomPan.prototype.setActive = function (on) {
    on = Boolean(on) && this.max > this.min;
    if (on === this.active) return;
    this.active = on;
    this.drag = null;
    this.pinch = null;
    if (on) {
      this.measure();
      this.zoom = clamp(this.enterScale, this.min, this.max);
    } else {
      this.zoom = this.min;
    }
    this.tx = 0;
    this.ty = 0;
    document.body.classList.toggle("is-zoomed", on);
    this.apply();
  };

  ZoomPan.prototype.toggle = function () { this.setActive(!this.active); };

  // 围绕某个屏幕点缩放：该点底下的内容保持不动
  ZoomPan.prototype.zoomAt = function (target, clientX, clientY) {
    if (!this.active) return;
    if (!this.base) this.measure();
    var next = clamp(target, this.min, this.max);
    if (Math.abs(next - this.zoom) < 0.001) return;
    var k = next / this.zoom;
    this.tx = clientX - this.base.cx - (clientX - this.base.cx - this.tx) * k;
    this.ty = clientY - this.base.cy - (clientY - this.base.cy - this.ty) * k;
    this.zoom = next;
    // 缩回原大小就等于退出放大，翻页随之恢复
    if (this.zoom <= this.min + 0.001) this.setActive(false);
    else this.apply();
  };

  ZoomPan.prototype.bind = function () {
    var self = this;

    var points = function () {
      var out = [];
      self.pointers.forEach(function (p) { out.push(p); });
      return out;
    };
    var mid = function () {
      var pts = points();
      return {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1
      };
    };

    this.root.addEventListener("pointerdown", function (e) {
      if (!self.active || e.button > 0) return;
      e.preventDefault();
      self.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { self.root.setPointerCapture(e.pointerId); } catch (err) { /* 指针已失效 */ }
      if (self.pointers.size === 1) {
        self.drag = { x: e.clientX, y: e.clientY, tx: self.tx, ty: self.ty };
        self.root.classList.add("is-panning");
      } else if (self.pointers.size === 2) {
        self.drag = null;
        var m = mid();
        self.pinch = { d: m.d, zoom: self.zoom };
      }
    });

    this.root.addEventListener("pointermove", function (e) {
      if (!self.active || !self.pointers.has(e.pointerId)) return;
      self.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (self.pinch && self.pointers.size >= 2) {
        e.preventDefault();
        var m = mid();
        self.zoomAt(self.pinch.zoom * (m.d / self.pinch.d), m.x, m.y);
        return;
      }
      if (!self.drag) return;
      e.preventDefault();
      self.tx = self.drag.tx + (e.clientX - self.drag.x);
      self.ty = self.drag.ty + (e.clientY - self.drag.y);
      self.apply();
    });

    var release = function (e) {
      if (!self.pointers.has(e.pointerId)) return;
      self.pointers.delete(e.pointerId);
      if (self.pointers.size === 0) {
        self.drag = null;
        self.pinch = null;
        self.root.classList.remove("is-panning");
      } else if (self.pointers.size === 1) {
        // 双指松开一根：剩下的那根接着平移，不要跳一下
        self.pinch = null;
        var p = points()[0];
        self.drag = { x: p.x, y: p.y, tx: self.tx, ty: self.ty };
      }
    };
    this.root.addEventListener("pointerup", release);
    this.root.addEventListener("pointercancel", release);

    this.root.addEventListener("wheel", function (e) {
      if (!self.active) return;
      e.preventDefault();
      self.zoomAt(self.zoom * Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY);
    }, { passive: false });

    window.addEventListener("resize", function () {
      if (!self.active) return;
      self.measure();
      self.apply();
    });
  };

  window.ZoomPan = ZoomPan;
})();
