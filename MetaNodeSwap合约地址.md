# MetaNodeSwap合约地址

合约部署在sepolia网络

## 当前部署（2026-10-28）

网络：Sepolia，Chain ID：11155111。

| 合约 | 地址 | 部署交易 |
| --- | --- | --- |
| PoolManager | `0x218D5C07333E0819BfBa2455FD5Ff508Bcd08B86` | [交易](https://sepolia.etherscan.io/tx/0x9116e70fb0b196a000af00d7e965c3f180d88c257fc62fc21a8d037b24525105) |
| PositionManager | `0x8201A0bB36E7c705431e4B859A12462a40ac6b8F` | [交易](https://sepolia.etherscan.io/tx/0x48649496d7cfd313238b1c7b107df03812f0207888750043aa2377bedadee6da) |
| SwapRouter | `0x547959a9a8a68b20bCEFF2E3A83451e02F0357D8` | [交易](https://sepolia.etherscan.io/tx/0xe3b423ee80a2e2edc7e433e7ddc9ce11247856fa5cdded3d7a99702514ad939f) |
| TokenLauncher | `0xf319Bbd5F66e9e841Ca01B988548443AB5b46448` | [交易](https://sepolia.etherscan.io/tx/0x94efdbcd6e03576c00d511e21b77283c1968df4ce218a3ee82c2b160a389e1dd) |

部署命令：在 `swap-contract` 目录运行 `npx hardhat ignition deploy ./ignition/modules/MetaNodeSwap.ts --network sepolia`。
配置通过环境变量 `SEPOLIA_RPC_URL`、`SEPOLIA_PRIVATE_KEY` 读取；区块浏览器验证可使用 `ETHERSCAN_API_KEY`。
已部署三个 DEX 核心合约及 TokenLauncher 发行登记合约，尚未创建交易池或添加流动性。
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
