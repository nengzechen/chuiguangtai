/**
 * 本地节点出内容，Pinata 只 pin 两个根 CID。
 *
 *   node scripts/ipfs-pin.js
 *
 * ── 为什么绕这一圈 ──
 * 这套藏品是 4274 个文件（2136 张图 + 2138 份 JSON）。
 * 按文件传，免费档一个都放不下：Pinata 上限 500，Filebase 1000。
 *
 * 但 IPFS 的目录本身就是一个 CID。只要内容已经在网络上能被找到，
 * 就可以让 pin 服务"按 CID 收养"整棵树 —— 那只算 **1 个 pin**。
 * 所以流程是：本机跑一个 ipfs 节点把内容放出去，
 * 让 Pinata 从网络上抓走，抓完本机节点就可以关了。
 *
 * 前提：API Key 要有 pinByHash 权限（只勾 pinFileToIPFS 是不够的）。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const JWT = process.env.PINATA_JWT;
const API = "https://api.pinata.cloud";
const H = { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" };

// Pinata 的公开 peer，直连一下比干等 DHT 快得多
const PINATA_PEERS = [
  "/dnsaddr/fra1-1.hostnodes.pinata.cloud",
  "/dnsaddr/fra1-2.hostnodes.pinata.cloud",
  "/dnsaddr/nyc1-1.hostnodes.pinata.cloud",
  "/dnsaddr/nyc1-2.hostnodes.pinata.cloud",
];

const ipfs = (...a) =>
  execFileSync("ipfs", a, { encoding: "utf8", maxBuffer: 1 << 28 }).trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gatewayOk(cid, name) {
  for (const u of [
    `https://gateway.pinata.cloud/ipfs/${cid}/${name}`,
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
  if (!JWT) throw new Error("没有 PINATA_JWT，写进 .env");

  try { ipfs("id"); } catch {
    throw new Error("本地 ipfs 节点没在跑。先开一个：ipfs daemon");
  }

  console.log("连一下 Pinata 的节点（省得干等 DHT）");
  for (const p of PINATA_PEERS) {
    try { ipfs("swarm", "connect", p); console.log(`  ✓ ${p.split("/").pop()}`); }
    catch { console.log(`  · ${p.split("/").pop()} 连不上，跳过`); }
  }

  console.log("\n① 图片加进本地节点");
  const cidImg = ipfs("add", "-r", "-Q", "--cid-version=1", "web/metadata/images");
  console.log(`  ${cidImg}`);

  console.log("\n② 用这个 CID 重新生成元数据");
  execFileSync("node", [path.join("scripts", "gen-metadata.js")], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, IMAGE_BASE: `ipfs://${cidImg}/` },
  });

  console.log("③ JSON 单独摊开再加进去（不能带上 images/，否则 CID 又变了）");
  const stage = path.join(ROOT, "dist", "_json");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, "web", "metadata")))
    if (f.endsWith(".json"))
      fs.copyFileSync(path.join(ROOT, "web", "metadata", f), path.join(stage, f));
  const cidMeta = ipfs("add", "-r", "-Q", "--cid-version=1", "dist/_json");
  console.log(`  ${cidMeta}`);

  console.log("\n④ 让 Pinata 按 CID 收养这两棵树（只占 2 个 pin）");
  for (const [name, cid] of [["images", cidImg], ["metadata", cidMeta]]) {
    const r = await fetch(`${API}/pinning/pinByHash`, {
      method: "POST", headers: H,
      body: JSON.stringify({ hashToPin: cid, pinataMetadata: { name: `chuiguangtai-${name}` } }),
    });
    const t = await r.text();
    if (r.status === 403 && t.includes("NO_SCOPES")) {
      throw new Error(
        "这把 key 没有 pinByHash 权限。\n" +
        "  Pinata → API Keys → New Key → 勾上 pinByHash（pinFileToIPFS 也留着）\n" +
        "  换掉 .env 里的 PINATA_JWT，再重跑本脚本。"
      );
    }
    if (!r.ok) throw new Error(`${name} 提交失败：${r.status} ${t.slice(0, 200)}`);
    console.log(`  ${name.padEnd(9)} 已提交`);
  }

  console.log("\n⑤ 等 Pinata 把内容抓完（本机节点这期间别关）");
  const deadline = Date.now() + 20 * 60 * 1000;
  let done = false;
  while (Date.now() < deadline) {
    const r = await gatewayOk(cidMeta, "1.json");
    if (r.ok) {
      console.log(`  ✓ 网关取到了：${r.json.name}`);
      done = true;
      break;
    }
    process.stdout.write("  · 还在抓，60 秒后再看\n");
    await sleep(60000);
  }
  if (!done) throw new Error("20 分钟还没抓到。本机节点保持开着，过会儿重跑本脚本（CID 不会变）。");

  const base = `ipfs://${cidMeta}/`;
  fs.writeFileSync(path.join(ROOT, "dist", "pinned.json"),
    JSON.stringify({ images: cidImg, metadata: cidMeta, baseURI: base }, null, 2));

  console.log(`
────────────────────────────────────────────
  图片     ipfs://${cidImg}/
  元数据   ipfs://${cidMeta}/
  baseURI  ${base}
────────────────────────────────────────────

换合约：
  BASE=${base} npm run setbase -- --network robinhood

换完之后把站上那份恢复成 https（两份内容各自自洽，互不影响）：
  SITE=https://nengzechen.github.io/chuiguangtai \\
  BASE=https://nengzechen.github.io/chuiguangtai/metadata/ npm run metadata

确认 Pinata 那边显示已 pin 之后，本机节点就可以关了。
`);
}

main().catch((e) => { console.error("\n✗ " + e.message); process.exitCode = 1; });
