/**
 * 冒烟检查：把这套东西该有的东西都点一遍。
 *
 *   npm run smoke            # 只查静态产物
 *   npm run smoke -- --web   # 顺带查本地服务器的路由
 *
 * 合约有 41 个单测，但元数据、图、分享页、路由这些没人守着 ——
 * 它们坏掉的方式是"悄悄少了一个文件"，跑一遍才看得见。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const META = path.join(WEB, "metadata");

const EMBER_SUPPLY = 2048;
const CON_SUPPLY = 88;
const CON_OFFSET = 10000;

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    const detail = fn();
    console.log(`  ✓ ${name}${detail ? "  " + detail : ""}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    fail++;
  }
}

const exists = (p) => fs.existsSync(p);
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ─────────────────────────────────────────────── 静态产物

console.log("\n前端文件");
for (const f of [
  "index.html", "landing.js", "landing.css",
  "observatory.html", "app.js",
  "token.html", "token.js",
  "keeper.html", "keeper.js",
  "shared.js", "dome.js", "toast.js", "sharecard.js",
  "content.js", "tokens.css", "styles.css", "favicon.svg", "vendor/ethers.js",
  "fonts/jetbrains-mono-400.woff2", "fonts/jetbrains-mono-700.woff2",
  "fonts/noto-serif-sc-700-subset.woff2",
]) {
  check(f, () => {
    must(exists(path.join(WEB, f)), "缺文件");
    return `${(fs.statSync(path.join(WEB, f)).size / 1024).toFixed(1)}KB`;
  });
}

console.log("\n元数据");
check("星屑 1..2048 全在", () => {
  for (let i = 1; i <= EMBER_SUPPLY; i++) {
    must(exists(path.join(META, `${i}.json`)), `缺 token ${i}`);
  }
  return `${EMBER_SUPPLY} 个`;
});
check("星座 10001..10088 全在", () => {
  for (let i = 1; i <= CON_SUPPLY; i++) {
    must(exists(path.join(META, `${CON_OFFSET + i}.json`)), `缺 token ${CON_OFFSET + i}`);
  }
  return `${CON_SUPPLY} 个`;
});
check("图与元数据一一对应", () => {
  let n = 0;
  for (let i = 1; i <= EMBER_SUPPLY; i++) {
    must(exists(path.join(META, "images", "ember", `${i}.svg`)), `缺星屑图 ${i}`);
    n++;
  }
  for (let i = 1; i <= CON_SUPPLY; i++) {
    must(exists(path.join(META, "images", "constellation", `${i}.svg`)), `缺星座图 ${i}`);
    n++;
  }
  return `${n} 张`;
});
check("contract.json 有 OpenSea 需要的字段", () => {
  const c = JSON.parse(fs.readFileSync(path.join(META, "contract.json"), "utf8"));
  for (const k of ["name", "description", "image"]) must(c[k], `缺 ${k}`);
});
check("names.json 正好 88 条", () => {
  const n = JSON.parse(fs.readFileSync(path.join(META, "names.json"), "utf8"));
  must(n.length === CON_SUPPLY, `实际 ${n.length} 条`);
  must(n[87].zh === "狐狸座", "末位不是狐狸座");
});

console.log("\n稀有度分布");
check("七档都存在且比例合理", () => {
  const tally = {};
  for (let i = 1; i <= EMBER_SUPPLY; i++) {
    const m = JSON.parse(fs.readFileSync(path.join(META, `${i}.json`), "utf8"));
    const g = m.attributes.find((a) => a.trait_type === "稀有度").value;
    tally[g] = (tally[g] || 0) + 1;
  }
  must(Object.keys(tally).length === 7, `只有 ${Object.keys(tally).length} 档`);
  must(tally["唯一级"] > 0 && tally["唯一级"] < EMBER_SUPPLY * 0.03, "唯一级比例异常");
  must(tally["常见"] > EMBER_SUPPLY * 0.4, "常见档比例异常");
  return Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ");
});

console.log("\n分享页");
check("88 个 OG 页齐全且带 og:image", () => {
  for (let i = 1; i <= CON_SUPPLY; i++) {
    const f = path.join(WEB, "s", `${i}.html`);
    must(exists(f), `缺 s/${i}.html`);
    const html = fs.readFileSync(f, "utf8");
    must(html.includes('property="og:image"'), `s/${i}.html 缺 og:image`);
    must(html.includes(`id=${CON_OFFSET + i}`), `s/${i}.html 跳转目标不对`);
  }
  return `${CON_SUPPLY} 个`;
});

console.log("\n样式体系");
const allCss = () =>
  ["tokens.css", "styles.css", "landing.css"]
    .map((f) => fs.readFileSync(path.join(WEB, f), "utf8"))
    .join("\n");

check("颜色全部是 oklch，没有裸 hex", () => {
  const css = allCss();
  const hex = css.match(/#[0-9a-fA-F]{6}\b/g) || [];
  must(hex.length === 0, `还剩 ${hex.length} 处：${[...new Set(hex)].join(" ")}`);
  return `${(css.match(/oklch\(/g) || []).length} 处 oklch`;
});
check("石面上的字够亮（正文 L > 0.65）", () => {
  const css = fs.readFileSync(path.join(WEB, "tokens.css"), "utf8");
  const out = [];
  // 地是 --stone（L=0.190）。正文和次级正文必须远高于它才读得出来；
  // --lime-faint 只用在刻度和禁用态上，不参与这条。
  // （上一版这三个叫 star / star-mid / star-low，世界换成名录墙时改的名，
  //   约束本身没变：前景永远不靠压暗来做层级。）
  for (const name of ["lime", "lime-mid", "lime-low"]) {
    const m = css.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)`));
    must(m, `找不到 --${name}`);
    must(Number(m[1]) > 0.65, `--${name} 的 L 只有 ${m[1]}`);
    out.push(`${name}=${m[1]}`);
  }
  return out.join(" ");
});
check("每个页面用到的共享函数都真的 import 了", () => {
  // keeper.js 曾经用了 notOpenYet 却没写进 import 里 —— node --check 查不出来，
  // 页面也不报错，只在跑到那一行时静默失效。这条专门堵这个。
  const shared = fs.readFileSync(path.join(WEB, "shared.js"), "utf8");
  const exported = [...shared.matchAll(/^export (?:const|function|async function) (\w+)/gm)]
    .map((m) => m[1]);
  const missing = [];
  for (const f of ["app.js", "token.js", "keeper.js", "landing.js"]) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/shared\.js"/);
    const names = imp ? imp[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
    // 去掉 import 那一行再找用法，免得自己匹配自己
    const body = src.replace(/import[^;]*;/g, "");
    for (const name of exported) {
      const used = new RegExp(`\\b${name}\\b`).test(body);
      // 页面自己声明了同名的一份就不算漏（app.js 有几个是本地副本）
      const own = new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(body);
      if (used && !own && !names.includes(name)) {
        missing.push(`${f} 用了 ${name} 但没 import`);
      }
    }
  }
  must(missing.length === 0, missing.join("；"));
  return `${exported.length} 个共享导出，4 个页面都对得上`;
});
check("字号走的是刻度，不是随手写的 px", () => {
  const css = allCss();
  const tokens = (css.match(/var\(--t-[a-z0-9]+\)/g) || []).length;
  must(tokens > 100, `只有 ${tokens} 处用了字号刻度`);
  // @font-face 和 unicode-range 里的裸 px 不算
  const body = css.replace(/@font-face\s*{[^}]*}/g, "");
  const raw = (body.match(/font-size:\s*[0-9.]+px/g) || []).length;
  must(raw === 0, `还有 ${raw} 处裸 font-size`);
  return `${tokens} 处刻度引用`;
});
check("拉丁字面已换成 JetBrains Mono", () => {
  const css = fs.readFileSync(path.join(WEB, "tokens.css"), "utf8");
  must(css.includes('font-family: "JetBrains Mono"'), "没有 @font-face");
  must(css.includes("unicode-range"), "没有限定 unicode-range，中文会白等字体");
  must(/--mono:\s*"JetBrains Mono"/.test(css), "--mono 没指向新字体");
  const kb = [400, 700].reduce(
    (n, w) => n + fs.statSync(path.join(WEB, `fonts/jetbrains-mono-${w}.woff2`)).size, 0
  );
  return `${(kb / 1024).toFixed(0)}KB`;
});
check("中文子集覆盖了页面上所有的字", () => {
  // 子集化是构建步骤，不是一次性手工活。
  // 改了文案却忘了重跑 npm run font，漏掉的字会静默掉回系统字体 ——
  // 同一句话里两种字面，不报错但很难看。这项就是防这个。
  const covered = new Set(
    fs.readFileSync(path.join(WEB, "fonts", "subset-chars.txt"), "utf8")
  );
  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/u;
  const missing = new Set();

  const scan = (text) => {
    for (const ch of text) if (CJK.test(ch) && !covered.has(ch)) missing.add(ch);
  };
  /*
   * 注释里的字不算 —— 它们永远不渲染。
   * 这里的剥离规则必须和 scripts/subset-font.js 的 stripComments 一致：
   * 两边不一致，构建就会在"子集里没有"和"页面上要有"之间来回打架。
   */
  const strip = (text, file) =>
    /\.html$/.test(file)
      ? text.replace(/<!--[\s\S]*?-->/g, " ")
      : text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  for (const f of fs.readdirSync(WEB)) {
    if (/\.(html|js)$/.test(f)) {
      scan(strip(fs.readFileSync(path.join(WEB, f), "utf8"), f));
    }
  }
  for (const f of fs.readdirSync(META)) {
    const fp = path.join(META, f);
    if (!fs.statSync(fp).isDirectory()) scan(fs.readFileSync(fp, "utf8"));
  }

  must(
    missing.size === 0,
    `${missing.size} 个字没进子集：${[...missing].slice(0, 20).join("")} —— 跑 npm run font`
  );
  return `${covered.size} 字 · ${(
    fs.statSync(path.join(WEB, "fonts", "noto-serif-sc-700-subset.woff2")).size / 1024
  ).toFixed(0)}KB`;
});
/*
 * 藏品图里**一个字都没有**。
 *
 * 这一条比它取代的那一条严格：上一版查的是"用了字的话必须写系统字体栈"，
 * 那是给带题记的标本卡准备的。现在画面上没有任何文字 ——
 * 名字和属性属于 metadata，交易平台会自己渲染成卡片，
 * 烧进图里等于在画布上贴标签（真正的生成艺术藏品图里一个字都没有）。
 *
 * 顺带，"不得引用本站字体、要能在 OpenSea 独立渲染"这条约束现在是**自动满足**的：
 * 没有 text 就没有字体可依赖。所以这里直接查根因，不再查症状。
 */
