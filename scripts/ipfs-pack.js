/**
 * 把藏品打成两个 CAR 包，算出确定的 CID —— 本机就能算，不需要任何账号。
 *
 * 为什么是两步：CID 是内容的哈希。元数据 JSON 里写着图片的地址，
 * 所以图片必须先定 CID，元数据才能写得出来；元数据写完了才能算它自己的 CID。
 * 一步到位会变成"CID 依赖内容、内容依赖 CID"的死结。
 *
 *   node scripts/ipfs-pack.js
 *
 * 产出 dist/images.car 和 dist/metadata.car，以及最终的 baseURI。
 * 这两个包上传到任意 pin 服务（Pinata / Storacha 都收 CAR）之后，
 * CID 不会变 —— CAR 里带着的就是这份内容算出来的哈希。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const META = path.join(ROOT, "web", "metadata");
const DIST = path.join(ROOT, "dist");
const STAGE = path.join(DIST, "_json");

const sh = (args) =>
  execFileSync("npx", ["--no-install", "ipfs-car", ...args], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28,
  }).trim();

fs.mkdirSync(DIST, { recursive: true });

// ── 第一步：图片
console.log("① 打包图片 …");
const imgCar = path.join(DIST, "images.car");
const cidImg = sh(["pack", path.join("web", "metadata", "images"), "--no-wrap", "-o", imgCar]);
console.log(`   ${cidImg}`);
console.log(`   ${(fs.statSync(imgCar).size / 1e6).toFixed(1)} MB → dist/images.car`);

// ── 第二步：拿着图片的 CID 重新生成元数据
console.log("\n② 用这个 CID 重新生成元数据 …");
execFileSync("node", [path.join("scripts", "gen-metadata.js")], {
  cwd: ROOT,
  stdio: "ignore",
  env: { ...process.env, IMAGE_BASE: `ipfs://${cidImg}/` },
});
const sample = JSON.parse(fs.readFileSync(path.join(META, "1.json"), "utf8"));
console.log(`   #1 的 image = ${sample.image}`);
if (!sample.image.startsWith(`ipfs://${cidImg}/`)) {
  throw new Error("元数据里的图片地址没换成 IPFS，中止");
}

// ── 第三步：把 JSON 单独摊到一个目录里打包（不能带上 images/，否则 CID 又变了）
console.log("\n③ 打包元数据 …");
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(META)) {
  if (f.endsWith(".json")) { fs.copyFileSync(path.join(META, f), path.join(STAGE, f)); n++; }
}
const metaCar = path.join(DIST, "metadata.car");
const cidMeta = sh(["pack", path.relative(ROOT, STAGE), "--no-wrap", "-o", metaCar]);
console.log(`   ${n} 个 JSON · ${cidMeta}`);
console.log(`   ${(fs.statSync(metaCar).size / 1e6).toFixed(1)} MB → dist/metadata.car`);
fs.rmSync(STAGE, { recursive: true, force: true });

console.log(`
────────────────────────────────────────────
  图片      ipfs://${cidImg}/
  元数据    ipfs://${cidMeta}/
  baseURI   ipfs://${cidMeta}/
────────────────────────────────────────────

接下来：
  1. 把 dist/images.car 和 dist/metadata.car 传到 pin 服务
     （Pinata 免费档 1GB；上传 CAR 而不是文件夹，CID 才不会变）
  2. 传完拿这两个 CID 各访问一次网关确认能取到：
     https://ipfs.io/ipfs/${cidMeta}/1.json
  3. 换合约的 baseURI：
     BASE=ipfs://${cidMeta}/ npx hardhat run scripts/set-base-uri.js --network robinhood
`);

fs.writeFileSync(
  path.join(DIST, "cids.json"),
  JSON.stringify({ images: cidImg, metadata: cidMeta, baseURI: `ipfs://${cidMeta}/` }, null, 2)
);
