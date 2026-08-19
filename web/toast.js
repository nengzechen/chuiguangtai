/**
 * 轻提示。之前所有反馈都埋在页面底部的控制台里 ——
 * 用户点了按钮，眼睛还在按钮上，反馈却出现在两屏之外。
 */
let timer;

export function toast(msg, kind = "") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }

  el.textContent = msg;
  el.className = "toast " + kind;
  el.hidden = false;
  // 强制重排，让连续两次 toast 也能重新播放入场动画
  void el.offsetWidth;
  el.classList.add("show");

  clearTimeout(timer);
  timer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 300);
  }, 2600);
}
