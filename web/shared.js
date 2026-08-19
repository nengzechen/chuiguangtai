/**
 * 两个页面共用的东西：星空背景、网络表、错误词表。
 * 抽出来是为了让 token.html 和 index.html 的行为不会各说各话。
 */

/*
 * 这不是密钥泄漏。它是 Hardhat 内置助记词的 1 号账号（0x7099…79C8），
 * 全世界每一台装了 Hardhat 的机器上都是同一个，只在本地 31337 链上有钱。
 * 它让本机开发不用装钱包也能走完整流程。
 * 线上永远走不到这条路：需要 chainId 是 31337 **且** 页面本身跑在 localhost。
 */
export // Hardhat 内置助记词的 1 号账号，全世界公开，只在本地链上有钱。见 shared.js 的说明。
const DEMO_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const DEMO_RPC = "http://127.0.0.1:8545";

/** 影子钱包只在本机出现。线上任何情况下都不许走这条路。 */
export const ON_LOCALHOST =
  typeof location !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);

/*
 * 每次进台都要重新登台，所以不再记"上次是不是主动离开的"。
 * 这个常量留着只是为了把旧访客浏览器里那条记录清掉。
 */
export const DISCONNECT_FLAG = "dome:disconnected";

/**
 * 让钱包**每次都问一遍**。
 *
 * eth_requestAccounts 在已经授权过的站点上是静默返回的 —— 用户点了"登台"，
 * 钱包一声不吭就连上了，看起来像是这个站自己有权限。
 * wallet_requestPermissions 会把授权弹窗重新拉起来（顺带让人能换账户）；
 * 老钱包不支持这个方法，那就退回原来的那条路。
 */
export async function askWallet(eth) {
  try {
    await eth.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (e) {
    // 4001 = 用户自己点了拒绝，这不是"不支持"，得原样抛出去
    if (e?.code === 4001) throw e;
  }
  return eth.request({ method: "eth_requestAccounts" });
}

export const CHAINS = {
  4663: {
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  46630: {
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  31337: { name: "本地观测站", rpc: DEMO_RPC, explorer: null, local: true },
};

export const OMENS = {
  DomeSealed: "穹顶尚未开启。等观测窗口开放再来。",
  InscriptionNotOpen: "铭刻阶段还没开始，此刻只能拾星屑。",
  BadQuantity: "一次最多接住两枚，再多就漏下去了。",
  EmberLimitReached: "你已经拾满 14 枚了。观星台不会给第 15 枚。",
  EmbersExhausted: "2048 次观测已经用尽，再没有星屑飘落了。",
  DomeFull: "88 个刻位已经刻满。这片天空不再接受新的名字。",
  AlreadyInscribed: "你已经在穹顶上留过名了。一个人只能刻一次。",
  NoEmberHeld: "你还没亲手拾过星屑。观星台不认钱，只认你来过。",
  WrongPayment: "献纳的数额不对。",
  NotYourSeat: "这个刻位不在你手里。你只能在自己的刻位上题字。",
  NotAConstellation: "星屑上没有刻痕志。只有星座能题字。",
  WordsTooLong: "石壁就这么大，题刻不能超过 140 字节。",
  WordsAlreadyCarved:
    "你这一任的字已经刻上去了。一任只能题一次，刻上去就改不了 —— " +
    "这一席换到下一个人手里时，志上才会多出新的一行。",
  EmptyWords: "空白刻不上石壁。写一句再落刀。",
  ERC721NonexistentToken: "这个编号还不存在。",
  PhaseCannotGoBack: "观测阶段只进不退，宣告过的窗口收不回来。",
  ZeroTreasury: "金库地址不能为空。",
  WithdrawFailed: "献纳没能转出去，稍后再试。",
};

export const short = (s) => s.slice(0, 6) + "…" + s.slice(-4);

function extractErrorData(e) {
  const spots = [
    e?.data, e?.error?.data, e?.info?.error?.data,
    e?.error?.error?.data, e?.info?.error?.error?.data,
  ];
  for (const d of spots) {
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) return d;
    if (typeof d?.data === "string" && d.data.startsWith("0x")) return d.data;
  }
  return null;
}

/** staticCall 之外的最后两道防线：ABI 反解 + 状态推断。 */
export function readOmen(e, fallbackGuess, contract) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) {
    return "你收回了手。什么都没有发生。";
  }
  const name = e?.revert?.name;
  if (name && OMENS[name]) return OMENS[name];

  const data = extractErrorData(e);
  if (data && contract) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed && OMENS[parsed.name]) return OMENS[parsed.name];
      if (parsed) return `观测中断：${parsed.name}`;
    } catch { /* 落到下一道 */ }
  }
  if (fallbackGuess) return fallbackGuess;

  const msg = e?.shortMessage || e?.message || String(e);
  if (/insufficient funds/i.test(msg)) return "余额不足，连 gas 都付不起。";
  if (/missing revert data|CALL_EXCEPTION/i.test(msg)) {
    return "观星台拒绝了这次请求，但没有说明理由。刷新页面后重试。";
  }
  return "观测失败：" + msg;
}

/**
 * 问一句。
 *
 * 不用 window.confirm：那个框长着操作系统的脸，和这一页没有半点关系，
 * 而且它会把整个标签页冻住。这里返回一个 Promise，
 * 默认焦点落在取消上 —— 回车不该替人做那个不可逆的决定。
 *
 * 观星台和藏品页都要问同一句话（题刻不可逆），所以放在这里，两页共用一份。
 * 页面上必须有 #ask 那一小块结构，否则这里直接放行，不挡流程。
 */
export function confirmDialog({ title, body, ok = "确认", cancel = "取消" }) {
  const g = (id) => document.getElementById(id);
  const box = g("ask");
  if (!box) return Promise.resolve(true);

  g("ask-title").textContent = title;
  g("ask-body").textContent = body;
  g("ask-yes").textContent = ok;
  g("ask-no").textContent = cancel;
  box.hidden = false;
  document.body.style.overflow = "hidden";
  g("ask-no").focus();

  return new Promise((resolve) => {
    const done = (v) => {
      box.hidden = true;
      document.body.style.overflow = "";
      box.removeEventListener("click", onClick);
      removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onClick = (e) => {
      if (e.target.closest("#ask-yes")) return done(true);
      if (e.target.closest("[data-askno]")) return done(false);
    };
    // 捕获阶段拦 Esc：不然它会被那个"关掉任何浮层"的全局快捷键先吃掉
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); done(false); }
    };
    box.addEventListener("click", onClick);
    addEventListener("keydown", onKey, true);
  });
}
