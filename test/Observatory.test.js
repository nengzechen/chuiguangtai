const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const PRICE = ethers.parseEther("0.0088");
const BASE = "ipfs://bafyDOME/";
const CONTRACT_URI = "ipfs://bafyDOME/contract.json";

const Phase = { Sealed: 0, Drifting: 1, Inscribing: 2 };
const Tier = { None: 0, Ember: 1, Constellation: 2 };

async function deploy() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();
  const Observatory = await ethers.getContractFactory("Observatory");
  const dome = await Observatory.deploy(
    BASE,
    CONTRACT_URI,
    PRICE,
    treasury.address,
    500
  );
  return { dome, owner, alice, bob, carol, treasury };
}

const DAY = 24 * 60 * 60;

/**
 * 拾满 n 枚：每天只给 2 枚，所以中间要跨天。
 * 天按 UTC 零点切，整整推 24 小时保证日号 +1。
 */
async function claimUpTo(dome, signer, n) {
  let got = Number(await dome.embersClaimedBy(signer.address));
  while (got < n) {
    const take = Math.min(2, n - got);
    await dome.connect(signer).claimEmbers(take);
    got += take;
    if (got < n) await time.increase(DAY);
  }
  return [...Array(n)].map((_, i) => i + 1); // 仅在单人场景下 id 就是 1..n
}

/** 推进到铭刻阶段，并让 signer 先拾一枚星屑（铭刻的前置条件）。 */
async function readyToInscribe(dome, signer) {
  await dome.advancePhase(Phase.Drifting);
  await dome.connect(signer).claimEmbers(1);
  await dome.advancePhase(Phase.Inscribing);
}

