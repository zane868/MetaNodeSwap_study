# MetaNode Swap HTML 前端

直接连接本仓库 2026-10-28 部署的 Sepolia 合约，使用 ethers.js 6.12.0（本地 vendor 文件及许可证），无需 npm 安装或构建。

在仓库根目录运行：

```sh
python3 -m http.server 8080 --directory web
```

浏览器打开 http://localhost:8080，使用 MetaMask 等注入式浏览器钱包连接 Sepolia。页面通过钱包 RPC 获取链上数据，私钥始终由钱包管理；无需把部署环境变量或私钥放入网页。ABI 来自本次部署时的编译产物。

页面支持：

- 读取交易池、代币 symbol / decimals 和钱包余额。
- 单池 ERC-20 精确输入兑换，链上模拟报价、滑点最低接收量及按需定额授权。
- 创建并初始化池子，自动排序代币并按 decimals 换算初始价格。
- 添加流动性、查看当前 NFT 所有者持有的仓位、移除全部流动性与领取代币。
- 交易确认状态及 Sepolia Etherscan 交易链接。
- 点击支付或接收代币按钮，按名称、符号或合约地址搜索。默认提供 Sepolia WETH、USDC、UNI、USDT、WBTC（搜索 BTC 或比特币也可找到），连接钱包前也可选择。
- 创建池子时使用同一代币选择器，不再要求手输地址。选中兑换代币对后自动匹配当前 DEX 的池子，无池子时可一键带入创建表单。
- 支持从地址读取并导入 ERC-20（需先连接钱包），或导入标准 Token List JSON（包含 `tokens` 数组）。列表只保留 `chainId: 11155111` 的有效代币，按地址去重，导入结果保存在浏览器本地。列表中的名称和符号不代表发行方身份认证。

