/**
 * 中文标题字的子集化。
 *
 *   npm run font
 *
 * 只子集**标题字**（思源黑体 900）。正文走系统无衬线，一个字节都不下载 ——
 * 中文正文字重装一套就是 180KB，而系统字在正文尺寸上读起来没有损失。
 * 标题不一样：标题是这一页的声音，不能交给"用户机器上碰巧装了什么"。
 *
 * 为什么是黑体重字而不是宋体：这一页是一台仪器。仪器面板和水下写字板上
 * 不会出现宋体 —— 那是印刷书籍的字。设备上的中文是刻印出来的黑体。
 *
 * ⚠️ 这是个构建步骤，不是一次性的手工活：
 * 以后改文案、加星座、写新的提示语，都要重跑一次。
 * 漏掉的字会静默掉回系统字体 —— 同一句话里两种字面，很难看但不报错。
 * 所以 `npm run smoke` 里有一项专门校验覆盖率。
 */
const fs = require("fs");
const path = require("path");
const subsetFont = require("subset-font");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "web");
const META = path.join(WEB, "metadata");
/*
 * 世界是名录墙，展示字是**明体**。
 * 宋/明体是刻工发明的字：横细竖粗、起收有棱，因为那是刀在木头和石头上
 * 最省力的走法。碑上的字本来就长这样 —— 上一版用黑体，因为那一版是仪器面板。
 *
 * 700 而不是 900：明体的竖画本来就重，再加粗会把横画的细挤没，
 * 刻痕的那点棱角就糊了。
 */
const OUT = path.join(WEB, "fonts", "noto-serif-sc-700-subset.woff2");
const MANIFEST = path.join(WEB, "fonts", "subset-chars.txt");

const SRC = path.join(
  ROOT,
  "node_modules/@fontsource/noto-serif-sc/files/noto-serif-sc-chinese-simplified-700-normal.woff2"
);

/** 中日韩统一表意文字 + 常用标点 */
const CJK = /[　-〿一-鿿＀-￯]/u;

/*
 * 注释里的字**不进子集**。
 *
 * 这个代码库的注释是中文的，而且写得很密（那是好事）。但注释永远不渲染，
 * 把它们算进来有两个坏处：字库里多出几十个谁也看不见的字形，
 * 而且 `npm run smoke` 的覆盖率检查会因为一句注释的用词而失败 ——
 * 于是修 bug 的人被迫改注释措辞，或者为一条注释把字库撑大。两个都不对。
 *
 * 剥掉的是：JS/CSS 的 // 与 /* *\/，以及 HTML 的 <!-- -->。
 * 剥不干净也没关系：这一步只会让子集更小，漏掉的真实文案仍然会被
 * smoke 的覆盖率检查抓住 —— 那一条查的是**渲染出来的字**。
 */
function stripComments(text, file) {
  if (/\.html$/.test(file)) return text.replace(/<!--[\s\S]*?-->/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function collect() {
  const chars = new Set();
  const add = (text) => {
    for (const ch of String(text)) if (CJK.test(ch)) chars.add(ch);
  };

  // 页面与脚本里会渲染出来的中文（注释剥掉，见上）
  for (const f of fs.readdirSync(WEB)) {
    if (!/\.(html|js|css)$/.test(f)) continue;
    add(stripComments(fs.readFileSync(path.join(WEB, f), "utf8"), f));
  }

  // 元数据：星座名、遗迹名、描述、trait —— 这些都会渲染到页面上
  for (const f of fs.readdirSync(META)) {
    const p = path.join(META, f);
    if (fs.statSync(p).isDirectory()) continue;
    add(fs.readFileSync(p, "utf8"));
  }

  // 生成器里的文案（改了文案但还没重跑 metadata 时也能兜住）
  add(fs.readFileSync(path.join(ROOT, "scripts", "gen-metadata.js"), "utf8"));
  add(fs.readFileSync(path.join(ROOT, "scripts", "seed.js"), "utf8"));
  add(fs.readFileSync(path.join(ROOT, "scripts", "fill.js"), "utf8"));

  return [...chars].sort();
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("找不到源字体，先 npm i");
    process.exit(1);
  }

  const chars = collect();
  const text = chars.join("");

  const src = fs.readFileSync(SRC);
  const out = await subsetFont(src, text, { targetFormat: "woff2" });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  fs.writeFileSync(MANIFEST, text);

  const srcKB = (src.length / 1024).toFixed(0);
  const outKB = (out.length / 1024).toFixed(1);
  console.log(`收集到 ${chars.length} 个汉字/标点`);
  console.log(`源文件 ${srcKB}KB → 子集 ${outKB}KB（${(
    (1 - out.length / src.length) * 100
  ).toFixed(1)}% 被砍掉）`);
  console.log(`→ ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
