/**
 * 垂光台 · 程序化生成两层藏品的图与元数据
 *
 *   node scripts/gen-metadata.js
 *
 * 星屑 (Ember)         token 1..2048      免费拾取
 * 星座 (Constellation) token 10001..10088 付费铭刻
 *
 * 设计原则：稀有度必须**画得出来**，不能只写在 trait 里。
 * 七档星屑的画面结构逐级加码 —— 从一团孤零零的余烬，到把光吃掉的黑洞视界，
 * 缩略图大小就能一眼分出档次。
 *
 * 同一个 tokenId 永远生成同一张图（种子确定），重跑不会改变已 mint 的藏品。
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "web", "metadata");
const IMG = path.join(OUT, "images");

const EMBER_SUPPLY = 2048;
const CONSTELLATION_SUPPLY = 88;
const CONSTELLATION_OFFSET = 10000;

// ---------------------------------------------------------------- 确定性随机

function rng(seed) {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const round = (n) => Math.round(n * 100) / 100;

function weighted(rand, table) {
  const total = table.reduce((n, t) => n + t.w, 0);
  let r = rand() * total;
  for (const t of table) if ((r -= t.w) < 0) return t;
  return table[table.length - 1];
}

const pol = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))];
};

// ------------------------------------------------------------------ 画法
//
// ══ 这一代的藏品图：无字 ══
//
// 上一代每张图下面压着一条题记 —— 中文名、拉丁名、稀有度、编号、印。
// 那是**标本卡**的做法，不是藏品的做法：真正的生成艺术藏品（Fidenza、Ringers、
// Autoglyphs、Punks）图里一个字都没有。名字和属性属于 metadata，
// 交易平台会自己渲染成卡片 —— 把它们烧进图里，等于在画布上贴标签。
//
// 所以这一代：
//   · 画面**满幅**，没有留白边、没有题记条、没有印章框
//   · 图里**一个字都没有**，因此也不再引用任何字体 ——
//     "藏品 SVG 不得引用本站字体"这条约束现在是自动满足的
//   · 主体占住 65–85% 的画幅，缩略图大小就能认出是什么
//
// ══ 三个正交的特征各管一件事 ══
//
//   恒星遗迹 kind  → **形**。七种天体七种轮廓，缩略图就能分出来
//   光谱型 spectrum → **色**。真实的恒星色温序列 O→M：蓝紫到红
//   余温 heat      → **强度**。尺寸、辉光半径、细节密度
//
// 7 形 × 7 色 × 100 温 —— 这才是一套能在网格里逐个认出来的收藏品。
// 上一代全部是灰的，2048 张在网格里长得一模一样。
//
// ⚠️ 这里可以发光，而且**应该**发光。
// 站点的背景规矩是"正文背后什么都没有"（见 DESIGN.md · The Empty-Backdrop Rule）——
// 那条管的是**正文背后**。藏品图是内容本身，不是谁的背景，
// 它的工作就是被看见。两者不矛盾，别把页面的克制搬到画布上来。

/* 光谱色。真实的恒星颜色由表面温度决定，从 O 型的蓝紫到 M 型的红。
   这是天文事实，不是配色偏好 —— 也正因为如此，它作为特征才立得住。 */
const SPECTRUM_PALETTE = {
  O: { hot: "#E6ECFF", mid: "#7C8CFF", deep: "#2A2270", sky: "#0A0A1E" },
  B: { hot: "#E8F1FF", mid: "#7FAEFF", deep: "#1D3480", sky: "#080D22" },
  A: { hot: "#FFFFFF", mid: "#BBD2F5", deep: "#2C3F6E", sky: "#080C18" },
  F: { hot: "#FFFAEC", mid: "#EEDCA8", deep: "#5A4A26", sky: "#0E0E14" },
  G: { hot: "#FFF3D0", mid: "#FFC95C", deep: "#6B4712", sky: "#120E0C" },
  K: { hot: "#FFE3BC", mid: "#FF9A3D", deep: "#6B300E", sky: "#140C08" },
  M: { hot: "#FFD0B8", mid: "#FF6242", deep: "#5C1A0E", sky: "#160806" },
};

const SPECTRA = ["O", "B", "A", "F", "G", "K", "M"];

/* 稀有档次唯一被允许影响颜色的地方：越稀有，天越黑、主体越亮。
   这样在网格里，高档次那几张是**对比度**更高，而不是"颜色更花"。 */
const contrastOf = (tier) => 0.55 + tier * 0.075;

/** 一圈毛边闭合路径。天体没有正圆 —— 正圆一出现就变成图标了。 */
function ragged(cx, cy, base, n, rough, rand) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const r = base * (1 - rough / 2 + rand() * rough);
    pts.push(pol(cx, cy, r, a));
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p = pts[(i + 1) % n];
    const q = pts[i];
    d += ` Q${round((q[0] + p[0]) / 2 + (rand() - 0.5) * base * 0.09)} ` +
         `${round((q[1] + p[1]) / 2 + (rand() - 0.5) * base * 0.09)} ${p[0]} ${p[1]}`;
  }
  return d + "Z";
}

/** 四芒星芒。只给真正亮的东西 —— 它是"亮到把镜头也照花了"的意思。 */
function spikes(cx, cy, len, w, color, o) {
  return `<path d="M${cx - len} ${cy} L${cx} ${round(cy - w)} L${cx + len} ${cy} L${cx} ${round(cy + w)}Z"
      fill="${color}" opacity="${o}"/>
    <path d="M${cx} ${cy - len} L${round(cx + w)} ${cy} L${cx} ${cy + len} L${round(cx - w)} ${cy}Z"
      fill="${color}" opacity="${o}"/>`;
}

