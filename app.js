import { ethers } from "./vendor/ethers.js";
import { seatPositions, wallChrome, asterismGlyph } from "./dome.js?v=85c127cd";
import { toast } from "./toast.js?v=0d4cc83d";
import { CODEX, GRADE_LINE, RANKS, rankOf, TIMELINE, GLOSSARY, FAQ }
  from "./content.js?v=2c67cd39";
import { askWallet, confirmDialog, ON_LOCALHOST, notOpenYet, metaUrl,
  IS_MOBILE, openWalletSheet, injectedProvider, noticeDialog, warnIfStale, staleBanner } from "./shared.js?v=66b4a74a";

// ═══════════════════════════════════════════════════════ 常量

// Hardhat 内置助记词的 1 号账号，全世界公开，只在本地链上有钱。见 shared.js 的说明。
const DEMO_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const DEMO_RPC = "http://127.0.0.1:8545";
const DISCONNECT_FLAG = "dome:disconnected";

const CHAINS = {
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

const PHASES = [
  { label: "闭台", note: "穹顶尚未开凿" },
  { label: "拾屑", note: "星屑正在飘落" },
  { label: "铭刻", note: "穹顶开放，可留名" },
];

const EMBER_SUPPLY = 2048;
const CONSTELLATION_SUPPLY = 88;
const EMBER_PER_WALLET = 14;   // 一个钱包总共能亲手拾多少枚
const EMBER_PER_DAY = 2;       // 一天能拾多少枚。14 ÷ 2 = 来七天
const EMBERS_PER_SEAT = 14;    // 交出多少枚换一个刻位
const FREE_SEATS = 22;         // 88 席里留给"交星屑"这条路的名额
const CON_OFFSET = 10000;
const FEED_PAGE = 20;
/** 题刻的字数上限。链上的硬上限是 140 字节，46 个汉字正好落在里面 */
const CARVE_CHARS = 46;

/** 合约自定义错误 → 观星台口吻。这是提示器的词表。 */
const OMENS = {
  DomeSealed: "穹顶尚未开凿。等观测窗口开放再来。",
  InscriptionNotOpen: "铭刻阶段还没开始，此刻只能拾星屑。",
  BadQuantity: "一次最多接住两枚，再多就漏下去了。",
  EmberLimitReached: "你已经拾满 14 枚了。观星台不会给第 15 枚。",
  DailyLimitReached: "今天的两枚已经拾过了。明天再来。",
  FreeSeatsGone: "能用星屑换的 22 个刻位已经换完了。剩下的席位要献纳。",
  NotEnoughEmbers: "你亲手拾的还不到 14 枚。买来的不算 —— 观星台只认你来过。",
  BadOffering: "要交出的是整整 14 枚，不多不少。",
  NotYourEmber: "这枚星屑不在你手里。",
  NotAnEmber: "交出来的必须是星屑。",
  EmbersExhausted: "2048 次观测已经用尽，再没有星屑飘落了。",
  DomeFull: "88 个刻位已经刻满。这片天空不再接受新的名字。",
  AlreadyInscribed: "你已经在穹顶上留过名了。一个人只能刻一次。",
  NoEmberHeld: "你还没亲手拾过星屑。观星台不认钱，只认你来过。",
  WrongPayment: "献纳的数额不对。",
  NotYourSeat: "这个刻位不在你手里。你只能在自己的刻位上题字。",
  NotAConstellation: "星屑上没有刻痕志。只有星座能题字。",
  WordsTooLong: "内壁就这么大，这行字太长了，删掉几个再刻。",
  ERC721NonexistentToken: "这个编号还不存在。",
};


// ═══════════════════════════════════════════════════════ 状态

const $ = (id) => document.getElementById(id);
const state = {
  qty: 1, demo: false, connected: false,
  connecting: false,
  metaCache: new Map(),
  discovered: new Set(), // 亲手拾到过的遗迹档位，决定图鉴解锁
};

// ═══════════════════════════════════════════════════════ 工具

const short = (s) => s.slice(0, 6) + "…" + s.slice(-4);
const addrLink = (a) => `<a class="addrlink" href="keeper.html?a=${a}">${short(a)}</a>`;

/** 写值并摘掉骨架，避免"先空后填"的跳动。 */
function setVal(id, text) {
  const el = $(id);
  el.textContent = text;
  el.classList.remove("loading");
}

function markLoading() {
  document.querySelectorAll(".sk").forEach((el) => el.classList.add("loading"));
}

function log(msg, kind = "") {
  const n = new Date();
  const t = [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
  const row = document.createElement("div");
  row.className = "row " + kind;
  row.innerHTML = `<span class="t">${t}</span><span class="m">${msg}</span>`;
  const box = $("log");
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function txLink(hash) {
  return state.dep?.explorer
    ? ` <a href="${state.dep.explorer}/tx/${hash}" target="_blank">↗</a>`
    : "";
}

/** 元数据缓存：穹顶、灯箱、动态都会重复读同一批 token。 */
async function meta(tokenId) {
  const key = String(tokenId);
  if (state.metaCache.has(key)) return state.metaCache.get(key);
  const p = fetch(metaUrl(state.dep, key))
    .then((r) => r.json())
    .catch(() => null);
  state.metaCache.set(key, p);
  return p;
}

const traitOf = (m, name) =>
  m?.attributes?.find((a) => a.trait_type === name)?.value ?? "—";

// ═══════════════════════════════════════════════════════ 错误解码

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

/**
 * "missing revert data" 的根因是 estimateGas 失败但节点没回 revert 数据。
 * 三道防线：staticCall 干跑 → ABI 反解自定义错误 → 客户端状态推断。
 */
function readOmen(e, fallbackGuess) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) {
    return "你收回了手。什么都没有发生。";
  }
  const name = e?.revert?.name;
  if (name && OMENS[name]) return OMENS[name];

  const data = extractErrorData(e);
  if (data && state.nft) {
    try {
      const parsed = state.nft.interface.parseError(data);
      if (parsed && OMENS[parsed.name]) return OMENS[parsed.name];
      if (parsed) return `观测中断：${parsed.name}`;
    } catch { /* 落到下一道防线 */ }
  }

  if (fallbackGuess) return fallbackGuess;

  const msg = e?.shortMessage || e?.message || String(e);
  if (/insufficient funds|doesn't have enough funds|enough funds to send/i.test(msg)) {
    /*
     * 本地链只给它自己生成的那几个账户发钱。
     * 你从 MetaMask 里连进来的地址余额是 0，而且每次重启链都会清空 ——
     * 光说"余额不足"等于没说，得把解法一起给出来。
     */
    if (CHAINS[state.dep?.chainId]?.local) {
      const who = state.account || "0x你的地址";
      return `这个地址在本地链上没有余额（连手续费都付不起）。` +
             `在项目目录里跑：FUND_TO=${who} npm run fund`;
    }
    return "余额不足，连 gas 都付不起。";
  }
  if (/missing revert data|CALL_EXCEPTION/i.test(msg)) {
    return "观星台拒绝了这次请求，但没有说明理由。刷新页面后重试。";
  }
  return "观测失败：" + msg;
}

async function preflight(fn, args, overrides) {
  await state.nft[fn].staticCall(...args, overrides);
}

// ═══════════════════════════════════════════════════════ 启动

/**
 * 启动顺序的原则：**首屏不等链**。
 * 骨架和穹顶先画出来，链上数字用微光条占位、到了再填。
 * 动态和藏品这类"看得晚也没关系"的，推到 idle 再拉。
 */
async function boot() {
  document.documentElement.classList.add("observatory-loading");
  markLoading();
  buildDome();
  buildFaq();
  buildRanks();
  bindUI();
  buildCodex();

  log("垂光台控制台就绪");

  try {
    state.dep = await (await fetch("deployment.json")).json();
  } catch {
    log("读不到这座台的登记信息，观测站可能没在运行。", "bad");
    document.documentElement.classList.remove("observatory-loading");

  // 手里这份页面是不是缓存的旧版 —— 是的话当场说，别让人对着上一版的行为发懵
  warnIfStale(() => {
    staleBanner();
    log("检测到你手里这份页面不是最新的（浏览器缓存）。点顶部那条横幅上的【刷新】。", "bad");
  });
    return;
  }

  if (notOpenYet(state.dep)) {
    // 站在公网上，但合约还没上公开的链。老实说，别让人白点一遍登台。
    sealShut();
    document.documentElement.classList.remove("observatory-loading");

  // 手里这份页面是不是缓存的旧版 —— 是的话当场说，别让人对着上一版的行为发懵
  warnIfStale(() => {
    staleBanner();
    log("检测到你手里这份页面不是最新的（浏览器缓存）。点顶部那条横幅上的【刷新】。", "bad");
  });
    return;
  }

  $("addr").textContent =
    state.dep.address.slice(0, 8) + "…" + state.dep.address.slice(-6);
  $("netname").textContent =
    CHAINS[state.dep.chainId]?.name || `Chain ${state.dep.chainId}`;
  if (state.dep.explorer) {
    const a = $("explorer");
    a.href = `${state.dep.explorer}/address/${state.dep.address}`;
    a.hidden = false;
  }

  // 名录和链上状态互不依赖，并行拉。
  // 预览图必须等在后面 —— 它要根据 state.inscribed 算"下一席是哪个星座"，
  // 并行会读到还没回填的 0，把预览定死在第 1 席。
  await Promise.all([loadNames(), readOnlySurvey()]);
  await loadPreviews();

  /*
   * 不自动登台。
   * 每次进来都是"没登台"的状态，要动手才连钱包 ——
   * 一个人打开网页，不等于他同意把地址交出来。
   */
  localStorage.removeItem(DISCONNECT_FLAG);   // 清掉旧版本留在浏览器里的那条记录
  log("还没登台。要拾星屑或铭刻，先点右上角【登台】。");
  document.documentElement.classList.remove("observatory-loading");

  // 手里这份页面是不是缓存的旧版 —— 是的话当场说，别让人对着上一版的行为发懵
  warnIfStale(() => {
    staleBanner();
    log("检测到你手里这份页面不是最新的（浏览器缓存）。点顶部那条横幅上的【刷新】。", "bad");
  });

  // 看得晚也无所谓的，等浏览器闲一下再拉。
  // 但必须给 timeout —— 星野 canvas 每帧都在 rAF，浏览器几乎没有真正的空闲期，
  // 不带 timeout 的 requestIdleCallback 会被饿到六七秒后才触发。
  const idle = window.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 200);
  idle(() => {
    loadRoster();
    loadFeed();
  });
}

