/**
 * 给每个 JS / CSS 打上内容指纹。
 *
 * 为什么必须有这一步：`?v=67` 是手写的，改了文件忘记改它，
 * 回头客拿到的就是浏览器缓存里的旧代码 —— 这个 bug 不报错、不留痕，
 * 只是有人看到的页面和你以为的不是同一个。刚才就发生了一次：
 * landing.js 改完发上去，线上仍旧跑着旧的那份。
 *
 * 而且模块之间的 import（`from "./shared.js"`）根本没有版本号，
 * HTML 里怎么改都管不到它们。所以指纹要同时打进 HTML 和 JS 的 import。
 *
 * 指纹是内容哈希：内容没变，版本号就不变，缓存照常命中。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const WEB = path.join(__dirname, "..", "web");
const HTML = ["index.html", "observatory.html", "token.html", "keeper.html"];

const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);

// 哈希要算在**去掉版本号之后**的内容上，否则每跑一次都变
const strip = (src) => src.replace(/(\.(?:js|css))\?v=[0-9a-z]+/g, "$1");

// 先把所有源文件的版本号清掉，再算指纹 —— 顺序很重要：
// shared.js 的指纹变了，引用它的 landing.js 内容就变，landing.js 的指纹也得跟着变。
const assets = fs
  .readdirSync(WEB)
  .filter((f) => /\.(js|css)$/.test(f));

for (const f of assets) {
  const p = path.join(WEB, f);
  fs.writeFileSync(p, strip(fs.readFileSync(p, "utf8")));
}
for (const f of HTML) {
  const p = path.join(WEB, f);
  fs.writeFileSync(p, strip(fs.readFileSync(p, "utf8")));
}

/*
 * 拓扑：被依赖的先定版。这里的依赖图很浅（shared/dome/content/toast/sharecard
 * → 各个页面脚本），手写一个顺序比引一个图算法划算，也更看得懂。
 */
const ORDER = [
  "tokens.css", "styles.css", "landing.css",
  "shared.js", "content.js", "dome.js", "toast.js", "sharecard.js",
  "app.js", "landing.js", "token.js", "keeper.js",
];
const rest = assets.filter((f) => !ORDER.includes(f));
const stamps = {};

for (const f of [...ORDER.filter((f) => assets.includes(f)), ...rest]) {
  const p = path.join(WEB, f);
  // 先把这个文件里对**已定版**依赖的引用改掉，再算它自己的指纹
  let src = fs.readFileSync(p, "utf8");
  for (const [dep, v] of Object.entries(stamps)) {
    src = src.split(`"./${dep}"`).join(`"./${dep}?v=${v}"`);
  }
  fs.writeFileSync(p, src);
  stamps[f] = hash(p);
}

// HTML 里的 <script src> / <link href>
for (const f of HTML) {
  const p = path.join(WEB, f);
  let src = fs.readFileSync(p, "utf8");
  for (const [asset, v] of Object.entries(stamps)) {
    src = src
      .split(`"${asset}"`).join(`"${asset}?v=${v}"`)
      .split(`href="${asset}"`).join(`href="${asset}?v=${v}"`);
  }
  fs.writeFileSync(p, src);
}

/*
 * 构建号：所有指纹再哈一次。
 *
 * 为什么需要它：指纹只能保证**资源**不被缓存旧的，管不了 HTML 本身。
 * GitHub Pages 给 HTML 发 max-age=600，且不读 _headers ——
 * 于是改完页面十分钟内，回头客拿到的 HTML 还是旧的，
 * 它引用的自然也是旧的 JS。页面看着正常，行为是上一版的，
 * 不报错、不留痕 —— 用户只会说"你不是说修好了吗"。
 *
 * 所以把构建号同时写进 HTML 和一个单独的 build.json：
 * 页面起来后用 no-store 拉一次 build.json（绕开 HTTP 缓存），
 * 对不上就说明手里这份 HTML 是缓存的旧版，当场告诉用户刷新。
 */
const build = crypto
  .createHash("sha256")
  .update(Object.entries(stamps).map(([f, v]) => f + v).join("|"))
  .digest("hex")
  .slice(0, 8);

fs.writeFileSync(path.join(WEB, "build.json"), JSON.stringify({ build }) + "\n");

for (const f of HTML) {
  const p = path.join(WEB, f);
  let src = fs.readFileSync(p, "utf8");
  src = src.replace(/<html([^>]*?)(?:\s+data-build="[0-9a-f]+")?>/, `<html$1 data-build="${build}">`);
  fs.writeFileSync(p, src);
}

console.log("内容指纹已打上：");
for (const [f, v] of Object.entries(stamps)) console.log(`  ${f.padEnd(16)} ${v}`);
console.log(`  ${"构建号".padEnd(14)} ${build}`);
