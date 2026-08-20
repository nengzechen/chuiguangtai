/**
 * 把藏品传到 Pinata，然后把合约的 baseURI 换过去。
 *
 *   PINATA_JWT=… node scripts/ipfs-upload.js
 *
 * ── 为什么不用本机算好的 CAR ──
 * Pinata 的 CAR 上传是付费档功能，免费档只能传文件夹。而文件夹上传的 CID
 * 由服务端的切块方式决定，不一定等于本机 ipfs-car 算出来的那个。
 * 所以这里不预设 CID，**一切以服务端返回的为准**：
 *
 *   ① 传图片            → 拿到真实的 CID_IMG
 *   ② 用 CID_IMG 重新生成元数据（image 字段写 ipfs://CID_IMG/…）
 *   ③ 传元数据          → 拿到真实的 CID_META
 *   ④ 逐个网关确认取得到 → 再让你去换 baseURI
 *
 * 顺序不能反：元数据里写着图片地址，图片不先定下来，元数据就写不出来。
 */
require("dotenv").config();   // JWT 写在 .env 里就行，不用每次都 export
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const META = path.join(ROOT, "web", "metadata");
const IMG = path.join(META, "images");
const API = "https://api.pinata.cloud/pinning/pinFileToIPFS";

const JWT = process.env.PINATA_JWT;
if (!JWT) {
  console.error(`没有 PINATA_JWT。

  1. pinata.cloud 注册（免费档 1GB，够放这 23MB）
  2. 左侧 API Keys → New Key → 勾上 pinFileToIPFS → 复制那串 JWT
  3. 写进 .env：  PINATA_JWT=eyJhbGciOi…
  4. 重跑本脚本`);
  process.exit(1);
}

/** 把一个目录整包传上去，返回服务端给的 CID。 */
async function upload(dir, label) {
  const files = [];
  (function walk(d, prefix) {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(p).isDirectory()) walk(p, rel);
      else files.push({ abs: p, rel });
    }
  })(dir, "");

  const bytes = files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
  console.log(`  ${files.length} 个文件 · ${(bytes / 1e6).toFixed(1)} MB`);

  const form = new FormData();
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    form.append("file", new Blob([buf]), `${label}/${f.rel}`);
  }
  form.append("pinataMetadata", JSON.stringify({ name: label }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pinata ${res.status}：${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  if (!j.IpfsHash) throw new Error(`没拿到 CID：${text.slice(0, 300)}`);
  console.log(`  → ${j.IpfsHash}${j.isDuplicate ? "（已存在，直接复用）" : ""}`);
  return j.IpfsHash;
}

/** 网关上真的取得到吗。多试几家，单家抽风不算数。 */
async function reachable(cid, name) {
  const gws = [
    `https://gateway.pinata.cloud/ipfs/${cid}/${name}`,
    `https://ipfs.io/ipfs/${cid}/${name}`,
    `https://dweb.link/ipfs/${cid}/${name}`,
  ];
  for (const u of gws) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (r.ok) return { ok: true, url: u, res: r };
    } catch { /* 换下一家 */ }
  }
  return { ok: false, url: gws[0] };
}

async function main() {
  console.log("① 传图片");
  const cidImg = await upload(IMG, "images");

  console.log("\n② 用这个 CID 重新生成元数据");
  execFileSync("node", [path.join("scripts", "gen-metadata.js")], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, IMAGE_BASE: `ipfs://${cidImg}/images/` },
  });
  const s = JSON.parse(fs.readFileSync(path.join(META, "1.json"), "utf8"));
  console.log(`  #1 的 image = ${s.image}`);
  if (!s.image.startsWith(`ipfs://${cidImg}/`)) throw new Error("图片地址没换过来，中止");

  console.log("\n③ 传元数据");
  const stage = path.join(ROOT, "dist", "_json");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const f of fs.readdirSync(META)) {
    if (f.endsWith(".json")) fs.copyFileSync(path.join(META, f), path.join(stage, f));
  }
  const cidMeta = await upload(stage, "metadata");
  fs.rmSync(stage, { recursive: true, force: true });

  console.log("\n④ 确认网关取得到（IPFS 传播要一会儿，慢是正常的）");
  for (const name of ["metadata/1.json", "metadata/10001.json", "metadata/contract.json"]) {
    const r = await reachable(cidMeta, name);
    if (!r.ok) throw new Error(`${name} 还取不到（试过 ${r.url}）—— 等两分钟重跑本脚本`);
    const j = await r.res.json();
    console.log(`  ✓ ${name.padEnd(24)} ${j.name || ""}`);
  }

  const base = `ipfs://${cidMeta}/metadata/`;
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "dist", "pinned.json"),
    JSON.stringify({ images: cidImg, metadata: cidMeta, baseURI: base }, null, 2)
  );

  console.log(`
────────────────────────────────────────────
  图片     ipfs://${cidImg}/images/
  元数据   ipfs://${cidMeta}/metadata/
  baseURI  ${base}
────────────────────────────────────────────

换合约（换之前它会再验一次可达性，验不过就不动链上）：

  BASE=${base} npm run setbase -- --network robinhood

站上那份 web/metadata/ 现在写的是 ipfs:// 地址。
要让页面继续走 https，换完之后跑一次：

  SITE=https://nengzechen.github.io/chuiguangtai \\
  BASE=https://nengzechen.github.io/chuiguangtai/metadata/ npm run metadata
`);
}

main().catch((e) => { console.error("\n✗ " + e.message); process.exitCode = 1; });