/**
 * 背景星野。
 * 这是**图**，不是页面背景 —— 所以它可以有星，而且需要有：
 * 没有星野的天体图是一张剪贴画，主体浮在色块上，没有尺度感。
 */
function starfield(rand, count, pal) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = round(rand() * 500);
    const y = round(rand() * 500);
    const m = Math.pow(rand(), 2.4);
    const r = round(0.4 + m * 1.9);
    const c = rand() < 0.22 ? pal.mid : "#FFFFFF";
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${round(0.18 + m * 0.62)}"/>`;
    if (m > 0.86) out += spikes(x, y, round(r * 5.5), round(r * 0.5), "#FFFFFF", 0.4);
  }
  return out;
}

/** 主体的辉光。三层同心，越外越淡 —— 一层的辉光看起来是贴上去的光斑。 */
function halo(id, pal) {
  return `<radialGradient id="glow${id}">
      <stop offset="0%" stop-color="${pal.hot}" stop-opacity="0.55"/>
      <stop offset="28%" stop-color="${pal.mid}" stop-opacity="0.26"/>
      <stop offset="62%" stop-color="${pal.deep}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${pal.deep}" stop-opacity="0"/>
    </radialGradient>`;
}

/* ── 七种形 ───────────────────────────────────────────────────────
   每一种都是这个天体**真实的样子**，不是七个抽象图案。
   稀有度从常见到唯一级，画面结构逐级加码，缩略图就能分出档次。 */

function formGiant(rand, pal, id, R) {
  /* 红巨星：一颗胀到吞掉自己行星的老年恒星。
     它几乎占满画幅 —— 这一档最常见，但它是全场**最大**的东西。
     临边昏暗（limb darkening）是它唯一必须画对的物理：
     恒星的边缘比中心暗，因为你在那里看到的是更外、更冷的一层大气。 */
  let out = `<circle cx="250" cy="250" r="${R}" fill="url(#body${id})"/>`;
  /*
   * 米粒组织：对流把热物质顶上来。
   * ⚠️ 只画**亮**的胞，绝不画暗斑 —— 深色的圆点压在一个球上，
   * 眼睛立刻读成**陨石坑**，整颗星就变成一颗卫星了（第一版就是这么翻车的）。
   * 而且胞要拉长、贴着切向排：对流是流动，不是麻点。
   */
  for (let i = 0; i < 26; i++) {
    const a = rand() * 360;
    const d = R * (0.1 + Math.sqrt(rand()) * 0.78);
    const [x, y] = pol(250, 250, d, a);
    const w = round(R * (0.09 + rand() * 0.15));
    out += `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${round(w * (0.4 + rand() * 0.3))}"
      transform="rotate(${round(a)} ${x} ${y})"
      fill="${pal.hot}" opacity="${round(0.04 + rand() * 0.08)}"/>`;
  }
  /* 色球层：边缘那一圈更亮的薄气层。它让球看起来是**发光**的，不是被照亮的 */
  out += `<circle cx="250" cy="250" r="${round(R * 0.99)}" fill="none"
    stroke="${pal.hot}" stroke-width="${round(R * 0.05)}" opacity="0.30"/>`;
  out += `<circle cx="250" cy="250" r="${round(R * 1.02)}" fill="none"
    stroke="${pal.hot}" stroke-width="1.4" opacity="0.55"/>`;
  /* 日珥：从边缘甩出去的物质拱环。要够大够亮才看得出是从星上抛出来的 */
  for (let i = 0, n = 3 + Math.floor(rand() * 3); i < n; i++) {
    const a = rand() * 360;
    const [x1, y1] = pol(250, 250, R * 0.98, a);
    const [x2, y2] = pol(250, 250, R * 0.98, a + 20 + rand() * 26);
    const [cx, cy] = pol(250, 250, R * (1.3 + rand() * 0.34), a + 12);
    out += `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="${pal.hot}"
      opacity="${round(0.10 + rand() * 0.12)}"/>`;
    out += `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none"
      stroke="${pal.hot}" stroke-width="${round(1.6 + rand() * 2.4)}"
      stroke-linecap="round" opacity="${round(0.45 + rand() * 0.4)}"/>`;
  }
  return out;
}

function formNebula(rand, pal, id, R) {
  /* 行星状星云：红巨星抛掉的那层壳，向外飘了几万年。
     所以它是**空心**的 —— 两三层同心的壳，中间那颗白矮星是它的遗孤。 */
  let out = "";
  const tilt = round(rand() * 180);
  for (let i = 0, n = 2 + Math.floor(rand() * 2); i < n; i++) {
    const r = R * (1 - i * 0.28);
    const sq = 0.52 + rand() * 0.4;
    out += `<ellipse cx="250" cy="250" rx="${round(r)}" ry="${round(r * sq)}"
      transform="rotate(${tilt} 250 250)" fill="none"
      stroke="${i === 0 ? pal.mid : pal.hot}"
      stroke-width="${round(R * (0.16 - i * 0.04))}"
      opacity="${round(0.30 - i * 0.06)}"/>`;
    out += `<ellipse cx="250" cy="250" rx="${round(r)}" ry="${round(r * sq)}"
      transform="rotate(${tilt} 250 250)" fill="none"
      stroke="${pal.hot}" stroke-width="1.4" opacity="${round(0.5 - i * 0.12)}"/>`;
  }
  /* 双极喷流：壳不是均匀吹出去的，两极总是跑得更快 */
  for (const s of [0, 180]) {
    const [x, y] = pol(250, 250, R * 1.34, tilt + 90 + s);
    out += `<path d="M250 250 L${x} ${y}" stroke="${pal.hot}" stroke-width="2"
      opacity="0.16" stroke-linecap="round"/>`;
  }
  out += `<circle cx="250" cy="250" r="${round(R * 0.06)}" fill="#FFFFFF" opacity="0.95"/>`;
  out += spikes(250, 250, round(R * 0.5), round(R * 0.02), "#FFFFFF", 0.5);
  return out;
}

