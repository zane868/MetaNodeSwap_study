# MetaNodeSwap合约地址

合约部署在sepolia网络

## 当前部署（2026-10-29，新版空池子）

网络：Sepolia，Chain ID：11155111。页面默认使用此版本，旧版可通过「合约版本」切换访问。此次重新部署没有移动或提取旧池子资金。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| PoolManager | `0xd5AaD8D32c26C20C66217BCDF323789902557Dcc` | [交易](https://sepolia.etherscan.io/tx/0xa15a544b0dea42502d0287d442f766513b969f3de99258d5e8ba25d10a333c2d) |
| PositionManager | `0x17823E797269053BcEbC14875453a84C46F79CE7` | [交易](https://sepolia.etherscan.io/tx/0x5bdf3975398342873686e7f83855f9a1844c6c9b12a0722ec96f696df9cf2fd9) |
| SwapRouter | `0xbBfbe5D915125b9A9a17b7E71478fA52d75c10ae` | [交易](https://sepolia.etherscan.io/tx/0x331c567f7a2f8d7a4f618f642f16245e062acdbfef3a6cd135aafccee5c8e29b) |

PositionManager 部署区块：`12017526`。继续使用原 TokenLauncher：`0xf319Bbd5F66e9e841Ca01B988548443AB5b46448`，已发行的代币无需重新部署。

独立部署模块：`swap-contract/ignition/modules/MetaNodeSwap20261029.ts`，部署 ID：`sepolia-clean-20261029`。完整前端配置见 `web/deployments.js`。部署后核验池子及仓位均为 0。

## 模拟市场参考价（2026-10-29）

- MarketPriceRegistry：`0xF7B9758E8B6D31aa27FaC78fc4143fe39bf2B832`
- [部署交易](https://sepolia.etherscan.io/tx/0xd074b37c78c1a005135e5c8e905494204f676f1f5777514aa804bd62a06c8b9f)
- [初始配置交易](https://sepolia.etherscan.io/tx/0x3cad09fae1382316fb8f6d6622d06d0af843ae9b2adb2ecb954b29aea89d1142)：`1 M_ETH = 200 M_USDT`
- 初始 owner：`0xEeBD193Cb96D61E93D22FdAeD12313E2BeC8ef6c`
- 绑定新版 PoolManager。owner 可调整模拟参考价；不改变已有池子的价格和资金。新池可通过 `createPoolAtReference` 直接使用最新配置，实际兑换继续按池子 AMM 价格执行。

## 旧版部署（2026-10-28，保留原有池子与资金）

网络：Sepolia，Chain ID：11155111。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| PoolManager | `0x218D5C07333E0819BfBa2455FD5Ff508Bcd08B86` | [交易](https://sepolia.etherscan.io/tx/0x9116e70fb0b196a000af00d7e965c3f180d88c257fc62fc21a8d037b24525105) |
| PositionManager | `0x8201A0bB36E7c705431e4B859A12462a40ac6b8F` | [交易](https://sepolia.etherscan.io/tx/0x48649496d7cfd313238b1c7b107df03812f0207888750043aa2377bedadee6da) |
| SwapRouter | `0x547959a9a8a68b20bCEFF2E3A83451e02F0357D8` | [交易](https://sepolia.etherscan.io/tx/0xe3b423ee80a2e2edc7e433e7ddc9ce11247856fa5cdded3d7a99702514ad939f) |
| TokenLauncher | `0xf319Bbd5F66e9e841Ca01B988548443AB5b46448` | [交易](https://sepolia.etherscan.io/tx/0x94efdbcd6e03576c00d511e21b77283c1968df4ce218a3ee82c2b160a389e1dd) |

部署命令：在 `swap-contract` 目录运行 `npx hardhat ignition deploy ./ignition/modules/MetaNodeSwap.ts --network sepolia`。
配置通过环境变量 `SEPOLIA_RPC_URL`、`SEPOLIA_PRIVATE_KEY` 读取；区块浏览器验证可使用 `ETHERSCAN_API_KEY`。
此版本已有池子与仓位，继续保留以便查看和撤出旧版资金。
TokenLauncher 支持任何钱包发行固定总量 100,000 枚、18 位精度的 ERC-20 代币，并记录代币地址、发行者、名称和符号，供前端创建池子时同步选择。源码为 `swap-contract/contracts/TokenLauncher.sol`，部署命令为 `npx hardhat ignition deploy ./ignition/modules/TokenLauncher.ts --network sepolia`。

## 原项目历史部署

测试用ERC20：

MNTokenA - 0x4798388e3adE569570Df626040F07DF71135C48E  
MNTokenB - 0x5A4eA3a013D42Cfd1B1609d19f6eA998EeE06D30   
MNTokenC - 0x86B5df6FF459854ca91318274E47F4eEE245CF28   
MNTokenD - 0x7af86B1034AC4C925Ef5C3F637D1092310d83F03    



swap合约：

PoolManager - 0xddC12b3F9F7C91C79DA7433D8d212FB78d609f7B  
PositionManager - 0xbe766Bf20eFfe431829C5d5a2744865974A0B610  
SwapRouter - 0xD2c220143F5784b3bD84ae12747d97C8A36CeCB2  
