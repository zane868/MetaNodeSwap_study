import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MarketPriceRegistry20261029", (m) => {
  const manager=m.getParameter("poolManager", "0xd5AaD8D32c26C20C66217BCDF323789902557Dcc");
  const market=m.contract("MarketPriceRegistry", [manager]);
  // Existing mock assets: 1 M_ETH = 200 M_USDT, both with 18 decimals.
  m.call(market, "setPrice", [
    "0x68Df69BC9EAEE428803B3aE0Aa00530aF19c4769",
    "0xa317221F46598d8ce092FBd8153AF118abec4872",
    5602277097478613991873193822n
  ], { id: "InitialMockMarketPrice" });
  return { market };
});
