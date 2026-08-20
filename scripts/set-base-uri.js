/**
 * 换合约的 baseURI。
 *
 *   BASE=ipfs://<CID>/ npx hardhat run scripts/set-base-uri.js --network robinhood
 *
 * 这是 owner 才能做的事，也是整套里少数几个能救命的开关之一 ——
 * 托管挂了、域名没了、想从自建域名搬到 IPFS，都靠它。
 *
 * 改之前会先替你验一遍新地址真的取得到东西：
 * 把 baseURI 指到一个打不开的地方，等于让所有藏品当场变空白，
 * 而这件事没有任何提示会告诉你，只有藏家会发现。
 */
const hre = require("hardhat");
const { ethers } = hre;

const GATEWAYS = [
  (cid, p) => `https://ipfs.io/ipfs/${cid}/${p}`,
  (cid, p) => `https://dweb.link/ipfs/${cid}/${p}`,
  (cid, p) => `https://cloudflare-ipfs.com/ipfs/${cid}/${p}`,
];

/** 把 ipfs:// 换成能用 fetch 打开的网关地址，逐个试。 */
async function reachable(base, name) {
  const m = base.match(/^ipfs:\/\/([^/]+)\/?$/);
  const urls = m
    ? GATEWAYS.map((g) => g(m[1], name))
    : [base + name];
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (res.ok) return { ok: true, url: u, json: await res.json() };
    } catch { /* 换下一个网关 */ }
  }
  return { ok: false, url: urls[0] };
}

async function main() {
  const base = process.env.BASE;
  if (!base) throw new Error("要给 BASE。例：BASE=ipfs://bafy…/ 或 https://…/metadata/");
  if (!base.endsWith("/")) throw new Error(`BASE 必须以斜杠结尾：tokenURI = BASE + id + ".json"`);
  if (!/^(ipfs|https):\/\//.test(base)) throw new Error("BASE 只能是 ipfs:// 或 https://");

  const dep = require("../web/deployment.json");
  const d = await ethers.getContractAt("Observatory", dep.address);
  const [me] = await ethers.getSigners();

  const owner = await d.owner();
  if (owner !== me.address) throw new Error(`只有 owner 能改。当前 owner 是 ${owner}`);

  console.log(`合约   : ${dep.address}（chainId ${dep.chainId}）`);
  console.log(`现在   : ${await d.tokenURI(1)}`);
  console.log(`要换成 : ${base}1.json`);

  console.log("\n先确认新地址真的取得到 …");
  for (const name of ["1.json", "10001.json", "contract.json"]) {
    const r = await reachable(base, name);
    if (!r.ok) throw new Error(`${name} 取不到（试过 ${r.url}）—— 没换，先把内容 pin 好`);
    const label = r.json.name || "（无 name 字段）";
    console.log(`  ✓ ${name.padEnd(14)} ${label}`);
    if (r.json.image) {
      const img = r.json.image.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/");
      const res = await fetch(img, { method: "HEAD", signal: AbortSignal.timeout(20000) })
        .catch(() => null);
      if (!res || !res.ok) throw new Error(`${name} 里的图打不开：${r.json.image}`);
      console.log(`    图 ${res.status} · ${res.headers.get("content-type")}`);
    }
  }

  console.log("\n换。");
  let tx = await d.setBaseURI(base);
  await tx.wait();
  console.log(`  baseURI  ${tx.hash}`);

  tx = await d.setContractURI(base + "contract.json");
  await tx.wait();
  console.log(`  contractURI  ${tx.hash}`);

  console.log(`\n现在   : ${await d.tokenURI(1)}`);
  console.log(`合集页 : ${await d.contractURI()}`);
  console.log("\nOpenSea 那边的缓存不会立刻刷新，可以在藏品页手动 refresh metadata。");
}

main().catch((e) => { console.error("\n✗ " + (e.shortMessage || e.message)); process.exitCode = 1; });
