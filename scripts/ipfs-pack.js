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


/** 重新生成元数据时必须带上 SITE，否则 external_url 会掉回 localhost。 */
function regenerate(imageBase) {
  const site = process.env.SITE;
  if (!site) {
    throw new Error(
      "没有 SITE。不带它重新生成，2136 件藏品的 external_url 会全变成 " +
      "http://127.0.0.1:8080/… —— 传上链就改不回来了。\n" +
      "  SITE=https://nengzechen.github.io/chuiguangtai node scripts/<本脚本>"
    );
  }
  execFileSync("node", [path.join("scripts", "gen-metadata.js")], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, SITE: site, IMAGE_BASE: imageBase },
  });
  // 自检：图片和外链两样都得对
  const m = JSON.parse(fs.readFileSync(path.join(META, "1.json"), "utf8"));
  if (!m.image.startsWith(imageBase)) throw new Error(`图片地址不对：${m.image}`);
  if (!m.external_url.startsWith(site)) throw new Error(`外链不对：${m.external_url}`);
  return m;
}

fs.mkdirSync(DIST, { recursive: true });

// ── 第一步：图片
console.log("① 打包图片 …");
const imgCar = path.join(DIST, "images.car");
const cidImg = sh(["pack", path.join("web", "metadata", "images"), "--no-wrap", "-o", imgCar]);
console.log(`   ${cidImg}`);
console.log(`   ${(fs.statSync(imgCar).size / 1e6).toFixed(1)} MB → dist/images.car`);

// ── 第二步：拿着图片的 CID 重新生成元数据
console.log("\n② 用这个 CID 重新生成元数据 …");
const sample = regenerate(`ipfs://${cidImg}/`);
console.log(`   #1 image        = ${sample.image}`);
console.log(`   #1 external_url = ${sample.external_url}`);

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