/** 88 个刻位的名字与天区，一次读完。 */
async function loadNames() {
  try {
    state.names = await (await fetch("metadata/names.json")).json();
  } catch {
    state.names = [];
  }
}

// ═══════════════════════════════════════════════════════ 静态区块

/**
 * 穹顶内壁：从顶心往下四道肋环，12 + 20 + 26 + 30 = 88。
 * 第一批铭刻的人落在最靠近顶心的那道环上 ——
 * 位置本身就是先来后到的记录，而且越靠顶心的环越短、越难得。
 */
function buildDome() {
  const pts = seatPositions();
  state.seatPts = pts;

  const seats = pts
    .map(
      (p, i) => `<g class="seat-g r${i % 3}" data-n="${i + 1}"
                    role="button" tabindex="0" aria-label="第 ${i + 1} 刻"
                    transform="translate(${p.x} ${p.y})">
        <rect class="hit" x="-14" y="-16" width="28" height="32" fill="transparent"/>
        <g class="glyph">
          <!-- 龛：拱顶的凹室。方块从形状上就不是它 -->
          <path class="recess" d="M-11 13V-2A11 11 0 0 1 11 -2V13Z"/>
          <path class="cut" d="M-7.6 10V-1.6A7.6 7.6 0 0 1 7.6 -1.6V10Z"/>
          <g class="asterism"></g>
        </g>
      </g>`
    )
    .join("");

  $("domesvg").innerHTML = `${wallChrome()}
    <g id="kinlines"></g>
    <g id="seats">${seats}</g>
    <g id="reticle" class="reticle" hidden>
      <rect class="ret-ring" x="-15" y="-14" width="30" height="28" rx="3"/>
      <path class="ret-tick" d="M0 -22V-17M0 22V17M-22 0H-17M22 0H17"/>
    </g>`;

  const svg = $("domesvg");
  svg.addEventListener("mouseover", (e) => {
    const g = e.target.closest(".seat-g");
    if (g) showSeatTip(Number(g.dataset.n));
  });
  svg.addEventListener("mouseout", (e) => {
    if (e.target.closest(".seat-g")) $("seattip").hidden = true;
  });
  svg.addEventListener("keydown", (e) => {
    const g = e.target.closest(".seat-g");
    if (!g) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSeat(Number(g.dataset.n));
    }
  });
  svg.addEventListener("focusin", (e) => {
    const g = e.target.closest(".seat-g");
    if (g) showSeatTip(Number(g.dataset.n));
  });
}

/** 老浏览器的 scrollTo 不认 options 对象，探一次并缓存结果。 */
let _smooth;
function supportsSmooth() {
  if (_smooth !== undefined) return _smooth;
  _smooth = false;
  try {
    window.scrollTo({
      top: scrollY,
      get behavior() {
        _smooth = true;
        return "auto";
      },
    });
  } catch {
    _smooth = false;
  }
  return _smooth;
}

/**
 * 把席位详情滚进视野。
 * 不用 scrollIntoView({behavior:"smooth"}) —— 它在后台标签页会被节流成不动，
 * 而且 block:"nearest" 的语义在长页面里不好预测。自己算目标位置更可控。
 */
function revealSeatPanel() {
  const el = $("seat");
  const box = el.getBoundingClientRect();
  const fullyVisible = box.top >= 0 && box.bottom <= innerHeight;
  if (fullyVisible) return;

  const target = Math.max(0, box.top + scrollY - Math.max(16, innerHeight * 0.18));
  const smooth =
    !matchMedia("(prefers-reduced-motion: reduce)").matches && supportsSmooth();
  window.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
}

/** 悬停名牌：告诉你这一席是谁、有没有人。 */
function showSeatTip(n) {
  const tip = $("seattip");
  const info = (state.names || [])[n - 1];
  if (!info) return;

  const owner = (state.seatOwners || [])[n - 1];
  const p = state.seatPts[n - 1];
  const svg = $("domesvg");
  const box = svg.getBoundingClientRect();
  const scale = box.width / 900;

  tip.innerHTML =
    `<b>${info.zh}</b><span>第 ${String(n).padStart(2, "0")} 刻 · ${info.region}</span>` +
    `<i>${owner ? short(owner) : "空席"}</i>`;
  tip.style.left = `${p.x * scale}px`;
  tip.style.top = `${p.y * scale - 14}px`;
  tip.className = "seattip r" + ((n - 1) % 3) + (owner ? " taken" : "");
  tip.hidden = false;
}

function buildCodex() {
  if (!$("codexlist")) return;
  const found = state.discovered || new Set();

  $("codexlist").innerHTML = CODEX.map((c) => {
    const got = found.has(c.tier);
    return `<div class="codexrow ${got ? "" : "locked"}" data-token="${got ? c.sample : ""}">
      <div class="codexart">
        <img src="metadata/images/ember/${c.sample}.svg" alt="" loading="lazy"/>
        ${got ? "" : '<span class="lock">?</span>'}
      </div>
      <div>
        <div class="codexname">${got ? c.name : "？ ？ ？"}
          <span class="codexlatin">${got ? c.latin.toUpperCase() : "UNDISCOVERED"}</span>
        </div>
        <p class="codexlore">${got ? c.lore : "尚未拾得。这一档的样子，得自己撞上才知道。"}</p>
      </div>
      <div class="codexpct">
        <span class="tiergauge" aria-label="稀有度 ${c.tier} / 7">${
          Array.from({ length: 7 }, (_, k) =>
            `<i class="${k < c.tier ? "on" : ""}"></i>`).join("")
        }</span>
        <b>${got ? c.grade : "—"}</b>
      </div>
    </div>`;
  }).join("");

  $("codexcount").innerHTML = `<b>${found.size}</b><i>/ 7 已发现</i>`;
  const hint = $("codexhint");
  if (hint) {
    hint.textContent = `图鉴 ${found.size} / 7 已发现 ↗`;
    hint.classList.toggle("full", found.size === 5);
  }
}

function buildTimeline() {
  $("timeline").innerHTML = TIMELINE.map(
    ([era, title, body], i) => `<li class="tl-item ${i === TIMELINE.length - 1 ? "now" : ""}">
      <div class="tl-era">${era}</div>
      <div class="tl-body">
        <b>${title}</b>
        <p>${body}</p>
      </div>
    </li>`
  ).join("");
}

function buildRanks() {
  buildTimeline();
  buildGlossary();
  $("ranklist").innerHTML = [...RANKS]
    .reverse()
    .map(
      (r) => `<div class="rankrow ${r.cls}">
        <b>${r.name}</b>
        <span>${r.latin}</span>
        <i>${r.min === 16 ? "16 席以上" : r.min === 1 ? "1 席" : `${r.min}–${nextMin(r) - 1} 席`}</i>
      </div>`
    )
    .join("");
}

/** 阶梯上一档的门槛，用来算出区间。 */
function nextMin(r) {
  const idx = RANKS.findIndex((x) => x.min === r.min);
  return idx > 0 ? RANKS[idx - 1].min : Infinity;
}

function buildGlossary() {
  $("glossary").innerHTML = GLOSSARY.map(
    ([term, def]) => `<dt>${term}</dt><dd>${def}</dd>`
  ).join("");
}

function buildFaq() {
  $("faq").innerHTML = FAQ.map(
    ([q, a]) => `<details class="qa"><summary>${q}</summary><p>${a}</p></details>`
  ).join("");
}