describe("Observatory 垂光台", function () {
  describe("部署", function () {
    it("闭台状态启动，两层都未开放", async function () {
      const { dome } = await loadFixture(deploy);
      expect(await dome.phase()).to.equal(Phase.Sealed);
      expect(await dome.embersDrifted()).to.equal(0);
      expect(await dome.constellationsInscribed()).to.equal(0);
    });

    it("上限就是设定里的两个数字", async function () {
      const { dome } = await loadFixture(deploy);
      expect(await dome.EMBER_SUPPLY()).to.equal(2048);
      expect(await dome.CONSTELLATION_SUPPLY()).to.equal(88);
      expect(await dome.EMBER_PER_WALLET()).to.equal(14);
      expect(await dome.EMBER_PER_DAY()).to.equal(2);
      expect(await dome.CONSTELLATION_PER_WALLET()).to.equal(1);
      expect(await dome.EMBERS_PER_SEAT()).to.equal(14);
      expect(await dome.FREE_SEATS()).to.equal(22);
    });

    it("survey 允许拿零地址问：没登台的人也要读得到全站数字", async function () {
      const { dome } = await loadFixture(deploy);
      const s = await dome.survey(ethers.ZeroAddress);
      expect(s.embersLeft).to.equal(2048);
      expect(s.constellationsLeft).to.equal(88);
      expect(s.keeperEmberBalance).to.equal(0);
      expect(s.freeSeatsLeft).to.equal(22);
    });

    it("宣告 ERC721 / ERC721Metadata / ERC2981", async function () {
      const { dome } = await loadFixture(deploy);
      expect(await dome.supportsInterface("0x80ac58cd")).to.equal(true);
      expect(await dome.supportsInterface("0x5b5e139f")).to.equal(true);
      expect(await dome.supportsInterface("0x2a55205a")).to.equal(true);
    });
  });

  describe("阶段", function () {
    it("闭台时两层都拒绝", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await expect(dome.connect(alice).claimEmbers(1))
        .to.be.revertedWithCustomError(dome, "DomeSealed");
      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
        .to.be.revertedWithCustomError(dome, "InscriptionNotOpen");
    });

    it("拾屑阶段只开放星屑", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);

      await dome.connect(alice).claimEmbers(1);
      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
        .to.be.revertedWithCustomError(dome, "InscriptionNotOpen");
    });

    it("阶段只进不退", async function () {
      const { dome } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Inscribing);
      await expect(dome.advancePhase(Phase.Drifting))
        .to.be.revertedWithCustomError(dome, "PhaseCannotGoBack");
      await expect(dome.advancePhase(Phase.Inscribing))
        .to.be.revertedWithCustomError(dome, "PhaseCannotGoBack");
    });

    it("只有 owner 能推进阶段", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await expect(dome.connect(alice).advancePhase(Phase.Drifting))
        .to.be.revertedWithCustomError(dome, "OwnableUnauthorizedAccount");
    });
  });

  describe("星屑（免费层）", function () {
    it("免费：只花 gas，不收 ETH", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await dome.connect(alice).claimEmbers(2);

      expect(await ethers.provider.getBalance(await dome.getAddress())).to.equal(0);
      expect(await dome.balanceOf(alice.address)).to.equal(2);
    });

    it("id 从 1 开始连号，且属于 Ember 层", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await dome.connect(alice).claimEmbers(2);

      expect(await dome.ownerOf(1)).to.equal(alice.address);
      expect(await dome.ownerOf(2)).to.equal(alice.address);
      expect(await dome.tierOf(1)).to.equal(Tier.Ember);
      expect(await dome.tierOf(2048)).to.equal(Tier.Ember);
    });

    it("一天最多 2 枚，分两次拾也算同一天", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);

      await dome.connect(alice).claimEmbers(1);
      await dome.connect(alice).claimEmbers(1);
      await expect(dome.connect(alice).claimEmbers(1))
        .to.be.revertedWithCustomError(dome, "DailyLimitReached");
    });

    it("过了 UTC 零点，日额度自己回来", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);

      await dome.connect(alice).claimEmbers(2);
      expect(await dome.takenToday(alice.address)).to.equal(2);

      await time.increase(DAY);
      expect(await dome.takenToday(alice.address)).to.equal(0);
      await dome.connect(alice).claimEmbers(2);
      expect(await dome.embersClaimedBy(alice.address)).to.equal(4);
    });

    it("拾满 14 枚就到顶了，再等多少天也没有第 15 枚", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);

      await claimUpTo(dome, alice, 14);
      expect(await dome.embersClaimedBy(alice.address)).to.equal(14);

      await time.increase(DAY);
      await expect(dome.connect(alice).claimEmbers(1))
        .to.be.revertedWithCustomError(dome, "EmberLimitReached");
    });

    it("单笔超过 2 枚直接拒绝", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await expect(dome.connect(alice).claimEmbers(3))
        .to.be.revertedWithCustomError(dome, "BadQuantity");
      await expect(dome.connect(alice).claimEmbers(0))
        .to.be.revertedWithCustomError(dome, "BadQuantity");
    });

    it("额度是每个钱包独立的", async function () {
      const { dome, alice, bob } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await dome.connect(alice).claimEmbers(2);
      await dome.connect(bob).claimEmbers(2);
      expect(await dome.embersDrifted()).to.equal(4);
    });

    it("emit EmberDrifted", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await expect(dome.connect(alice).claimEmbers(1))
        .to.emit(dome, "EmberDrifted")
        .withArgs(alice.address, 1);
    });
  });

  describe("星座（付费层）", function () {
    it("没拾过星屑就不能铭刻", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Inscribing);
      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
        .to.be.revertedWithCustomError(dome, "NoEmberHeld");
    });

    it("拾过星屑后可以铭刻，id 落在 10001 起的段位", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);

      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
        .to.emit(dome, "ConstellationInscribed")
        .withArgs(alice.address, 10001, 1);

      expect(await dome.ownerOf(10001)).to.equal(alice.address);
      expect(await dome.tierOf(10001)).to.equal(Tier.Constellation);
      expect(await dome.constellationOf(alice.address)).to.equal(10001);
    });

    it("每个钱包只能刻一个", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);
      await dome.connect(alice).inscribeConstellation({ value: PRICE });

      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
        .to.be.revertedWithCustomError(dome, "AlreadyInscribed");
    });

    it("金额必须精确", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);

      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE - 1n }))
        .to.be.revertedWithCustomError(dome, "WrongPayment")
        .withArgs(PRICE, PRICE - 1n);
      await expect(dome.connect(alice).inscribeConstellation({ value: PRICE * 2n }))
        .to.be.revertedWithCustomError(dome, "WrongPayment");
    });

    it("刻位按顺序发放", async function () {
      const { dome, alice, bob, carol } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      for (const s of [alice, bob, carol]) await dome.connect(s).claimEmbers(1);
      await dome.advancePhase(Phase.Inscribing);

      await dome.connect(alice).inscribeConstellation({ value: PRICE });
      await dome.connect(bob).inscribeConstellation({ value: PRICE });
      await dome.connect(carol).inscribeConstellation({ value: PRICE });

      expect(await dome.constellationOf(alice.address)).to.equal(10001);
      expect(await dome.constellationOf(bob.address)).to.equal(10002);
      expect(await dome.constellationOf(carol.address)).to.equal(10003);
      expect(await dome.constellationsInscribed()).to.equal(3);
    });

    it("献纳只能流向写死的金库，谁按这个按钮都一样", async function () {
      const { dome, alice, bob, treasury } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);
      await dome.connect(alice).inscribeConstellation({ value: PRICE });

      const addr = await dome.getAddress();
      expect(await ethers.provider.getBalance(addr)).to.equal(PRICE);
      expect(await dome.TREASURY()).to.equal(treasury.address);

      // 不是 owner 也能按 —— 收款地址写死了，按下去的结果只有一个
      const before = await ethers.provider.getBalance(treasury.address);
      await expect(dome.connect(bob).withdraw())
        .to.emit(dome, "Withdrawn")
        .withArgs(treasury.address, PRICE);

      expect(await ethers.provider.getBalance(treasury.address) - before).to.equal(PRICE);
      expect(await ethers.provider.getBalance(addr)).to.equal(0);
    });

    it("空合约提现是空操作，不 revert", async function () {
      const { dome, bob } = await loadFixture(deploy);
      await expect(dome.connect(bob).withdraw()).to.not.be.reverted;
    });

    it("版税收款人默认也是金库", async function () {
      const { dome, treasury } = await loadFixture(deploy);
      const [receiver, amount] = await dome.royaltyInfo(10001, 10_000n);
      expect(receiver).to.equal(treasury.address);
      expect(amount).to.equal(500n); // 5%
    });

    it("金库不能是零地址", async function () {
      const O = await ethers.getContractFactory("Observatory");
      await expect(O.deploy(BASE, CONTRACT_URI, PRICE, ethers.ZeroAddress, 500))
        .to.be.revertedWithCustomError(O, "ZeroTreasury");
    });
  });

  describe("tokenURI / 分层", function () {
    it("两层各自拼出正确的 URI", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);
      await dome.connect(alice).inscribeConstellation({ value: PRICE });

      // 后缀是给静态托管用的：没有扩展名就拿不到 application/json
      expect(await dome.tokenURI(1)).to.equal(BASE + "1.json");
      expect(await dome.tokenURI(10001)).to.equal(BASE + "10001.json");
    });

    it("tokenURI 对不存在的编号会 revert", async function () {
      const { dome } = await loadFixture(deploy);
      await expect(dome.tokenURI(9999))
        .to.be.revertedWithCustomError(dome, "ERC721NonexistentToken");
    });

    it("tierOf 的边界正确", async function () {
      const { dome } = await loadFixture(deploy);
      expect(await dome.tierOf(0)).to.equal(Tier.None);
      expect(await dome.tierOf(1)).to.equal(Tier.Ember);
      expect(await dome.tierOf(2048)).to.equal(Tier.Ember);
      expect(await dome.tierOf(2049)).to.equal(Tier.None);
      expect(await dome.tierOf(10000)).to.equal(Tier.None);
      expect(await dome.tierOf(10001)).to.equal(Tier.Constellation);
      expect(await dome.tierOf(10088)).to.equal(Tier.Constellation);
      expect(await dome.tierOf(10089)).to.equal(Tier.None);
    });

    it("两层的 id 段永不重叠", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);
      await dome.connect(alice).inscribeConstellation({ value: PRICE });

      // 星屑最多到 2048，星座从 10001 起，中间隔着 7952 个空位
      expect(await dome.EMBER_SUPPLY()).to.be.lessThan(
        await dome.CONSTELLATION_OFFSET()
      );
    });
  });

  describe("survey 聚合视图", function () {
    it("一次调用返回前端需要的全部状态", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await readyToInscribe(dome, alice);
      await dome.connect(alice).inscribeConstellation({ value: PRICE });

      const s = await dome.survey(alice.address);
      expect(s.currentPhase).to.equal(Phase.Inscribing);
      expect(s.embersLeft).to.equal(2047);
      expect(s.constellationsLeft).to.equal(87);
      expect(s.keeperEmbers).to.equal(1);
      expect(s.keeperConstellation).to.equal(10001);
      expect(s.price).to.equal(PRICE);
    });

    it("对没来过的地址返回干净的零值", async function () {
      const { dome, bob } = await loadFixture(deploy);
      const s = await dome.survey(bob.address);
      expect(s.keeperEmbers).to.equal(0);
      expect(s.keeperConstellation).to.equal(0);
      expect(s.embersLeft).to.equal(2048);
      expect(s.constellationsLeft).to.equal(88);
    });
  });

  describe("版税与管理", function () {
    it("默认 5% 给指定收款地址", async function () {
      const { dome, treasury } = await loadFixture(deploy);
      const [r, a] = await dome.royaltyInfo(10001, ethers.parseEther("1"));
      expect(r).to.equal(treasury.address);
      expect(a).to.equal(ethers.parseEther("0.05"));
    });

    it("不能弃权：弃权就等于把台子永远锁在当前阶段", async function () {
      const { dome, owner } = await loadFixture(deploy);
      await expect(dome.connect(owner).renounceOwnership())
        .to.be.revertedWithCustomError(dome, "OwnershipRequired");
      expect(await dome.owner()).to.equal(owner.address);
    });

    it("非 owner 打不开任何管理接口", async function () {
      const { dome, alice } = await loadFixture(deploy);
      const calls = [
        dome.connect(alice).advancePhase(Phase.Drifting),
        dome.connect(alice).setBaseURI("ipfs://x/"),
        dome.connect(alice).setContractURI("ipfs://x.json"),
        dome.connect(alice).setDefaultRoyalty(alice.address, 100),
      ];
      for (const c of calls) {
        await expect(c).to.be.revertedWithCustomError(
          dome,
          "OwnableUnauthorizedAccount"
        );
      }
    });

    it("换 baseURI 后两层的 URI 一起变（reveal 用）", async function () {
      const { dome, alice } = await loadFixture(deploy);
      await dome.advancePhase(Phase.Drifting);
      await dome.connect(alice).claimEmbers(1);

      await dome.setBaseURI("ipfs://revealed/");
      expect(await dome.tokenURI(1)).to.equal("ipfs://revealed/1.json");
    });
  });

  describe("稀缺性上限", function () {
    it("星座刻满 88 个后拒绝", async function () {
      const dome = await (async () => {
        const [owner, , , , treasury] = await ethers.getSigners();
        const O = await ethers.getContractFactory("Observatory");
        return O.deploy(BASE, CONTRACT_URI, 0, treasury.address, 500);
      })();

      await dome.advancePhase(Phase.Drifting);
      await dome.advancePhase(Phase.Inscribing);

      // 88 个不同的钱包各刻一个，第 89 个必须失败
      const keepers = [];
      for (let i = 0; i < 89; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [
          w.address,
          "0x56BC75E2D63100000", // 100 ETH
        ]);
        keepers.push(w);
      }

      for (let i = 0; i < 88; i++) {
        await dome.connect(keepers[i]).claimEmbers(1);
        await dome.connect(keepers[i]).inscribeConstellation({ value: 0 });
      }

      expect(await dome.constellationsInscribed()).to.equal(88);
      expect(await dome.ownerOf(10088)).to.equal(keepers[87].address);

      await dome.connect(keepers[88]).claimEmbers(1);
      await expect(dome.connect(keepers[88]).inscribeConstellation({ value: 0 }))
        .to.be.revertedWithCustomError(dome, "DomeFull");
    });
  });
});

