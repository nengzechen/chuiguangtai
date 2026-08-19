/**
 * 穹顶几何。观星台和观星者页共用同一套坐标，
 * 否则同一个刻位在两页上会落在不同位置 —— 那就不是同一座穹顶了。
 *
 * 为什么是四道环而不是一张 8×11 的方格：你是站在圆顶**里面**往上看。
 * 从里面看，一圈一圈的纬线是弯的，越靠近顶心弯得越厉害、周长越短 ——
 * 所以最上面那道只放得下 12 个刻位，最下面那道放得下 30 个。
 * 12 + 20 + 26 + 30 = 88 不是凑出来的分组，是这个曲面自己的容量。
 */

export const WALL_W = 900;
export const WALL_H = 348;
const CX = 450;

/**
 * 从顶心往下四道肋环。
 * span 是这道环在画面上的跨度，sag 是它两端翘起来的高度 ——
 * 越靠近顶心的环越短、翘得越狠，这就是"从里面看圆顶"的全部。
 */
export const RINGS = [
  { n: 12, ring: "Ⅰ", y: 88,  span: 430, sag: 30 },
  { n: 20, ring: "Ⅱ", y: 156, span: 620, sag: 22 },
  { n: 26, ring: "Ⅲ", y: 226, span: 740, sag: 15 },
  { n: 30, ring: "Ⅳ", y: 296, span: 806, sag: 9 },
];

/** 一道环上参数 t（0–1）处的坐标。抛物线近似，两端翘起。 */
function onRing(r, t) {
  const x = CX - r.span / 2 + t * r.span;
  const k = 2 * t - 1;
  return { x, y: r.y + r.sag * k * k };
}

/** 天区按刻位号轮着分 —— 和元数据里的算法必须一致。 */
export const REGIONS = ["北天", "南天", "黄道"];
export const regionOf = (seat) => REGIONS[(seat - 1) % 3];

/**
 * 龛里那一小张星图。
 *
 * 刻位里装的是一个**星座**，所以它就该是星座本来的样子：
 * 几颗主星，连成一条折线。星数是这个刻位真实的主星数
 * （names.json 的 stars，与藏品图同源），5 颗的和 9 颗的一眼不同。
 *
 * 画在 20×24 的框里，1px 的线，缩到 17px 也还认得出是"连起来的几颗星"
 * 而不是一块色片。
 */
export function asterismGlyph(stars = 6, seed = 1) {
  // 自己的小随机，保证同一个刻位每次画出来一模一样
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const n = Math.max(2, Math.min(11, stars));
  const pts = [];
  /*
   * 星不是均匀撒的，也不是放射状的。
   * 按角度分格再在格里抖 —— 这样既不会两颗叠在一起，
   * 又不会排成一个规规矩矩的多边形。
   */
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.9;
    const rad = 3.4 + rnd() * 5.4;
    pts.push({
      x: +(10 + Math.cos(a) * rad).toFixed(2),
      y: +(12 + Math.sin(a) * rad * 0.92).toFixed(2),
      m: rnd(),                                   // 星等：大多数是暗的
    });
  }

  /*
   * 连线走**最近邻**：从最低的那颗起步，每次挑还没连过的里面最近的一颗。
   * 真实的星座连法就是这个逻辑 —— 人眼总是把挨得近的两颗连起来。
   * 随便连的话，线会横跨整幅图，缩小之后就是一团乱麻。
   */
  const left = pts.map((_, i) => i);
  let cur = left.splice(pts.reduce((b, p, i) => (p.y > pts[b].y ? i : b), 0), 1)[0];
  let d = `M${pts[cur].x} ${pts[cur].y}`;
  let dots = "";
  const order = [cur];
  while (left.length) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < left.length; k++) {
      const p = pts[left[k]], q = pts[cur];
      const dd = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    }
    cur = left.splice(best, 1)[0];
    order.push(cur);
    d += ` L${pts[cur].x} ${pts[cur].y}`;
  }
  for (const i of order) {
    const p = pts[i];
    dots += `<circle cx="${p.x}" cy="${p.y}" r="${(0.85 + p.m * 0.9).toFixed(2)}"/>`;
  }

  return { d, dots };
}

/** 直接给一段可以塞进 HTML 的 SVG。 */
export function asterismSvg(stars, seed) {
  const { d, dots } = asterismGlyph(stars, seed);
  return `<svg class="asterism" viewBox="0 0 20 24" aria-hidden="true">
    <path d="${d}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="mags">${dots}</g>
  </svg>`;
}

export function seatPositions() {
  const out = [];
  for (const r of RINGS) {
    for (let i = 0; i < r.n; i++) {
      const p = onRing(r, (i + 0.5) / r.n);
      /*
       * 龛是一个个凿出来的，不是钻床打出来的。
       * 起伏要有，但不能让相邻的龛咬在一起 —— 越挤的环摆幅越小。
       */
      const room = 12 / r.n;
      const wob = (Math.sin(i * 1.7 + r.n) * 3.4 + Math.sin(i * 0.61) * 1.8) * (0.5 + room);
      const drift = Math.sin(i * 2.3 + r.span) * 2.6;
      out.push({ x: +(p.x + drift).toFixed(2), y: +(p.y + wob).toFixed(2) });
    }
  }
  return out;
}

/**
 * 背景：圆顶内壁。
 *
 * 三样东西，一样都不能少，少一样它就退回成"一块深色底板"：
 *   1. **开缝** —— 左上角那道开着的天。整幅图里唯一的冷光源，
 *      也是这座台还在工作的证据。
 *   2. **子午肋** —— 从顶心放射下来的钢肋。是它让这块平面读成一个曲面。
 *   3. **四道肋环** —— 龛坐在上面的台面，越靠上弯得越厉害。
 */