function bindUI() {
  $("connect").onclick = () => connect({ silent: false });
  $("disconnect").onclick = disconnect;
  $("minus").onclick = () => setQty(state.qty - 1);
  $("plus").onclick = () => setQty(state.qty + 1);
  $("claim").onclick = claimEmbers;
  $("inscribe").onclick = inscribe;
  $("offer").onclick = offerEmbers;

  // 穹顶刻位
  $("domesvg").addEventListener("click", async (e) => {
    const g = e.target.closest(".seat-g");
    if (!g) return;
    await openSeat(Number(g.dataset.n));
    // 触屏没有悬停名牌，点完得让详情自己送到眼前，
    // 否则用户点了一颗星，什么反应都看不到（详情在一屏之外）。
    if (matchMedia("(hover: none)").matches) revealSeatPanel();
  });
  $("focusclear").onclick = () => {
    clearFocus();
    document.querySelectorAll(".seat-g.active").forEach((el) =>
      el.classList.remove("active")
    );
    $("seat").hidden = true;
  };

  // 放大：预览图、图鉴、收藏
  document.querySelectorAll(".zoombtn").forEach((b) => {
    b.onclick = () => {
      const art = $(b.dataset.zoomFor);
      if (art.dataset.zoomToken) openLightbox(art.dataset.zoomToken);
    };
  });
  document.querySelectorAll(".art.zoomable").forEach((a) => {
    a.onclick = () => a.dataset.zoomToken && openLightbox(a.dataset.zoomToken);
  });
  $("seat-zoom").onclick = () => state.seatToken && openLightbox(state.seatToken);
  $("carve-input").addEventListener("input", updateCarveCount);

  // 灯箱关闭
  startScrollSpy();

  $("feedfilter").addEventListener("click", (e) => {
    const b = e.target.closest(".seg");
    if (!b) return;
    state.feedKind = b.dataset.kind;
    state.feedShown = FEED_PAGE; // 换了类型就从头看
    document.querySelectorAll("#feedfilter .seg").forEach((x) => {
      const on = x === b;
      x.classList.toggle("on", on);
      x.setAttribute("aria-selected", String(on));
    });
    renderFeed();
  });

  // 写着"图鉴"的链接就该去图鉴。它以前打开的是观测手册 ——
  // 手册里没有图鉴，点了只会让人找不着北
  $("codexhint").onclick = (e) => {
    e.preventDefault();
    $("codex").scrollIntoView({ block: "start" });
  };
  $("openmanual").onclick = (e) => {
    e.preventDefault();
    buildCodex();
    $("manual").hidden = false;
    document.body.style.overflow = "hidden";
  };
  $("manual").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-mnclose")) {
      $("manual").hidden = true;
      document.body.style.overflow = "";
    }
    const row = e.target.closest(".codexrow:not(.locked)");
    if (row && row.dataset.token) openLightbox(row.dataset.token);
  });

  $("reveal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-rvclose")) return closeReveal();
    const c = e.target.closest(".rv-card.open");
    if (c) { closeReveal(); openLightbox(c.dataset.token); }
  });
  $("lightbox").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeLightbox();
  });
  // 快捷键。只做三个，多了没人记得住。
  addEventListener("keydown", (e) => {
    const typing = /input|textarea/i.test(e.target.tagName);
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        $("openmanual").click();
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        $("dome").scrollIntoView({ block: "start" });
        toast("已跳到穹顶");
        return;
      }
    }
    if (e.key !== "Escape") return;
    closeLightbox();
    closeReveal();
    if (!$("manual").hidden) {
      $("manual").hidden = true;
      document.body.style.overflow = "";
    }
  });

  if (injectedProvider()) {
    injectedProvider().on?.("accountsChanged", (a) => {
      if (!a.length) return disconnect({ silent: true });
      log("检测到换了一双手，重新登台");
      connect({ silent: true });
    });

    /*
     * 换网络：在原地重连，**不刷新页面**。
     *
     * 这里原本是 `location.reload()`，那是一个会自己咬住自己的死循环：
     * 钱包在页面初始化时也会播一次 chainChanged（本地链重启、
     * 节点被重新部署、RPC 短暂不可达都会触发），于是
     * 播报 → 刷新 → 钱包重新初始化 → 再播报 → 再刷新，永远停不下来。
     * 控制台上看就是 observatory.html 被反复导航，每轮都跑一遍 boot()。
     *
     * 两道闸：记住上一次的链号，重复播报直接丢掉；页面刚起来的头 1.5 秒
     * 一律不响应 —— 那个窗口里的事件几乎都是钱包在自我介绍，不是用户换了网络。
     */
    let lastChain = null;
    const booted = Date.now();
    injectedProvider()
      .request?.({ method: "eth_chainId" })
      .then((c) => { lastChain = c; })
      .catch(() => {});

    injectedProvider().on?.("chainChanged", (cid) => {
      if (cid === lastChain) return;
      if (Date.now() - booted < 1500) { lastChain = cid; return; }
      lastChain = cid;

      log("检测到换了网络，正在重新连接…");
      Object.assign(state, { connected: false, signer: null, account: null, demo: false });
      state.nft = state.reader;
      connect({ silent: true });
    });
  }
}

/**
 * 导航跟随阅读位置点亮。
 * 用 IntersectionObserver 而不是 scroll 事件 —— 后者每帧都要读布局，
 * 在这个长页面上是白白的性能开销。
 */
function startScrollSpy() {
  // 只收真正指向某个区块的链接。手册那条是 href="#"，
  // 直接丢给 querySelector 会抛 "'#' is not a valid selector"。
  const links = [...document.querySelectorAll(".nav a[href^='#']")].filter(
    (a) => a.getAttribute("href").length > 1
  );
  const map = new Map();
  for (const a of links) {
    const el = document.querySelector(a.getAttribute("href"));
    if (el) map.set(el, a);
  }
  if (!map.size) return;

  const seen = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) seen.add(e.target);
        else seen.delete(e.target);
      }
      // 同时有多个区块在视野里时，取最靠上的那个
      let top = null;
      for (const el of seen) {
        if (!top || el.getBoundingClientRect().top < top.getBoundingClientRect().top) {
          top = el;
        }
      }
      // CSS 认的是 .on（和 hover 同一套），别再造第二个名字
      links.forEach((a) => a.classList.remove("on"));
      if (top) map.get(top)?.classList.add("on");
    },
    { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
  );
  map.forEach((_, el) => io.observe(el));
}

// ═══════════════════════════════════════════════════════ 连接

async function readOnlySurvey() {
  const info = CHAINS[state.dep.chainId];
  if (!info) return;
  try {
    const provider = new ethers.JsonRpcProvider(info.rpc, state.dep.chainId);
    const ro = new ethers.Contract(state.dep.address, state.dep.abi, provider);
    state.reader = ro;
    state.nft = state.nft || ro;
    paintSurvey(await ro.survey(ethers.ZeroAddress), { anonymous: true });
    await paintDome();
  } catch {
    log("读不到链上状态，观测站可能没在运行", "bad");
  }
}

/**
 * 登台失败要让人看见。
 *
 * 这些路径以前只写 log ——而控制台在页面底部，用户点的是右上角的按钮，
 * 眼睛还在按钮上，反馈却出现在两屏之外，看起来就是"点了没反应"。
 * toast.js 开头那段话说的就是这件事，只是当时没落到这里。
 */
function failLoud(short, detail) {
  log(detail || short, "bad");
  toast(short, "bad");
}

/** 桌面上没有钱包插件时的说明。toast 只闪一下，装不下这段话。 */
function openNoWalletHint() {
  noticeDialog({
    title: "没检测到钱包插件",
    body:
      "这一页需要一个浏览器钱包（比如 MetaMask）才能登台。\n\n" +
      "如果你已经装了，多半是因为在无痕窗口里 —— Chrome 默认不让扩展在无痕模式下运行，" +
      "所以页面根本看不到它。两条路：\n\n" +
      "· 打开 chrome://extensions，找到 MetaMask，开启「在无痕模式下启用」\n" +
      "· 或者换一个普通窗口打开这一页\n\n" +
      "还没装钱包的话，先装一个再回来。",
    ok: "知道了",
  });
}

async function connect({ silent }) {
  // 钱包在授权/切链时可能连续触发 accountsChanged 和 chainChanged。
  // 同一时间只允许一条连接流程写 UI，避免按钮、阶段和统计值来回重绘。
  if (state.connecting) return;
  state.connecting = true;
  try {
    return await connectFlow({ silent });
  } finally {
    state.connecting = false;
  }
}

async function connectFlow({ silent }) {
  const { chainId } = state.dep;

  if (injectedProvider()) {
    const browser = new ethers.BrowserProvider(injectedProvider());
    try {
      /*
       * 手动点【登台】时走 askWallet：它会把钱包的授权弹窗重新拉起来。
       * 之前用 eth_requestAccounts，授权过的浏览器上点一下就静默连上了 ——
       * 那不是"登台"，那是这个站替你做了主。
       * silent 只用于钱包自己通知换了账户/换了链时的原地重连。
       */
      const accts = silent
        ? await browser.send("eth_accounts", [])
        : await askWallet(injectedProvider());
      if (!accts.length) {
        if (!silent) failLoud("钱包里没有可用账户");
        return;
      }
      const net = await browser.getNetwork();
      if (Number(net.chainId) !== chainId) {
        if (silent) return;
        log(`正在切换到 ${CHAINS[chainId]?.name || chainId}…`);
        await switchChain(chainId);
        return connectFlow({ silent: true });
      }
      state.signer = await browser.getSigner();
      state.account = await state.signer.getAddress();
      state.demo = false;
    } catch (e) {
      if (!silent) failLoud(readOmen(e));
      return;
    }
  } else {
    if (!CHAINS[chainId]?.local || !ON_LOCALHOST) {
      /*
       * 手机浏览器不注入钱包，只有钱包 App 自带的浏览器才有。
       * 所以这里不能只说"没检测到钱包"就完 —— 那是把人堵死在门口。
       * 给一层"在钱包里打开"，把这一页深链进钱包的浏览器。
       */
      if (IS_MOBILE) {
        failLoud("手机上要在钱包 App 里打开这一页");
        openWalletSheet();
      } else {
        /*
         * 别再说"装一个 MetaMask"—— 最常撞上这条的人其实**装了**，
         * 只是在无痕窗口里：Chrome 默认不让扩展在无痕模式下运行，
         * 所以 window.ethereum 根本不会被注入。
         * 无痕本身探测不可靠也不该探测，所以两种情况一起说清楚。
         */
        failLoud(
          "没检测到钱包插件",
          "没检测到钱包插件。如果你已经装了 MetaMask：无痕窗口里扩展默认是关的 —— " +
          "去 chrome://extensions 找到它，打开「在无痕模式下启用」，或者换普通窗口打开这一页。"
        );
        openNoWalletHint();
      }
      return;
    }
    const provider = new ethers.JsonRpcProvider(CHAINS[chainId].rpc, chainId);
    state.signer = new ethers.Wallet(DEMO_KEY, provider);
    state.account = state.signer.address;
    state.demo = true;
  }

  localStorage.removeItem(DISCONNECT_FLAG);
  state.connected = true;
  state.nft = new ethers.Contract(state.dep.address, state.dep.abi, state.signer);

  $("connect").textContent = short(state.account) + (state.demo ? " · 影" : "");
  $("disconnect").hidden = false;
  $("myhome").href = `keeper.html?a=${state.account}`;
  $("myhome").hidden = false;

  log(`已登台 ${short(state.account)}${state.demo ? "（本地影子钱包）" : ""}`, "ok");
  toast("已登台 " + short(state.account), "ok");
  await refresh();
}