function formDwarf(rand, pal, id, R) {
  /* 白矮星：壳掉光之后剩下的核，一茶匙重达数吨。
     它**很小**，而这正是要画的东西 —— 满幅的黑里一个极亮的点，
     对比度就是这一档的全部内容。 */
  const r = R * 0.24;
  let out = "";
  for (let i = 3; i >= 1; i--) {
    out += `<circle cx="250" cy="250" r="${round(r * (1 + i * 0.9))}" fill="none"
      stroke="${pal.mid}" stroke-width="${round(0.6 + i * 0.3)}" opacity="${round(0.12 / i)}"/>`;
  }
  out += `<circle cx="250" cy="250" r="${round(r)}" fill="url(#body${id})"/>`;
  out += spikes(250, 250, round(R * 1.55), round(r * 0.34), pal.hot, 0.5);
  out += spikes(250, 250, round(R * 0.8), round(r * 0.5), "#FFFFFF", 0.75);
  return out;
}

function formNeutron(rand, pal, id, R) {
  /* 中子星：整颗恒星被压成一座城市大小，每秒自转数百圈。
     它的标志不是核，是**两道扫出去的束** —— 磁极不对着自转轴，
     所以那两道光像灯塔一样扫过宇宙。 */
  const r = R * 0.13;
  const tilt = round(rand() * 360);
  let out = "";
  for (const s of [0, 180]) {
    const a = tilt + s;
    const [tx, ty] = pol(250, 250, R * 2.6, a);
    const [l1, l2] = pol(250, 250, R * 2.6, a - 6);
    const [r1, r2] = pol(250, 250, R * 2.6, a + 6);
    /*
     * ⚠️ 这里必须用**径向**渐变，而且 gradientUnits="userSpaceOnUse"。
     * 第一版用的是 linearGradient x1=0→x2=1：那是按对象包围盒算的，
     * 一个斜三角形的包围盒和光束方向对不上，于是整道束**不衰减**，
     * 画出来是一根插穿星体的实心棒。
     * 以星为心的径向渐变对两道束同时成立，跟角度无关。
     */
    out += `<path d="M250 250 L${l1} ${l2} L${tx} ${ty} L${r1} ${r2}Z"
      fill="url(#beam${id})"/>`;
    out += `<path d="M250 250 L${tx} ${ty}" stroke="${pal.hot}" stroke-width="1.6"
      opacity="0.3" stroke-linecap="round"/>`;
  }
  /* 吸积盘：侧对着我们，所以是一道扁到几乎成线的椭圆 */
  out += `<ellipse cx="250" cy="250" rx="${round(R * 1.15)}" ry="${round(R * 0.16)}"
    transform="rotate(${round(tilt + 90)} 250 250)" fill="none"
    stroke="${pal.mid}" stroke-width="${round(R * 0.1)}" opacity="0.3"/>`;
  out += `<circle cx="250" cy="250" r="${round(r)}" fill="url(#body${id})"/>`;
  out += spikes(250, 250, round(R * 0.66), round(r * 0.4), "#FFFFFF", 0.7);
  return out;
}

function formMagnetar(rand, pal, id, R) {
  /* 磁星：磁场最强的那种中子星。它抖一下，几万光年外的仪器都要偏针。
     所以画的是**磁场本身** —— 一组从北极出发、绕回南极的偶极场线。 */
  const r = R * 0.11;
  const tilt = round(rand() * 360);
  /*
   * ⚠️ 场线必须是**主角**。
   * 第一版把它画得又细又淡又小，结果整张图看起来只是"又一颗白矮星，
   * 旁边有几道看不清的划痕" —— 磁星和中子星的区别就没了。
   * 所以这一版：线更粗、更亮、张得更开，星芒反过来收短，
   * 让眼睛先看见场，再看见星。
   */
  let out = `<g transform="rotate(${tilt} 250 250)">`;
  for (let i = 1; i <= 7; i++) {
    const w = R * (0.34 + i * 0.42);
    const h = R * (0.5 + i * 0.34);
    for (const sg of [1, -1]) {
      out += `<path d="M250 ${round(250 - r)} C${round(250 + w * sg)} ${round(250 - h)}
        ${round(250 + w * sg)} ${round(250 + h)} 250 ${round(250 + r)}"
        fill="none" stroke="${pal.hot}" stroke-width="${round(2.6 - i * 0.22)}"
        stroke-linecap="round" opacity="${round(0.68 - i * 0.07)}"/>`;
    }
  }
  out += `</g>`;
  /* 星震：磁场重联时炸出去的一道弧。它是这一档唯一"正在发生"的东西 */
  const fa = rand() * 360;
  const [fx, fy] = pol(250, 250, R * 1.8, fa);
  const [mx, my] = pol(250, 250, R * 1.1, fa + 32);
  out += `<path d="M250 250 Q${mx} ${my} ${fx} ${fy}"
    fill="none" stroke="#FFFFFF" stroke-width="2.6" opacity="0.6" stroke-linecap="round"/>`;
  out += `<circle cx="250" cy="250" r="${round(r)}" fill="url(#body${id})"/>`;
  out += spikes(250, 250, round(R * 0.42), round(r * 0.5), "#FFFFFF", 0.85);
  return out;
}

