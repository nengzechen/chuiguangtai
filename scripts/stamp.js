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

console.log("内容指纹已打上：");
for (const [f, v] of Object.entries(stamps)) console.log(`  ${f.padEnd(16)} ${v}`);
