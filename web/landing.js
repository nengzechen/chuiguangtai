/**
 * 首页 = 一面刻满名字的墙。
 *
 * 这个文件只做四件事：铺板号索引、把滚动和当前板接起来、砌那面墙、铺纪年。
 * 没有钱包、没有交易 —— 那些都在观星台里。
 * 首页的唯一任务是让人看懂"位置有限，而且正在减少"。
 */
import { ethers } from "./vendor/ethers.js";
import { CHAINS, notOpenYet } from "./shared.js?v=7fac73ed";
import { TIMELINE } from "./content.js?v=2c67cd39";
import { asterismSvg, RINGS, regionOf } from "./dome.js?v=85c127cd";

const CON_SUPPLY = 88;
const EMBER_SUPPLY = 2048;
const $ = (id) => document.getElementById(id);

const PHASES = ["尚未开台", "拾屑中", "观测中"];
const PHASE_NOTE = ["两层都关着", "只能拾星屑", "两层同时开放"];

/** 首页那面墙用的是穹顶的四道肋环，12+20+26+30 = 88 —— 同一组分环。 */
const LEDGES = RINGS;

let NAMES = [];

// ═════════════════════════════════════════════════════ 板号索引

/*
 * 纪念墙是按板编号的。你沿着墙走，板号一块一块过去 ——
 * 这一版的阅读方向是**走过去**，不是抬头，所以索引横在页顶，不竖在页侧。
 *
 * 板名写的是这一板上刻着什么，不是章节标题的复制。
 */
const PANELS = [
  { id: "wall",  n: "01", name: "墙" },
  { id: "how",   n: "02", name: "怎么留名" },
  { id: "pair",  n: "03", name: "两种东西" },
  { id: "line",  n: "04", name: "门槛" },
  { id: "rules", n: "05", name: "三条规矩" },
  { id: "log",   n: "06", name: "纪年" },
];

function buildPanels() {
  $("panel-list").innerHTML = PANELS.map(
    (p) => `<li class="panel-i" data-for="${p.id}">
              <a href="#${p.id}"><b>${p.n}</b><span>${p.name}</span></a>
            </li>`
  ).join("");
}

/** 滚动 → 你正站在哪块板前面。 */
function trackPanel() {
  const secs = [...document.querySelectorAll(".panel-i")]
    .map((li) => ({ li, el: $(li.dataset.for) }))
    .filter((s) => s.el);
  let ticking = false;

  function measure() {
    ticking = false;
    /*
     * 采样点落在视口上三分之一，不是正中：
     * 一块板刚进视野就该算"你正站在它前面"了 ——
     * 等它滚到正中才点亮，索引会一直比脚步慢半块。
     */
    const mark = scrollY + innerHeight * 0.32;
    let cur = secs[0];
    for (const s of secs) if (s.el.offsetTop <= mark) cur = s;

    for (const s of secs) {
      s.li.classList.toggle("here", s === cur);
      // 走过去的板留着痕，没到的板是空的 —— 索引本身也是一面被走过的墙
      s.li.classList.toggle("past", s.el.offsetTop + s.el.offsetHeight < mark);
    }
  }

  addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(measure); }
  }, { passive: true });
  addEventListener("resize", measure, { passive: true });
  measure();
}

// ═════════════════════════════════════════════════════ 墙面

function buildWall(owners = [], mine = null) {
  const me = mine?.toLowerCase();
  let seat = 0;

  $("ledges").innerHTML = LEDGES.map((ring, ri) => {
    const cells = Array.from({ length: ring.n }, (_, i) => {
      seat += 1;
      const o = owners[seat - 1];
      const isMine = me && o && o.toLowerCase() === me;
      // 天区按刻位号轮着分，和元数据、观星台穹顶用的是同一个算法
      const info = NAMES[seat - 1];
      const region = o ? `r${(seat - 1) % 3}` : "";
      const cls = ["niche", o ? "filled" : "", region, isMine ? "mine" : ""]
        .filter(Boolean).join(" ");
      const state = o ? "已铭刻" : "空槽";
      const name = info ? `${info.zh} · ` : "";
      /*
       * 天区只靠颜色是不够的（r0/r1/r2 三个色相分不出来，色觉障碍者更分不出来）。
       * 所以天区名进可访问名，和刻位号、状态一起报出来。
       */
      const label = `第 ${seat} 槽 · ${name}${regionOf(seat)} · 列 ${ring.ring} · ${state}`;
      /*
       * 这一版**没有 lift**：穹顶内壁被展开成一面墙，四道肋环拉直成四道横列。
       * 那条抛物线（ring.sag）是弧的来源 —— 展开就是把它取消。
       * 分环本身不动：12 + 20 + 26 + 30 = 88，和藏品元数据、观星台同源。
       */
      // 刻过的槽里才有星图；空槽就是空的，看得见槽底
      const inner = o ? asterismSvg(info?.stars || 6, seat) : "";
      /*
       * 刻过的槽是**一个链接**，指向它自己的藏品页（刻位号 + 10000 = 编号）。
       * 用 <a> 而不是带 tabindex 的 div：键盘可达、可以新窗口打开、
       * 屏幕阅读器报的是"链接"这件它真能做的事。
       * 曾经这里是 role="button" —— 那是在承诺一个不存在的动作，
       * 页面上没有任何点击处理器，按下去什么也不会发生。
       *
       * 空槽还没有藏品页，所以它不是链接，也不进 Tab 序；
       * 它的总数在下面的计数里报过了，个体对辅助技术隐藏，
       * 免得读者被 80 个"空槽"轮流念一遍。
       */
      return o
        ? `<a class="${cls}" href="token.html?id=${10000 + seat}"
              aria-label="${label}" title="${label}">${inner}<span class="nd">${seat}</span></a>`
        : `<div class="${cls}" aria-hidden="true"><span class="nd">${seat}</span></div>`;
    }).join("");

    /*
     * 四道列**不等长**，而且不该等长：
     * 12 席那道就是比 30 席那道短。槽的尺寸是固定的，列有多长由它装了多少个决定 ——
     * 把短列拉满宽会让槽变大，一面墙上的槽是一个规格，这是石匠的活。
     */
    return `<div class="course">
              <p class="course-d">列 ${ring.ring}<i>${ring.n} 席</i></p>
              <div class="course-row">${cells}</div>
            </div>`;
  }).join("");
}