async function disconnect({ silent } = {}) {
  // 主动离台要问一句：这一步会断开钱包，回来得重新授权
  if (!silent) {
    const ok = await confirmDialog({
      title: "离台？",
      body: "断开这个钱包。你拾到的星屑和刻下的字都留在链上，一个也不会少 —— 只是这一页不再认得你。回来的时候要重新登台。",
      ok: "离台",
      cancel: "留下",
    });
    if (!ok) return;
  }

  try {
    await injectedProvider()?.request?.({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch { /* 老钱包不支持，忽略 */ }

  Object.assign(state, { connected: false, signer: null, account: null, demo: false });

  $("connect").textContent = "登台";
  $("disconnect").hidden = true;
  $("myhome").hidden = true;
  $("vault-wrap").hidden = true;
  $("claim").disabled = true;
  $("claim").textContent = "登台后可拾取";
  $("inscribe").disabled = true;
  $("inscribe").textContent = "尚未解锁";
  $("offer").disabled = true;
  $("offer").textContent = "尚未解锁";
  $("card-constellation").classList.add("locked");
  setGate(false, "先拾一枚星屑，才能铭刻。观星台不认钱，只认你来过。");

  if (!silent) {
    log("你已离台。那面墙还在那里。");
    toast("已离台");
  }
  state.nft = state.reader;
  await readOnlySurvey();
}

async function switchChain(chainId) {
  const hex = "0x" + chainId.toString(16);
  const info = CHAINS[chainId];
  if (!info) throw new Error(`未知网络 ${chainId}`);
  try {
    await injectedProvider().request({
      method: "wallet_switchEthereumChain", params: [{ chainId: hex }],
    });
  } catch {
    await injectedProvider().request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex,
        chainName: info.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [info.rpc],
        ...(info.explorer ? { blockExplorerUrls: [info.explorer] } : {}),
      }],
    });
    await injectedProvider().request({
      method: "wallet_switchEthereumChain", params: [{ chainId: hex }],
    });
  }
}

// ═══════════════════════════════════════════════════════ 渲染

async function refresh() {
  paintSurvey(await state.nft.survey(state.account), { anonymous: false });
  await paintDome();
  await loadVault();
}

function paintSurvey(s, { anonymous }) {
  const phase = Number(s.currentPhase);
  const embersLeft = Number(s.embersLeft);
  const conLeft = Number(s.constellationsLeft);
  const mine = Number(s.keeperEmbers);
  const myCon = BigInt(s.keeperConstellation);
  const inscribed = CONSTELLATION_SUPPLY - conLeft;

  const mySeats = Number(s.keeperSeats);
  // 手里现在还剩几枚（能不能凑出 14 枚交出去）、今天已经拾了几枚、免费席位还剩几个
  const held = Number(s.keeperEmberBalance ?? 0);
  const today = Number(s.keeperTakenToday ?? 0);
  const freeLeft = Number(s.freeSeatsLeft ?? 0);
  Object.assign(state, {
    phase, embersLeft, conLeft, mine, myCon, price: s.price, inscribed, mySeats,
    held, today, freeLeft,
  });

  const p = PHASES[phase];
  $("phasetext").textContent = p.label;
  $("phasenote").textContent = p.note;
  $("phasechip").classList.toggle("sealed", phase === 0);

  setVal("s-embers", embersLeft.toLocaleString());
  setVal("s-seats", String(conLeft));
  setVal("s-keepers", String(inscribed));
  setVal("s-phase", p.label);

  setVal("emberleft", embersLeft.toLocaleString());
  setVal("conleft", String(conLeft));
  setVal("price", ethers.formatEther(s.price) + " ETH");
  $("domefilled").textContent = inscribed;

  const drifted = EMBER_SUPPLY - embersLeft;
  $("emberfill").style.transform = `scaleX(${drifted / EMBER_SUPPLY})`;
  $("embermeta").textContent = `${drifted} / ${EMBER_SUPPLY} 已拾取`;

  // 刻满之后序章不能再说"还有 88 个空位"
  $("lore-tail").innerHTML =
    conLeft === 0
      ? `<b>88</b> 个刻位已经全部刻满。这片天空不再接受新的名字了。` +
        `星屑还剩 <b>${embersLeft.toLocaleString()}</b> 枚，但它换不来穹顶上的位置。`
      : `燃料还够 <b>${embersLeft.toLocaleString()}</b> 次观测。` +
        `穹顶上还有 <b>${conLeft}</b> 个空着的刻位。两个数字都不会再增加了。`;

  // 这一句说的是全站还剩几席，不是"你的"状态 —— 没登台的人也该看见
  $("offernote").textContent =
    freeLeft > 0
      ? `交出 ${EMBERS_PER_SEAT} 枚亲手拾的星屑，换一个刻位。这条路还剩 ${freeLeft} / ${FREE_SEATS} 席。`
      : `能用星屑换的 ${FREE_SEATS} 席已经换完了。剩下的席位只走献纳。`;

  /*
   * 没登台的人到这里就返回了 —— 于是下面那段门槛逻辑不会跑，
   * 三个按钮就一直停在 HTML 里写死的初始态：disabled + 原文案。
   * 那个状态是最糟的一种：`.btn.act:disabled` 只是把底色去掉，
   * 看上去和能点的按钮一模一样，而 disabled 的按钮连 click 都不会派发 ——
   * 点下去什么都不发生，也没有任何解释。
   *
   * 所以这里把它们改成"能点，且点了有用"：告诉人下一步是登台，
   * 点下去直接把登台流程拉起来。死路变成路口。
   */
  if (anonymous) {
    askConnectOn("claim", "登台后拾取星屑");
    askConnectOn("inscribe", "登台后献纳铭刻");
    askConnectOn("offer", "登台后交星屑换席");
    return;
  }

  // 登台之后：摘掉"去登台"那身打扮，并把按钮真正的动作装回去。
  for (const id of ["claim", "inscribe", "offer"]) restoreAction($(id));

  const room = roomNow();
  setQty(Math.min(state.qty, Math.max(room, 1)));

  /*
   * 三道限制，报最紧的那一条 —— 而且要分清楚：
   * "今天没了"是明天还能来，"拾满了"是到此为止。混在一起说，
   * 人不知道该不该明天再来。
   */
  const claim = $("claim");
  if (phase === 0) disable(claim, "穹顶尚未开凿");
  else if (embersLeft === 0) disable(claim, "星屑已拾尽");
  else if (mine >= EMBER_PER_WALLET) disable(claim, `你已经拾满 ${EMBER_PER_WALLET} 枚 · 到顶了`);
  else if (room <= 0) disable(claim, "今天的两枚拾过了 · 明天再来");
  else {
    claim.disabled = false;
    claim.textContent = `拾取 ${state.qty} 枚星屑`;
  }
  $("embertoday").textContent =
    mine >= EMBER_PER_WALLET
      ? `已拾满 ${EMBER_PER_WALLET} 枚`
      : `今日 ${state.today ?? 0} / ${EMBER_PER_DAY} · 累计 ${mine} / ${EMBER_PER_WALLET}`;

  const card = $("card-constellation");
  const ins = $("inscribe");
  const offer = $("offer");

  /*
   * 两条路各有各的门槛，所以分开判：
   * 献纳只要"拾过一枚"，交星屑要"亲手拾满 14 枚、手里还拿着 14 枚、名额没换完"。
   * 把它们合成一个 disabled 会让人不知道自己卡在哪一条上。
   */
  const canOffer = mine >= EMBERS_PER_SEAT && held >= EMBERS_PER_SEAT && freeLeft > 0;

  // 卡片初始就是 locked（写在 HTML 里），这里只做"解锁"这一个方向的切换
  if (myCon !== 0n) {
    card.classList.remove("locked");
    setGate(true, `你已铭刻 #${myCon}，这片天空记住你了。`);
    disable(ins, "已在穹顶留名");
    disable(offer, "已在穹顶留名");
  } else if (phase < 2) {
    card.classList.add("locked");
    setGate(false, "铭刻阶段还没开始。先去拾星屑。");
    disable(ins, "尚未开放铭刻");
    disable(offer, "尚未开放铭刻");
  } else if (conLeft === 0) {
    card.classList.add("locked");
    setGate(false, "88 个刻位已经刻满。");
    disable(ins, "穹顶已满");
    disable(offer, "穹顶已满");
  } else if (mine === 0) {
    card.classList.add("locked");
    setGate(false, "先拾一枚星屑，才能铭刻。观星台不认钱，只认你来过。");
    /*
     * 这一档和"穹顶已满""还没开台"不一样：它是**用户自己能解决**的。
     * 所以不能给一个 disabled 的死按钮 —— 那等于告诉人此路不通，
     * 而真相是路在旁边那张卡上。点下去就把他带过去。
     */
    pointTo(ins, "先拾一枚星屑 →", "要铭刻，得先亲手拾一枚星屑。");
    pointTo(offer, `先拾满 ${EMBERS_PER_SEAT} 枚星屑 →`,
      `换席要亲手拾满 ${EMBERS_PER_SEAT} 枚，每天 2 枚。`);
  } else {
    card.classList.remove("locked");
    setGate(true, `你亲手拾过 ${mine} 枚星屑，够了。还剩 ${conLeft} 个刻位。`);
    restoreAction(ins);
    ins.disabled = false;
    ins.textContent = `献纳铭刻 · ${ethers.formatEther(s.price)} ETH`;

    if (canOffer) {
      restoreAction(offer);
      offer.disabled = false;
      offer.textContent = `交出 ${EMBERS_PER_SEAT} 枚星屑`;
    } else if (freeLeft === 0) {
      disable(offer, "换完了 · 22 席已满");
    } else if (mine < EMBERS_PER_SEAT) {
      pointTo(offer, `还差 ${EMBERS_PER_SEAT - mine} 枚 →`,
        `还差 ${EMBERS_PER_SEAT - mine} 枚，每天最多拾 2 枚。`);
    } else {
      disable(offer, `手里只剩 ${held} 枚`);
    }
  }

}

