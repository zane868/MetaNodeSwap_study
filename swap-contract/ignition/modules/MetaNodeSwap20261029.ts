import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Independent deployment; keep the previous contracts available for withdrawals.
export default buildModule("MetaNodeSwap20261029", (m) => {
  const poolManager = m.contract("PoolManager");
  const positionManager = m.contract("PositionManager", [poolManager]);
  // Serialize transactions for RPCs that limit pending delegated-account transactions.
  const swapRouter = m.contract("SwapRouter", [poolManager], { after: [positionManager] });
  return { poolManager, positionManager, swapRouter };
});
