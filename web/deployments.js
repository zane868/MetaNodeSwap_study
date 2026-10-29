// Sepolia deployments. Keep the legacy profile accessible for existing funds.
const DEX_DEPLOYMENTS=Object.freeze({
  "current": {
    "label": "新版 · 2026-10-29",
    "chainId": 11155111,
    "positionManagerStartBlock": 12017526,
    "addresses": {
      "TokenLauncher": "0xf319Bbd5F66e9e841Ca01B988548443AB5b46448",
      "MarketPriceRegistry": "0xF7B9758E8B6D31aa27FaC78fc4143fe39bf2B832",
      "PoolManager": "0xd5AaD8D32c26C20C66217BCDF323789902557Dcc",
      "PositionManager": "0x17823E797269053BcEbC14875453a84C46F79CE7",
      "SwapRouter": "0xbBfbe5D915125b9A9a17b7E71478fA52d75c10ae"
    }
  },
  "legacy": {
    "label": "旧版 · 2026-10-28",
    "chainId": 11155111,
    "positionManagerStartBlock": 12011721,
    "addresses": {
      "TokenLauncher": "0xf319Bbd5F66e9e841Ca01B988548443AB5b46448",
      "PoolManager": "0x218D5C07333E0819BfBa2455FD5Ff508Bcd08B86",
      "PositionManager": "0x8201A0bB36E7c705431e4B859A12462a40ac6b8F",
      "SwapRouter": "0x547959a9a8a68b20bCEFF2E3A83451e02F0357D8"
    }
  }
});
if(typeof module!=='undefined')module.exports=DEX_DEPLOYMENTS;