function formRemnant(rand, pal, id, R) {
  /* 超新星残骸：爆炸后向外抛散的壳层。你身体里的铁都来自某一次这样的爆炸。
     它**不对称**、边缘是撕开的 —— 一个规规矩矩的圆环是气泡，不是爆炸。 */
  let out = "";
  const ox = round(250 + (rand() - 0.5) * 30);
  const oy = round(250 + (rand() - 0.5) * 30);
  /*
   * ⚠️ 不要画闭合的硬轮廓。
   * 第一版用一圈 ragged() 描边当壳层，画出来是**饼干模子切出来的星形**——
   * 规整的锯齿一眼就是几何图形，不是爆炸。
   * 真实的残骸是**一堆丝**：激波把星际介质拉成细丝，边界是丝的疏密变出来的，
   * 不是一条线。所以壳只留极淡的一层雾，结构全部交给丝。
   */
  out += `<path d="${ragged(ox, oy, R * 0.96, 30, 0.26, rand)}" fill="none"
    stroke="${pal.mid}" stroke-width="${round(R * 0.2)}" opacity="0.13"/>`;
  /* 断续的弧：壳只在几处被照亮，不连成一圈 */
  for (let i = 0, n = 3 + Math.floor(rand() * 3); i < n; i++) {
    const a0 = rand() * 360, sw = 30 + rand() * 50;
    const rr = R * (0.88 + rand() * 0.16);
    const [x1, y1] = pol(ox, oy, rr, a0);
    const [x2, y2] = pol(ox, oy, rr, a0 + sw);
    out += `<path d="M${x1} ${y1} A${round(rr)} ${round(rr)} 0 0 1 ${x2} ${y2}"
      fill="none" stroke="${pal.hot}" stroke-width="${round(1.4 + rand() * 2)}"
      stroke-linecap="round" opacity="${round(0.3 + rand() * 0.35)}"/>`;
  }
  /* 丝状体：激波扫过星际介质，把气体拉成一条条细丝。这是这一档的主体 */
  for (let i = 0; i < 90; i++) {
    const a = rand() * 360;
    const [x1, y1] = pol(ox, oy, R * (0.32 + rand() * 0.55), a);
    const [x2, y2] = pol(ox, oy, R * (0.9 + rand() * 0.4), a + (rand() - 0.5) * 14);
    const [cx, cy] = pol(ox, oy, R * (0.7 + rand() * 0.3), a + (rand() - 0.5) * 22);
    out += `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none"
      stroke="${rand() < 0.45 ? pal.hot : pal.mid}"
      stroke-width="${round(0.5 + rand() * 1.5)}" opacity="${round(0.16 + rand() * 0.44)}"
      stroke-linecap="round"/>`;
  }
  return out;
}

function formVoid(rand, pal, id, R) {
  /* 黑洞视界：光也逃不出去的边界。
     垂光台记录不到它的光，只能记录**它吞噬别人的光**——
     所以画面上唯一亮的东西是被它拽弯的吸积盘和那一圈光子环。
     中心是这套系统里唯一的真黑：光进去就没有再出来。 */
  const r = R * 0.46;
  const tilt = round(-18 + rand() * 36);
  let out = `<g transform="rotate(${tilt} 250 250)">`;
  /* 吸积盘的远侧被引力透镜抬到视界上方 —— 那是黑洞最著名的样子 */
  out += `<ellipse cx="250" cy="250" rx="${round(r * 2.5)}" ry="${round(r * 0.52)}"
    fill="none" stroke="url(#disk${id})" stroke-width="${round(r * 0.44)}" opacity="0.9"/>`;
  out += `<path d="M${round(250 - r * 2.5)} 250 A${round(r * 2.5)} ${round(r * 1.5)} 0 0 1 ${round(250 + r * 2.5)} 250"
    fill="none" stroke="url(#disk${id})" stroke-width="${round(r * 0.3)}" opacity="0.72"/>`;
  out += `</g>`;
  out += `<circle cx="250" cy="250" r="${round(r)}" fill="#000000"/>`;
  /* 光子环：擦着视界飞过去的那一圈光，是全图最亮的一条线 */
  out += `<circle cx="250" cy="250" r="${round(r * 1.045)}" fill="none"
    stroke="${pal.hot}" stroke-width="2.2" opacity="0.95"/>`;
  out += `<circle cx="250" cy="250" r="${round(r * 1.045)}" fill="none"
    stroke="#FFFFFF" stroke-width="0.8" opacity="0.8"/>`;
  return out;
}

const FORMS = {
  giant: formGiant, nebula: formNebula, dwarf: formDwarf, neutron: formNeutron,
  magnetar: formMagnetar, remnant: formRemnant, void: formVoid,
};

/* 每种形自己的基准半径。红巨星几乎占满，白矮星只有一点 ——
   尺寸本身就是这七样东西最直观的区别。 */
const FORM_R = {
  giant: 168, nebula: 150, dwarf: 128, neutron: 92,
  magnetar: 112, remnant: 176, void: 128,
};

