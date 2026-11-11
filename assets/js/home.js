// home.js — 首页只做两件事：点书进入阅读器前的过渡，以及返回时复位状态。
(function () {
  const body = document.body;

  document.querySelectorAll(".book").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      event.preventDefault();
      const href = link.getAttribute("href");
      body.classList.add("is-leaving");
      window.setTimeout(() => {
        window.location.href = href;
      }, 300);
    });
  });

  // 从阅读器按「后退」回来时，浏览器可能直接复用上一帧的淡出状态。
  window.addEventListener("pageshow", () => {
    body.classList.remove("is-leaving");
  });
})();