// ═══════════════════════════════════════════════════ 交星屑换刻位

describe("Observatory 交星屑换刻位", function () {
  /** 让 signer 拾满 14 枚并进入铭刻阶段，返回它名下那 14 个编号。 */
  async function readyToOffer(dome, signer) {
    await dome.advancePhase(Phase.Drifting);
    await claimUpTo(dome, signer, 14);
    await dome.advancePhase(Phase.Inscribing);
    const ids = [];
    for (let id = 1; id <= 2048 && ids.length < 14; id++) {
      if (await dome.ownerOf(id).catch(() => null) === signer.address) ids.push(id);
    }
    return ids;
  }

  it("交出 14 枚亲手拾的星屑，换到一个刻位；那 14 枚被烧掉", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);

    await expect(dome.connect(alice).inscribeWithEmbers(ids))
      .to.emit(dome, "ConstellationInscribed")
      .withArgs(alice.address, 10001, 1);

    expect(await dome.ownerOf(10001)).to.equal(alice.address);
    // 星屑全烧了，手里只剩那个刻位
    expect(await dome.balanceOf(alice.address)).to.equal(1);
    for (const id of ids) {
      await expect(dome.ownerOf(id)).to.be.reverted;
    }
    // 烧掉不改写"亲手拾过多少"——那是履历，不是余额
    expect(await dome.embersClaimedBy(alice.address)).to.equal(14);
    expect(await dome.freeInscribed()).to.equal(1);
  });

  it("一分钱都不用付", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await dome.connect(alice).inscribeWithEmbers(ids);
    expect(await ethers.provider.getBalance(await dome.getAddress())).to.equal(0);
  });

  it("数量不是 14 就不收", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await expect(dome.connect(alice).inscribeWithEmbers(ids.slice(0, 13)))
      .to.be.revertedWithCustomError(dome, "BadOffering");
  });

  it("同一个编号交两次不算数", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    const dup = [...ids.slice(0, 13), ids[0]];
    await expect(dome.connect(alice).inscribeWithEmbers(dup)).to.be.reverted;
  });

  it("交别人的星屑不算数", async function () {
    const { dome, alice, bob } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await expect(dome.connect(bob).inscribeWithEmbers(ids))
      .to.be.revertedWithCustomError(dome, "NotEnoughEmbers");
  });

  it("买来 14 枚也换不到：只认亲手拾过的", async function () {
    const { dome, alice, bob } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    // alice 把 14 枚全转给 bob；bob 手里有货，但一枚都没亲手拾过
    for (const id of ids) {
      await dome.connect(alice).transferFrom(alice.address, bob.address, id);
    }
    expect(await dome.balanceOf(bob.address)).to.equal(14);
    await expect(dome.connect(bob).inscribeWithEmbers(ids))
      .to.be.revertedWithCustomError(dome, "NotEnoughEmbers");
  });

  it("拾满过但已经卖掉：有履历也拿不出货", async function () {
    const { dome, alice, bob } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await dome.connect(alice).transferFrom(alice.address, bob.address, ids[0]);
    await expect(dome.connect(alice).inscribeWithEmbers(ids))
      .to.be.revertedWithCustomError(dome, "NotYourEmber");
  });

  it("交出来的必须是星屑，不能拿刻位充数", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await expect(
      dome.connect(alice).inscribeWithEmbers([...ids.slice(0, 13), 10001])
    ).to.be.revertedWithCustomError(dome, "NotAnEmber");
  });

  it("换过一次就不能再换，也不能再付钱刻第二个", async function () {
    const { dome, alice } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await dome.connect(alice).inscribeWithEmbers(ids);
    await expect(dome.connect(alice).inscribeConstellation({ value: PRICE }))
      .to.be.revertedWithCustomError(dome, "AlreadyInscribed");
  });

  it("22 个名额换完，第 23 个只能付钱", async function () {
    const { dome } = await loadFixture(deploy);
    await dome.advancePhase(Phase.Drifting);

    // 23 个钱包各自拾满 14 枚（同一批交易里跨天，大家进度一致）
    const keepers = [];
    for (let i = 0; i < 23; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await ethers.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);
      keepers.push(w);
    }
    const owned = new Map(keepers.map((k) => [k.address, []]));
    let next = 1;
    for (let day = 0; day < 7; day++) {
      for (const k of keepers) {
        await dome.connect(k).claimEmbers(2);
        owned.get(k.address).push(next++, next++);
      }
      if (day < 6) await time.increase(DAY);
    }
    await dome.advancePhase(Phase.Inscribing);

    for (let i = 0; i < 22; i++) {
      await dome.connect(keepers[i]).inscribeWithEmbers(owned.get(keepers[i].address));
    }
    expect(await dome.freeInscribed()).to.equal(22);

    await expect(
      dome.connect(keepers[22]).inscribeWithEmbers(owned.get(keepers[22].address))
    ).to.be.revertedWithCustomError(dome, "FreeSeatsGone");

    // 付费那条路还开着
    await dome.connect(keepers[22]).inscribeConstellation({ value: PRICE });
    expect(await dome.constellationsInscribed()).to.equal(23);
  });

  it("两条路共用同一串刻位号，谁先到谁在前", async function () {
    const { dome, alice, bob } = await loadFixture(deploy);
    const ids = await readyToOffer(dome, alice);
    await dome.connect(bob).claimEmbers(1);          // bob 只拾一枚，走付费

    await dome.connect(bob).inscribeConstellation({ value: PRICE });
    await dome.connect(alice).inscribeWithEmbers(ids);

    expect(await dome.constellationOf(bob.address)).to.equal(10001);
    expect(await dome.constellationOf(alice.address)).to.equal(10002);
  });

  it("闭台时这条路也走不通", async function () {
    const { dome, alice } = await loadFixture(deploy);
    await expect(dome.connect(alice).inscribeWithEmbers([...Array(14)].map((_, i) => i + 1)))
      .to.be.revertedWithCustomError(dome, "InscriptionNotOpen");
  });
});