function emberSvg(id, rand, r, heat, spectrum) {
  const pal = SPECTRUM_PALETTE[spectrum];
  const k = contrastOf(r.tier);
  /* 余温决定尺寸与辉光：同一种天体，热的那颗更大更亮 */
  const R = round(FORM_R[r.kind] * (0.82 + (heat / 100) * 0.3));
  const form = FORMS[r.kind](rand, pal, id, R);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
  <defs>
    <radialGradient id="sky${id}" cx="50%" cy="50%" r="72%">
      <stop offset="0%" stop-color="${pal.deep}" stop-opacity="${round(0.5 - k * 0.28)}"/>
      <stop offset="100%" stop-color="${pal.sky}" stop-opacity="1"/>
    </radialGradient>
    ${halo(id, pal)}
    <!--
      主体：临边昏暗。恒星的边比心暗，因为你在边上看到的是更外、更冷的一层。
      白心收在 10% 以内 —— 放到 18% 时，A/F 这些本来就近白的光谱型
      会把整颗星糊成一个白球，光谱型这个特征就白设了。
    -->
    <radialGradient id="body${id}" cx="42%" cy="38%" r="74%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="10%" stop-color="${pal.hot}"/>
      <stop offset="44%" stop-color="${pal.mid}"/>
      <stop offset="100%" stop-color="${pal.deep}"/>
    </radialGradient>
    <!-- 光束的衰减：以星为心，所以两道束共用一条渐变，且与角度无关 -->
    <radialGradient id="beam${id}" cx="250" cy="250" r="${round(R * 2.6)}"
                    gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.85"/>
      <stop offset="22%" stop-color="${pal.hot}" stop-opacity="0.4"/>
      <stop offset="60%" stop-color="${pal.mid}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${pal.mid}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="disk${id}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${pal.mid}"/>
      <stop offset="35%" stop-color="${pal.hot}"/>
      <stop offset="65%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="${pal.mid}"/>
    </linearGradient>
  </defs>

  <!-- 满幅。没有留白边、没有题记条 —— 画面就是画面 -->
  <rect width="500" height="500" fill="${pal.sky}"/>
  <rect width="500" height="500" fill="url(#sky${id})"/>
  ${starfield(rand, r.stars, pal)}

  <!-- 辉光垫在主体下面：先有光，才有轮廓 -->
  <circle cx="250" cy="250" r="${round(R * 1.9)}" fill="url(#glow${id})"/>
  ${form}
</svg>`;
}

// ------------------------------------------------------------------ 星座

/*
 * 星图。
 *
 * 这里的算法**和穹顶上那个小龛里的图案是同一个**（web/dome.js 的 asterismGlyph）：
 * 同一个刻位号、同一个主星数，连出来的折线一模一样。
 * 上一代这两处是两套算法，于是墙上看到的图案和真正拿到手的藏品对不上 ——
 * 那是这套东西最不该出错的地方：龛就是这枚藏品在墙上的位置。
 */
function asterism(stars, seed) {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const n = Math.max(2, Math.min(11, stars));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.9;
    const rad = 3.4 + rnd() * 5.4;
    pts.push({
      x: +(10 + Math.cos(a) * rad).toFixed(2),
      y: +(12 + Math.sin(a) * rad * 0.92).toFixed(2),
      m: rnd(),
    });
  }
  /* 连线走最近邻：人眼总是把挨得近的两颗连起来，真实的星座就是这么连的 */
  const left = pts.map((_, i) => i);
  let cur = left.splice(pts.reduce((b, p, i) => (p.y > pts[b].y ? i : b), 0), 1)[0];
  const order = [cur];
  while (left.length) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < left.length; j++) {
      const p = pts[left[j]], q = pts[cur];
      const dd = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (dd < bd) { bd = dd; best = j; }
    }
    cur = left.splice(best, 1)[0];
    order.push(cur);
  }
  return { pts, order };
}

function constellationSvg(ordinal, rand, zh, latin, stars, region, magnitude) {
  const pal = region.pal;
  const { pts, order } = asterism(stars, ordinal);

  /* 20×24 的字身放大到画幅里，留出辉光的余地 */
  const S = 19.5;
  const P = (p) => [round(250 + (p.x - 10) * S), round(250 + (p.y - 12) * S)];

  let lines = "";
  for (let i = 1; i < order.length; i++) {
    const [x1, y1] = P(pts[order[i - 1]]);
    const [x2, y2] = P(pts[order[i]]);
    lines += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${pal.mid}"
      stroke-width="6" opacity="0.14" stroke-linecap="round"/>`;
    lines += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${pal.hot}"
      stroke-width="1.3" opacity="0.62" stroke-linecap="round"/>`;
  }

  let orbs = "";
  for (let i = 0; i < order.length; i++) {
    const p = pts[order[i]];
    const [x, y] = P(p);
    /* 第一颗是主星 —— 每个星座都有一颗最亮的 */
    const m = i === 0 ? 1 : 0.34 + p.m * 0.5;
    const rr = round(4 + m * 11);
    orbs += `<circle cx="${x}" cy="${y}" r="${round(rr * 3.4)}" fill="url(#orb${ordinal})" opacity="${round(0.3 + m * 0.5)}"/>`;
    orbs += `<circle cx="${x}" cy="${y}" r="${rr}" fill="#FFFFFF"/>`;
    orbs += `<circle cx="${x}" cy="${y}" r="${round(rr * 1.7)}" fill="none"
      stroke="${pal.hot}" stroke-width="1" opacity="0.45"/>`;
    if (m > 0.6) orbs += spikes(x, y, round(rr * 5.2), round(rr * 0.22), "#FFFFFF", 0.5);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
  <defs>
    <radialGradient id="sky${ordinal}" cx="50%" cy="42%" r="76%">
      <stop offset="0%" stop-color="${pal.deep}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${pal.sky}" stop-opacity="1"/>
    </radialGradient>
    <radialGradient id="orb${ordinal}">
      <stop offset="0%" stop-color="${pal.hot}" stop-opacity="0.85"/>
      <stop offset="40%" stop-color="${pal.mid}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${pal.mid}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="neb${ordinal}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${pal.mid}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${pal.mid}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="500" height="500" fill="${pal.sky}"/>
  <rect width="500" height="500" fill="url(#sky${ordinal})"/>
  ${starfield(rand, 150, pal)}

  <!-- 这一片天区的气体。它是天区色唯一大面积出现的地方 -->
  <ellipse cx="${round(190 + rand() * 120)}" cy="${round(190 + rand() * 120)}"
    rx="${round(150 + rand() * 90)}" ry="${round(120 + rand() * 80)}"
    fill="url(#neb${ordinal})"/>

  ${lines}
  ${orbs}
</svg>`;
}

