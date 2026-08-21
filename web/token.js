/**
 * 单个藏品的独立页面：token.html?id=10012
 *
 * 存在的理由是**可分享**。穹顶上的一席、你拾到的一枚星屑，
 * 都该有自己的地址能发出去，而不是只活在一个长页面的抽屉里。
 */
import { ethers } from "./vendor/ethers.js";
import { CHAINS, short, readOmen, DEMO_KEY, DISCONNECT_FLAG, askWallet, confirmDialog,
  ON_LOCALHOST, notOpenYet, metaUrl, IS_MOBILE, openWalletSheet, injectedProvider }
  from "./shared.js?v=5c8d3823";
import { buildCardSvg, svgToPng, download } from "./sharecard.js?v=c094fe83";
import { toast } from "./toast.js?v=0d4cc83d";

const CON_OFFSET = 10000;
const CON_SUPPLY = 88;
const EMBER_SUPPLY = 2048;

const RANKS = [
  { min: 16, name: "司天监", latin: "Grand Astronomer", cls: "r5" },
  { min: 8, name: "星域主", latin: "Warden of the Sky", cls: "r4" },
  { min: 4, name: "星官", latin: "Star Officer", cls: "r3" },
  { min: 2, name: "巡天者", latin: "Sky-walker", cls: "r2" },
  { min: 1, name: "执灯人", latin: "Lantern-bearer", cls: "r1" },
];

const $ = (id) => document.getElementById(id);
const state = { connected: false };

const traitOf = (m, name) =>
  m?.attributes?.find((a) => a.trait_type === name)?.value ?? "—";

function say(msg, kind = "") {
  const el = $("tk-log");
  el.className = "tk-log " + kind;
  el.textContent = msg;
}

// ───────────────────────────────────────────────────── 启动

async function boot() {

  const id = Number(new URLSearchParams(location.search).get("id") || 10001);
  const isCon = id > CON_OFFSET;
  const ordinal = isCon ? id - CON_OFFSET : id;
  const valid =
    Number.isInteger(id) &&
    ((isCon && ordinal >= 1 && ordinal <= CON_SUPPLY) ||
      (!isCon && id >= 1 && id <= EMBER_SUPPLY));

  if (!valid) return renderNotFound(id);

  state.id = id;
  state.isCon = isCon;
  state.ordinal = ordinal;

  bindUI();

  try {
    state.dep = await (await fetch("deployment.json")).json();
    if (notOpenYet(state.dep)) {
      say("垂光台还没在链上开凿。开台之后这一席才会有内容。");
      return;
    }
  } catch {
    say("找不到 deployment.json —— 先运行 npm run deploy:local", "bad");
    return;
  }

  $("addr").textContent =
    state.dep.address.slice(0, 8) + "…" + state.dep.address.slice(-6);
  $("netname").textContent =
    CHAINS[state.dep.chainId]?.name || `Chain ${state.dep.chainId}`;

  if (state.dep.explorer) {
    const a = $("tk-explorer");
    a.href = `${state.dep.explorer}/token/${state.dep.address}/instance/${id}`;
    a.hidden = false;
  }

  const info = CHAINS[state.dep.chainId];
  state.reader = new ethers.Contract(
    state.dep.address,
    state.dep.abi,
    new ethers.JsonRpcProvider(info.rpc, state.dep.chainId)
  );

  await renderMeta();
  await renderChain();
  renderCardPreview();

  // 不自动登台：和观星台同一条规矩，要动手才连钱包
  localStorage.removeItem(DISCONNECT_FLAG);
}

function bindUI() {
  $("share").onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $("share").textContent = "已复制";
      toast("链接已复制");
      setTimeout(() => ($("share").textContent = "复制链接"), 1600);
    } catch {
      say("复制失败，手动复制地址栏即可");
    }
  };
  $("tk-connect").onclick = () => connect(false);
  $("tk-card").onclick = makeCard;
  $("tk-carve-input").addEventListener("input", updateCount);
  $("tk-carve-btn").onclick = carve;
}

