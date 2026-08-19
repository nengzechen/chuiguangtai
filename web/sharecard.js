/**
 * 分享卡：把一个刻位合成成 1200×630 的图，下载即可发出去。
 *
 * 为什么是 1200×630 —— 主流社交平台的 OG 图比例。
 * 为什么要带题刻 —— 会被转发的从来不是"我 mint 了一个 NFT"，
 * 是"有人在第 02 刻上写了：献给还没出生的人"。
 */

const W = 1200;
const H = 630;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/** 按字符宽度粗略折行 —— 中文按 1，西文按 0.55。 */
function wrap(text, maxUnits) {
  const lines = [];
  let line = "";
  let units = 0;
  for (const ch of text) {
    const u = /[一-龥　-〿＀-￯]/.test(ch) ? 1 : 0.55;
    if (units + u > maxUnits) {
      lines.push(line);
      line = ch;
      units = u;
    } else {
      line += ch;
      units += u;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {object} o
 * @param {string} o.artSvg   藏品本身的 SVG 源码
 * @param {string} o.name     标题
 * @param {string} o.sub      副标题
 * @param {string} o.words    题刻，可为空
 * @param {string} o.keeper   持有者短地址
 * @param {string} o.badge    右上角角标（如 "第 02 刻 / 88"）
 */
export function buildCardSvg(o) {
  /*
   * 这张卡会离开本站 —— 发到聊天窗、时间线、任何地方。
   * 所以它不能引用站内的字体，颜色也全部写死：它到不了 tokens.css。
   * 用的是抬头那个世界的那几个色（DESIGN.md），一个不多。
   */
  const ink = "#F3F6FA";        // 星光
  const dim = "#93A3B3";        // 退到背景里的说明
  const thermo = "#F76E50";     // 安全灯红：唯一的饱和色
  const inkDeep = "#05060C";    // 天顶
  const line = "#F3F6FA";       // 线，靠 opacity 压

  // 把藏品 SVG 内嵌进来：剥掉外层 <svg> 的宽高，用 <g transform> 缩放摆放
  const inner = o.artSvg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

  const words = o.words ? wrap(o.words, 21) : [];
  const wordsBlock = words.length
    ? `<text x="640" y="${words.length > 2 ? 330 : 348}" fill="${ink}"
             font-family="-apple-system,PingFang SC,Hiragino Sans GB,sans-serif"
             font-size="34" font-weight="600">
         ${words
           .map(
             (l, i) =>
               `<tspan x="640" dy="${i === 0 ? 0 : 52}">${esc(
                 i === 0 ? "\u300c" + l : l
               )}${i === words.length - 1 ? "\u300d" : ""}</tspan>`
           )
           .join("")}
       </text>`
    : `<text x="640" y="342" fill="${dim}"
             font-family="ui-monospace,Menlo,monospace" font-size="24">\u5c1a\u672a\u9898\u523b</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- \u5929\uff1a\u5de6\u4e0a\u662f\u5f00\u7f1d\u7684\u5149\uff0c\u53f3\u4e0b\u6c89\u8fdb\u58a8\u91cc\u3002\u548c\u7ad9\u70b9\u4e0a\u662f\u540c\u4e00\u675f\u5149 -->
    <linearGradient id="cardbg" x1="0" y1="0" x2="0.75" y2="1">
      <stop offset="0%" stop-color="#131A2A"/>
      <stop offset="58%" stop-color="#0A1018"/>
      <stop offset="100%" stop-color="${inkDeep}"/>
    </linearGradient>
    <radialGradient id="cardlamp" gradientUnits="userSpaceOnUse" cx="150" cy="60" r="820">
      <stop offset="0%" stop-color="#D6E4F5" stop-opacity="0.12"/>
      <stop offset="40%" stop-color="#D6E4F5" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#D6E4F5" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="artclip"><rect x="60" y="95" width="440" height="440" rx="3"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#cardbg)"/>
  <rect width="${W}" height="${H}" fill="url(#cardlamp)"/>

  <g clip-path="url(#artclip)">
    <g transform="translate(60 95) scale(0.88)">${inner}</g>
  </g>
  <rect x="60" y="95" width="440" height="440" rx="3" fill="none"
        stroke="${line}" stroke-width="1" opacity="0.26"/>

  <g transform="translate(60 40)">
    <g fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="1" y="1" width="28" height="28" rx="6"/>
      <path d="M15 8v13M10.5 17l4.5 4.5 4.5-4.5"/>
    </g>
    <text x="44" y="14" fill="${ink}"
          font-family="-apple-system,PingFang SC,Hiragino Sans GB,sans-serif"
          font-size="19" font-weight="700" letter-spacing="2">\u5782\u5149\u53f0</text>
    <text x="44" y="30" fill="${dim}"
          font-family="ui-monospace,Menlo,monospace" font-size="9" letter-spacing="3">THE LAST OBSERVATORY</text>
  </g>

  <text x="1140" y="58" fill="${dim}" text-anchor="end"
        font-family="ui-monospace,Menlo,monospace" font-size="15" letter-spacing="2">${esc(o.badge)}</text>

  <text x="640" y="185" fill="${ink}"
        font-family="-apple-system,PingFang SC,Hiragino Sans GB,sans-serif"
        font-size="52" font-weight="700" letter-spacing="1">${esc(o.name)}</text>
  <text x="640" y="224" fill="${dim}"
        font-family="ui-monospace,Menlo,monospace" font-size="17" letter-spacing="1.5">${esc(o.sub)}</text>

  <path d="M640 262 H1140" stroke="${line}" stroke-width="1" opacity="0.18"/>

  ${wordsBlock}

  <path d="M640 470 H1140" stroke="${line}" stroke-width="1" opacity="0.12"/>
  <text x="640" y="506" fill="${dim}"
        font-family="ui-monospace,Menlo,monospace" font-size="16">${esc(o.keeper)}</text>
  <text x="1140" y="506" fill="${dim}" text-anchor="end"
        font-family="ui-monospace,Menlo,monospace" font-size="14" letter-spacing="1">\u661f\u5c51 2048 \u00b7 \u661f\u5ea7 88</text>

  <!-- \u5e95\u8fb9\u90a3\u4e00\u6761\u9752\uff1a\u6574\u5f20\u5361\u4e0a\u552f\u4e00\u7684\u9971\u548c\u8272 -->
  <rect x="0" y="${H - 3}" width="${W}" height="3" fill="${thermo}" opacity="0.8"/>
</svg>`;
}

/** SVG → PNG。用 canvas 光栅化，避免依赖任何外部库。 */
export async function svgToPng(svg, scale = 1) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });

    const cv = document.createElement("canvas");
    cv.width = W * scale;
    cv.height = H * scale;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0, cv.width, cv.height);

    return await new Promise((res) => cv.toBlob(res, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