const REMNANTS = [
  {
    w: 96, tier: 1, kind: "giant", name: "红巨星", latin: "Red Giant", grade: "常见",
    depth: 42, core: "#C4693C", halo: "#8A4A2E", stars: 34,
    lore: "膨胀到吞掉自己行星的老年恒星。死得最慢，也最壮观。",
  },
  {
    w: 48, tier: 2, kind: "nebula", name: "行星状星云", latin: "Planetary Nebula", grade: "少见",
    depth: 56, core: "#7FD8C8", halo: "#3C8C86", stars: 40,
    lore: "红巨星抛掉的那层壳，向外飘了几万年。名字里的「行星」是三百年前的误会，将错就错到今天。",
  },
  {
    w: 28, tier: 3, kind: "dwarf", name: "白矮星", latin: "White Dwarf", grade: "罕见",
    depth: 68, core: "#E4EEF6", halo: "#93B4CE", stars: 48,
    lore: "壳掉光之后剩下的核。一茶匙重达数吨。它最终会冷成一颗黑矮星 —— 但宇宙还不够老，一颗都还没成形。",
  },
  {
    w: 16, tier: 4, kind: "neutron", name: "中子星", latin: "Neutron Star", grade: "稀有",
    depth: 82, core: "#C6B4EE", halo: "#7A66B4", stars: 58,
    lore: "整颗恒星被压成一座城市的大小。每秒自转数百圈，扫过的射线像灯塔。",
  },
  {
    w: 7, tier: 5, kind: "magnetar", name: "磁星", latin: "Magnetar", grade: "极稀有",
    depth: 96, core: "#B9C6FF", halo: "#5566CC", stars: 68,
    lore: "磁场最强的那种中子星。它抖一下，几万光年外的仪器都要偏针 —— 垂光台的记录里，这一档全是被它带歪的读数。",
  },
  {
    w: 4, tier: 6, kind: "remnant", name: "超新星残骸", latin: "Supernova Remnant", grade: "孤例",
    depth: 112, core: "#9DE6C2", halo: "#3E9B76", stars: 78,
    lore: "爆炸后向外抛散的壳层。你身体里的铁，都来自某一次这样的爆炸。",
  },
  {
    w: 1, tier: 7, kind: "void", name: "黑洞视界", latin: "Event Horizon", grade: "唯一级",
    depth: 128, core: "#000000", halo: "#FFD98A", stars: 92,
    lore: "光也逃不出去的边界。垂光台记录不到它的光，只能记录它吞噬别人的光。",
  },
];

function buildEmber(id, base, site) {
  const rand = rng(id * 7919);
  const r = weighted(rand, REMNANTS);
  const heat = Math.floor(rand() * 100);
  const spectrum = pick(rand, SPECTRA);

  return {
    svg: emberSvg(id, rand, r, heat, spectrum),
    metadata: {
      name: `星屑 #${String(id).padStart(4, "0")}`,
      /* 简介只留两句：一句这是什么，一句它凭什么算数。
         其余（稀有度、光谱型、余温、编号）全部在 attributes 里 ——
         交易平台会把它们渲染成属性卡，写进正文是重复一遍。 */
      description:
        `${r.lore}\n\n` +
        `全站 2048 枚。它不值钱，只证明一件事：那颗恒星熄灭的时候，你在场。`,
      image: `${base}images/ember/${id}.svg`,
      external_url: `${site}/token.html?id=${id}`,
      attributes: [
        { trait_type: "层级", value: "星屑 Ember" },
        { trait_type: "恒星遗迹", value: r.name },
        { trait_type: "稀有度", value: r.grade },
        { display_type: "number", trait_type: "稀有度等级", value: r.tier },
        { trait_type: "光谱型", value: `${spectrum} 型` },
        { display_type: "number", trait_type: "余温 (K)", value: heat },
        { display_type: "number", trait_type: "观测编号", value: id },
      ],
    },
  };
}

// ------------------------------------------------------------------ 星座

