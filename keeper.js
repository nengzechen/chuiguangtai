/**
 * 持有者主页：keeper.html?a=0x…
 *
 * 88 个刻位各自有页，但真正被记住的是**人**。
 * 这一页把一个地址在垂光台留下的全部痕迹收在一起：
 * 称号、星域、亲手写的字、名下的藏品。
 */
import { ethers } from "./vendor/ethers.js";
import { CHAINS, short, notOpenYet, metaUrl } from "./shared.js?v=7fac73ed";
import { buildCardSvg, svgToPng, download } from "./sharecard.js?v=c094fe83";
import { seatPositions, wallChrome } from "./dome.js?v=85c127cd";
import { toast } from "./toast.js?v=0d4cc83d";

const CON_OFFSET = 10000;
const CON_SUPPLY = 88;

const RANKS = [
  { min: 16, name: "司天监", latin: "Grand Astronomer", cls: "r5" },
  { min: 8, name: "星域主", latin: "Warden of the Sky", cls: "r4" },
  { min: 4, name: "星官", latin: "Star Officer", cls: "r3" },
  { min: 2, name: "巡天者", latin: "Sky-walker", cls: "r2" },
  { min: 1, name: "执灯人", latin: "Lantern-bearer", cls: "r1" },
];

const $ = (id) => document.getElementById(id);
const state = {};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function say(msg, kind = "") {
  const el = $("kp-log");
  el.className = "tk-log " + kind;
  el.textContent = msg;
}

const setVal = (id, v) => {
  const el = $(id);
  el.textContent = v;
  el.classList.remove("loading");
};

// ───────────────────────────────────────────────────── 启动