// ═════════════════════════════════════════════════════ 纪年与图例

/*
 * 观测纪年是**固定的六条设定**，不会增加 —— 它是这个世界的来历，不是动态。
 * 真正会长的是链上发生的事，所以最后一条"今日"接实时数据：
 * 那一行会随着有人拾星屑、有人铭刻而变。
 */
function buildLog(live) {
  const last = TIMELINE.length - 1;
  $("logbook").innerHTML = TIMELINE.map(
    ([when, title, body], i) => `<article class="log-row${i === last ? " now" : ""}">
      <p class="log-when"><i class="log-dot"></i>${when}</p>
      <div>
        <h3>${title}</h3>
        <p>${body}</p>
        ${i === last && live ? `<p class="log-live">
          <span><b class="n">${live.embers}</b> 枚星屑已被拾走</span>
          <span><b class="n">${live.taken}</b> / 88 个龛已刻</span>
          <span>此刻读数，来自链上</span>
        </p>` : ""}
      </div>
    </article>`
  ).join("");
}

/** 页面上出现的每一张图都是真的藏品，没有示意图。 */
function buildFigures() {
  $("hero-art").innerHTML =
    `<img src="metadata/images/constellation/60.svg" alt="猎户座" decoding="async">`;
  // 用一枚红巨星：它占了将近一半，是大多数人真会拿到的那一档。
  // 之前挂的是 37 号黑洞视界 —— 全站只有 16 枚，而且画面上是一块黑，
  // 拿它当"星屑长什么样"的示例，两头都不对。
  $("fig-ember").innerHTML =
    `<img src="metadata/images/ember/1.svg" alt="" loading="lazy" decoding="async">`;
  $("fig-con").innerHTML =
    `<img src="metadata/images/constellation/60.svg" alt="" loading="lazy" decoding="async">`;
}

// ═════════════════════════════════════════════════════ 链上

/**
 * 还没开台：把读数格上的"连接中"换成实话。
 *
 * 留着"连接中"比空着更糟 —— 它是在说"马上就好"，而实际上永远不会好。
 */
function sealShut() {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("r-embers", "—");
  set("r-open", "—");
  set("r-phase", "尚未开台");
  set("r-phase-note", "还没在链上开凿");
  set("w-taken", "—");
  set("w-open", "—");
  const s = document.getElementById("hero-spec-state");
  if (s) s.textContent = "尚未开台";
}

/** 链上状态：读不到也不该让首页开天窗，静默退回静态数字。 */
async function loadChain() {
  try {
    const dep = await (await fetch("deployment.json")).json();

    /*
     * 站已经发出去、但合约还指着本地链的那段时间：直接不连。
     * 不加这一下，首页会朝 127.0.0.1:8545 发几十个请求 ——
     * 那个地址在访客的机器上是他自己的电脑，不是我们的链。
     * 请求全部失败，控制台刷满红字，而墙上本来就该是空的。
     */
    if (notOpenYet(dep)) {
      sealShut();
      return;
    }

    const info = CHAINS[dep.chainId];
    if (!info) throw new Error("unknown chain");

    const c = new ethers.Contract(
      dep.address,
      dep.abi,
      new ethers.JsonRpcProvider(info.rpc, dep.chainId)
    );

    // 名字和主星数：龛里那张星图按它画
    NAMES = await fetch("metadata/names.json").then((r) => r.json()).catch(() => []);

    const [owners, phase, drifted] = await Promise.all([
      c.seatOwners().then((r) => Array.from(r)),
      c.phase(),
      c.embersDrifted().catch(() => 0n),
    ]);

    const taken = owners.length;
    const p = Number(phase);

    buildWall(owners);
    $("r-embers").textContent = String(EMBER_SUPPLY - Number(drifted));
    $("r-open").textContent = String(CON_SUPPLY - taken);
    $("w-taken").textContent = String(taken);
    $("w-open").textContent = String(CON_SUPPLY - taken);
    $("r-phase").textContent = PHASES[p] || "观测中";
    $("r-phase-note").textContent = PHASE_NOTE[p] || "只进不退";
    $("hero-spec-state").textContent = owners[59] ? "已铭刻" : "空位";
    buildLog({ embers: Number(drifted), taken });
  } catch {
    // 链读不到就留一面空墙：首页照样成立，数字是合约里刻死的那两个
    $("r-embers").textContent = String(EMBER_SUPPLY);
    $("r-open").textContent = String(CON_SUPPLY);
    $("w-taken").textContent = "0";
    $("w-open").textContent = String(CON_SUPPLY);
    $("r-phase").textContent = "未连接";
    $("r-phase-note").textContent = "读不到链上状态";
    $("hero-spec-state").textContent = "空位";
  }
}

// ═════════════════════════════════════════════════════ 启动

buildPanels();
buildWall();
buildLog();
buildFigures();
trackPanel();
loadChain();
