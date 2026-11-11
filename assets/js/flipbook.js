// flipbook.js — 双叶翻页引擎（无依赖）
//
// 模型：一「跨页」= 一张图 = 舞台左右各一半。
// 翻页时只有右侧这一叶真的转起来：
//   正面 = 当前跨页的右半，绕书脊（舞台中线）从左到右转 180°；
//   背面 = 下一跨页的左半，转过去正好盖住左页。
// 底层左页保持不动、右页先换成目标跨页的右半，于是动画结束的瞬间版面即目标跨页，
// 直接对调隐藏叶子即可，不会出现闪帧。
//
// 边界：只管「翻」这一件事——不读 URL、不建缩略图、不管按钮状态，那些在 reader.js 里。
(function () {
  "use strict";

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInOut = function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  var FLIP_MS = 820;
  var DRAG_COMMIT = 0.26;

  function Flipbook(opts) {
    this.root = opts.root;
    this.panelL = opts.panelL;
    this.panelR = opts.panelR;
    this.leaf = opts.leaf;
    this.front = opts.front;
    this.back = opts.back;
    this.pages = opts.pages;
    this.index = opts.index || 0;
    this.onChange = opts.onChange || function () {};
    this.onEdge = opts.onEdge || function () {};
    this.onError = opts.onError || function () {};
    this.onLoading = opts.onLoading || function () {};

    this.busy = false;
    this.turn = null;
    this.cache = new Map();
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.raf = 0;

    this.leaf.hidden = true;
    this.bindPointer();
    this.render();
    this.preloadAround();
  }

  Flipbook.prototype.page = function (i) {
    return this.pages[clamp(i, 0, this.pages.length - 1)];
  };

  Flipbook.prototype.ensure = function (page) {
    var self = this;
    if (!page) return Promise.resolve();
    if (this.cache.has(page.src)) return Promise.resolve(this.cache.get(page.src));
    if (!page.__pending) {
      page.__pending = new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          self.cache.set(page.src, img);
          resolve(img);
        };
        img.onerror = function () {
          reject(new Error("第 " + page.id + " 页加载失败：" + page.src));
        };
        img.src = page.src;
      }).then(
        function (img) { page.__pending = null; return img; },
        function (err) { page.__pending = null; throw err; }
      );
    }
    return page.__pending;
  };

  // 铺一层页：已缓存就直接用正图，否则先上占位图再悄悄换。
  Flipbook.prototype.paint = function (el, page, side) {
    var self = this;
    var cached = this.cache.has(page.src);
    el.dataset.src = page.src;
    el.dataset.side = side;
    el.style.backgroundImage = 'url("' + (cached ? page.src : page.ph) + '")';
    if (cached) return;
    this.ensure(page)
      .then(function () {
        if (el.dataset.src !== page.src) return;
        el.style.backgroundImage = 'url("' + page.src + '")';
      })
      .catch(function (err) {
        self.onError(err);
      });
  };

  Flipbook.prototype.render = function () {
    var page = this.pages[this.index];
    this.paint(this.panelL, page, "left");
    this.paint(this.panelR, page, "right");
    this.onChange(this.index, page);
    this.trimCache();
    this.preloadAround();
  };

  // 翻过的页不再长留内存：只保留当前页前后各一页，其余从缓存里放掉。
  Flipbook.prototype.trimCache = function () {
    if (this.cache.size <= 8) return;
    var keep = [
      this.pages[this.index - 1],
      this.pages[this.index],
      this.pages[this.index + 1],
      this.pages[this.index + 2]
    ]
      .filter(Boolean)
      .map(function (p) { return p.src; });
    var drop = [];
    this.cache.forEach(function (_img, src) {
      if (keep.indexOf(src) === -1) drop.push(src);
    });
    while (this.cache.size > 6 && drop.length) this.cache.delete(drop.shift());
  };

  Flipbook.prototype.preloadAround = function () {
    var self = this;
    [this.index + 1, this.index + 2, this.index - 1].forEach(function (i) {
      if (i < 0 || i >= self.pages.length) return;
      self.ensure(self.pages[i]).catch(function () {});
    });
  };

  Flipbook.prototype.makeTurn = function (dir) {
    var to = this.index + dir;
    if (to < 0 || to >= this.pages.length) return null;
    var from = this.index;
    var fromPage = this.pages[from];
    var toPage = this.pages[to];
    var frontPage = dir > 0 ? fromPage : toPage; // 翻起那页的正面
    var backPage = dir > 0 ? toPage : fromPage;  // 翻起那页的背面
    var self = this;

    this.paint(this.panelL, dir > 0 ? fromPage : toPage, "left");
    this.paint(this.panelR, dir > 0 ? toPage : fromPage, "right");
    this.paint(this.front, frontPage, "right");
    this.paint(this.back, backPage, "left");

    this.leaf.hidden = false;
    this.leaf.style.transition = "none";
    this.leaf.style.transform = "rotateY(" + (dir > 0 ? 0 : -180) + "deg)";
    this.root.classList.add("is-turning");

    var state = { dir: dir, from: from, to: to, p: dir > 0 ? 0 : 1 };

    var apply = function (p) {
      p = clamp(p, 0, 1);
      state.p = p;
      var angle = dir > 0 ? -180 * p : -180 + 180 * p;
      var lift = Math.sin((Math.abs(angle) * Math.PI) / 180);
      // 沿页面的法线把叶子抬起来一点，翻动时才有「纸离开桌面」的感觉
      self.leaf.style.transform =
        "rotateY(" + angle.toFixed(2) + "deg) translateZ(" + (lift * 26).toFixed(2) + "px)";
      self.root.style.setProperty("--shade", lift.toFixed(3));
    };

    var settle = function (commit) {
      self.root.classList.remove("is-turning", "is-dragging");
      self.root.style.setProperty("--shade", 0);
      self.leaf.hidden = true;
      self.leaf.style.transition = "";
      if (commit) self.index = to;
      self.render();
      self.busy = false;
      self.turn = null;
    };

    return {
      state: state,
      apply: apply,
      commit: function () { settle(true); },
      cancel: function () { settle(false); }
    };
  };

  Flipbook.prototype.run = function (turn, from, to, duration, ease) {
    var self = this;
    var start = null;
    return new Promise(function (resolve) {
      if (self.reduceMotion || duration <= 0) {
        turn.apply(to);
        resolve();
        return;
      }
      var step = function (ts) {
        if (start === null) start = ts;
        var t = clamp((ts - start) / duration, 0, 1);
        turn.apply(from + (to - from) * ease(t));
        if (t < 1) {
          self.raf = requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      self.raf = requestAnimationFrame(step);
    });
  };

  Flipbook.prototype.turnPage = function (dir, opts) {
    var self = this;
    opts = opts || {};
    if (this.busy) return Promise.resolve(false);
    var turn = this.makeTurn(dir);
    if (!turn) {
      this.bump(dir);
      this.onEdge(dir);
      return Promise.resolve(false);
    }
    this.busy = true;
    this.turn = turn;
    var target = this.pages[turn.state.to];
    this.onLoading(true);
    return this.ensure(target)
      .catch(function (err) { self.onError(err); })
      .then(function () {
        self.onLoading(false);
        return self.run(turn, 0, 1, opts.duration || FLIP_MS, easeInOut);
      })
      .then(function () {
        turn.commit();
        return true;
      });
  };

  Flipbook.prototype.goTo = function (index, opts) {
    var self = this;
    opts = opts || {};
    index = clamp(index, 0, this.pages.length - 1);
    if (this.busy || index === this.index) return Promise.resolve(false);
    this.busy = true;
    this.onLoading(true);
    return this.ensure(this.pages[index])
      .catch(function (err) { self.onError(err); })
      .then(function () {
        self.onLoading(false);
        self.root.classList.add("is-jumping");
        return new Promise(function (resolve) {
          window.setTimeout(function () {
            self.index = index;
            self.render();
            self.root.classList.remove("is-jumping");
            self.busy = false;
            resolve(true);
          }, self.reduceMotion ? 0 : 180);
        });
      });
  };

  Flipbook.prototype.bump = function (dir) {
    var self = this;
    var cls = dir > 0 ? "is-bump-next" : "is-bump-prev";
    this.root.classList.add(cls);
    window.setTimeout(function () { self.root.classList.remove(cls); }, 460);
  };

  Flipbook.prototype.bindPointer = function () {
    var self = this;
    var drag = null;

    this.root.addEventListener("pointerdown", function (e) {
      if (self.busy || e.button > 0) return;
      var box = self.root.getBoundingClientRect();
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        lastX: e.clientX,
        lastT: performance.now(),
        moved: false,
        turn: null,
        half: e.clientX < box.left + box.width / 2 ? -1 : 1,
        vertical: false
      };
      self.root.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x0;
      var dy = e.clientY - drag.y0;

      if (!drag.turn) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.4) {
          drag.vertical = true;
          return;
        }
        var dir = dx < 0 ? 1 : -1;
        var turn = self.makeTurn(dir);
        if (!turn) {
          drag = null;
          return;
        }
        drag.turn = turn;
        drag.moved = true;
        self.busy = true;
        self.turn = turn;
        self.root.classList.add("is-dragging");
        // 拖到一半才需要正图；先让占位图顶着，加载好会自己换上。
        self.ensure(self.pages[turn.state.to]).catch(function (err) { self.onError(err); });
      }

      var width = self.root.getBoundingClientRect().width / 2;
      drag.lastX = e.clientX;
      drag.lastT = performance.now();
      drag.turn.apply(clamp(Math.abs(dx) / width, 0, 1));
    });

    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var d = drag;
      drag = null;

      if (d.turn) {
        var p = d.turn.state.p;
        var dt = Math.max(1, performance.now() - d.t0);
        var travel = Math.abs(e.clientX - d.x0);
        var speed = travel / dt; // px/ms
        // 拖过 26% 或者明显甩了一下就翻过去，否则退回去
        var forward = p > DRAG_COMMIT || (speed > 0.5 && travel > 22);
        self.run(d.turn, p, forward ? 1 : 0, forward ? 340 : 300, easeOut).then(function () {
          if (forward) d.turn.commit();
          else d.turn.cancel();
        });
        return;
      }

      if (!d.vertical && !d.moved && !self.busy) {
        var dt2 = performance.now() - d.t0;
        if (dt2 < 600) self.turnPage(d.half);
      }
    };

    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);
    this.root.addEventListener("dragstart", function (e) { e.preventDefault(); });
  };

  Flipbook.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
  };

  window.Flipbook = Flipbook;
})();
