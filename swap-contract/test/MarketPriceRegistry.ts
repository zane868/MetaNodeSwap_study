import { expect } from "chai";
import hre from "hardhat";

function sqrt(n: bigint): bigint { if(n < 2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }

describe("MarketPriceRegistry", function () {
  async function setup() {
    const manager=await hre.viem.deployContract("PoolManager");
    const registry=await hre.viem.deployContract("MarketPriceRegistry",[manager.address]);
    const a=await hre.viem.deployContract("ReleasedToken",["Mock A","A",(await hre.viem.getWalletClients())[0].account.address]);
    const b=await hre.viem.deployContract("ReleasedToken",["Mock B","B",(await hre.viem.getWalletClients())[0].account.address]);
    const [token0,token1]=BigInt(a.address)<BigInt(b.address)?[a.address,b.address]:[b.address,a.address];
    const [owner,other]=await hre.viem.getWalletClients();
    return {manager,registry,token0,token1,owner,other};
  }
  it("restricts updates to owner, stores both directions, and lets users initialize from reference",async()=>{
    const {manager,registry,token0,token1,owner,other}=await setup();
    const price=sqrt((1n<<192n)/200n); // 200 token0 per token1, both use 18 decimals
    expect((await registry.read.owner()).toLowerCase()).to.equal(owner.account.address.toLowerCase());
    await expect(registry.write.setPrice([token0,token1,price],{account:other.account})).to.be.rejectedWith("OwnableUnauthorizedAccount");
    await expect(registry.write.createPoolAtReference([token0,token1,3000,-60000,-40000,1n])).to.be.rejectedWith("Reference price not configured");
    await registry.write.setPrice([token0,token1,price]);
    const forward=await registry.read.getPrice([token0,token1]),reverse=await registry.read.getPrice([token1,token0]);
    expect(forward.sqrtPriceX96).to.equal(price);expect(reverse).to.deep.equal(forward);expect(forward.version).to.equal(1n);
    await registry.write.createPoolAtReference([token1,token0,3000,-60000,-40000,1n],{account:other.account});
    const pool=await hre.viem.getContractAt("Pool",await manager.read.getPool([token0,token1,0]));
    expect(await pool.read.sqrtPriceX96()).to.equal(price);
    const newPrice=sqrt((1n<<192n)/250n);
    await registry.write.setPrice([token0,token1,newPrice]);
    expect((await registry.read.getPrice([token0,token1])).version).to.equal(2n);
    await expect(registry.write.createPoolAtReference([token0,token1,500,-60000,-40000,1n])).to.be.rejectedWith("Reference price changed");
    expect(await pool.read.sqrtPriceX96()).to.equal(price); // existing funds are not repriced
    await registry.write.createPoolAtReference([token0,token1,500,-60000,-40000,2n]);
    const second=await hre.viem.getContractAt("Pool",await manager.read.getPool([token0,token1,1]));
    expect(await second.read.sqrtPriceX96()).to.equal(newPrice);
    await registry.write.createPoolAtReference([token0,token1,3000,-60000,-40000,2n]);
    expect(await pool.read.sqrtPriceX96()).to.equal(price); // reusing an existing pool also preserves price
  });
  it("rejects malformed prices, token pairs, and ranges",async()=>{
    const {registry,token0,token1}=await setup();
    await expect(registry.write.setPrice([token1,token0,1n<<96n])).to.be.rejectedWith("Invalid token order");
    await expect(registry.write.setPrice([token0,token1,0n])).to.be.rejectedWith("Price out of range");
    await registry.write.setPrice([token0,token1,1n<<96n]);
    await expect(registry.write.createPoolAtReference([token0,token1,3000,1,100,1n])).to.be.rejectedWith("Reference price outside range");
    await expect(registry.write.createPoolAtReference([token0,token1,3000,100,1,1n])).to.be.rejectedWith("Invalid ticks");
  });
});
