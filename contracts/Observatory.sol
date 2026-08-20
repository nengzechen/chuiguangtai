// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 *                        垂  光  台
 *                  THE  LAST  OBSERVATORY
 *
 *  宇宙正在熄灭。垂光台是最后一座仍在运转的观星台，它只做一件事：
 *  在每一颗恒星死去时，记录下它最后的光。
 *
 *  你可以做两件事。
 *
 *  一、拾取星屑（免费）
 *      恒星死后散落的余烬，飘过观星台的穹顶。任何人都能伸手接住。
 *      共 2048 枚 —— 这是垂光台在燃料耗尽前还能完成的观测次数。
 *      每天最多接住 2 枚，一个钱包总共最多 14 枚。
 *      14 枚要来七天 —— 星屑不值钱，它记的是你来过几次。
 *
 *  二、铭刻星座（88 席，两条路只能走一条）
 *      把星屑连成图案，署上名字，永久刻进穹顶内壁。
 *      共 88 个 —— 人类命名过的星座，一个不多，一个不少。
 *      每个钱包只能刻一个。刻完，你的名字就和那片天空绑在一起了。
 *
 *        · 献纳：付 0.0088 ETH。
 *        · 交出：把你亲手拾满的 14 枚星屑烧掉，换一个位置。
 *          这条路只留 22 席 —— 不设上限的话，2048 枚星屑够换 146 个位置，
 *          而位置只有 88 个，献纳那条路就没人走了。
 *
 *  规矩只有一条：没亲手拾过星屑的人，不能铭刻星座。
 *  观星台不认钱，只认你来过。
 *
 *  ── 刻痕志 ──
 *
 *  每个刻位底下都刻着一本志。谁拿到它，谁就能在志上题一行字。
 *  刻位可以转让 —— 星座毕竟是能交易的 —— 但转让只会往志上追加一行，
 *  前人题的字一个也擦不掉。垂光台记录光，也记录经手过光的人。
 *
 *  一个钱包持有的刻位越多，它在穹顶上的分量越重：
 *  1 席是执灯人，16 席以上就是司天监。称号由 constellationBalance 决定。
 */
