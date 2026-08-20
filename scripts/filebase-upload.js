/**
 * 把两个 CAR 包传到 Filebase 的 IPFS bucket。
 *
 *   node scripts/filebase-upload.js
 *
 * ── 为什么是 Filebase + CAR ──
 * 这套藏品 4274 个文件。按文件传，免费档没有一家放得下
 * （Pinata 500、Filebase 的 pin 数也有限）。
 * 但 Filebase 的 S3 接口收 CAR：带上 `import=car` 这个元数据标记上传，
 * 它会把整棵树导进去，**根 CID 原样保留** —— 一个对象装下 2136 张图。
 * CAR 里带着的就是这份内容自己算出来的哈希，所以传到哪都是同一个 CID。
 *
 * 需要 .env 里三样（Filebase → Access Keys / Buckets）：
 *   FILEBASE_KEY / FILEBASE_SECRET / FILEBASE_BUCKET
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const ROOT = path.join(__dirname, "..");
const { FILEBASE_KEY, FILEBASE_SECRET, FILEBASE_BUCKET } = process.env;

if (!FILEBASE_KEY || !FILEBASE_SECRET || !FILEBASE_BUCKET) {
  console.error(`.env 里还缺东西。

  1. filebase.com 注册（免费档 5GB）
  2. Buckets → Create Bucket → **Network 选 IPFS**，名字随便（比如 chuiguangtai）
  3. Access Keys → 复制 Key 和 Secret
  4. 写进 .env：
       FILEBASE_KEY=…
       FILEBASE_SECRET=…
       FILEBASE_BUCKET=你刚建的桶名`);
  process.exit(1);
}

const s3 = new S3Client({
  region: "us-east-1",
  endpoint: "https://s3.filebase.com",
  credentials: { accessKeyId: FILEBASE_KEY, secretAccessKey: FILEBASE_SECRET },
  forcePathStyle: true,
});

/** 传一个 CAR，返回 Filebase 记下来的根 CID。 */
async function putCar(file, key) {
  const body = fs.readFileSync(file);
  console.log(`  ${path.basename(file)} · ${(body.length / 1e6).toFixed(1)} MB`);

  await s3.send(new PutObjectCommand({
    Bucket: FILEBASE_BUCKET,
    Key: key,
    Body: body,
    // 这一行是关键：告诉 Filebase 这是 CAR，按整棵树导入，别当普通文件
    Metadata: { import: "car" },
  }));

  const head = await s3.send(new HeadObjectCommand({ Bucket: FILEBASE_BUCKET, Key: key }));
  const cid = head.Metadata?.cid;
  if (!cid) throw new Error(`没拿到 CID，Filebase 返回的元数据：${JSON.stringify(head.Metadata)}`);
  console.log(`  → ${cid}`);
  return cid;
}

async function gatewayOk(cid, name) {
  for (const u of [
    `https://ipfs.filebase.io/ipfs/${cid}/${name}`,
    `https://ipfs.io/ipfs/${cid}/${name}`,
    `https://dweb.link/ipfs/${cid}/${name}`,
  ]) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return { ok: true, url: u, json: await r.json() };
    } catch { /* 换下一家 */ }
  }
  return { ok: false };
}

async function main() {
  const local = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "cids.json"), "utf8"));
  console.log("本机算出来的 CID（传完要一模一样，不一样就说明 CAR 没被当 CAR 收）");
  console.log(`  图片    ${local.images}`);
  console.log(`  元数据  ${local.metadata}\n`);

  console.log("① 传图片");
  const cidImg = await putCar(path.join(ROOT, "dist", "images.car"), "images.car");
  if (cidImg !== local.images) {
    throw new Error(`CID 对不上！本机 ${local.images}，Filebase ${cidImg}\n` +
      "多半是 import=car 没生效（桶不是 IPFS 类型？），别往下走。");
  }

  console.log("\n② 传元数据");
  const cidMeta = await putCar(path.join(ROOT, "dist", "metadata.car"), "metadata.car");
  if (cidMeta !== local.metadata) {
    throw new Error(`CID 对不上！本机 ${local.metadata}，Filebase ${cidMeta}`);
  }

  console.log("\n③ 网关确认（刚传完可能要等一会儿）");
  for (const name of ["1.json", "10001.json", "contract.json"]) {
    const r = await gatewayOk(cidMeta, name);
    if (!r.ok) throw new Error(`${name} 还取不到 —— 等两分钟重跑，CID 不会变`);
    console.log(`  ✓ ${name.padEnd(14)} ${r.json.name || ""}`);
  }

  const base = `ipfs://${cidMeta}/`;
  fs.writeFileSync(path.join(ROOT, "dist", "pinned.json"),
    JSON.stringify({ images: cidImg, metadata: cidMeta, baseURI: base, host: "filebase" }, null, 2));

  console.log(`
────────────────────────────────────────────
  baseURI  ${base}
────────────────────────────────────────────

换合约（换之前它会再验一次可达性）：
  BASE=${base} npm run setbase -- --network robinhood
`);
}

main().catch((e) => { console.error("\n✗ " + (e.message || e)); process.exitCode = 1; });