const disable = (btn, text) => {
  restoreAction(btn);
  btn.disabled = true;
  btn.textContent = text;
};

/**
 * 还没登台就想动手 —— 先把登台流程拉起来，别只丢一句话。
 * 三个动作入口都走这里，不管用户是从按钮、快捷键还是别处进来的。
 */
function needConnectFirst(what) {
  log(`要${what}，先登台。`);
  return connect();
}

/**
 * 差一步才能用的按钮：保持可点，点了把人带到该去的地方。
 *
 * 用 disabled 表达"你还缺点什么"是不对的：disabled 的按钮不派发 click，
 * 于是点下去毫无反应、毫无解释 —— 而这里缺的东西用户自己就能补上。
 * disabled 只留给真正没得做的状态（还没开台、穹顶已满、你已经刻过了）。
 */
/* 每个按钮真正的动作。pointTo / askConnectOn 会临时改写 onclick，
   状态一旦转好必须装回来 —— 不然拾到星屑之后点【献纳铭刻】
   还是在滚屏，而那比"没反应"更糟：它看着像成功了。 */
const REAL_ACTION = {
  claim: () => claimEmbers(),
  inscribe: () => inscribe(),
  offer: () => offerEmbers(),
};
function restoreAction(btn) {
  if (!btn) return;
  btn.classList.remove("needs-connect");
  const fn = REAL_ACTION[btn.id];
  if (fn) btn.onclick = fn;
}

function pointTo(btn, label, why) {
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = label;
  btn.classList.add("needs-connect");
  btn.onclick = () => {
    log(why);
    const sec = $("ember-sec");
    if (sec) {
      sec.scrollIntoView({ block: "center" });
      sec.classList.add("flash");
      setTimeout(() => sec.classList.remove("flash"), 1200);
    }
  };
}

/** 未登台时的按钮：看得出来能点，点了就去登台。 */
function askConnectOn(id, text) {
  const b = $(id);
  if (!b) return;
  b.disabled = false;
  b.textContent = text;
  b.classList.add("needs-connect");
}

function setGate(open, text) {
  // CSS 里这个状态叫 pass。两边名字不一样的那阵子，门槛过了外观也不变
  $("gate").classList.toggle("pass", open);
  $("gatetext").textContent = text;
}

/** 一次读完整面墙的现任持有者，转让过的刻位也能正确归属。 */
async function loadSeatOwners() {
  try {
    // 摊成普通数组：ethers 的 Result 越界读会抛 "out of result range"，
    // 而穹顶要按 88 个龛索引，绝大多数格子此刻还没有主人。
    state.seatOwners = Array.from(await (state.reader || state.nft).seatOwners());
  } catch {
    state.seatOwners = [];
  }
}

async function paintDome() {
  await loadSeatOwners();
  const owners = state.seatOwners || [];
  const me = state.account?.toLowerCase();

  document.querySelectorAll(".seat-g").forEach((el, i) => {
    const owner = owners[i];
    const isMine = me && owner && owner.toLowerCase() === me;
    el.classList.toggle("filled", !!owner && !isMine);
    el.classList.toggle("mine", !!isMine);
    el.classList.remove("kin");

    /*
     * 刻过的龛里长着一株，分叉数是这个刻位真实的主星数。
     * 放在这里而不是 buildDome：那时候 names.json 还没读回来，
     * 画出来的会是 88 株一模一样的东西。
     */
    const slot = el.querySelector(".asterism");
    if (!slot) return;
    if (!owner) { slot.innerHTML = ""; return; }
    if (slot.childElementCount) return;          // 已经长好了，别重画
    const { d, dots } = asterismGlyph(state.names?.[i]?.stars || 6, i + 1);
    slot.innerHTML =
      `<g transform="translate(-7.5 -12) scale(0.75)">` +
      `<path d="${d}" fill="none" stroke-linecap="round"/><g class="mags">${dots}</g></g>`;
  });
  clearFocus();
}

/**
 * 还没开台：把所有能按的东西关掉，把话说清楚。
 * 这一页仍然可读 —— 设定、图鉴、纪年、守则都不依赖链。
 */
function sealShut() {
  const c = $("connect");
  if (c) {
    c.textContent = "尚未开台";
    c.disabled = true;
    c.title = "垂光台还没在链上开凿";
  }
  for (const id of ["claim", "inscribe", "offer"]) {
    const b = $(id);
    if (b) { b.disabled = true; b.textContent = "尚未开台"; }
  }
  const n = $("netname");
  if (n) n.textContent = "尚未开台";
  const p = $("phasechip");
  if (p) { p.classList.add("sealed"); p.textContent = "尚未开台"; }
  log("垂光台还没在链上开凿。设定、图鉴、纪年可以先看 —— 开台后再来拾星屑。");
}

/** 把某个持有者名下的所有刻位一起点亮 —— 那片连起来的光就是"星域"。 */
function paintKin(owner, seats) {
  const owners = state.seatOwners || [];
  const target = owner?.toLowerCase();
  const kinIdx = [];

  document.querySelectorAll(".seat-g").forEach((el, i) => {
    const o = owners[i];
    const kin = !!target && !!o && o.toLowerCase() === target;
    el.classList.toggle("kin", kin);
    if (kin) kinIdx.push(i);
  });

  const svg = $("domesvg");
  const lines = $("kinlines");

  if (!target) {
    svg.classList.remove("focused");
    lines.innerHTML = "";
    $("focusbar").hidden = true;
    return;
  }

  // 把同一持有者的刻位连成一条线 —— 这才是"星域"，不是一堆孤立的点
  const pts = kinIdx.map((i) => state.seatPts[i]);
  lines.innerHTML = pts
    .slice(1)
    .map(
      (p, k) =>
        `<line x1="${pts[k].x}" y1="${pts[k].y}" x2="${p.x}" y2="${p.y}"
         stroke="var(--gold-hot)" stroke-width="1" opacity="0.55"/>`
    )
    .join("");

  svg.classList.add("focused");
  $("focusbar").hidden = false;
  $("focustext").innerHTML =
    kinIdx.length > 1
      ? `正在查看 <b>${short(owner)}</b> 的星域 · ${seats} 席已连线`
      : `正在查看 <b>${short(owner)}</b> 的刻位 · 仅此一席`;
}

function clearFocus() {
  $("domesvg")?.classList.remove("focused");
  const lines = $("kinlines");
  if (lines) lines.innerHTML = "";
  const bar = $("focusbar");
  if (bar) bar.hidden = true;
  document.querySelectorAll(".seat-g.kin").forEach((el) => el.classList.remove("kin"));
  $("reticle")?.setAttribute("hidden", "");
}

/** 现在还能拾几枚：今天的额度、这辈子的额度、全站余量，取最紧的那个。 */
function roomNow() {
  const lifetime = state.mine === undefined ? EMBER_PER_WALLET : EMBER_PER_WALLET - state.mine;
  const daily = EMBER_PER_DAY - (state.today ?? 0);
  const left = state.embersLeft ?? EMBER_PER_WALLET;
  return Math.max(0, Math.min(lifetime, daily, left));
}

function setQty(n) {
  state.qty = Math.max(1, Math.min(n, Math.max(1, roomNow())));
  $("qty").textContent = state.qty;
  if (state.connected && !$("claim").disabled) {
    $("claim").textContent = `拾取 ${state.qty} 枚星屑`;
  }
}

// ═══════════════════════════════════════════════════════ 预览

async function loadPreviews() {
  const nextEmber = Math.min((EMBER_SUPPLY - (state.embersLeft ?? EMBER_SUPPLY)) + 1, EMBER_SUPPLY);
  const nextCon = Math.min((state.inscribed ?? 0) + 1, CONSTELLATION_SUPPLY);
  await Promise.all([
    paintArt("art-ember", nextEmber),
    paintArt("art-constellation", CON_OFFSET + nextCon),
  ]);

  const m = await meta(CON_OFFSET + nextCon);
  if (!m) return;
  $("nextcon").textContent =
    state.conLeft === 0
      ? `末席 · ${traitOf(m, "星座")} —— 穹顶已满`
      : `下一席 · ${traitOf(m, "星座")} ↗`;
  $("nextcon").href = `token.html?id=${CON_OFFSET + nextCon}`;
}

async function paintArt(elId, tokenId) {
  const el = $(elId);
  try {
    const m = await meta(tokenId);
    const svg = await (await fetch(m.image)).text();
    el.innerHTML = svg;
    el.dataset.zoomToken = tokenId;
  } catch {
    // 前景最暗一级到 --lime-faint 为止（L=0.708）。
    // 这里原本写死了一个 hex，亮度只有 0.38 —— 而"观测中断"是最该看清的那行字。
    el.innerHTML = '<span style="color:var(--lime-faint);font:12px var(--mono)">观测中断</span>';
  }
}

// ═══════════════════════════════════════════════════════ 穹顶刻位