contract Observatory is ERC721, ERC2981, Ownable {
    /// @notice 观测阶段。闭台 → 拾屑 → 铭刻，只进不退。
    enum Phase {
        Sealed,      // 闭台：穹顶未开
        Drifting,    // 拾屑：星屑飘过，可免费拾取
        Inscribing   // 铭刻：穹顶开放，可铭刻星座
    }

    /// @notice 两种藏品。星屑是入场券，星座是署名权。
    enum Tier {
        None,
        Ember,          // 星屑
        Constellation   // 星座
    }

    // ---------------------------------------------------------------- 常量

    /// @dev 垂光台燃料耗尽前还能完成的观测次数。
    uint256 public constant EMBER_SUPPLY = 2048;
    /// @dev 人类命名过的星座总数，IAU 官方数字。
    uint256 public constant CONSTELLATION_SUPPLY = 88;

    /// @dev 一个钱包总共能亲手拾多少枚。14 枚正好换一个刻位。
    uint256 public constant EMBER_PER_WALLET = 14;
    /// @dev 一天能拾多少枚。14 ÷ 2 = 七天 —— 拾满是"来过七次"，不是"点了七下"。
    uint256 public constant EMBER_PER_DAY = 2;
    uint256 public constant CONSTELLATION_PER_WALLET = 1;

    /// @dev 交出多少枚星屑换一个刻位。和每个钱包的总上限是同一个数。
    uint256 public constant EMBERS_PER_SEAT = 14;
    /**
     * @dev 88 席里留给"交星屑"这条路的名额。
     *      不设名额的话，2048 ÷ 14 = 146 个位置的兑换力，而位置只有 88 个 ——
     *      献纳那条路会被完全挤掉。22 = 88 的四分之一。
     */
    uint256 public constant FREE_SEATS = 22;

    /// @dev 星屑占 1..2048，星座从 10001 起。看 id 就知道是哪一层。
    uint256 public constant CONSTELLATION_OFFSET = 10000;

    /// @dev 题刻长度上限（字节）。石壁就这么大。
    uint256 public constant MAX_WORDS = 140;

    // ---------------------------------------------------------------- 状态

    Phase public phase;
    uint256 public immutable INSCRIPTION_PRICE;

    /**
     * @notice 献纳的钱只能去这一个地址，部署那一刻就钉死，之后谁也改不了。
     * @dev 故意不做成 owner 可改的参数，也不给 withdraw 留收款人参数 ——
     *      "钱会去哪儿"这件事应该在链上一眼看得出来，而不是取决于我此刻是谁。
     */
    address public immutable TREASURY;

    uint256 public embersDrifted;      // 已拾取的星屑数
    uint256 public constellationsInscribed; // 已铭刻的星座数

    /// @dev 亲手拾取过的数量。二级市场买来的星屑不算 —— 观星台只认你来过。
    mapping(address => uint256) public embersClaimedBy;

    /**
     * @dev 每日额度。按 UTC 零点切天（block.timestamp / 1 days）。
     *      不记"上次几点拾的"而是记"上次拾的是哪一天"：
     *      按 24 小时滚动窗口算的话，每天都会往后漂一点，
     *      到第七天用户已经说不清自己什么时候能再来了。
     */
    mapping(address => uint256) public lastClaimDay;
    mapping(address => uint256) public claimedOnDay;

    /// @dev 已经被"交星屑"换走的席位数，上限 FREE_SEATS。
    uint256 public freeInscribed;
    mapping(address => uint256) public constellationOf; // 0 = 尚未亲手铭刻

    /// @notice 一行题刻。转让只会追加，永不覆盖前人。
    struct Mark {
        address keeper;
        uint64 heldSince; // 接手时的区块时间。别叫 at —— 会和 Array.prototype.at 撞名
        string words;   // 题刻，可为空
    }

    /// @dev tokenId => 历任持有者的题刻，索引 0 是最初的铭刻者。
    mapping(uint256 => Mark[]) private _chronicle;

    /// @notice 当前持有的星座数量。决定这个钱包在穹顶上的称号。
    mapping(address => uint256) public constellationBalance;

    /// @dev ordinal(1..88) => 当前持有者，供前端一次读完整张穹顶。
    address[] private _seatOwners;

    string private _base;
    string public contractURI;

    // ---------------------------------------------------------------- 事件

    event PhaseAdvanced(Phase phase);
    event EmberDrifted(address indexed keeper, uint256 indexed tokenId);
    event ConstellationInscribed(
        address indexed keeper,
        uint256 indexed tokenId,
        uint256 indexed ordinal
    );
    event BaseURIUpdated(string baseURI);

    /// @notice 刻位易主。index 是这条记录在刻痕志里的位置。
    event SeatPassedOn(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        uint256 index
    );
    event WordsCarved(uint256 indexed tokenId, address indexed keeper, string words);
    event Withdrawn(address indexed treasury, uint256 amount);

    // ---------------------------------------------------------------- 错误

    error DomeSealed();          // 穹顶未开
    error InscriptionNotOpen();  // 尚未进入铭刻阶段
    error BadQuantity();         // 数量不合法
    error EmberLimitReached();   // 已达每人 14 枚星屑
    error DailyLimitReached();   // 今天的 2 枚已经拾过了
    error FreeSeatsGone();       // 22 个可用星屑换的席位已经换完
    error NotEnoughEmbers();     // 亲手拾的还不够 14 枚
    error BadOffering();         // 交出的星屑数量不对
    error NotYourEmber();        // 这枚星屑不在你手里
    error NotAnEmber();          // 交出来的不是星屑
    error EmbersExhausted();     // 2048 枚星屑已被拾尽
    error DomeFull();            // 88 个星座已刻满
    error AlreadyInscribed();    // 每个钱包只能刻一个
    error NoEmberHeld();         // 没亲手拾过星屑
    error WrongPayment(uint256 expected, uint256 sent);
    error WithdrawFailed();
    error PhaseCannotGoBack();   // 阶段只进不退
    error ZeroTreasury();        // 金库不能是零地址
    error OwnershipRequired();   // 这个合约不能弃权
    error NotYourSeat();         // 你不持有这个刻位
    error NotAConstellation();   // 星屑上没有刻痕志
    error WordsTooLong(uint256 max, uint256 got);
    error WordsAlreadyCarved();  // 这一任只能题一次，刻上去就改不了
    error EmptyWords();          // 空白刻不上石壁

    // ---------------------------------------------------------------- 构造

    constructor(
        string memory baseURI_,
        string memory contractURI_,
        uint256 inscriptionPrice_,
        address treasury_,
        uint96 royaltyBps
    ) ERC721(unicode"垂光台 · The Last Observatory", "DOME") Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        _base = baseURI_;
        contractURI = contractURI_;
        INSCRIPTION_PRICE = inscriptionPrice_;
        TREASURY = treasury_;
        // 版税默认也走同一个地址。它是可改的（市场那边的规则会变），
        // 但献纳的本金不可改 —— 这两件事的严肃程度不一样。
        _setDefaultRoyalty(treasury_, royaltyBps);
    }

    // ------------------------------------------------------------ 一、拾星屑

    /**
     * @notice 免费拾取星屑，只花 gas。每天最多 2 枚，一个钱包总共最多 14 枚。
     * @dev 天按 UTC 零点切。日额度挡不住多开地址（拾星屑只花 gas），
     *      它挡的是"一个人一次把额度用光"——拾满 14 枚必须来七天，
     *      这正是这一层要记的东西：你来过几次。
     */
    function claimEmbers(uint256 qty) external {
        if (phase == Phase.Sealed) revert DomeSealed();
        if (qty == 0 || qty > EMBER_PER_DAY) revert BadQuantity();

        uint256 today = block.timestamp / 1 days;
        uint256 already = lastClaimDay[msg.sender] == today
            ? claimedOnDay[msg.sender]
            : 0;
        if (already + qty > EMBER_PER_DAY) revert DailyLimitReached();

        uint256 claimed = embersClaimedBy[msg.sender];
        if (claimed + qty > EMBER_PER_WALLET) revert EmberLimitReached();

        uint256 drifted = embersDrifted;
        if (drifted + qty > EMBER_SUPPLY) revert EmbersExhausted();

        lastClaimDay[msg.sender] = today;
        claimedOnDay[msg.sender] = already + qty;
        embersClaimedBy[msg.sender] = claimed + qty;
        embersDrifted = drifted + qty;

        for (uint256 i = 1; i <= qty; ++i) {
            uint256 tokenId = drifted + i;
            _safeMint(msg.sender, tokenId);
            emit EmberDrifted(msg.sender, tokenId);
        }
    }

    // ------------------------------------------------------------ 二、刻星座

    /// @notice 献纳铭刻。需先亲手拾过星屑，每个钱包仅此一次，全网仅 88 个。
    function inscribeConstellation() external payable returns (uint256 tokenId) {
        if (phase != Phase.Inscribing) revert InscriptionNotOpen();
        if (embersClaimedBy[msg.sender] == 0) revert NoEmberHeld();
        if (msg.value != INSCRIPTION_PRICE) {
            revert WrongPayment(INSCRIPTION_PRICE, msg.value);
        }
        return _takeSeat();
    }

    /**
     * @notice 交出 14 枚亲手拾满的星屑，换一个刻位。这条路只有 22 席。
     * @dev 两道门都要过：**亲手拾过** 14 枚（买来的不算，这是全站最底层的规矩），
     *      而且现在手里还拿着 14 枚交出来烧掉。只查其一都能绕：
     *      只查"拾过"的话，人可以拾满、卖掉、再空手换一席；
     *      只查"手里有"的话，二级市场买 14 枚就能插队。
     * @param emberIds 交出来的 14 枚星屑编号，必须都在你名下。
     */
    function inscribeWithEmbers(uint256[] calldata emberIds)
        external
        returns (uint256 tokenId)
    {
        if (phase != Phase.Inscribing) revert InscriptionNotOpen();
        if (emberIds.length != EMBERS_PER_SEAT) revert BadOffering();
        if (embersClaimedBy[msg.sender] < EMBERS_PER_SEAT) revert NotEnoughEmbers();
        if (freeInscribed >= FREE_SEATS) revert FreeSeatsGone();

        for (uint256 i = 0; i < emberIds.length; ++i) {
            uint256 id = emberIds[i];
            if (tierOf(id) != Tier.Ember) revert NotAnEmber();
            // 同一个编号交两次：第二次 ownerOf 会因为它已经烧掉而 revert
            if (_ownerOf(id) != msg.sender) revert NotYourEmber();
            _burn(id);
        }

        freeInscribed += 1;
        return _takeSeat();
    }

    /**
     * @dev 落座：两条路最后都走这里。
     *      刻位号按铭刻顺序发 —— 第 N 个铭刻的人拿第 N 席，和走哪条路无关。
     */
    function _takeSeat() private returns (uint256 tokenId) {
        // 阶段在两个入口处各查过一次：那是最根本的一道门，要最先报出来
        if (constellationOf[msg.sender] != 0) revert AlreadyInscribed();

        uint256 inscribed = constellationsInscribed;
        if (inscribed >= CONSTELLATION_SUPPLY) revert DomeFull();

        uint256 ordinal = inscribed + 1;
        tokenId = CONSTELLATION_OFFSET + ordinal;

        constellationsInscribed = ordinal;
        constellationOf[msg.sender] = tokenId;

        _safeMint(msg.sender, tokenId);
        emit ConstellationInscribed(msg.sender, tokenId, ordinal);
    }

    // ------------------------------------------------------------ 三、题刻痕

    /**
     * @notice 在你持有的刻位上题一行字。一任只有一次机会。
     * @dev 只写你自己那一条记录。前任题的字永远动不了 —— 这是刻痕志的全部意义。
     *
     *      刻一次就封上：题过之后自己也改不了、删不了。石头上的字本来就是这样。
     *      每次易主 _update 都会追加一条空白记录，所以从别人手里买来的刻位
     *      会给新主人一次全新的机会 —— 同样只有一次。
     *      一个地址持有几个刻位，就有几次机会，每个刻位各算各的。
     */
    function carveWords(uint256 tokenId, string calldata words) external {
        if (tierOf(tokenId) != Tier.Constellation) revert NotAConstellation();
        if (ownerOf(tokenId) != msg.sender) revert NotYourSeat();
        if (bytes(words).length == 0) revert EmptyWords();
        if (bytes(words).length > MAX_WORDS) {
            revert WordsTooLong(MAX_WORDS, bytes(words).length);
        }

        Mark[] storage marks = _chronicle[tokenId];
        // 最后一条一定属于当前持有者：_update 在每次易主时都会追加。
        Mark storage mine = marks[marks.length - 1];
        if (bytes(mine.words).length != 0) revert WordsAlreadyCarved();
        mine.words = words;

        emit WordsCarved(tokenId, msg.sender, words);
    }

    /// @notice 这个地址现在能不能在这一席上题字。前端拿它决定输入框是开是锁。
    function canCarve(uint256 tokenId, address who) external view returns (bool) {
        if (tierOf(tokenId) != Tier.Constellation) return false;
        if (_ownerOf(tokenId) != who) return false;
        Mark[] storage marks = _chronicle[tokenId];
        if (marks.length == 0) return false;
        return bytes(marks[marks.length - 1].words).length == 0;
    }

    /// @notice 整本刻痕志，从最初的铭刻者到现任持有者。
    function chronicleOf(uint256 tokenId) external view returns (Mark[] memory) {
        return _chronicle[tokenId];
    }

    function chronicleLength(uint256 tokenId) external view returns (uint256) {
        return _chronicle[tokenId].length;
    }

    /// @notice 整张穹顶的现任持有者，下标 0 对应第 1 刻。一次调用画完全图。
    function seatOwners() external view returns (address[] memory) {
        return _seatOwners;
    }

    // ---------------------------------------------------------------- 视图

    function tierOf(uint256 tokenId) public pure returns (Tier) {
        if (tokenId >= 1 && tokenId <= EMBER_SUPPLY) return Tier.Ember;
        if (
            tokenId > CONSTELLATION_OFFSET &&
            tokenId <= CONSTELLATION_OFFSET + CONSTELLATION_SUPPLY
        ) return Tier.Constellation;
        return Tier.None;
    }

    /// @notice 前端用一次调用拿全部状态，省 RPC 往返。
    function survey(address keeper)
        external
        view
        returns (
            Phase currentPhase,
            uint256 embersLeft,
            uint256 constellationsLeft,
            uint256 keeperEmbers,
            uint256 keeperConstellation,
            uint256 price,
            uint256 keeperSeats,
            uint256 keeperEmberBalance,
            uint256 keeperTakenToday,
            uint256 freeSeatsLeft
        )
    {
        /*
         * 逐个赋值，不要 return (a, b, c, ...)。
         * 十个返回值一次性铺成元组会把栈压爆（Stack too deep），
         * 而逐个写进命名返回值就不会 —— 编译器可以一个一个地收。
         */
        currentPhase = phase;
        embersLeft = EMBER_SUPPLY - embersDrifted;
        constellationsLeft = CONSTELLATION_SUPPLY - constellationsInscribed;
        keeperEmbers = embersClaimedBy[keeper];
        keeperConstellation = constellationOf[keeper];
        price = INSCRIPTION_PRICE;
        keeperSeats = constellationBalance[keeper];
        /*
         * 手里现在还剩几枚星屑（含买来的）。要交出 14 枚，得看这个数。
         * 零地址要单独挡一下：前端在没登台的时候就是拿 address(0) 来问的，
         * 而 ERC721 的 balanceOf(address(0)) 是会 revert 的 ——
         * 不挡这一下，整页在连钱包之前都读不到任何链上数字。
         */
        keeperEmberBalance = keeper == address(0) ? 0 : balanceOf(keeper) - keeperSeats;
        keeperTakenToday = takenToday(keeper);
        freeSeatsLeft = FREE_SEATS - freeInscribed;
    }

    /// @notice 这个钱包今天已经拾了几枚。跨过 UTC 零点自动归零。
    function takenToday(address keeper) public view returns (uint256) {
        return lastClaimDay[keeper] == block.timestamp / 1 days
            ? claimedOnDay[keeper]
            : 0;
    }

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }

    /**
     * @notice tokenURI = baseURI + tokenId + ".json"
     * @dev 后缀是为静态托管加的。没有扩展名的文件，GitHub Pages 之类的
     *      静态服务器只会给 application/octet-stream ——
     *      内容是对的 JSON，但类型是错的，严格一点的索引器会直接跳过。
     *      IPFS 那边加不加都能读，所以两种托管方式都用同一套名字。
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        _requireOwned(tokenId);
        return string.concat(_base, _toString(tokenId), ".json");
    }

    /// @dev 只为拼 tokenURI 用，不值得为它引一整个 Strings 库。
    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v;
        uint256 len;
        while (n != 0) { len++; n /= 10; }
        bytes memory buf = new bytes(len);
        while (v != 0) { buf[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(buf);
    }

    /**
     * @dev 每次星座易主都在这里留痕：更新持有量、刷新穹顶名册、往刻痕志追加一条
     *      空白记录等新主人来填。星屑不走这套 —— 它没有刻痕志。
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = super._update(to, tokenId, auth);
        if (tierOf(tokenId) != Tier.Constellation) return from;

        if (from != address(0)) constellationBalance[from] -= 1;
        if (to == address(0)) return from; // 本合约不支持销毁，保险起见

        constellationBalance[to] += 1;

        uint256 ordinal = tokenId - CONSTELLATION_OFFSET;
        if (from == address(0)) {
            _seatOwners.push(to);          // 首次铭刻，名册增长
        } else {
            _seatOwners[ordinal - 1] = to; // 易主，改写名册
        }

        _chronicle[tokenId].push(
            Mark({keeper: to, heldSince: uint64(block.timestamp), words: ""})
        );
        emit SeatPassedOn(tokenId, from, to, _chronicle[tokenId].length - 1);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------- 管理

    /// @dev 阶段只进不退：宣布过的观测窗口不能收回。
    function advancePhase(Phase next) external onlyOwner {
        if (uint8(next) <= uint8(phase)) revert PhaseCannotGoBack();
        phase = next;
        emit PhaseAdvanced(next);
    }

    /**
     * @dev 关掉 Ownable 自带的弃权。
     *      阶段必须由 owner 一步步推上去，baseURI 也可能需要修 ——
     *      在这两件事做完之前弃权，整座台子就永远停在闭台，谁也救不回来。
     *      要转交就用 transferOwnership，别用一个没有回头路的按钮。
     */
    function renounceOwnership() public pure override {
        revert OwnershipRequired();
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _base = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function setContractURI(string calldata contractURI_) external onlyOwner {
        contractURI = contractURI_;
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        _setDefaultRoyalty(receiver, bps);
    }

    /**
     * @notice 把合约里的献纳全部打给金库。
     * @dev 不限 onlyOwner：收款地址是写死的，谁来按这个按钮结果都一样，
     *      那就没有理由只让我一个人能按。也不收参数 —— 没有参数就没有改道的余地。
     */
    function withdraw() external {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok, ) = payable(TREASURY).call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(TREASURY, amount);
    }
}
