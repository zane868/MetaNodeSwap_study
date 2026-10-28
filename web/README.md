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