/** 编号不在 1–2048 或 10001–10088 里，就没有这件藏品。 */
function renderNotFound(id) {
  document.title = "查无此编号 · 垂光台";
  document.querySelector(".tk").innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      
      <h2>查无此编号</h2>
      <p>
        编号 <code>${String(id)}</code> 不在垂光台的记录里。<br>
        星屑的编号是 1 – 2048，星座的编号是 10001 – 10088。
      </p>
      <a class="btn ghost small" href="observatory.html" style="text-decoration:none">回观星台</a>
    </div>`;
}

// ───────────────────────────────────────────────────── 元数据

async function renderMeta() {
  const m = await (await fetch(metaUrl(state.dep, state.id))).json();
  state.meta = m;

  document.title = `${m.name} · 垂光台`;
  state.artSvg = await (await fetch(m.image)).text();
  $("tk-art").innerHTML = state.artSvg;
  $("tk-name").textContent = m.name;
  $("tk-tier").textContent = traitOf(m, "层级");
  $("tk-desc").textContent = m.description;
  $("tk-id").textContent = "#" + state.id;

  $("tk-sub").textContent = state.isCon
    ? `${traitOf(m, "星座")} · ${traitOf(m, "天区")} · 主星 ${traitOf(m, "主星数")} 颗`
    : `${traitOf(m, "恒星遗迹")} · ${traitOf(m, "稀有度")} · ${traitOf(m, "光谱型")}`;

  $("tk-traits").innerHTML = m.attributes
    .filter((a) => a.trait_type !== "层级")
    .map((a) => `<div class="trait"><span>${a.trait_type}</span><b>${a.value}</b></div>`)
    .join("");

  // 星座才有封蜡
  $("tk-seal").hidden = !state.isCon;

  // 上一 / 下一
  const max = state.isCon ? CON_SUPPLY : EMBER_SUPPLY;
  const base = state.isCon ? CON_OFFSET : 0;
  const prev = state.ordinal > 1 ? base + state.ordinal - 1 : base + max;
  const next = state.ordinal < max ? base + state.ordinal + 1 : base + 1;
  $("tk-prev").href = `token.html?id=${prev}`;
  $("tk-next").href = `token.html?id=${next}`;
  $("tk-pos").textContent = state.isCon
    ? `第 ${String(state.ordinal).padStart(2, "0")} 刻 / 88`
    : `第 ${state.ordinal} 次观测 / 2048`;
}

// ───────────────────────────────────────────────────── 链上

async function renderChain() {
  const c = state.reader;
  let owner = null;
  try {
    owner = await c.ownerOf(state.id);
  } catch {
    // 尚未 mint
  }
  state.owner = owner;

  $("tk-status").textContent = owner
    ? state.isCon ? "已铭刻" : "已拾取"
    : state.isCon ? "空席" : "尚未观测";
  $("tk-status").style.color = owner ? "var(--gold)" : "var(--mute)";
  $("tk-owner").innerHTML = owner
    ? `<a class="addrlink" href="keeper.html?a=${owner}">${short(owner)}</a>`
    : "尚无";

  if (!owner) {
    $("tk-hands").textContent = "—";
    return;
  }

  if (!state.isCon) {
    $("tk-hands").textContent = "星屑无刻痕志";
    return;
  }

  const [marks, seats] = await Promise.all([
    c.chronicleOf(state.id),
    c.constellationBalance(owner),
  ]);
  state.marks = marks;

  $("tk-hands").textContent =
    marks.length === 1 ? "初主，未曾易手" : `${marks.length} 手 · 转让 ${marks.length - 1} 次`;

  const rank = RANKS.find((r) => Number(seats) >= r.min);
  if (rank) {
    const box = $("tk-rank");
    box.hidden = false;
    box.className = "rank tk-rank " + rank.cls;
    $("tk-title2").textContent = rank.name;
    $("tk-seats").textContent = `持 ${seats} 席 · ${rank.latin}`;
  }

  renderChronicle(marks);
}

function renderChronicle(marks) {
  $("tk-chron-wrap").hidden = false;
  $("tk-chron").innerHTML = marks
    .map((mk, i) => {
      const last = i === marks.length - 1;
      const when = new Date(Number(mk.heldSince) * 1000).toISOString().slice(0, 10);
      const tag = i === 0 ? "初主 · 铭刻者" : `第 ${i + 1} 任`;
      const words = mk.words
        ? `<p class="chronwords">「${esc(mk.words)}」</p>`
        : `<p class="chronwords blank">${last ? "尚未题刻" : "接手后未曾留字"}</p>`;
      return `<li class="chronitem ${last ? "now" : ""}">
        <div class="chronmeta"><a class="addrlink" href="keeper.html?a=${mk.keeper}">${short(mk.keeper)}</a> · ${when}<span class="tag">${tag}</span></div>
        ${words}
      </li>`;
    })
    .join("");
}

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// ───────────────────────────────────────────────────── 钱包

async function connect(silent) {
  const { chainId } = state.dep;

  if (injectedProvider()) {
    const bp = new ethers.BrowserProvider(injectedProvider());
    try {
      // 手动点的时候把钱包的授权弹窗拉起来，别静默连上
      const accts = silent
        ? await bp.send("eth_accounts", [])
        : await askWallet(injectedProvider());
      if (!accts.length) return;
      if (Number((await bp.getNetwork()).chainId) !== chainId) {
        if (!silent) say("请先把钱包切到 " + (CHAINS[chainId]?.name || chainId), "bad");
        return;
      }
      state.signer = await bp.getSigner();
    } catch (e) {
      if (!silent) say(readOmen(e, null, state.nft), "bad");
      return;
    }
  } else if (CHAINS[chainId]?.local && ON_LOCALHOST) {
    state.signer = new ethers.Wallet(
      DEMO_KEY,
      new ethers.JsonRpcProvider(CHAINS[chainId].rpc, chainId)
    );
  } else {
    if (!silent) {
      if (IS_MOBILE) {
        say("手机上要在钱包 App 里打开这一页。", "bad");
        openWalletSheet();
      } else {
        say("没检测到钱包", "bad");
      }
    }
    return;
  }

  state.account = await state.signer.getAddress();
  state.connected = true;
  state.nft = new ethers.Contract(state.dep.address, state.dep.abi, state.signer);
  $("tk-connect").textContent = short(state.account);

  maybeShowCarve();
}

/**
 * 题刻框：只对现任持有者开，而且一任只开一次。
 *
 * 已经题过的人看到的是刻好的字，不是一个还能敲的输入框 ——
 * 让人写完再被链上打回来，是最差的一种告知方式。
 */
function maybeShowCarve() {
  const mine =
    state.isCon &&
    state.owner &&
    state.account &&
    state.owner.toLowerCase() === state.account.toLowerCase();

  $("tk-carve").hidden = !mine;
  if (!mine || !state.marks?.length) return;

  const words = (state.marks[state.marks.length - 1].words || "").trim();
  $("tk-carve-done").hidden = !words;
  $("tk-carve-form").hidden = !!words;

  if (words) {
    $("tk-carve-done-words").textContent = words;
    return;
  }
  $("tk-carve-input").value = "";
  updateCount();
}

/* 和观星台上那个框同一套规矩：面上数字，里面数字节 */
const CARVE_CHARS = 46;

function updateCount() {
  const v = $("tk-carve-input").value;
  const chars = [...v].length;
  const bytes = new TextEncoder().encode(v).length;
  const el = $("tk-carve-count");
  el.textContent = bytes > 140 ? "太长了，删掉几个字" : `还能刻 ${CARVE_CHARS - chars} 字`;
  el.classList.toggle("over", bytes > 140);
  $("tk-carve-btn").disabled = bytes > 140 || chars > CARVE_CHARS;
}

async function carve() {
  const btn = $("tk-carve-btn");
  const words = $("tk-carve-input").value.trim();

  if (!words) {
    say("空白刻不上石壁。写一句再落刀。", "bad");
    return;
  }

  // 这一步链上不可逆，而且这一任只有这一次机会。
  const yes = await confirmDialog({
    title: "落刀之前",
    body:
      `你要在这一席上留下：\n\n「${words}」\n\n` +
      "这一任只能题一次。刻上去之后，你自己也改不了、删不了。\n" +
      "只有当这一席换到下一个人手里时，志上才会多出新的一行。",
    ok: "落刀",
    cancel: "再想想",
  });
  if (!yes) return;

  btn.disabled = true;
  btn.textContent = "落刀…";
  say("正在把字刻进内壁…");

  try {
    await state.nft.carveWords.staticCall(state.id, words);
    const tx = await state.nft.carveWords(state.id, words);
    await tx.wait();
    toast("题刻已留在内壁上", "ok");
    say("题刻已留在这一席上。", "ok");
    await renderChain();
    maybeShowCarve();
    renderCardPreview();
  } catch (e) {
    say(readOmen(e, null, state.nft), "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "题刻";
  }
}

/** 分享卡：预览一张，点了就下载。 */
function currentWords() {
  if (!state.marks?.length) return "";
  const last = state.marks[state.marks.length - 1];
  return last.words || state.marks.find((m) => m.words)?.words || "";
}

function cardData() {
  const m = state.meta;
  return {
    artSvg: state.artSvg,
    name: state.isCon ? traitOf(m, "星座") : m.name,
    sub: state.isCon
      ? `${traitOf(m, "天区")} · 主星 ${traitOf(m, "主星数")} 颗 · MAG ${traitOf(m, "视星等")}`
      : `${traitOf(m, "恒星遗迹")} · ${traitOf(m, "稀有度")} · ${traitOf(m, "光谱型")}`,
    words: state.isCon
      ? currentWords()
      : `${traitOf(m, "恒星遗迹")}，余温 ${traitOf(m, "余温 (K)")}K`,
    keeper: state.owner ? short(state.owner) : "尚无持有者",
    badge: state.isCon
      ? `第 ${String(state.ordinal).padStart(2, "0")} 刻 / 88`
      : `EMBER ${String(state.ordinal).padStart(4, "0")} / 2048`,
  };
}

function renderCardPreview() {
  try {
    $("tk-cardprev").innerHTML = buildCardSvg(cardData());
    $("tk-cardwrap").hidden = false;
  } catch {
    $("tk-cardwrap").hidden = true;
  }
}

async function makeCard() {
  const btn = $("tk-card");
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const png = await svgToPng(buildCardSvg(cardData()), 2);
    download(png, `chuiguangtai-${state.id}.png`);
    toast("分享卡已下载（1200×630）", "ok");
  } catch (e) {
    say("合成失败：" + (e.message || e), "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "下载分享卡";
  }
}

boot();

// 这几页一直停在 60° 的穹顶内壁：天不随滚动变