async function boot() {
  document.querySelectorAll(".sk").forEach((el) => el.classList.add("loading"));

  const a = new URLSearchParams(location.search).get("a") || "";
  if (!ethers.isAddress(a)) return renderBadAddress(a);
  state.addr = ethers.getAddress(a);

  $("kp-addr").textContent = state.addr;
  $("share").onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    toast("链接已复制");
  };
  $("kp-card").onclick = makeCard;

  try {
    state.dep = await (await fetch("deployment.json")).json();
    if (notOpenYet(state.dep)) {
      say("垂光台还没在链上开凿。开台之后这里才会有痕迹。");
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

  const info = CHAINS[state.dep.chainId];
  state.c = new ethers.Contract(
    state.dep.address,
    state.dep.abi,
    new ethers.JsonRpcProvider(info.rpc, state.dep.chainId)
  );

  state.names = await (await fetch("metadata/names.json")).json();

  await loadKeeper();
}

function renderBadAddress(a) {
  document.title = "地址无效 · 垂光台";
  $("kp-main").innerHTML = `
    <div class="empty-state">
      
      <h2>这不是一个地址</h2>
      <p>
        ${a ? `<code>${esc(a)}</code> 不是合法的以太坊地址。` : "没有提供地址。"}<br>
        观星者主页的格式是 <code>keeper.html?a=0x…</code>
      </p>
      <a class="btn ghost small" href="observatory.html" style="text-decoration:none">回观星台</a>
    </div>`;
}

// ───────────────────────────────────────────────────── 读取

async function loadKeeper() {
  const { c, addr } = state;

  const [owners, embers, seats, ownCon] = await Promise.all([
    c.seatOwners().then((r) => Array.from(r)),
    c.embersClaimedBy(addr),
    c.constellationBalance(addr),
    c.constellationOf(addr),
  ]);

  state.owners = owners;
  const mine = [];
  owners.forEach((o, i) => {
    if (o && o.toLowerCase() === addr.toLowerCase()) mine.push(i + 1);
  });
  state.mine = mine;

  // 称号
  const rank = RANKS.find((r) => Number(seats) >= r.min);
  document.title = rank
    ? `${rank.name} ${short(addr)} · 垂光台`
    : `观星者 ${short(addr)} · 垂光台`;

  $("kp-rank").textContent = rank ? rank.name : "过客";
  $("kp-latin").textContent = rank
    ? rank.latin
    : Number(embers) > 0
    ? "拾过星屑，尚未铭刻"
    : "还没有在垂光台留下任何痕迹";
  if (rank) $("kp-rank").classList.add("rk-" + rank.cls);

  setVal("kp-seats", String(seats));
  setVal("kp-embers", String(embers));
  setVal("kp-first", ownCon > 0n ? `第 ${Number(ownCon) - CON_OFFSET} 刻` : "—");

  // 星域小穹顶
  renderDome(mine);
  $("kp-domesub").textContent = mine.length
    ? `${mine.length} 处刻痕属于这个地址，已在穹顶上连成一片。`
    : "这个地址在穹顶上还没有位置。";

  // 题刻：只捞这个人亲手写的那些行
  const words = [];
  await Promise.all(
    mine.map(async (n) => {
      const marks = await c.chronicleOf(CON_OFFSET + n);
      const own = Array.from(marks).filter(
        (m) => m.keeper.toLowerCase() === addr.toLowerCase() && m.words
      );
      for (const m of own) {
        words.push({ n, words: m.words, at: Number(m.heldSince) });
      }
    })
  );
  words.sort((a, b) => a.n - b.n);
  state.words = words;
  setVal("kp-words", String(words.length));
  renderWords(words);

  await renderVault();
  renderCard();
}

function renderDome(mine) {
  const pts = seatPositions();
  const set = new Set(mine);

  const seats = pts
    .map((p, i) => {
      const n = i + 1;
      const owned = set.has(n);
      const taken = !!state.owners[i];
      const cls = owned ? "kin" : taken ? "filled" : "";
      return `<g class="seat-g r${i % 3} ${cls}" transform="translate(${p.x} ${p.y})">
        <g class="glyph">
          <path class="recess" d="M-11 13V-2A11 11 0 0 1 11 -2V13Z"/>
          <path class="cut" d="M-7.6 10V-1.6A7.6 7.6 0 0 1 7.6 -1.6V10Z"/>
        </g>
      </g>`;
    })
    .join("");

  // 星域连线
  const lines = mine
    .slice(1)
    .map((n, k) => {
      const a = pts[mine[k] - 1];
      const b = pts[n - 1];
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
        stroke="var(--seal)" stroke-width="1" opacity="0.6"/>`;
    })
    .join("");

  $("kp-dome").innerHTML = wallChrome() + lines + seats;
  $("kp-dome").classList.toggle("focused", mine.length > 0);
}

function renderWords(words) {
  if (!words.length) return;
  $("kp-wordswrap").hidden = false;
  $("kp-wordslist").innerHTML = words
    .map((w) => {
      const info = state.names[w.n - 1];
      const when = new Date(w.at * 1000).toISOString().slice(0, 10);
      return `<a class="kp-word" href="token.html?id=${CON_OFFSET + w.n}">
        <div class="kp-wordmeta">
          <b>${info.zh}</b>
          <span>第 ${String(w.n).padStart(2, "0")} 刻 · ${when}</span>
        </div>
        <p>「${esc(w.words)}」</p>
      </a>`;
    })
    .join("");
}

async function renderVault() {
  const logs = await state.c.queryFilter(
    state.c.filters.Transfer(null, state.addr)
  );
  const ids = [...new Set(logs.map((l) => l.args[2].toString()))].sort(
    (a, b) => Number(b) - Number(a)
  );

  const cards = await Promise.all(
    ids.map(async (id) => {
      try {
        if ((await state.c.ownerOf(id)) !== state.addr) return null;
        const m = await (await fetch(metaUrl(state.dep, id))).json();
        const isCon = Number(id) > CON_OFFSET;
        return `<a class="relic ${isCon ? "con" : ""}" href="token.html?id=${id}">
          <img src="${m.image}" alt="${esc(m.name)}" loading="lazy"/>
          <div class="cap">${esc(m.name)}</div>
        </a>`;
      } catch {
        return null;
      }
    })
  );

  const list = cards.filter(Boolean);
  if (!list.length) return;
  $("kp-vault").innerHTML = list.join("");
  $("kp-vaultcount").innerHTML = `<b>${list.length}</b><i>件</i>`;
  $("kp-vaultwrap").hidden = false;
}

// ───────────────────────────────────────────────────── 名片

function cardData() {
  const rank = RANKS.find((r) => state.mine.length >= r.min);
  const best = state.words[0];
  const domeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 348" width="900" height="348">
      <rect width="900" height="348" fill="oklch(0.115 0.018 273)"/>
      ${$("kp-dome").innerHTML}
    </svg>`;

  return {
    artSvg: domeSvg,
    name: rank ? rank.name : "过客",
    sub: `持 ${state.mine.length} 席 · 拾 ${$("kp-embers").textContent} 枚星屑`,
    words: best ? best.words : "尚未在内壁上留字",
    keeper: short(state.addr),
    badge: rank ? rank.latin.toUpperCase() : "VISITOR",
  };
}

function renderCard() {
  try {
    $("kp-cardprev").innerHTML = buildCardSvg(cardData());
    $("kp-cardwrap").hidden = false;
  } catch {
    $("kp-cardwrap").hidden = true;
  }
}

async function makeCard() {
  const btn = $("kp-card");
  btn.disabled = true;
  btn.textContent = "合成中…";
  try {
    const png = await svgToPng(buildCardSvg(cardData()), 2);
    download(png, `keeper-${state.addr.slice(0, 10)}.png`);
    toast("名片已下载");
  } catch (e) {
    say("合成失败：" + (e.message || e), "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "下载名片";
  }
}

boot();

// 这几页一直停在 60° 的穹顶内壁：天不随滚动变

