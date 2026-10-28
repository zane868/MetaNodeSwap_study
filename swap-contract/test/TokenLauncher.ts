import { expect } from "chai";
import hre from "hardhat";

describe("TokenLauncher", function () {
  it("issues fixed supply to each creator and registers every token for pool discovery", async function () {
    const launcher = await hre.viem.deployContract("TokenLauncher");
    const [alice, bob] = await hre.viem.getWalletClients();
    const client = await hre.viem.getPublicClient();
    for (const [wallet, name, symbol] of [[alice, "Alpha Token", "ALPHA"], [bob, "Beta Token", "BETA"]] as const) {
      const hash = await launcher.write.createToken([name, symbol], { account: wallet.account });
      await client.waitForTransactionReceipt({ hash });
    }
    expect(await launcher.read.tokenCount()).to.equal(2n);
    const all = await launcher.read.getTokens([0n, 100n]);
    expect(all.map(t => t.symbol)).to.deep.equal(["ALPHA", "BETA"]);
    expect(all[0].token).not.to.equal(all[1].token);
    for (const [i, wallet] of [alice, bob].entries()) {
      const t = await hre.viem.getContractAt("ReleasedToken", all[i].token);
      expect(all[i].creator.toLowerCase()).to.equal(wallet.account.address.toLowerCase());
      expect(await t.read.balanceOf([wallet.account.address])).to.equal(100_000n * 10n ** 18n);
      expect(await t.read.totalSupply()).to.equal(100_000n * 10n ** 18n);
      expect(await t.read.balanceOf([launcher.address])).to.equal(0n);
      expect(await t.read.decimals()).to.equal(18);
    }
    expect((await launcher.read.getTokens([1n, 1n]))[0].symbol).to.equal("BETA");
    expect(await launcher.read.getTokens([2n, 100n])).to.deep.equal([]);
    expect(await launcher.read.getTokens([0n, 0n])).to.deep.equal([]);
    expect(await launcher.getEvents.TokenCreated({}, { fromBlock: 0n })).to.have.length(2);
  });

  it("rejects invalid metadata without adding a registry entry", async function () {
    const launcher = await hre.viem.deployContract("TokenLauncher");
    for (const [name, symbol] of [["", "A"], ["A", ""], ["A".repeat(97), "A"], ["A", "A".repeat(17)]]) {
      await expect(launcher.write.createToken([name, symbol])).to.be.rejected;
    }
    expect(await launcher.read.tokenCount()).to.equal(0n);
    await expect(launcher.read.getTokens([0n, 101n])).to.be.rejectedWith("Page too large");
  });
});