check("藏品 SVG 里没有任何文字", () => {
  let n = 0;
  const scan = (dir, count) => {
    for (let i = 1; i <= count; i++) {
      const svg = fs.readFileSync(path.join(META, "images", dir, `${i}.svg`), "utf8");
      must(!/<text[\s>]/.test(svg), `${dir}/${i}.svg 里有 <text>`);
      must(!/font-family/.test(svg), `${dir}/${i}.svg 里有 font-family`);
      n++;
    }
  };
  scan("ember", EMBER_SUPPLY);
  scan("constellation", CON_SUPPLY);
  return `${n} 张，0 处文字`;
});
check("中文段落里没有折行造成的空格", () => {
  for (const f of ["index.html", "observatory.html", "token.html", "keeper.html"]) {
    const html = fs.readFileSync(path.join(WEB, f), "utf8");
    const body = html.replace(/<!--[\s\S]*?-->/g, " ");
    const bad = body.match(/[\u4e00-\u9fff]\n\s+[\u4e00-\u9fff]/g) || [];
    must(bad.length === 0, `${f} 有 ${bad.length} 处：HTML 会把换行折成可见空格`);
  }
});
check("首页不加载应用的组件样式", () => {
  // 首页曾经直接引 styles.css，结果 landing 的 <header> 被应用顶栏的
  // `header { display:grid }` 命中，整个首屏塌了。令牌共享，组件样式必须分家。
  const lp = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
  must(lp.includes("tokens.css"), "首页没引令牌");
  must(!/href="styles\.css/.test(lp), "首页引了应用组件样式，会撞选择器");
  const tokens = fs.readFileSync(path.join(WEB, "tokens.css"), "utf8");
  must(tokens.includes(":root"), "tokens.css 里没有 :root");
  must(!/\.card\s*{|\.btn\s*{/.test(tokens), "tokens.css 混进了组件样式");
});
check("动效可被 prefers-reduced-motion 关闭", () => {
  const css = fs.readFileSync(path.join(WEB, "styles.css"), "utf8");
  must(css.includes("prefers-reduced-motion"), "没有 reduced-motion 分支");
});

console.log("\nJS 引用的 DOM id 都存在");
for (const [h, j] of [
  ["observatory.html", "app.js"],
  ["index.html", "landing.js"],
  ["token.html", "token.js"],
  ["keeper.html", "keeper.js"],
]) {
  check(`${h} ↔ ${j}`, () => {
    const html = fs.readFileSync(path.join(WEB, h), "utf8");
    const js = fs.readFileSync(path.join(WEB, j), "utf8");
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    // 这几个是 buildDome 运行时注入的，HTML 里本来就没有
    const runtime = new Set(["kinlines", "reticle", "rostermore", "feedmore", "seats"]);
    const used = [...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((x) => !ids.has(x) && !runtime.has(x));
    must(missing.length === 0, `JS 引用了不存在的 id: ${missing.join(", ")}`);
    return `${new Set(used).size} 个引用`;
  });
}

// ─────────────────────────────────────────────── 路由（可选）

async function web() {
  const base = process.env.BASE_URL || "http://127.0.0.1:8080";
  console.log(`\n路由 (${base})`);

  const routes = [
    ["/index.html", "最后一座观星台"],
    ["/observatory.html", "穹顶星图"],
    ["/token.html?id=10002", "token.js"],
    ["/token.html?id=37", "token.js"],
    ["/token.html?id=99999", "token.js"],
    ["/keeper.html?a=0x0000000000000000000000000000000000000001", "keeper.js"],
    ["/s/60.html", "og:image"],
    ["/metadata/10060", "猎户座"],
    ["/metadata/names.json", "狐狸座"],
    ["/favicon.svg", "svg"],
  ];

  for (const [r, marker] of routes) {
    // 顺序请求，避免把开发服务器打满
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(base + r).catch(() => null);
    check(r, () => {
      must(res, "连不上，先 npm run web");
      must(res.ok, `HTTP ${res.status}`);
      return `${res.status}`;
    });
    if (res?.ok) {
      // eslint-disable-next-line no-await-in-loop
      const body = await res.text();
      check(`  └ 内容含「${marker}」`, () => must(body.includes(marker), "没找到标记"));
    }
  }
}

(async () => {
  if (process.argv.includes("--web")) await web();

  console.log(`\n${"─".repeat(46)}`);
  console.log(`  通过 ${pass} 项${fail ? `，失败 ${fail} 项` : "，全部通过"}`);
  console.log(`${"─".repeat(46)}\n`);
  process.exit(fail ? 1 : 0);
})();