async function openSeat(n) {
  document.querySelectorAll(".seat-g").forEach((el) =>
    el.classList.toggle("active", Number(el.dataset.n) === n)
  );
  // 选中用准星套住，位置纹丝不动
  const p = state.seatPts[n - 1];
  const ret = $("reticle");
  ret.setAttribute("transform", `translate(${p.x} ${p.y})`);
  ret.removeAttribute("hidden");

  const tokenId = CON_OFFSET + n;
  state.seatToken = tokenId;
  state.seatOrdinal = n;
  showSeatTip(n);
  $("seat").hidden = false;
  $("seat-page").href = `token.html?id=${tokenId}`;

  const m = await meta(tokenId);
  if (!m) return;

  $("seatart").innerHTML = await (await fetch(m.image)).text();
  $("seat-name").textContent = traitOf(m, "星座");
  $("seat-ord").textContent = `第 ${String(n).padStart(2, "0")} 刻 / 88`;
  $("seat-region").textContent = traitOf(m, "天区");
  $("seat-stars").textContent = traitOf(m, "主星数") + " 颗";

  const owner = (state.seatOwners || [])[n - 1];
  const inscribed = !!owner;
  const isMine =
    inscribed && state.account &&
    owner.toLowerCase() === state.account.toLowerCase();

  $("seat-status").textContent = inscribed ? "已铭刻" : "空席";
  $("seat-status").style.color = inscribed ? "var(--gold)" : "var(--dim)";

  const note = $("seat-note");
  const rankBox = $("seat-rank");

  if (!inscribed) {
    // ── 空席：没有持有者，也就没有刻痕志
    $("seat-owner").textContent = "尚无";
    $("seat-hands").textContent = "—";
    rankBox.hidden = true;
    $("chronicle-wrap").hidden = true;
    $("carve").hidden = true;
    clearFocus();

    note.className = "seatnote empty";
    const queue = n - (state.inscribed ?? 0);
    note.textContent =
      queue === 1
        ? "这是下一个会被刻上的位置。谁先铭刻，谁拿走它。"
        : `还要再有 ${queue - 1} 个人铭刻，才会轮到这一席。`;
    return;
  }

  // ── 已铭刻：读刻痕志 + 持有者身份
  const c = state.reader || state.nft;
  const [marks, seats] = await Promise.all([
    c.chronicleOf(tokenId),
    c.constellationBalance(owner),
  ]);

  $("seat-owner").innerHTML =
    `<a class="addrlink" href="keeper.html?a=${owner}">${short(owner)}</a>` +
    (isMine ? " · 你" : "");
  $("seat-hands").textContent =
    marks.length === 1 ? "初主，未曾易手" : `${marks.length} 手 · 转让 ${marks.length - 1} 次`;

  // 称号：持有量越大牌子越亮
  const rank = rankOf(Number(seats));
  rankBox.hidden = false;
  rankBox.className = "rank " + (rank?.cls || "r1");
  $("seat-title").textContent = rank?.name || "—";
  $("seat-seats").textContent = `持 ${seats} 席 · ${rank?.latin || ""}`;

  // 把这个人名下的所有刻位一起点亮
  paintKin(owner, Number(seats));

  note.className = "seatnote";
  if (Number(seats) >= 8) {
    note.textContent = `穹顶上有 ${seats} 处刻痕属于同一双手。连起来的那一片，就是这个人的星域。`;
  } else if (Number(seats) > 1) {
    note.textContent = `这个人还持有另外 ${Number(seats) - 1} 个刻位，已在穹顶上一并点亮。`;
  } else if (isMine) {
    note.textContent = "这是你的刻位。垂光台熄灭之后，这道刻痕还留在原地。";
  } else {
    note.textContent = "这个位置已经有人了。它不会再空出来。";
  }

  renderChronicle(marks, owner);
  setupCarve(tokenId, isMine, marks);
}

/** 刻痕志：从初主到现任，每一行都留着。 */
function renderChronicle(marks, owner) {
  const wrap = $("chronicle-wrap");
  wrap.hidden = false;

  $("chronicle").innerHTML = marks
    .map((mk, i) => {
      const last = i === marks.length - 1;
      const when = new Date(Number(mk.heldSince) * 1000)
        .toISOString()
        .slice(0, 10);
      const tag = i === 0 ? "初主 · 铭刻者" : `第 ${i + 1} 任`;
      const words = mk.words
        ? `<p class="chronwords">「${escapeHtml(mk.words)}」</p>`
        : `<p class="chronwords blank">${last ? "尚未题刻" : "接手后未曾留字"}</p>`;

      return `<li class="chronitem ${last ? "now" : ""}">
        <div class="chronmeta">${short(mk.keeper)} · ${when}<span class="tag">${tag}</span></div>
        ${words}
      </li>`;
    })
    .join("");
}

/**
 * 题刻表单：只对现任持有者开放，一任只开一次。
 *
 * 已经题过的人看到的是刻好的字和一句"这一任已经封上了"，不是一个还能敲的输入框 ——
 * 让人写完再被链上打回来，是最差的一种告知方式。
 */
function setupCarve(tokenId, isMine, marks) {
  const box = $("carve");
  if (!isMine || !state.connected) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const mine = marks[marks.length - 1];
  const carved = !!(mine.words || "").trim();

  box.classList.toggle("sealed", carved);
  $("carve-done").hidden = !carved;
  $("carve-form").hidden = carved;

  if (carved) {
    $("carve-done-words").textContent = mine.words;
    return;
  }

  $("carve-input").value = "";
  updateCarveCount();
  $("carve-btn").onclick = () => carve(tokenId);
}

/*
 * 计数按**字**报，不按字节报。
 * 链上的上限确实是 140 字节，但没有人是按字节写字的 ——
 * 字节留在里面做硬闸（一个表情符号能占四个字节），面上给的是人能数的那个数。
 */
function updateCarveCount() {
  const v = $("carve-input").value;
  const chars = [...v].length;
  const bytes = new TextEncoder().encode(v).length;
  const el = $("carve-count");
  el.textContent = bytes > 140 ? "太长了，删掉几个字" : `还能刻 ${CARVE_CHARS - chars} 字`;
  el.classList.toggle("over", bytes > 140);
  $("carve-btn").disabled = bytes > 140 || chars > CARVE_CHARS;
}