export function domeChrome() {
  // 子午肋：从顶心（画外）扇下来。间距不等，正中那几道最密
  const meridians = [-0.92, -0.66, -0.42, -0.2, 0, 0.2, 0.42, 0.66, 0.92]
    .map((k) => {
      const xb = CX + k * 560;
      const xt = CX + k * 150;
      return `<path d="M${xt.toFixed(1)} -30 L${xb.toFixed(1)} ${WALL_H + 20}"
                    stroke="var(--rule)" stroke-width="${Math.abs(k) < 0.25 ? 1 : 1.4}"
                    fill="none" opacity="${(0.75 - Math.abs(k) * 0.35).toFixed(2)}"/>`;
    })
    .join("");

  const rings = RINGS.map((r) => {
    const a = onRing(r, 0), b = onRing(r, 0.5), c = onRing(r, 1);
    // 二次贝塞尔的控制点：让曲线真的过中点
    const cy = 2 * b.y - (a.y + c.y) / 2;
    const arc = `M${a.x.toFixed(1)} ${(a.y + 16).toFixed(1)} Q${CX} ${(cy + 16).toFixed(1)} ${c.x.toFixed(1)} ${(c.y + 16).toFixed(1)}`;
    return `
      <path d="${arc}" fill="none" stroke="var(--rule-strong)" stroke-width="1.2"/>
      <path d="${arc}" fill="none" stroke="var(--lime-low)" stroke-width="1.2" opacity="0.30"
            stroke-dasharray="${(r.span * 0.42).toFixed(0)} ${r.span}"/>
      <path d="${arc} L${c.x.toFixed(1)} ${(c.y + 30).toFixed(1)} Q${CX} ${(cy + 30).toFixed(1)} ${a.x.toFixed(1)} ${(a.y + 30).toFixed(1)} Z"
            fill="var(--cut-floor)" opacity="0.62"/>
      <text x="${(a.x - 12).toFixed(1)}" y="${(a.y + 20).toFixed(1)}" class="ringlab" text-anchor="end">${r.ring}</text>`;
  }).join("");

  return `
    <defs>
      <linearGradient id="domeshell" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0%" stop-color="var(--stone-face)"/>
        <stop offset="55%" stop-color="var(--stone)"/>
        <stop offset="100%" stop-color="var(--stone-deep)"/>
      </linearGradient>
      <!--
        龛的内壁。上暗下亮 —— 光从左上的开缝进来，上内壁背光、下内壁被照到。
        一块均匀的黑只会读成"墓碑"，不是凿进壁里的坑。
      -->
      <linearGradient id="nicheEmpty" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stop-color="oklch(0.078 0.010 268)"/>
        <stop offset="45%" stop-color="oklch(0.108 0.012 267)"/>
        <stop offset="100%" stop-color="oklch(0.198 0.020 264)"/>
      </linearGradient>
      <linearGradient id="niche0" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stop-color="oklch(0.105 0.018 246)"/>
        <stop offset="100%" stop-color="oklch(0.305 0.044 246)"/>
      </linearGradient>
      <linearGradient id="niche1" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stop-color="oklch(0.100 0.020 291)"/>
        <stop offset="100%" stop-color="oklch(0.285 0.048 291)"/>
      </linearGradient>
      <linearGradient id="niche2" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0%" stop-color="oklch(0.105 0.016 100)"/>
        <stop offset="100%" stop-color="oklch(0.305 0.038 100)"/>
      </linearGradient>
      <linearGradient id="slitsky" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="oklch(0.300 0.030 258)"/>
        <stop offset="100%" stop-color="oklch(0.150 0.018 262)"/>
      </linearGradient>
      <radialGradient id="slitspill" cx="0.13" cy="-0.05" r="0.9">
        <stop offset="0%" stop-color="oklch(0.86 0.030 240)" stop-opacity="0.16"/>
        <stop offset="52%" stop-color="oklch(0.80 0.030 240)" stop-opacity="0.045"/>
        <stop offset="100%" stop-color="oklch(0.80 0.030 240)" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <rect width="${WALL_W}" height="${WALL_H}" fill="url(#domeshell)"/>
    ${meridians}

    <!-- 开缝：圆顶开着的那一条。整幅图里唯一的冷光源 -->
    <g class="slit">
      <path d="M96 -6 L150 -6 L120 118 L98 118 Z" fill="url(#slitsky)"/>
      <path d="M96 -6 L98 118" stroke="var(--lime-low)" stroke-width="1.4" opacity="0.5" fill="none"/>
      <path d="M150 -6 L120 118" stroke="var(--lime-low)" stroke-width="1.4" opacity="0.28" fill="none"/>
      <circle cx="116" cy="26" r="1.3" fill="oklch(0.95 0.01 250)" opacity="0.9"/>
      <circle cx="131" cy="58" r="0.9" fill="oklch(0.95 0.01 250)" opacity="0.65"/>
      <circle cx="109" cy="88" r="1.1" fill="oklch(0.95 0.01 250)" opacity="0.5"/>
    </g>
    <rect width="${WALL_W}" height="${WALL_H}" fill="url(#slitspill)"/>

    ${rings}`;
}

/* 旧名字：还有页面按老名字引用，保留别名，避免同一座穹顶有两套坐标 */
export const wallChrome = domeChrome;
export const colonyGlyph = asterismGlyph;
export const colonySvg = asterismSvg;
export const LEDGES = RINGS;
export const DOME_RINGS = RINGS;