// IAU 官方 88 个星座，一个不多一个不少 —— 这就是上限的由来。
const CONSTELLATIONS = [
  ["仙女座", "Andromeda"], ["唧筒座", "Antlia"], ["天燕座", "Apus"],
  ["宝瓶座", "Aquarius"], ["天鹰座", "Aquila"], ["天坛座", "Ara"],
  ["白羊座", "Aries"], ["御夫座", "Auriga"], ["牧夫座", "Bootes"],
  ["雕具座", "Caelum"], ["鹿豹座", "Camelopardalis"], ["巨蟹座", "Cancer"],
  ["猎犬座", "Canes Venatici"], ["大犬座", "Canis Major"], ["小犬座", "Canis Minor"],
  ["摩羯座", "Capricornus"], ["船底座", "Carina"], ["仙后座", "Cassiopeia"],
  ["半人马座", "Centaurus"], ["仙王座", "Cepheus"], ["鲸鱼座", "Cetus"],
  ["蝘蜓座", "Chamaeleon"], ["圆规座", "Circinus"], ["天鸽座", "Columba"],
  ["后发座", "Coma Berenices"], ["南冕座", "Corona Australis"],
  ["北冕座", "Corona Borealis"], ["乌鸦座", "Corvus"], ["巨爵座", "Crater"],
  ["南十字座", "Crux"], ["天鹅座", "Cygnus"], ["海豚座", "Delphinus"],
  ["剑鱼座", "Dorado"], ["天龙座", "Draco"], ["小马座", "Equuleus"],
  ["波江座", "Eridanus"], ["天炉座", "Fornax"], ["双子座", "Gemini"],
  ["天鹤座", "Grus"], ["武仙座", "Hercules"], ["时钟座", "Horologium"],
  ["长蛇座", "Hydra"], ["水蛇座", "Hydrus"], ["印第安座", "Indus"],
  ["蝎虎座", "Lacerta"], ["狮子座", "Leo"], ["小狮座", "Leo Minor"],
  ["天兔座", "Lepus"], ["天秤座", "Libra"], ["豺狼座", "Lupus"],
  ["天猫座", "Lynx"], ["天琴座", "Lyra"], ["山案座", "Mensa"],
  ["显微镜座", "Microscopium"], ["麒麟座", "Monoceros"], ["苍蝇座", "Musca"],
  ["矩尺座", "Norma"], ["南极座", "Octans"], ["蛇夫座", "Ophiuchus"],
  ["猎户座", "Orion"], ["孔雀座", "Pavo"], ["飞马座", "Pegasus"],
  ["英仙座", "Perseus"], ["凤凰座", "Phoenix"], ["绘架座", "Pictor"],
  ["双鱼座", "Pisces"], ["南鱼座", "Piscis Austrinus"], ["船尾座", "Puppis"],
  ["罗盘座", "Pyxis"], ["网罟座", "Reticulum"], ["天箭座", "Sagitta"],
  ["人马座", "Sagittarius"], ["天蝎座", "Scorpius"], ["玉夫座", "Sculptor"],
  ["盾牌座", "Scutum"], ["巨蛇座", "Serpens"], ["六分仪座", "Sextans"],
  ["金牛座", "Taurus"], ["望远镜座", "Telescopium"], ["三角座", "Triangulum"],
  ["南三角座", "Triangulum Australe"], ["杜鹃座", "Tucana"],
  ["大熊座", "Ursa Major"], ["小熊座", "Ursa Minor"], ["船帆座", "Vela"],
  ["室女座", "Virgo"], ["飞鱼座", "Volans"], ["狐狸座", "Vulpecula"],
];

// 天区 = 壁面的三段。岩性和水色都不一样，所以 88 张图在墙上有冷暖差别
/*
 * 天区三色。它是**分类色**：88 个刻位按号轮着分三份，
 * 所以在网格里一眼能看出这一枚属于哪一区 —— 这是 88 个里唯一的颜色特征。
 * 与 web/tokens.css 的 --region-n/s/e 同源。
 */
const REGIONS = [
  { name: "北天", pal: { hot: "#DCEBFF", mid: "#6FA8E0", deep: "#173257", sky: "#050A14" } },
  { name: "南天", pal: { hot: "#EADFFF", mid: "#A08ADA", deep: "#2A1F55", sky: "#07050F" } },
  { name: "黄道", pal: { hot: "#FFF3D2", mid: "#D8C06A", deep: "#4C3D14", sky: "#0C0A06" } },
];

/** 刻位在壁面哪一道岩脊上。和站点上那面墙用的是同一组分环。 */
function seatDepth(ordinal) {
  const ledges = [[12, 62], [20, 78], [26, 96], [30, 118]];
  let n = ordinal;
  for (const [count, d] of ledges) {
    if (n <= count) return d;
    n -= count;
  }
  return 118;
}
function buildConstellation(ordinal, base, site) {
  const [zh, latin] = CONSTELLATIONS[ordinal - 1];
  const rand = rng(ordinal * 104729 + 13);

  const stars = 5 + Math.floor(rand() * 5);
  const region = REGIONS[(ordinal - 1) % REGIONS.length];
  const magnitude = round(0.4 + rand() * 3.6);

  return {
    svg: constellationSvg(ordinal, rand, zh, latin, stars, region, magnitude),
    id: CONSTELLATION_OFFSET + ordinal,
    metadata: {
      name: `${zh} · 第 ${String(ordinal).padStart(2, "0")} 刻`,
      description:
        `穹顶第 ${ordinal} 号刻位，${zh}（${latin}）。\n\n` +
        `全站仅 88 个 —— 人类命名过的星座就这么多。每个钱包只能刻一个。`,
      image: `${base}images/constellation/${ordinal}.svg`,
      external_url: `${site}/token.html?id=${CONSTELLATION_OFFSET + ordinal}`,
      attributes: [
        { trait_type: "层级", value: "星座 Constellation" },
        { trait_type: "星座", value: zh },
        { trait_type: "天区", value: region.name },
        { display_type: "number", trait_type: "主星数", value: stars },
        { display_type: "number", trait_type: "视星等", value: magnitude },
        { display_type: "number", trait_type: "刻位", value: ordinal },
      ],
    },
  };
}