async function carve(tokenId) {
  const btn = $("carve-btn");
  const words = $("carve-input").value.trim();

  if (!words) {
    log("空白刻不上石壁。写一句再落刀。", "bad");
    return;
  }

  // 落刀之前先问一句。这一步链上不可逆，而且这一任只有这一次机会 ——
  // 让人在按下去之前完整看一眼自己要留的那句话。
  const yes = await confirmDialog({
    title: "落刀之前",
    body:
      `你要在第 ${tokenId - CON_OFFSET} 刻上留下：\n\n「${words}」\n\n` +
      "这一任只能题一次。刻上去之后，你自己也改不了、删不了。\n" +
      "只有当这个刻位换到下一个人手里时，才会多出新的一行。",
    ok: "落刀",
    cancel: "再想想",
  });
  if (!yes) return;

  btn.disabled = true;
  btn.textContent = "落刀…";
  log("正在把字刻进内壁…");

  try {
    await preflight("carveWords", [tokenId, words], {});
    const tx = await state.nft.carveWords(tokenId, words);
    await tx.wait();
    log(`题刻已留在第 ${tokenId - CON_OFFSET} 刻上${txLink(tx.hash)}`, "hot");
    await openSeat(tokenId - CON_OFFSET);
    await loadFeed();
  } catch (e) {
    log(readOmen(e), "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "题刻";
  }
}

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// ═══════════════════════════════════════════════════════ 开图

/**
 * 拾到星屑后的开图。稀有度不该写在说明里让人读，
 * 该让人自己翻开那一张 —— 所以逐张揭示，最稀有的那张留到最后。
 */
async function reveal(tokenIds) {
  const metas = await Promise.all(tokenIds.map((id) => meta(id)));
  const items = metas
    .map((m, i) => ({
      m,
      id: tokenIds[i],
      tier: Number(traitOf(m, "稀有度等级")),
    }))
    .sort((a, b) => a.tier - b.tier); // 压轴的放最后

  const box = $("rv-cards");
  box.innerHTML = items
    .map(
      (it) => `<div class="rv-card t${it.tier}" data-token="${it.id}">
        <div class="rv-face"></div>
        <div class="rv-img"><img src="${it.m.image}" alt=""/></div>
        <div class="rv-cap">
          <b>${traitOf(it.m, "恒星遗迹")}</b>
          <i>${"◆".repeat(it.tier)} ${traitOf(it.m, "稀有度")}</i>
        </div>
      </div>`
    )
    .join("");

  $("rv-verdict").textContent = "";
  $("reveal").hidden = false;
  document.body.style.overflow = "hidden";

  const cards = [...box.children];
  for (const [i, card] of cards.entries()) {
    await new Promise((r) => setTimeout(r, i === 0 ? 420 : 760));
    card.classList.add("open");
  }

  const best = items[items.length - 1];
  await new Promise((r) => setTimeout(r, 420));
  $("rv-verdict").textContent = GRADE_LINE[best.tier];
  if (best.tier >= 4) $("reveal").classList.add("rare");

  // 第一次撞见某一档，图鉴当场解锁
  for (const it of items) state.discovered.add(it.tier);
  buildCodex();
}

function closeReveal() {
  $("reveal").hidden = true;
  $("reveal").classList.remove("rare");
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════ 灯箱

async function openLightbox(tokenId) {
  const m = await meta(tokenId);
  if (!m) return;

  const lb = $("lightbox");
  lb.hidden = false;
  document.body.style.overflow = "hidden";

  $("lb-art").innerHTML = await (await fetch(m.image)).text();
  $("lb-tier").textContent = traitOf(m, "层级");
  $("lb-name").textContent = m.name;
  $("lb-desc").textContent = m.description;

  $("lb-traits").innerHTML = m.attributes
    .filter((a) => a.trait_type !== "层级")
    .map(
      (a) => `<div class="trait"><span>${a.trait_type}</span><b>${a.value}</b></div>`
    )
    .join("");

  $("lb-page").href = `token.html?id=${tokenId}`;
  const open = $("lb-open");
  if (state.dep.explorer) {
    open.href = `${state.dep.explorer}/token/${state.dep.address}/instance/${tokenId}`;
    open.hidden = false;
  } else {
    open.hidden = true;
  }
}

function closeLightbox() {
  $("lightbox").hidden = true;
  document.body.style.overflow = "";
}

// ═══════════════════════════════════════════════════════ 链上动态

async function loadFeed() {
  const c = state.reader || state.nft;
  if (!c) return;

  $("feed").innerHTML = Array.from(
    { length: FEED_PAGE },
    () => '<div class="fitem skel"></div>'
  ).join("");

  try {
    const [embers, cons, passed, carved] = await Promise.all([
      c.queryFilter(c.filters.EmberDrifted()),
      c.queryFilter(c.filters.ConstellationInscribed()),
      c.queryFilter(c.filters.SeatPassedOn()),
      c.queryFilter(c.filters.WordsCarved()),
    ]);

    const items = [
      ...embers.map((e) => ({
        kind: "emb", block: e.blockNumber, li: e.index ?? 0,
        who: e.args[0], token: Number(e.args[1]),
      })),
      ...cons.map((e) => ({
        kind: "con", block: e.blockNumber, li: e.index ?? 0,
        who: e.args[0], token: Number(e.args[1]), ordinal: Number(e.args[2]),
      })),
      // 首次铭刻也会触发 SeatPassedOn(from=0)，那条和 con 重复，滤掉
      ...passed
        .filter((e) => e.args[1] !== ethers.ZeroAddress)
        .map((e) => ({
          kind: "pass", block: e.blockNumber, li: e.index ?? 0,
          token: Number(e.args[0]), from: e.args[1], who: e.args[2],
        })),
      ...carved
        .filter((e) => e.args[2])
        .map((e) => ({
          kind: "carve", block: e.blockNumber, li: e.index ?? 0,
          token: Number(e.args[0]), who: e.args[1], words: e.args[2],
        })),
    ]
      .sort((a, b) => b.block - a.block || b.li - a.li);

    state.feedAll = items;
    renderFeed();
    return;
  } catch {
    $("feed").innerHTML = '<p class="empty">读不到链上记录。</p>';
  }
}

/**
 * 渲染当前筛选 + 分页下的那一段。切筛选不重新拉链。
 *
 * 每次渲染领一个序号：行内容要逐条 await 元数据，快速切换标签时
 * 先发的渲染可能后返回，把后发的结果盖掉。写 DOM 前先验号。
 */
let feedRun = 0;

async function renderFeed() {
  const run = ++feedRun;
  const kind = state.feedKind || "all";
  const all = (state.feedAll || []).filter((x) => kind === "all" || x.kind === kind);

  state.feedTotal = all.length;
  const items_ = all.slice(0, state.feedShown || FEED_PAGE);

  if (!items_.length) {
    if (run !== feedRun) return;
    $("feed").innerHTML = `<p class="empty">${
      kind === "all"
        ? "还没有人来过。你可以是第一个。"
        : "这一类还没有记录。"
    }</p>`;
    return;
  }

  try {

    const rows = await Promise.all(
      items_.map(async (it) => {
        const conName = async () => {
          const m = await meta(it.token);
          return m ? traitOf(m, "星座") : `#${it.token}`;
        };

        if (it.kind === "con") {
          return `<div class="fitem con">
            <svg class="ico ficon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 8l7-5 7 5"/></svg>
            <span class="ftext">${addrLink(it.who)} 铭刻了 <b>${await conName()}</b> · 第 ${it.ordinal} 刻</span>
            <span class="fblock">区块 ${it.block}</span>
          </div>`;
        }
        if (it.kind === "pass") {
          return `<div class="fitem pass">
            <svg class="ico ficon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-4-4M20 15H4l4 4"/></svg>
            <span class="ftext"><b>${await conName()}</b> 易主 · ${addrLink(it.from)} → ${addrLink(it.who)}</span>
            <span class="fblock">区块 ${it.block}</span>
          </div>`;
        }
        if (it.kind === "carve") {
          return `<div class="fitem carve">
            <svg class="ico ficon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>
            <span class="ftext">${addrLink(it.who)} 在 <b>${await conName()}</b> 上题刻：「${escapeHtml(it.words)}」</span>
            <span class="fblock">区块 ${it.block}</span>
          </div>`;
        }
        return `<div class="fitem emb">
          <svg class="ico ficon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg>
          <span class="ftext">${addrLink(it.who)} 拾取了星屑 <b>#${String(it.token).padStart(4, "0")}</b></span>
          <span class="fblock">区块 ${it.block}</span>
        </div>`;
      })
    );

    if (run !== feedRun) return; // 已经有更新的渲染在跑了，这批结果作废

    const left = state.feedTotal - items_.length;
    $("feed").innerHTML =
      rows.join("") +
      (left > 0
        ? `<button id="feedmore" class="btn ghost small feedmore">再看 ${Math.min(
            left,
            FEED_PAGE
          )} 条 · 共 ${state.feedTotal} 条 ↓</button>`
        : state.feedTotal > FEED_PAGE
        ? `<p class="feedend">已是全部 ${state.feedTotal} 条记录</p>`
        : "");

    const fm = $("feedmore");
    if (fm) {
      fm.onclick = () => {
        state.feedShown = (state.feedShown || FEED_PAGE) + FEED_PAGE;
        renderFeed();
      };
    }
  } catch {
    $("feed").innerHTML = '<p class="empty">读不到链上记录。</p>';
  }
}

// ═══════════════════════════════════════════════════════ 名录

/**
 * 守夜人名录。seatOwners() 一次读完整面墙，再按地址归并 ——
 * 88 个刻位最多只能属于 88 个人，所以这张表天然有上界。
 */
async function loadRoster() {
  const c = state.reader || state.nft;
  if (!c) return;

  // 骨架数量要和落地后的默认条数一致，否则内容一到高度就跳
  $("rosterlist").innerHTML = Array.from(
    { length: ROSTER_PAGE },
    () => '<div class="rosterrow skel"></div>'
  ).join("");

  try {
    const owners = Array.from(await c.seatOwners());
    if (!owners.length) {
      $("rosterlist").innerHTML =
        '<p class="empty">还没有人在穹顶上留名。第一个龛还空着。</p>';
      return;
    }

    // 地址 → 持有的刻位号
    const byAddr = new Map();
    owners.forEach((o, i) => {
      const k = o.toLowerCase();
      if (!byAddr.has(k)) byAddr.set(k, { addr: o, seats: [] });
      byAddr.get(k).seats.push(i + 1);
    });

    const rows = [...byAddr.values()].sort(
      (a, b) => b.seats.length - a.seats.length || a.seats[0] - b.seats[0]
    );

    const me = state.account?.toLowerCase();
    $("rostercount").innerHTML =
      `<b>${rows.length}</b><i>人 · 上限 88</i>`;

    state.roster = rows;
    renderRoster();
  } catch {
    $("rosterlist").innerHTML = '<p class="empty">读不到名录。</p>';
  }
}

/**
 * 名录默认只铺前 12 名。满员时是 88 个地址 ——
 * 一次全倒出来会把页面撑到近三万像素，那不是"内容丰富"，是失控。
 */
const ROSTER_PAGE = 12;

function renderRoster() {
  const rows = state.roster || [];
  const all = state.rosterOpen;
  const shown = all ? rows : rows.slice(0, ROSTER_PAGE);
  const me = state.account?.toLowerCase();

  const seatSum = rows.reduce((n, r) => n + r.seats.length, 0);
  $("rostercount").innerHTML = `<b>${rows.length}</b><i>人 · ${seatSum} 席 · 上限 88</i>`;

  const list = shown
    .map((r, i) => {
      /*
       * 称号只在**挣到基座以上**的时候才出现。
       * 亲手铭刻每人只有一次，所以名录里绝大多数人都是 1 席 ——
       * 每行都挂一个"执灯人"，这一列就等于没写：
       * 88 行同一个词，读者只会把它当背景。
       * 2 席起才有区别，那时候它才是信息。
       */
      const rank = r.seats.length >= 2 ? rankOf(r.seats.length) : null;
      const mine = me && r.addr.toLowerCase() === me;
      const names = r.seats
        .slice(0, 5)
        .map((n) => state.names?.[n - 1]?.zh || `#${n}`)
        .join("、");
      const more = r.seats.length > 5 ? ` 等 ${r.seats.length} 席` : "";
      return `<a class="rosterrow ${rank?.cls || ""} ${mine ? "mine" : ""}"
                 href="keeper.html?a=${r.addr}">
        <span class="rk-no">${String(i + 1).padStart(2, "0")}</span>
        <span class="rk-title">${rank?.name || ""}</span>
        <span class="rk-addr">${short(r.addr)}${mine ? '<i class="rk-you">你</i>' : ""}</span>
        <span class="rk-seats">${names}${more}</span>
        <span class="rk-count">${r.seats.length}<i>席</i></span>
      </a>`;
    })
    .join("");

  const rest = rows.length - shown.length;
  const toggle =
    rows.length > ROSTER_PAGE
      ? `<button id="rostermore" class="btn ghost small rostermore">${
          all ? "只看前 12 名 ↑" : `展开其余 ${rest} 人 ↓`
        }</button>`
      : "";

  $("rosterlist").innerHTML = list + toggle;

  const btn = $("rostermore");
  if (btn) {
    btn.onclick = () => {
      state.rosterOpen = !state.rosterOpen;
      renderRoster();
      if (!state.rosterOpen) $("roster").scrollIntoView({ block: "start" });
    };
  }
}

// ═══════════════════════════════════════════════════════ 写入

async function claimEmbers() {
  if (!state.connected) return needConnectFirst("拾星屑");
  const btn = $("claim");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "伸手接住…";
  log(`向观星台请求 ${state.qty} 枚星屑…`);

  try {
    await preflight("claimEmbers", [state.qty], {});
    const tx = await state.nft.claimEmbers(state.qty);
    log(`请求已送出 ${short(tx.hash)}，等待观测台确认…`);
    const rc = await tx.wait();

    flash("art-ember");
    log(`接住了 ${state.qty} 枚星屑 · 区块 ${rc.blockNumber}${txLink(tx.hash)}`, "ok");

    // 从回执里取真实 tokenId，别靠客户端推算
    const got = rc.logs
      .map((l) => {
        try { return state.nft.interface.parseLog(l); } catch { return null; }
      })
      .filter((e) => e && e.name === "EmberDrifted")
      .map((e) => Number(e.args[1]));

    /*
     * 到这里星屑已经在链上了。
     * 后面这些只是把界面追上去 —— 它们失败不等于交易失败，
     * 所以要自己兜住：混在上面那个 catch 里，一次读元数据超时
     * 就会报成"今天的两枚已经拾过了"，而人明明刚刚拾到。
     */
    try {
      await refresh();
      await loadPreviews();
      await loadFeed();
      if (got.length) await reveal(got);
    } catch {
      log("星屑已经到手了，但这一页没能立刻刷新。刷新页面就能看到。");
    }
  } catch (e) {
    btn.textContent = label;
    log(readOmen(e, guessEmberFailure()), "bad");
  } finally {
    btn.disabled = false;
    await refreshButtonsOnly();
  }
}

async function inscribe() {
  if (!state.connected) return needConnectFirst("铭刻");
  const btn = $("inscribe");
  btn.disabled = true;
  btn.textContent = "正在刻入内壁…";
  log("向穹顶提交铭刻请求…");

  try {
    const value = state.price;
    await preflight("inscribeConstellation", [], { value });
    const tx = await state.nft.inscribeConstellation({ value });
    log(`铭刻请求已送出 ${short(tx.hash)}…`);
    const rc = await tx.wait();

    flash("art-constellation");
    await refresh();

    const ord = Number(state.myCon) - CON_OFFSET;
    const m = await meta(Number(state.myCon));
    const name = m ? traitOf(m, "星座") : `#${state.myCon}`;

    log(`${name} · 第 ${ord} 刻已经刻上了。你的名字和这片天空绑在一起了。${txLink(tx.hash)} · 区块 ${rc.blockNumber}`, "hot");
    log(`穹顶还剩 ${state.conLeft} 个刻位。`);

    // 刻位已经在链上了，下面只是追界面。它出错不该报成"铭刻失败"
    try {
      await loadPreviews();
      await loadFeed();
      await loadRoster();
      await openSeat(ord); // 刻完直接把这一席摊开
      $("seat").scrollIntoView({ block: "center" });
    } catch {
      log("刻位已经是你的了，但这一页没能立刻刷新。刷新页面就能看到。");
    }
  } catch (e) {
    log(readOmen(e, guessInscribeFailure()), "bad");
  } finally {
    await refreshButtonsOnly();
  }
}

/**
 * 手里现在还拿着的星屑编号。
 * 从 Transfer(→我) 的日志里捞候选，再逐个确认现在还在不在我名下 ——
 * 买来的、转走的都要算准，交出去的那 14 枚必须是真在手里的。
 */
async function myEmberIds(need) {
  const logs = await state.nft.queryFilter(
    state.nft.filters.Transfer(null, state.account)
  );
  const ids = [...new Set(logs.map((l) => Number(l.args[2])))]
    .filter((id) => id >= 1 && id <= EMBER_SUPPLY)
    .sort((a, b) => a - b);

  const mine = [];
  for (const id of ids) {
    if (mine.length >= need) break;
    try {
      if ((await state.nft.ownerOf(id)) === state.account) mine.push(id);
    } catch { /* 已经烧掉了，跳过 */ }
  }
  return mine;
}

/** 交出 14 枚星屑，换一个刻位。走的是和献纳同一串刻位号。 */
async function offerEmbers() {
  if (!state.connected) return needConnectFirst("换席");
  const btn = $("offer");
  btn.disabled = true;
  btn.textContent = "正在清点星屑…";

  try {
    const ids = await myEmberIds(EMBERS_PER_SEAT);
    if (ids.length < EMBERS_PER_SEAT) {
      log(`手里只清点出 ${ids.length} 枚星屑，交出一个刻位要 ${EMBERS_PER_SEAT} 枚。`, "bad");
      return;
    }

    btn.textContent = "正在把星屑交出去…";
    log(`交出 ${EMBERS_PER_SEAT} 枚星屑，换一个刻位…`);
    await preflight("inscribeWithEmbers", [ids], {});
    const tx = await state.nft.inscribeWithEmbers(ids);
    log(`请求已送出 ${short(tx.hash)}…`);
    const rc = await tx.wait();

    flash("art-constellation");
    await refresh();

    const ord = Number(state.myCon) - CON_OFFSET;
    const m = await meta(Number(state.myCon));
    const name = m ? traitOf(m, "星座") : `#${state.myCon}`;

    log(`${EMBERS_PER_SEAT} 枚星屑烧掉了，换来 ${name} · 第 ${ord} 刻。${txLink(tx.hash)} · 区块 ${rc.blockNumber}`, "hot");
    log(`能用星屑换的刻位还剩 ${state.freeLeft} 个。`);

    try {
      await loadPreviews();
      await loadFeed();
      await loadRoster();
      await loadVault();
      await openSeat(ord);
      $("seat").scrollIntoView({ block: "center" });
    } catch {
      log("刻位已经是你的了，但这一页没能立刻刷新。刷新页面就能看到。");
    }
  } catch (e) {
    log(readOmen(e, guessOfferFailure()), "bad");
  } finally {
    await refreshButtonsOnly();
  }
}

function guessOfferFailure() {
  if (state.phase < 2) return OMENS.InscriptionNotOpen;
  if (state.myCon !== 0n) return OMENS.AlreadyInscribed;
  if (state.conLeft === 0) return OMENS.DomeFull;
  if ((state.freeLeft ?? 0) === 0) return OMENS.FreeSeatsGone;
  if (state.mine < EMBERS_PER_SEAT) return OMENS.NotEnoughEmbers;
  return null;
}

function flash(id) {
  const el = $(id);
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 900);
}

function guessEmberFailure() {
  if (state.phase === 0) return OMENS.DomeSealed;
  if (state.embersLeft === 0) return OMENS.EmbersExhausted;
  if (state.mine + state.qty > EMBER_PER_WALLET) return OMENS.EmberLimitReached;
  if ((state.today ?? 0) + state.qty > EMBER_PER_DAY) return OMENS.DailyLimitReached;
  return null;
}

function guessInscribeFailure() {
  if (state.phase < 2) return OMENS.InscriptionNotOpen;
  if (state.myCon !== 0n) return OMENS.AlreadyInscribed;
  if (state.conLeft === 0) return OMENS.DomeFull;
  if (state.mine === 0) return OMENS.NoEmberHeld;
  return null;
}

async function refreshButtonsOnly() {
  if (!state.connected) return;
  paintSurvey(await state.nft.survey(state.account), { anonymous: false });
}

// ═══════════════════════════════════════════════════════ 收藏

async function loadVault() {
  const wrap = $("vault-wrap");
  if (!state.connected || (state.mine === 0 && state.myCon === 0n)) {
    wrap.hidden = true;
    return;
  }

  const logs = await state.nft.queryFilter(
    state.nft.filters.Transfer(null, state.account)
  );
  const ids = [...new Set(logs.map((l) => l.args[2].toString()))].sort(
    (a, b) => Number(b) - Number(a)
  );

  const cards = await Promise.all(
    ids.map(async (id) => {
      try {
        const m = await meta(id);
        const isCon = Number(id) > CON_OFFSET;
        /*
         * 图鉴记的是"**亲手拾到过**"，不是"现在还拿着"——
         * 和铭刻门槛用的是同一条规矩。这批 id 全部来自 Transfer(null, 你)，
         * 也就是你自己拾的那些；所以先记进图鉴，再判断现在还在不在手里。
         * 反过来写的话，把一枚星屑转出去，图鉴里那一档就重新锁上了。
         */
        if (!isCon) state.discovered.add(Number(traitOf(m, "稀有度等级")));
        if ((await state.nft.ownerOf(id)) !== state.account) return null;
        return `<a class="relic ${isCon ? "con" : ""} t${traitOf(m, "稀有度等级")}"
                    href="token.html?id=${id}" data-token="${id}">
          <img src="${m.image}" alt="${m.name}" loading="lazy" />
          <div class="cap">${m.name}</div>
        </a>`;
      } catch {
        return null;
      }
    })
  );

  const list = cards.filter(Boolean);
  $("vault").innerHTML = list.join("");
  buildCodex(); // 藏品变了，图鉴的解锁状态跟着变
  $("vaultcount").innerHTML = `<b>${list.length}</b><i>件藏品</i>`;
  wrap.hidden = false;
}

boot();

// 这几页一直停在 60° 的穹顶内壁：天不随滚动变

