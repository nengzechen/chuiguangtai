# 垂光台 · The Last Observatory

一个双层 NFT mint dApp，跑在 Robinhood Chain 上。
合约 + 测试 + 生成式藏品 + 一整套 mint 页面，产出的 NFT 符合 OpenSea 索引要求
（ERC-721 + ERC-2981 + `contractURI`）。

**站点** <https://nengzechen.github.io/chuiguangtai/>
**合约（测试网）** [`0xdce4…4034`](https://explorer.testnet.chain.robinhood.com/address/0xdce46962b34803f4FB0F8338e94f8B1b607a4034#code) · 源码已验证
**链** Robinhood Chain Testnet（chainId 46630）

---

## 一、设定

宇宙正在熄灭。垂光台是最后一座仍在运转的观星台，它只做一件事：
在每一颗恒星死去时，记录下它最后的光。

| | 星屑 Ember | 星座 Constellation |
|---|---|---|
| 层级 | Free mint | Premier mint |
| 价格 | 免费，只花 gas | 0.0088 ETH **或** 交出 14 枚星屑 |
| 总量 | **2048** | **88**（其中 **22** 席可用星屑换） |
| 每钱包 | 每天 2 枚，累计 **14** | **1** |
| token id | 1 – 2048 | 10001 – 10088 |
| 门槛 | 无 | 必须先亲手拾过星屑 |

四个数字都不是随口定的：

- **2048** —— 垂光台燃料耗尽前还能完成的观测次数（也是 2¹¹）
- **88** —— IAU 官方命名的星座总数，人类命名过的星座就这么多
- **14** —— 换一个刻位要交出的星屑数。每天 2 枚，拾满要来七天
- **22** —— 能用星屑换走的席位上限（88 的四分之一）。不设这个数，
  2048 ÷ 14 = 146 个位置的兑换力压在 88 个位置上，献纳那条路就没人走了

**每个钱包只能亲手铭刻一个星座**，所以这个项目最多只会有 88 个人在壁面上留下名字。
稀缺性来自设定本身，不是营销话术。

### 门槛记的是"来过"，不是"持有"

`inscribeConstellation()` 要求 `embersClaimedBy[msg.sender] > 0` —— 记的是
**亲手拾取**的数量，不是余额。从二级市场买来的星屑不算数。

叙事上是「观星台不认钱，只认你来过」；机制上是把免费层变成付费层的漏斗，
同时挡住有人开着钱包直接扫走全部 88 个刻位。

用星屑换席位的那条路两道门都要过：**亲手拾过** 14 枚，**而且**现在手里还拿着
14 枚交出来烧掉。只查其一都能绕 —— 只查"拾过"，人可以拾满、卖掉、再空手换一席；
只查"手里有"，二级市场买 14 枚就能插队。

### 刻痕志：转手只追加，不覆盖

每个刻位底下有一本志。`_update` 钩子在每次易主时自动往志上追加一条空白记录，
新主人用 `carveWords` 填自己那一行。

**一任只能题一次。** 刻上去之后本人也改不了、删不了 —— 石头上的字本来就是这样。
从别人手里买来的刻位会给新主人一次全新的机会，同样只有一次。
一个地址持有几个刻位就有几次机会，每个刻位各算各的。

合约里没有任何函数能改别人那一行：`carveWords` 只写数组的最后一条，
而且只在那条还是空白时才写得进去。

```
第 02 刻 · 唧筒座
  1. 0x90F7…b906  初主·铭刻者  「献给还没出生的人。」
  2. 0x3C44…93BC  第 2 任       「从别人手里接过来的。」
```

### 星屑的稀有度

程序化生成，按恒星遗迹分五档（2048 枚的实测分布）：

| 遗迹 | 权重 | 实测 |
|---|---|---|
| 红巨星 | 60 | 1227 · 59.9% |
| 白矮星 | 28 | 569 · 27.8% |
| 中子星 | 8 | 164 · 8.0% |
| 超新星残骸 | 3 | 60 · 2.9% |
| 黑洞视界 | 1 | 28 · 1.4% |

每档有独立配色和构图（黑洞是唯一没有发光核心的 —— 它只有吸积盘）。

### 称号与星域

亲手铭刻每人只有一次，多刻位只能从二级市场收。`constellationBalance`
记录当前持有量，决定这个钱包在壁面上的称号：

| 持有 | 称号 |
|---|---|
| 1 | 执灯人 Lantern-bearer |
| 2–3 | 巡天者 Sky-walker |
| 4–7 | 星官 Star Officer |
| 8–15 | 星域主 Warden of the Sky |
| 16+ | 司天监 Grand Astronomer |

点开任意一席，壁面会把同一持有者名下的所有刻位一起点亮 —— 连成的那片光就是他的星域。
`seatOwners()` 一次返回整张壁面的现任持有者，所以这个高亮只花一次 RPC。

---

## 二、钱去哪儿

献纳的 ETH **只能**流向一个地址，部署那一刻就钉死在合约里：

```solidity
address public immutable TREASURY;          // 部署时写死，之后谁也改不了

function withdraw() external {              // 不收参数，也不限 onlyOwner
    uint256 amount = address(this).balance;
    if (amount == 0) return;
    (bool ok, ) = payable(TREASURY).call{value: amount}("");
    if (!ok) revert WithdrawFailed();
    emit Withdrawn(TREASURY, amount);
}
```

三点都是刻意的：

- **immutable** —— 不是 owner 可改的参数。"钱会去哪儿"应该在链上一眼看得出来，
  而不是取决于此刻 owner 是谁。
- **不收收款人参数** —— 没有参数就没有改道的余地。
- **不限 onlyOwner** —— 收款地址写死了，谁按这个按钮结果都一样，
  那就没有理由只让一个人能按。

想知道钱去哪儿，读合约的 `TREASURY()` —— 那是唯一权威的来源。
仓库里不写这个地址：它在链上本来就是公开的，但没必要在代码库里
把它和某个 GitHub 账号绑在一起。部署时从 `.env` 的 `TREASURY` 读，
没设就直接报错，不给默认值。

ERC-2981 版税收款人默认也是它。版税那一项可改（市场那边的规则会变），
但献纳的本金不可改 —— 这两件事的严肃程度不一样。

部署者钱包只出 gas，不碰这笔钱，所以它可以是一个随时能扔掉的新地址。

---

## 三、跑起来

```bash
npm install
npm run metadata          # 生成 2048 枚星屑 + 88 个星座
npm run font              # 中文字体子集化 —— 改过文案就要重跑
```

三个终端：

```bash
npm run chain             # A：本地链 :8545
```

```bash
npm run web               # B：页面 :8080
```

```bash
npm run deploy:local      # C：部署，自动推进到【铭刻】阶段
```

打开 <http://127.0.0.1:8080> 。**没装 MetaMask 也能玩** —— 检测不到钱包插件时
自动用本地链的影子账户。这个降级要同时满足两个条件：chainId 是 31337
**且**页面本身跑在 localhost，线上任何情况下都走不到。

用自己的 MetaMask 测：

```bash
FUND_TO=0x你的地址 npm run fund
```

其他命令：

```bash
npm run check             # 合约测试 + 冒烟检查，一条命令过全场
npm test                  # 65 个合约测试
npm run smoke             # 44 项静态检查
npm run preflight         # 上线闸：查链、查金库、查地址、查托管配置
npm run inspect           # 回读链上状态
npm run seed              # 造一批铭刻/题刻/转手记录，方便看刻痕志效果
npm run fill              # 灌满 88 席；COLLECT=0 npm run fill 看纯散户分布
npm run whoami -- --network robinhoodTestnet   # 确认钥匙、网络、余额
```

---

## 四、上线

### 域名与服务器

整站是纯静态的（HTML + CSS + ES modules，浏览器直接连链上 RPC），
没有后端、没有数据库、没有构建产物，所以静态托管就够。

现在跑在 **GitHub Pages** 上（`gh-pages` 分支，根目录），全站 32MB。
发布命令：

```bash
git subtree push --prefix web origin gh-pages
```

`.github/workflows/pages.yml` 也留着 —— 在仓库 Settings → Pages 里把 Source
改成 GitHub Actions，它就接管，之后 push main 即自动发布。
（最初想直接走 Actions，但 workflow 自带的 GITHUB_TOKEN 建不了 Pages 站点，
报 `Resource not accessible by integration`；推一个 `gh-pages` 分支会自动把
Pages 开起来，所以走了这条。）

**想换更好的免费托管**：Cloudflare Pages 免费档不限流量（GitHub Pages、
Netlify、Vercel 都是每月 100GB 封顶），仓库里的 `web/_headers`（含 CSP）
和 `web/_redirects` 就是按它的格式写的，会被自动读取。

**免费域名**：`is-a.dev`（提 PR）、`js.org`（限 JS 项目）、`eu.org`、
DigitalPlat FreeDomain（`dpdns.org` / `us.kg`）。

> 免费域名有个真实风险：域名一旦失效，指向它的 `baseURI` 会一起死，
> 所有 NFT 在 OpenSea 和钱包里变空白。所以**正式发行建议把 `BASE` 换成 IPFS**
> （`web/metadata/` 只有 31MB，主流 pin 服务免费档 1GB 足够），
> 站点本身放免费域名 —— 站挂了元数据还在，这两件事不该绑在一起。

### 两条链

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| 浏览器 | robinhoodchain.blockscout.com | explorer.testnet.chain.robinhood.com |
| Faucet | — | faucet.testnet.chain.robinhood.com |

部署实测 2,859,038 gas —— 测试网约 0.00064 ETH，主网约 0.000057 ETH。

### 一条命令

```bash
./scripts/golive.sh testnet
```

依次做：部署合约 → 用线上域名重生成元数据与分享页 → 打内容指纹 →
跑测试和上线闸 → 发布到 gh-pages。主网那条（`mainnet`）会先要你输 `yes` 确认。

主网部署后阶段停在 **闭台**。确认元数据和 OpenSea 显示无误后再手动推进：

```solidity
advancePhase(1)  // 拾屑：开放免费层
advancePhase(2)  // 铭刻：开放付费层
```

阶段**只进不退** —— 宣告过的观测窗口收不回来，这是写进合约的承诺。
也正因为只进不退，**合约里没有紧急暂停**：开台之后没有人能把它关上。
这是设计选择，不是遗漏，但上线前必须知道它意味着什么。

`renounceOwnership` 被关掉了（revert）：阶段要靠 owner 一步步推上去，
在那之前弃权会把整座台子永远锁死。要转交用 `transferOwnership`。

### 合约还没上链的那段时间

页面显示「尚未开台」：登台、拾星屑、铭刻全部禁用并改文案，
不会朝任何链发请求。设定、图鉴、观测纪年照常可读。

---

## 五、结构

```
contracts/Observatory.sol   双层合约、阶段控制、门槛、刻痕志
test/Observatory.test.js    65 个测试，含 88 钱包刻满壁面、A→B 传承不抹前人题刻

scripts/gen-metadata.js     生成 2136 张 SVG + 元数据 + names.json + 88 个分享页
scripts/deploy.js           部署并写 web/deployment.json
scripts/golive.sh           部署 → 重生成 → 检查 → 发布，一条命令
scripts/site-url.js         把站点绝对地址盖进 og/canonical/sitemap
scripts/stamp.js            按内容哈希给 JS/CSS 打版本号
scripts/subset-font.js      中文字体子集化（构建步骤，改文案后要重跑）
scripts/smoke.js            冒烟检查：文件、元数据、色值、id 引用、路由
scripts/preflight.js        上线闸：链、金库、baseURI、占位地址、托管配置
scripts/inspect.js          回读 OpenSea 依赖的全部字段 + 人口与刻痕志统计
scripts/serve.js            开发服务器（no-store，改完刷新即生效）
scripts/whoami.js           当前网络下的部署者与余额
scripts/fund.js             给本地钱包打测试币（仅限本地链）
scripts/seed.js             演一段历史：铭刻、题刻、转手、收藏家囤席
scripts/fill.js             把 88 席灌满，看售罄的样子（仅限本地链）
scripts/accounts.js         列出本地链预置账户

web/index.html · landing.js    首页：88 个刻位的墙 + 观测纪年
web/observatory.html · app.js  观星台：拾取 / 铭刻 / 题刻
web/token.html · token.js      单件藏品的独立页（可分享）
web/keeper.html · keeper.js    观星者主页
web/sharecard.js               1200×630 分享卡合成 + PNG 导出
web/shared.js                  共用：网络表、错误词表、元数据地址、确认弹窗
web/dome.js                    共用：壁面几何（两个页面必须是同一片天）
web/content.js                 世界观静态内容：图鉴、称号、纪年、术语、守则
web/tokens.css                 全站共用令牌（字体、色板、刻度）
web/landing.css                首页专用
web/styles.css                 观星台专用组件
web/s/<刻位号>.html             静态 OG 页，链接在社交平台能正常展开
```

### 页面

| 路径 | 用途 |
|---|---|
| `index.html` | 首页：88 个刻位的墙、两条规则、观测纪年 |
| `observatory.html` | 观星台：壁面星图、两层 mint、名录、守则、手册抽屉 |
| `token.html?id=10002` | 第 02 刻的独立页：刻痕志、传承、称号、题刻、分享卡 |
| `token.html?id=37` | 星屑 #0037 的独立页 |
| `keeper.html?a=0x…` | 观星者主页：称号、星域、他刻下的话、藏品、名片 |
| `s/60.html` | 猎户座的静态分享页（带 OG meta，自动跳转到 token 页） |

`token.html` 的编号越界、`keeper.html` 的地址非法，都会渲染对应的空状态，不会白屏。

页面之间是互相通的：壁面上的持有者、动态里的地址、刻痕志的每一任，
都能点进那个人的主页；主页上的每条题刻又能点回对应的刻位页。

**快捷键**：<kbd>M</kbd> 手册 · <kbd>D</kbd> 壁面 · <kbd>Esc</kbd> 关浮层。
88 个刻位可以用 Tab 逐个走过去，回车打开。

---

## 六、视觉

页面的世界写在 `DESIGN.md` 里。明确的反面参照是"深色宇宙底 + 发光星点 +
单一金色强调"：那是这个品类的默认答案，不是选择。所以全站**没有**星野 canvas、
没有星云光晕、没有渐变文字、没有发光阴影 —— 早先那一版全有，后来整批拆掉了。

配色用 **OKLCH** 重建（借助 `oklch-skill`），不是手调的 hex。样式表里
**0 处 hex、0 处 rgba**。绒面上的三级文字全部 **L > 0.75**，冒烟检查卡这条。
强调只靠字重与尺寸，不靠渐变文字（`background-clip: text` 全站 0 处）。

三种表面，每一种只挑一个手段说话：托盘靠影子浮起（无描边），读数槽靠内阴影
凹进去（无落影），黄铜件靠一圈边（无浮起）。同时上描边和大投影是生成式 UI
的通病，`impeccable` 的检测器专门抓这个。

### 刻度

改造前审计的结果：26 种字号、15 种字距、104 个不同的 px 值，字重只有
500/600/700（正是 `ui-design-aesthetics` 点名要避开的"安全中间值"）。现在：

- **字号** 10 级刻度（比例 1.26），167 处引用，0 处裸 `font-size`
- **字距** 5 级，改用 `em`，跟着字号缩放
- **间距** 8 级，4px 为基
- **字重** 只留 400 / 700。中文字体没有可靠的 300/900，
  层级靠尺寸与字距的落差拉，不靠伪字重
- **拉丁字面** JetBrains Mono（拉丁子集 400/700，42KB），
  用 `unicode-range` 限定范围 —— 中文永远不会白等它加载
- **中文展示字** 思源宋体子集。整包 1521KB，页面实际只用到 900 上下个字，
  砍掉 89%。`font-display: swap` 且不 preload：首屏该抢带宽的是 42KB 的拉丁字面

**藏品 SVG 里刻意不用这套字**，仍写系统等宽 —— 那些图要能在 OpenSea、钱包、
任何地方独立渲染，不能依赖本站的字体文件。这条有冒烟检查守着。

### 中文排版

`text-wrap: pretty`（末行不留孤字）、`line-break: strict`（标点不落行首）、
表格数字（数值跳动时不左右位移）。

`text-wrap: balance` 只给两三行的短文本 —— 它为了把每行凑等长会挑出很别扭的
断点，中文尤其明显。

还有一条容易被忽略的：**HTML 会把中文句子里的源码换行折叠成一个可见空格**。
冒烟检查里有一项专门扫这个。

---

## 七、检查

### `npm run check` = 65 个合约测试 + 44 项冒烟检查

合约有单测守着，但元数据、图、分享页、路由、色值这些没人守 ——
它们坏掉的方式是"悄悄少了一个文件"或"某次重构漏改了一个 id"，跑一遍才看得见。

冒烟检查抓过的真问题，每一条后来都变成了一项检查：

| 出过的事 | 现在守着它的检查 |
|---|---|
| 重构后 JS 里留着已删除元素的引用，页面不报错但功能静默失效 | HTML/JS 之间 DOM id 是否都真实存在 |
| 新写的文案里有字没进字体子集，同一句话两种字面 | 中文子集覆盖率（拿生僻字验证过真的会拦） |
| `keeper.js` 用了 `notOpenYet` 却没 import，`node --check` 查不出来 | 共享导出与各页 import 比对 |
| 给合约的 `tokenURI` 加 `.json` 后缀，漏改前端三处 fetch，页面 404 | 直接从 `.sol` 读后缀，和前端拼法比对 |
| `external_url` 是 `https://example.com`，2136 件藏品全挂着 | 元数据里不许有占位地址，且必须同源 |
| 中文句子里的源码换行折叠成可见空格 | 扫描折行造成的空格 |

### `npm run preflight` = 上线闸

管的是"把它挂到公网上给陌生人用，还缺什么"。和冒烟检查分开，
因为本地开发时天天都在违反 preflight 的条件（指向 127.0.0.1、连本地链），
那不是错，只是还没到上线那一步。

- 合约部署在真链上（不是 chainId 31337）
- **连上链读 `TREASURY()`，和 `.env` 里的收款地址核对**
- `baseURI` 是公网可达的 `https://` 或 `ipfs://`，且以斜杠结尾
- 两个入口页的 `og:image` 是真域名（占位域名也会被抓出来）
- 88 张静态分享页的地址已经换过
- 影子钱包只在本机可用
- `_headers` / `_redirects` / `.nojekyll` / `robots.txt` / `sitemap.xml` 都在
- 元数据 2136 份齐全

### 自己还要确认的

- [ ] 用全新钱包做 deployer，`.env` 已在 `.gitignore`
- [ ] 测试网走完整流程，Blockscout 上验证源码
- [ ] 主网部署后自己先拾一枚，确认 OpenSea 显示正常、traits 正确
- [ ] 确认 `withdraw()` 能把钱打到金库（测试网上试一次）
- [ ] 再 `advancePhase(1)`

---

## 八、实现细节

**`survey(address)` 聚合视图** —— 前端一次调用拿到阶段、两层剩余量、
用户的星屑数和刻位号，省掉六次 RPC 往返。

**"missing revert data" 的三道防线**（`web/app.js`）：

1. 发交易前先 `staticCall` 干跑，让节点在不花 gas 的情况下吐出错误
2. 从 `e.data` / `e.error.data` / `e.info.error.data` 等各层挖出 4 字节选择器，
   用 ABI 反解成自定义错误名
3. 都失败时用客户端已知状态推断原因

每个自定义错误都映射成观星台口吻的提示，比如 `EmberLimitReached` →
「你已经拾满 14 枚了。观星台不会给第 15 枚。」

**登台要动手点。** 页面加载不自动连钱包 —— 打开一个网页不等于同意把地址交出去。
点【登台】走 `wallet_requestPermissions`，把钱包的授权弹窗真正拉起来（顺带能换账户），
老钱包不支持就退回 `eth_requestAccounts`。离台先弹确认，
然后 `wallet_revokePermissions` + 清空本地状态。

**题刻前必弹确认。** 落刀不可逆而且一任只有一次，所以按下去之前把用户写的那句话
原样摊开给他看，焦点默认落在"再想想"上 —— 回车不该替人做那个决定。

**不继承 ERC721Enumerable** —— 省 mint 的 gas，收藏区靠 `Transfer` 事件反查。

**版本号是内容哈希**（`scripts/stamp.js`）。手写 `?v=67` 的问题是改了文件忘记改它，
回头客拿到的就是缓存里的旧代码 —— 这个 bug 不报错、不留痕，只是有人看到的页面
和你以为的不是同一个。而且模块之间的 `import "./shared.js"` 根本没有版本号，
HTML 里怎么改都管不到。现在指纹同时打进 HTML 引用和 JS import，内容没变就不变。

### 踩过的坑

**rAF 在标签页不可见时不触发。** 曾经用 `body.booting { opacity: 0 }` +
`requestAnimationFrame` 做首屏淡入，结果在后台标签页里永久留白。
换成 CSS 动画同样不推进。现在整页遮罩已彻底移除。

**SVG 里的 `transform-origin: center` 必须配 `transform-box: fill-box`**，
否则原点是画布 (0,0)，元素缩放时会朝左上角飞走。

**ethers 的 `Result` 不是数组** —— 越界读会抛 `out of result range` 而不是返回
`undefined`，`seatOwners()` 必须 `Array.from` 摊平；结构体字段也别叫 `at`，
会和 `Array.prototype.at` 撞名。

**静态托管不给没有扩展名的文件正确的 content-type。** GitHub Pages 对
`/metadata/10001` 返回 `application/octet-stream` —— 内容是对的 JSON，类型是错的，
严格一点的索引器会跳过。所以 `tokenURI` 拼的是 `baseURI + tokenId + ".json"`。

**`export A=1 B=$A` 里的 `$A` 取的是旧值。** 一行连写会让 `BASE` 变成 `/metadata/`，
元数据里的图片地址全成相对路径。`golive.sh` 里分两行写，冒烟检查也会拦。

**首屏不等链** —— 骨架条占位，`loadNames / readOnlySurvey` 并行，
链上动态推到 `requestIdleCallback`。