// ------------------------------------------------------------------ 输出

function main() {
  const base = process.env.BASE || "http://127.0.0.1:8080/metadata/";
  /*
   * external_url 是交易平台上那个"跳回项目"的链接。
   * 以前这里写死着 https://example.com —— 2136 件藏品每一件都挂着这个占位符，
   * 在 OpenSea 上就是一个指向别人家的链接。现在指回这件藏品自己的页面。
   */
  const site = (process.env.SITE || "http://127.0.0.1:8080").replace(/\/$/, "");

  fs.mkdirSync(path.join(IMG, "ember"), { recursive: true });
  fs.mkdirSync(path.join(IMG, "constellation"), { recursive: true });

  const tally = {};
  for (let id = 1; id <= EMBER_SUPPLY; id++) {
    const { svg, metadata } = buildEmber(id, base, site);
    fs.writeFileSync(path.join(IMG, "ember", `${id}.svg`), svg);
    // tokenURI = baseURI + tokenId，所以文件名不带扩展名
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(metadata, null, 2));
    const k = metadata.attributes[1].value;
    tally[k] = (tally[k] || 0) + 1;
  }

  for (let ordinal = 1; ordinal <= CONSTELLATION_SUPPLY; ordinal++) {
    const { svg, metadata, id } = buildConstellation(ordinal, base, site);
    fs.writeFileSync(path.join(IMG, "constellation", `${ordinal}.svg`), svg);
    fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(metadata, null, 2));
  }

  // 前端一次读完 88 个刻位的名字/天区，省掉 88 次请求
  fs.writeFileSync(
    path.join(OUT, "names.json"),
    JSON.stringify(
      CONSTELLATIONS.map(([zh, latin], i) => ({
        n: i + 1,
        zh,
        latin,
        region: REGIONS[i % REGIONS.length].name,
        r: i % REGIONS.length,
        // 主星数：壁面上那个小小的枝形标记按它长出分叉，
        // 所以龛里的图案和这个刻位真正的藏品是同一个数
        stars: 5 + Math.floor(rng((i + 1) * 104729 + 13)() * 5),
        d: seatDepth(i + 1),
      }))
    )
  );

  fs.writeFileSync(
    path.join(OUT, "contract.json"),
    JSON.stringify(
      {
        name: "垂光台 · The Last Observatory",
        description:
          "宇宙正在熄灭。垂光台是最后一座仍在运转的观星台，它只做一件事：" +
          "在每一颗恒星死去时，记录下它最后的光。\n\n" +
          "星屑 2048 枚，免费拾取，是你到过这里的唯一证据。" +
          "星座 88 个，付费铭刻，每个钱包只能刻一个 —— " +
          "所以最多只会有 88 个人在穹顶上留下名字。",
        image: base + "images/constellation/31.svg",
        banner_image: base + "images/ember/37.svg",
        external_link: site,
      },
      null,
      2
    )
  );

  // ── 88 个刻位的静态分享页。
  // 爬虫不跑 JS，链接要能在 Twitter/Discord 里正常展开，就必须有静态 meta。
  const SITE = (process.env.SITE || "http://127.0.0.1:8080").replace(/\/$/, "");
  const SDIR = path.join(__dirname, "..", "web", "s");
  fs.mkdirSync(SDIR, { recursive: true });

  for (let ordinal = 1; ordinal <= CONSTELLATION_SUPPLY; ordinal++) {
    const [zh, latin] = CONSTELLATIONS[ordinal - 1];
    const tokenId = CONSTELLATION_OFFSET + ordinal;
    const title = `${zh} · 第 ${String(ordinal).padStart(2, "0")} 刻 · 垂光台`;
    const desc =
      `穹顶第 ${ordinal} 号刻位。全站仅 88 个，每个钱包只能刻一个 —— ` +
      `所以最多只会有 88 个人在这里留下名字。`;
    const img = `${SITE}/metadata/images/constellation/${ordinal}.svg`;
    const to = `${SITE}/token.html?id=${tokenId}`;

    fs.writeFileSync(
      path.join(SDIR, `${ordinal}.html`),
      `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:url" content="${to}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="icon" href="../favicon.ico" sizes="32x32">
<link rel="canonical" href="${to}">
<meta http-equiv="refresh" content="0; url=${to}">
</head>
<body style="background:#070C16;color:#F2F6FA;font-family:system-ui;padding:40px">
<p>正在前往 <a href="${to}" style="color:#19D7E6">${title}</a>…</p>
</body>
</html>
`
    );
  }

  console.log(`分享页 ${CONSTELLATION_SUPPLY} 个 → web/s/<刻位号>.html`);
  console.log(`星屑 ${EMBER_SUPPLY} 枚`);
  for (const r of REMNANTS) {
    const n = tally[r.name] || 0;
    console.log(
      `  T${r.tier} ${r.name.padEnd(6)} ${String(n).padStart(4)}  ` +
        `${String(round((n / EMBER_SUPPLY) * 100)).padStart(5)}%  ${r.grade}`
    );
  }
  console.log(`星座 ${CONSTELLATION_SUPPLY} 个`);
  console.log(`baseURI = ${base}`);
}

main();