默认列表位于 `tokens.json`，地址来源为 [Uniswap Sepolia 默认列表](https://github.com/Uniswap/default-token-list/blob/main/src/tokens/sepolia.json) 和 [Circle USDC 合约地址](https://developers.circle.com/stablecoins/usdc-contract-addresses)。链上已有池子的代币也会加入选择器。代币列表用于发现资产，不会自动接入 Uniswap 的流动性；兑换报价仍来自本项目的池子。

首次使用先在「流动性池」创建池子，并投入实际测试代币。初始价格为 1 个 A 对应 B 的数量，Tick 按排序后 token0 / token1 设置。兑换只支持 ERC-20，不支持直接使用原生 ETH。移除仓位与领取是两笔交易。

这是学习合约配套页面，交易行为以当前合约实现为准。页面不包含合约源码验证或自动添加流动性功能。没有注入式钱包时，页面展示未连接状态。

ethers API 参考：https://docs.ethers.org/v6/single-page/

USDT 和 WBTC 使用 [Aave Sepolia 地址簿](https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Sepolia.sol) 中的测试代币，分别为 6 和 8 位精度，已通过链上 symbol / decimals 验证。两者用于测试，不代表主网 USDT 或原生 BTC；BTC 入口使用 ERC-20 WBTC。


## 发行代币与创建流动池

在「发行代币」填写名称、符号，连接 Sepolia 钱包后点击发行。浏览器调用 `TokenLauncher.createToken`，由登记合约创建新的 ERC-20 合约，向发起钱包分配固定 100,000 枚、18 位精度的代币。没有后续增发接口。每次发行都创建独立地址，允许名称或符号相同，以合约地址区分。

登记合约：`0xf319Bbd5F66e9e841Ca01B988548443AB5b46448`（Sepolia）。核心 DEX 地址不变。

发行确认后：

1. 新代币自动加入统一代币选择器，并在创建池子表单「选择已发行的代币」中展示。
2. 新代币带入代币 A，WETH 带入代币 B；点击「创建流动池」进入表单，确认价格与区间后创建。
3. 每个发行记录都有独立的创建入口，支持连续发行多种代币。
4. 登记记录保存在链上，通过 `getTokens(offset, limit)` 分页同步；连接钱包、刷新或点击同步可恢复其他浏览器/其他用户的发行记录。本地缓存只是加速展示。
5. 「添加到钱包」由钱包确认；创建池子、授权和添加流动性仍是独立操作，发行成功不会自动创建池子或投入资产。

本地验证：

```sh
cd swap-contract
npx hardhat test test/TokenLauncher.ts
cd ..
node --test web/tests/release.test.cjs
```

## 添加流动性时的输入范围与实际投入

选择池子后，表单显示钱包余额允许的输入范围（0 至余额）、当前池子价格与区间，以及根据这些条件计算的资金配比。池子已有流动性 L 不构成新增投入的固定上限。表单还会根据两种钱包余额给出可配对投入的参考上限。

输入框填写的是「最多愿意投入」，不是承诺全部转入。可点击「按某一侧数量计算另一侧」自动填写配套数量。预览表分别列出最大投入、预计实际投入和未使用数量。未使用代币留在钱包，池子兑换费率不会直接按比例扣掉添加流动性的本金。

`liquidity-math.js` 使用 BigInt 实现与本仓库 TickMath、LiquidityAmounts、SqrtPriceMath 对齐的整数计算与取整，并与 SDK 交叉验证。预览是读取时的估算；交易前仍以合约模拟和链上执行为准。当前学习合约不完整支持区间外添加流动性，预览会明确提示这种状态。

## 每个仓位的实际投入

「我的仓位」按 NFT 分别展示最初实际投入、当时填写的投入上限、当时未使用的数量、当前本金估算，以及已结算待领取的本金和费用。历史投入从建仓交易中的池子 `Mint` 事件还原，并与同笔交易中的 NFT 铸造 `Transfer` 事件关联；不会拿池子总余额或用户填写的上限当成实际投入。直接调用 `PositionManager.mint` 时还可从交易参数恢复填写的上限；聚合器或其他间接调用无法解码时，只展示已验证的实际投入。

新交易使用已确认回执即时填充。已有仓位从 PositionManager 部署区块 `12011721` 起分段查询铸造日志，再读取建仓回执；历史 RPC 不可用时保留当前仓位，金额显示「—」并提示刷新重试，而不是显示成零。当前本金按本仓位的 L、池子价格和区间计算，使用与移除本金一致的向下取整，不包含尚未结算的手续费。NFT 转移后，最初投入仍是该 NFT 的历史记录，不代表新持有人曾支付该金额。全部领取并销毁的 NFT 不在当前仓位列表中。

## 2026-10-29：重新开始与旧版资金

页面默认使用 2026-10-29 新部署的 DEX，池子和仓位列表从空开始。工作区上方的「合约版本」可切换到「旧版 · 原有池子和仓位」：旧池子及资金仍在原合约，可在旧版「我的仓位」移除并领取。此次没有提取、转移或销毁旧版资金。切换版本通过 URL 的 `?deployment=legacy` 区分，仓位历史扫描起点随版本切换，NFT 编号不会跨版本混用。

TokenLauncher 与已发行代币继续复用，因此新池子仍可选择原来的 M_USDT、M_ETH 等代币。新版 PositionManager / SwapRouter 地址不同，添加流动性或兑换时可能需要重新授权。部署配置统一位于 `deployments.js`。

独立部署命令：

```sh
cd swap-contract
npx hardhat ignition deploy ./ignition/modules/MetaNodeSwap20261029.ts --network sepolia --deployment-id sepolia-clean-20261029
```

该命令会恢复这次部署进度，不会每次运行都创建全新 DEX。未来再次重新开始时应使用新的模块标识和部署 ID，并保留旧版本资金入口。

## Owner 模拟市场价

新版配置接入 `MarketPriceRegistry`（`0xF7B9758E8B6D31aa27FaC78fc4143fe39bf2B832`），独立于现有 DEX 部署，不迁移或重置池子资金。初始 owner 是部署钱包，已配置 `1 M_ETH = 200 M_USDT`。

使用方式：

1. 在新版「流动性池 → 创建池子」选择代币 A/B。owner 连接钱包后会看到「Owner：设置当前代币对的参考比例」。例如 A 选择 M_ETH、B 选择 M_USDT，填 1、200，保存上链。
2. 已配置的代币对默认勾选「创建时使用 owner 设置的参考价」，自动显示对应初始化价格，用户无需每次重新输入。创建交易调用登记合约 `createPoolAtReference`，由链上存储的 `sqrtPriceX96` 初始化新池子。已有相同池子仍返回原池，不会重置池价。
3. 参考价每次更新会递增版本。前端提交前检查版本；合约在执行时再次校验 `expectedVersion`，防止钱包确认期间 owner 调价造成非预期初始化。
4. 兑换页单独展示 owner 的模拟行情，例如 `1 M_ETH ≈ 200 M_USDT`，并按输入量展示参考可得数量。这个展示不含池子费率、滑点或价格影响；实际兑换仍按 AMM 池子报价执行，owner 调整参考价不会改变已有池子的价格、余额或仓位。
5. 取消勾选后仍可使用原来的手动初始化方式。该配置是模拟参考价，不限制别人直接调用 PoolManager 选择其他初始化价格。旧版未接入参考价配置。

合约 `setPrice(token0, token1, sqrtPriceX96)` 仅 owner 可调用，代币必须按地址排序；前端会根据人类可读的 A:B 数量和代币 decimals 正确换算，包括反向报价。`getPrice(tokenA, tokenB)` 返回同一规范方向的价格、版本和更新时间。

验证：`cd swap-contract && npx hardhat test test/MarketPriceRegistry.ts`；前端测试仍为 `node --test web/tests/release.test.cjs`。
