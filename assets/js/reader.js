// reader.js — 阅览室编排层
// 负责：选册/取页（URL 参数）、顶栏与进度、缩略图、键盘与全屏、自动翻阅、错误提示。
// 翻页本身交给 flipbook.js，这里不碰角度与 transform。
(function () {
  "use strict";

  var DATA = window.BOOK_DATA;
  if (!DATA || !DATA.books || !DATA.books.length) {
    document.body.innerHTML =
      '<p style="padding:48px;color:#d8ccb6">书目清单缺失：assets/js/books-data.js 没能加载。</p>';
    throw new Error("BOOK_DATA 未就绪");
  }

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  var params = new URLSearchParams(window.location.search);
  var book = DATA.books.filter(function (b) { return b.slug === params.get("book"); })[0] || DATA.books[0];
  var startIndex = clamp((parseInt(params.get("p"), 10) || 1) - 1, 0, book.pages.length - 1);

  var el = {
    book: document.getElementById("book"),
    rig: document.getElementById("rig"),
    panelL: document.getElementById("panelL"),
    panelR: document.getElementById("panelR"),
    leaf: document.getElementById("leaf"),
    leafFront: document.getElementById("leafFront"),
    leafBack: document.getElementById("leafBack"),
    pageNow: document.getElementById("pageNow"),
    pageTotal: document.getElementById("pageTotal"),
    bookNo: document.getElementById("bookNo"),
    bookName: document.getElementById("bookName"),
    bookEn: document.getElementById("bookEn"),
    bar: document.getElementById("bar"),
    barFill: document.getElementById("barFill"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnAuto: document.getElementById("btnAuto"),
    btnStrip: document.getElementById("btnStrip"),
    btnFull: document.getElementById("btnFull"),
    btnStripClose: document.getElementById("btnStripClose"),
    strip: document.getElementById("strip"),
    stripScroll: document.getElementById("stripScroll"),
    stripCount: document.getElementById("stripCount"),
    toast: document.getElementById("toast"),
    veil: document.getElementById("veil"),
    veilNo: document.getElementById("veilNo"),
    veilTitle: document.getElementById("veilTitle"),
    loadnote: document.getElementById("loadnote")
  };

  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  // --- 顶栏与幕布文案 ---------------------------------------------------
  document.title = "翻阅 · " + book.title;
  el.bookNo.textContent = book.no;
  el.bookName.textContent = book.title;
  el.bookEn.textContent = book.en;
  el.veilNo.textContent = book.no;
  el.veilTitle.textContent = book.title;
  el.pageTotal.textContent = book.pages.length;
  el.stripCount.textContent = book.pages.length;
  el.bar.setAttribute("aria-valuemax", String(book.pages.length));

  // --- 提示条 -----------------------------------------------------------
  var toastTimer = 0;
  function toast(msg, ms) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = msg;
    el.toast.hidden = false;
    toastTimer = window.setTimeout(function () { el.toast.hidden = true; }, ms || 2400);
  }

  // --- 翻页引擎 ---------------------------------------------------------
  var thumbEls = [];

  var fb = new window.Flipbook({
    root: el.book,
    panelL: el.panelL,
    panelR: el.panelR,
    leaf: el.leaf,
    front: el.leafFront,
    back: el.leafBack,
    pages: book.pages,
    index: startIndex,
    onChange: onChange,
    onEdge: function (dir) {
      toast(dir > 0 ? "已是最后一页" : "已是第一页", 1500);
    },
    onError: function (err) {
      toast(err.message + "（可刷新重试）", 4200);
    },
    onLoading: function (on) {
      el.loadnote.hidden = !on;
    }
  });

  function onChange(index, page) {
    var n = index + 1;
    var total = book.pages.length;
    el.pageNow.textContent = pad(n);
    el.barFill.style.transform = "scaleX(" + (n / total).toFixed(4) + ")";
    el.bar.setAttribute("aria-valuenow", String(n));
    el.btnPrev.disabled = index === 0;
    el.btnNext.disabled = index === total - 1;
    syncThumbs(index);
    var url = "?book=" + encodeURIComponent(book.slug) + "&p=" + n;
    window.history.replaceState(null, "", url);
  }

  // --- 缩略图 -----------------------------------------------------------
  function buildStrip() {
    if (thumbEls.length) return;
    var frag = document.createDocumentFragment();
    book.pages.forEach(function (page, i) {
      var b = document.createElement("button");
      b.className = "thumb";
      b.type = "button";
      b.setAttribute("aria-label", "第 " + (i + 1) + " 个跨页");
      b.dataset.index = String(i);
      b.addEventListener("click", function () {
        fb.goTo(i);
      });
      thumbEls.push(b);
      frag.appendChild(b);
    });
    el.stripScroll.appendChild(frag);
  }

  function loadThumbs() {
    buildStrip();
    book.pages.forEach(function (page, i) {
      var b = thumbEls[i];
      if (b.style.backgroundImage) return;
      b.style.backgroundImage = 'url("' + page.thumb + '")';
    });
  }

  function syncThumbs(index) {
    if (!thumbEls.length) return;
    thumbEls.forEach(function (b, i) {
      if (i === index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    if (!el.strip.hidden) {
      var cur = thumbEls[index];
      if (cur) cur.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }

  function setStrip(open) {
    el.strip.hidden = !open;
    document.body.classList.toggle("strip-open", open);
    el.btnStrip.setAttribute("aria-pressed", String(open));
    if (open) {
      loadThumbs();
      syncThumbs(fb.index);
    }
  }

  el.btnStrip.addEventListener("click", function () { setStrip(el.strip.hidden); });
  el.btnStripClose.addEventListener("click", function () { setStrip(false); });

  // --- 按钮 -------------------------------------------------------------
  el.btnPrev.addEventListener("click", function () { fb.turnPage(-1); });
  el.btnNext.addEventListener("click", function () { fb.turnPage(1); });

  var autoTimer = 0;
  function stopAuto() {
    window.clearInterval(autoTimer);
    autoTimer = 0;
    el.btnAuto.setAttribute("aria-pressed", "false");
    el.btnAuto.textContent = "自动翻阅";
  }
  function startAuto() {
    el.btnAuto.setAttribute("aria-pressed", "true");
    el.btnAuto.textContent = "停止";
    autoTimer = window.setInterval(function () {
      if (fb.busy) return;
      if (fb.index >= book.pages.length - 1) {
        stopAuto();
        toast("已经翻到最后一页", 1600);
        return;
      }
      fb.turnPage(1, { duration: 900 });
    }, 3600);
  }
  el.btnAuto.addEventListener("click", function () {
    if (autoTimer) stopAuto();
    else startAuto();
  });

  function setFull(on) {
    if (on) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  }
  el.btnFull.addEventListener("click", function () {
    setFull(!document.fullscreenElement);
  });
  document.addEventListener("fullscreenchange", function () {
    el.btnFull.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
    el.btnFull.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });

  // --- 进度条 -----------------------------------------------------------
  el.bar.addEventListener("click", function (e) {
    var box = el.bar.getBoundingClientRect();
    var ratio = clamp((e.clientX - box.left) / box.width, 0, 1);
    fb.goTo(Math.round(ratio * (book.pages.length - 1)));
  });

  el.bar.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      fb.turnPage(e.key === "ArrowRight" ? 1 : -1);
    }
  });

  // --- 键盘 -------------------------------------------------------------
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var key = e.key;
    if (key === "ArrowRight" || key === "PageDown" || key === " ") {
      e.preventDefault();
      if (autoTimer) stopAuto();
      fb.turnPage(1);
    } else if (key === "ArrowLeft" || key === "PageUp") {
      e.preventDefault();
      if (autoTimer) stopAuto();
      fb.turnPage(-1);
    } else if (key === "Home") {
      e.preventDefault();
      fb.goTo(0);
    } else if (key === "End") {
      e.preventDefault();
      fb.goTo(book.pages.length - 1);
    } else if (key === "Escape") {
      if (!el.strip.hidden) setStrip(false);
    } else if (key === "t" || key === "T") {
      setStrip(el.strip.hidden);
    } else if (key === "f" || key === "F") {
      setFull(!document.fullscreenElement);
    }
  });

  // --- 幕布：等第一页就绪再揭开 -----------------------------------------
  var veilShownAt = performance.now();
  fb.ensure(book.pages[fb.index])
    .catch(function () {})
    .then(function () {
      var wait = Math.max(0, 420 - (performance.now() - veilShownAt));
      window.setTimeout(function () { el.veil.classList.add("is-gone"); }, wait);
    });
})();
