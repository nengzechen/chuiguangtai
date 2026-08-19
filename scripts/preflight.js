/**
 * 上线前的最后一道闸。
 *
 * smoke.js 管的是"这个站自己有没有做对"，preflight 管的是
 * "把它挂到公网上给陌生人用，还缺什么"。两件事分开，因为本地开发时
 * 天天都在违反 preflight 的条件（指向 127.0.0.1、连的是本地链），
 * 那不是错，只是还没到上线那一步。
 */
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
// 占位域名。写着它就等于还没填真地址 —— 比留 127.0.0.1 更危险，因为它看着像对的
const PLACEHOLDERS = /example\.|你的域名|your-domain|changeme/i;
const read = (f) => fs.readFileSync(path.join(WEB, f), "utf8");

let bad = 0, warn = 0;
const fail = (msg, how) => { bad++; console.log(`  ✗ ${msg}\n    → ${how}`); };
const soft = (msg, how) => { warn++; console.log(`  ! ${msg}\n    → ${how}`); };
const ok   = (msg) => console.log(`  ✓ ${msg}`);

console.log("\n上线前检查\n" + "─".repeat(46));

// ── 1. 合约部署在哪条链上
let dep = null;
try {
  dep = JSON.parse(read("deployment.json"));
} catch {
  fail("web/deployment.json 读不到", "先 npm run deploy:testnet 或 deploy:mainnet");
}

if (dep) {
  const NAMES = { 4663: "Robinhood 主网", 46630: "Robinhood 测试网", 31337: "本地链" };
  const name = NAMES[dep.chainId] || `chainId ${dep.chainId}`;
  if (dep.chainId === 31337) {
    fail(`合约还指向${name}`, "本地链在别人的机器上不存在。要 deploy:testnet / deploy:mainnet");
  } else {
    ok(`合约在${name} · ${dep.address}`);
  }

  // ── 2. 献纳流向
  const TREASURY = "0xTREASURY_REDACTED";
  if (!dep.treasury) {
    soft("deployment.json 里没记金库地址", "用新版 deploy.js 重新部署即可");
  } else if (dep.treasury.toLowerCase() !== TREASURY.toLowerCase()) {
    fail(`金库是 ${dep.treasury}，不是约定的 ${TREASURY}`, "TREASURY=… 重新部署");
  } else {
    ok(`献纳流向 ${dep.treasury}`);
  }

  // ── 3. baseURI 必须是公网可达的绝对地址
  const b = dep.baseURI || "";
  if (/127\.0\.0\.1|localhost/.test(b)) {
    fail(`baseURI 还指着本机（${b}）`, "BASE=https://你的域名/metadata/ 重新部署");
  } else if (!/^(https:\/\/|ipfs:\/\/)/.test(b)) {
    fail(`baseURI 不是 https 也不是 ipfs（${b}）`, "OpenSea 只认这两种");
  } else if (!b.endsWith("/")) {
    fail(`baseURI 没以斜杠结尾（${b}）`, "tokenURI = baseURI + tokenId，少个斜杠会拼错");
  } else {
    ok(`baseURI ${b}`);
  }
}

// ── 4. 页面里的绝对地址
for (const f of ["index.html", "observatory.html"]) {
  const h = read(f);
  const og = (h.match(/<meta property="og:image" content="([^"]*)"/) || [])[1] || "";
  if (/127\.0\.0\.1|localhost/.test(og)) {
    fail(`${f} 的分享图还指着本机`, "SITE=https://你的域名 npm run site");
  } else if (PLACEHOLDERS.test(og)) {
    fail(`${f} 的分享图还是占位域名（${og}）`, "SITE=https://真实域名 npm run site");
  } else if (!og.startsWith("https://")) {
    fail(`${f} 的分享图不是 https（${og}）`, "SITE=https://你的域名 npm run site");
  } else {
    ok(`${f} 分享图 ${og.replace(/\/metadata.*/, "")}`);
  }
}

// ── 5. 静态分享页也得换过来
const s60 = read(path.join("s", "60.html"));
if (/127\.0\.0\.1|localhost/.test(s60) || PLACEHOLDERS.test(s60)) {
  fail("88 张分享页的地址还没换成真域名", "SITE=https://真实域名 npm run metadata");
} else {
  ok("88 张分享页的地址已经换过");
}

// ── 6. 影子钱包不能在线上出现
const shared = read("shared.js");
if (!shared.includes("ON_LOCALHOST")) {
  fail("影子钱包没有本机限制", "shared.js 里要导出 ON_LOCALHOST，并在两处登台逻辑里判断");
} else {
  const app = read("app.js"), tok = read("token.js");
  const guarded = app.includes("ON_LOCALHOST") && tok.includes("ON_LOCALHOST");
  guarded ? ok("影子钱包只在本机可用") : fail("有页面没接上影子钱包的本机限制", "app.js / token.js 都要判断");
}

// ── 7. 托管配置
for (const f of ["_headers", "_redirects", ".nojekyll", "robots.txt", "sitemap.xml"]) {
  fs.existsSync(path.join(WEB, f)) ? ok(`${f} 在`) : soft(`${f} 缺`, "SITE=… npm run site 会生成 robots/sitemap");
}

// ── 8. 元数据齐不齐
const metaDir = path.join(WEB, "metadata");
const n = fs.existsSync(metaDir) ? fs.readdirSync(metaDir).filter((f) => /^\d+$/.test(f)).length : 0;
n >= 2136 ? ok(`元数据 ${n} 份`) : fail(`元数据只有 ${n} 份，应该 2136`, "npm run metadata");

console.log("─".repeat(46));
if (bad === 0 && warn === 0) console.log("可以上线。\n");
else console.log(`${bad} 项必须解决${warn ? `，${warn} 项建议处理` : ""}。\n`);
process.exitCode = bad ? 1 : 0;