// ═══════════════════════════════════════════════════ 刻痕志与传承

describe("Observatory 刻痕志", function () {
  const PRICE2 = ethers.parseEther("0.0088");

  async function withSeat() {
    const f = await loadFixture(deploy);
    await f.dome.advancePhase(Phase.Drifting);
    await f.dome.connect(f.alice).claimEmbers(1);
    await f.dome.advancePhase(Phase.Inscribing);
    await f.dome.connect(f.alice).inscribeConstellation({ value: PRICE2 });
    return { ...f, tokenId: 10001n };
  }

  it("铭刻时自动开志，第一条属于铭刻者且留白", async function () {
    const { dome, alice, tokenId } = await withSeat();
    const marks = await dome.chronicleOf(tokenId);

    expect(marks.length).to.equal(1);
    expect(marks[0].keeper).to.equal(alice.address);
    expect(marks[0].words).to.equal("");
    expect(marks[0].heldSince).to.be.greaterThan(0);
  });

  it("持有者可以题刻一次", async function () {
    const { dome, alice, tokenId } = await withSeat();

    expect(await dome.canCarve(tokenId, alice.address)).to.equal(true);

    await expect(dome.connect(alice).carveWords(tokenId, "第一次抬头看见它"))
      .to.emit(dome, "WordsCarved")
      .withArgs(tokenId, alice.address, "第一次抬头看见它");

    const marks = await dome.chronicleOf(tokenId);
    expect(marks.length).to.equal(1);
    expect(marks[0].words).to.equal("第一次抬头看见它");
    expect(await dome.canCarve(tokenId, alice.address)).to.equal(false);
  });

  it("题过就封上：本人也改不了、删不了", async function () {
    const { dome, alice, tokenId } = await withSeat();
    await dome.connect(alice).carveWords(tokenId, "第一次抬头看见它");

    await expect(dome.connect(alice).carveWords(tokenId, "改了主意"))
      .to.be.revertedWithCustomError(dome, "WordsAlreadyCarved");
    await expect(dome.connect(alice).carveWords(tokenId, ""))
      .to.be.revertedWithCustomError(dome, "EmptyWords");

    const marks = await dome.chronicleOf(tokenId);
    expect(marks[0].words).to.equal("第一次抬头看见它");
  });

  it("空白刻不上去：一次机会不能浪费在空字符串上", async function () {
    const { dome, alice, tokenId } = await withSeat();
    await expect(dome.connect(alice).carveWords(tokenId, ""))
      .to.be.revertedWithCustomError(dome, "EmptyWords");
    expect(await dome.canCarve(tokenId, alice.address)).to.equal(true);
  });

  it("买来的刻位给新主人一次全新的机会，同样只有一次", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    await dome.connect(alice).carveWords(tokenId, "A 只说一次");
    await dome.connect(alice).transferFrom(alice.address, bob.address, tokenId);

    // B 接手：机会重新给一次
    expect(await dome.canCarve(tokenId, bob.address)).to.equal(true);
    await dome.connect(bob).carveWords(tokenId, "B 也只说一次");

    // 用完就没了
    expect(await dome.canCarve(tokenId, bob.address)).to.equal(false);
    await expect(dome.connect(bob).carveWords(tokenId, "再补一句"))
      .to.be.revertedWithCustomError(dome, "WordsAlreadyCarved");

    // A 的那一行一个字没动
    const marks = await dome.chronicleOf(tokenId);
    expect(marks.map((m) => m.words)).to.deep.equal(["A 只说一次", "B 也只说一次"]);
  });

  it("canCarve：不是自己的刻位、或者是星屑，都返回 false", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    expect(await dome.canCarve(tokenId, bob.address)).to.equal(false);
    expect(await dome.canCarve(1, alice.address)).to.equal(false);
  });

  it("非持有者不能题刻", async function () {
    const { dome, bob, tokenId } = await withSeat();
    await expect(dome.connect(bob).carveWords(tokenId, "我也想留一句"))
      .to.be.revertedWithCustomError(dome, "NotYourSeat");
  });

  it("星屑没有刻痕志", async function () {
    const { dome, alice } = await withSeat();
    await expect(dome.connect(alice).carveWords(1, "星屑也想说话"))
      .to.be.revertedWithCustomError(dome, "NotAConstellation");
  });

  it("题刻超过 140 字节被拒", async function () {
    const { dome, alice, tokenId } = await withSeat();
    await expect(dome.connect(alice).carveWords(tokenId, "x".repeat(141)))
      .to.be.revertedWithCustomError(dome, "WordsTooLong")
      .withArgs(140, 141);
    await dome.connect(alice).carveWords(tokenId, "x".repeat(140));
  });

  it("A 转给 B：追加新记录，A 的题刻原样保留", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    await dome.connect(alice).carveWords(tokenId, "我把它交给下一个人");

    await expect(
      dome.connect(alice).transferFrom(alice.address, bob.address, tokenId)
    )
      .to.emit(dome, "SeatPassedOn")
      .withArgs(tokenId, alice.address, bob.address, 1);

    const marks = await dome.chronicleOf(tokenId);
    expect(marks.length).to.equal(2);

    // A 的那一行原封不动
    expect(marks[0].keeper).to.equal(alice.address);
    expect(marks[0].words).to.equal("我把它交给下一个人");

    // B 拿到一行空白，等他自己填
    expect(marks[1].keeper).to.equal(bob.address);
    expect(marks[1].words).to.equal("");
  });

  it("B 题刻只动自己那行，A 的一个字都改不了", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    await dome.connect(alice).carveWords(tokenId, "A 到此一游");
    await dome.connect(alice).transferFrom(alice.address, bob.address, tokenId);
    await dome.connect(bob).carveWords(tokenId, "B 接手了");

    const marks = await dome.chronicleOf(tokenId);
    expect(marks.map((m) => m.words)).to.deep.equal(["A 到此一游", "B 接手了"]);
    expect(marks.map((m) => m.keeper)).to.deep.equal([alice.address, bob.address]);

    // 转出去之后 A 再也写不了
    await expect(dome.connect(alice).carveWords(tokenId, "反悔"))
      .to.be.revertedWithCustomError(dome, "NotYourSeat");
  });

  it("转手三次，刻痕志按顺序留下四条", async function () {
    const { dome, alice, bob, carol, owner, tokenId } = await withSeat();
    await dome.connect(alice).transferFrom(alice.address, bob.address, tokenId);
    await dome.connect(bob).transferFrom(bob.address, carol.address, tokenId);
    await dome.connect(carol).transferFrom(carol.address, owner.address, tokenId);

    const marks = await dome.chronicleOf(tokenId);
    expect(await dome.chronicleLength(tokenId)).to.equal(4);
    expect(marks.map((m) => m.keeper)).to.deep.equal([
      alice.address, bob.address, carol.address, owner.address,
    ]);
  });

  it("转让后 constellationBalance 跟着走", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    expect(await dome.constellationBalance(alice.address)).to.equal(1);
    expect(await dome.constellationBalance(bob.address)).to.equal(0);

    await dome.connect(alice).transferFrom(alice.address, bob.address, tokenId);
    expect(await dome.constellationBalance(alice.address)).to.equal(0);
    expect(await dome.constellationBalance(bob.address)).to.equal(1);
  });

  it("一个钱包可以通过二级市场攒下多个刻位", async function () {
    const { dome, alice, bob, carol } = await loadFixture(deploy);
    await dome.advancePhase(Phase.Drifting);
    for (const s of [alice, bob, carol]) await dome.connect(s).claimEmbers(1);
    await dome.advancePhase(Phase.Inscribing);
    for (const s of [alice, bob, carol]) {
      await dome.connect(s).inscribeConstellation({ value: PRICE2 });
    }

    // bob、carol 把刻位都转给 alice
    await dome.connect(bob).transferFrom(bob.address, alice.address, 10002);
    await dome.connect(carol).transferFrom(carol.address, alice.address, 10003);

    expect(await dome.constellationBalance(alice.address)).to.equal(3);
    // 但 alice 亲手铭刻的仍然只有第一个 —— 门槛记的是"来过"，不是"买过"
    expect(await dome.constellationOf(alice.address)).to.equal(10001);
    // 攒够 3 个也不能再铭刻第二次
    await expect(dome.connect(alice).inscribeConstellation({ value: PRICE2 }))
      .to.be.revertedWithCustomError(dome, "AlreadyInscribed");
  });

  it("seatOwners 一次读完整张穹顶，并随转让更新", async function () {
    const { dome, alice, bob, carol } = await loadFixture(deploy);
    await dome.advancePhase(Phase.Drifting);
    for (const s of [alice, bob]) await dome.connect(s).claimEmbers(1);
    await dome.advancePhase(Phase.Inscribing);

    expect(await dome.seatOwners()).to.deep.equal([]);

    await dome.connect(alice).inscribeConstellation({ value: PRICE2 });
    await dome.connect(bob).inscribeConstellation({ value: PRICE2 });
    expect(await dome.seatOwners()).to.deep.equal([alice.address, bob.address]);

    await dome.connect(bob).transferFrom(bob.address, carol.address, 10002);
    expect(await dome.seatOwners()).to.deep.equal([alice.address, carol.address]);
  });

  it("survey 带出持有刻位数（用于称号）", async function () {
    const { dome, alice, bob, tokenId } = await withSeat();
    await dome.connect(alice).transferFrom(alice.address, bob.address, tokenId);

    expect((await dome.survey(bob.address)).keeperSeats).to.equal(1);
    expect((await dome.survey(alice.address)).keeperSeats).to.equal(0);
    // 亲手铭刻的记录不因转让而消失
    expect((await dome.survey(alice.address)).keeperConstellation).to.equal(10001);
  });

  it("星屑转让不产生刻痕志，也不影响持有量", async function () {
    const { dome, alice, bob } = await loadFixture(deploy);
    await dome.advancePhase(Phase.Drifting);
    await dome.connect(alice).claimEmbers(1);
    await dome.connect(alice).transferFrom(alice.address, bob.address, 1);

    expect(await dome.chronicleLength(1)).to.equal(0);
    expect(await dome.constellationBalance(bob.address)).to.equal(0);
  });
});
