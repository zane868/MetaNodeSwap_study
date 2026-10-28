import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("TokenLauncherModule", (m) => {
  const tokenLauncher = m.contract("TokenLauncher");
  return { tokenLauncher };
});
