// Exercise issuance, registry recovery, and pool handoff without a browser wallet.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ethers=require('../../swap-contract/node_modules/ethers');
const root=path.join(__dirname,'..');
class Element {
  constructor(){this.value='';this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this.classList={toggle(){}};}
  replaceChildren(...nodes){this.children=nodes;this.value=nodes[0]?.value??'';}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  add(n){this.children.push(n);}
  addEventListener(){}
  setCustomValidity(message){this.validationMessage=message;}
  focus(){}
}
async function app(storage=new Map(),search=''){
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context=vm.createContext({console,ethers,URL,URLSearchParams,
    document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element()},
    history:{replaceState(_a,_b,url){context.hash=url;}},location:{hash:'',search,href:'http://localhost:8080/'+search,assign(url){context.redirect=url;}},
    window:{addEventListener(){},ethereum:{on(){},async request({method}){if(method==='eth_chainId')return '0xaa36a7';if(method==='eth_accounts')return ['0x1111111111111111111111111111111111111111'];throw Error('Unexpected wallet call');}}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Option:class{constructor(text,value){this.text=text;this.value=value;}},
    fetch:async file=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))})});
  vm.runInContext(fs.readFileSync(path.join(root,'deployments.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'liquidity-math.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
  await vm.runInContext('tokenReady',context);
  return {context,get,storage,exec:code=>vm.runInContext(code,context)};
}
test('two launches appear in the selector and pool creation, and survive reload',async()=>{
  const a=await app();
  const abi=JSON.parse(fs.readFileSync(path.join(root,'abi/TokenLauncher.json')));
  const iface=new ethers.Interface(abi);
  const events=['0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333'];
  let i=0;
  a.context.fakeLauncher={interface:iface,async createToken(name,symbol){const address=events[i++];const event=iface.encodeEventLog(iface.getEvent('TokenCreated'),[address,'0x1111111111111111111111111111111111111111',name,symbol]);return{hash:'0x'+'ab'.repeat(32),async wait(){return{status:1,logs:[{address:a.exec('ADDR.TokenLauncher'),...event}]};}};}};
  a.exec("account='0x1111111111111111111111111111111111111111';contracts={TokenLauncher:fakeLauncher}");
  for(const symbol of ['ALPHA','BETA']){
    a.get('releaseName').value=symbol+' token';a.get('releaseSymbol').value=symbol;
    // Wait for the event-handler's run() task through its busy state.
    a.get('releaseForm').onsubmit({preventDefault(){}});
    while(a.exec('busy'))await new Promise(resolve=>setImmediate(resolve));
    assert.equal(a.get('releaseSuccess').hidden,false);
    assert.equal(a.get('createA').value,events[i-1]);
  }
  assert.equal(a.exec('issuedTokens().length'),2);
  a.get('tokenSearch').value='ALPHA';a.exec('renderTokenResults()');assert.equal(a.get('tokenResults').children.length,1);
  a.exec('prepareIssuedPool(issuedTokens()[0])');
  assert.equal(a.context.hash,'#pools');assert.equal(a.get('createForm').hidden,false);assert.equal(a.get('createA').value,events[0]);
  assert.equal(a.get('createB').value.toLowerCase(),'0xfff9976782d46cc05630d1f6ebab18b2324d6b14');
  const b=await app(a.storage);assert.equal(b.exec('issuedTokens().length'),2);
  assert.equal(b.get('releasedForPool').children[1].children.length,2);
});
test('a fresh browser discovers all registry tokens and does not duplicate on sync',async()=>{
  const a=await app();
  a.context.fakeLauncher={async tokenCount(){return 2n;},async getTokens(){return[{token:'0x4444444444444444444444444444444444444444',creator:'0x1111111111111111111111111111111111111111',name:'One',symbol:'ONE'},{token:'0x5555555555555555555555555555555555555555',creator:'0x6666666666666666666666666666666666666666',name:'Two',symbol:'TWO'}];}};
  a.exec("account='0x1111111111111111111111111111111111111111';contracts={TokenLauncher:fakeLauncher}");
  await a.exec('loadReleasedTokens()');await a.exec('loadReleasedTokens()');
  assert.equal(a.exec('issuedTokens().length'),2);assert.equal(a.get('releaseList').children.length,2);
  a.exec('prepareIssuedPool(issuedTokens()[1])');assert.equal(a.get('createA').value,'0x5555555555555555555555555555555555555555');
});

test('tick percentages handle token order, decimals and invalid ranges',async()=>{
  const a=await app();
  const log=a.exec("tickHumanLogPrice(0,{address:'0x1111111111111111111111111111111111111111',decimals:6},{address:'0x2222222222222222222222222222222222222222',decimals:18})");
  assert.ok(Math.abs(Math.exp(log)/1e-12-1)<1e-12);
  const reversed=a.exec("tickHumanLogPrice(0,{address:'0x2222222222222222222222222222222222222222',decimals:18},{address:'0x1111111111111111111111111111111111111111',decimals:6})");
  assert.ok(Math.abs(Math.exp(reversed)/1e12-1)<1e-12);
  assert.equal(a.exec('tickPercent(0)'),'0.00%');
  assert.match(a.exec('tickPercent(100*Math.log1p(0.0001))'),/^\+1\.005/);
  a.get('tickLower').value='-100';a.get('tickUpper').value='100';
  a.exec('updateTickPreview()');
  assert.match(a.get('tickLowerPercent').textContent,/−0\.995/);
  assert.match(a.get('tickUpperPercent').textContent,/\+1\.005/);
  a.get('tickLower').value='101';a.exec('updateTickPreview()');
  assert.match(a.get('tickRangeSummary').textContent,/必须小于/);
});

test('editing percentages updates ticks and round-trips across decimals and reversed pairs',async()=>{
  const a=await app();
  a.get('tickLowerChange').value='-10';a.exec("applyTickChange('Lower')");
  assert.equal(a.get('tickLower').value,'-1054');
  a.get('tickUpperChange').value='10';a.exec("applyTickChange('Upper')");
  assert.equal(a.get('tickUpper').value,'953');
  a.get('tickLowerChange').value='-100';a.exec("applyTickChange('Lower')");
  assert.equal(a.get('tickLower').value,'-1054');
  assert.match(a.get('tickLowerChange').validationMessage,/大于 -100/);
  // A human price of one with 6/18 decimal tokens is not raw tick zero.
  const source="{address:'0x1111111111111111111111111111111111111111',decimals:6}";
  const target="{address:'0x2222222222222222222222222222222222222222',decimals:18}";
  const sortedTick=a.exec(`tickFromPercent(10,${source},${target},1)`);
  const inverseTick=a.exec(`tickFromPercent(10,${target},${source},1)`);
  assert.ok(sortedTick>270000);assert.ok(inverseTick>270000);
  for(const [x,y,tick] of [[source,target,sortedTick],[target,source,inverseTick]]){
    const delta=a.exec(`Math.expm1(tickHumanLogPrice(${tick},${x},${y}))*100`);
    assert.ok(Math.abs(delta-10)<0.006);
  }
});

test('price input updates ticks and percentages for sorted and reversed token pairs',async()=>{
  const a=await app();
  a.get('initialPrice').value='1';
  a.exec("setCreateToken('createA',[...catalog.values()].find(t=>t.symbol==='USDC'));setCreateToken('createB',[...catalog.values()].find(t=>t.symbol==='WETH'))");
  a.get('tickLowerPriceInput').value='0.9';a.exec("applyTickPrice('Lower')");
  a.get('tickUpperPriceInput').value='1.1';a.exec("applyTickPrice('Upper')");
  assert.ok(Number(a.get('tickLower').value)<Number(a.get('tickUpper').value));
  assert.ok(Math.abs(Number(a.get('tickLowerChange').value)+10)<0.006);
  assert.ok(Math.abs(Number(a.get('tickUpperChange').value)-10)<0.006);
  // The requested price remains editable; displayed actual price reflects tick rounding.
  assert.equal(a.get('tickUpperPriceInput').value,'1.1');
  a.exec('updateTickPreview()');
  assert.ok(Math.abs(Number(a.get('tickUpperPriceInput').value)-1.1)<0.00006);
  a.exec("setCreateToken('createA',[...catalog.values()].find(t=>t.symbol==='WETH'));setCreateToken('createB',[...catalog.values()].find(t=>t.symbol==='USDC'))");
  a.get('tickLowerPriceInput').value='1.1';a.exec("applyTickPrice('Lower')");
  a.get('tickUpperPriceInput').value='0.9';a.exec("applyTickPrice('Upper')");
  assert.ok(Number(a.get('tickLower').value)<Number(a.get('tickUpper').value));
  assert.ok(Math.abs(Number(a.get('tickLowerChange').value)-10)<0.006);
  const previous=a.get('tickLower').value;
  a.get('tickLowerPriceInput').value='0';a.exec("applyTickPrice('Lower')");
  assert.equal(a.get('tickLower').value,previous);
  assert.match(a.get('tickLowerPriceInput').validationMessage,/大于 0/);
});

test('existing pool range uses token decimals and on-chain current price as the percentage baseline',async()=>{
  const a=await app();
  a.exec("pools=[{tickLower:0,tickUpper:20000,sqrtPriceX96:2n*(2n**96n),m0:{symbol:'USDC',decimals:6},m1:{symbol:'WETH',decimals:18}}]");
  const values=a.exec('poolRangeValues(pools[0])');
  assert.ok(Math.abs(Math.exp(values.lowerLog)/1e-12-1)<1e-12);
  assert.ok(Math.abs(Math.exp(values.currentLog)/4e-12-1)<1e-12);
  assert.equal(a.exec('tickPercent(poolRangeValues(pools[0]).lowerLog-poolRangeValues(pools[0]).currentLog)'),'−75.00%');
  const card=a.exec('renderPoolPriceRange(pools[0])');
  assert.match(card.children[0].textContent,/WETH \/ USDC/);
  assert.match(card.children[1].children[0].children[2].textContent,/相对当前价 ≈ −75.00%/);
});

test('nested wallet errors reveal the RPC cause and decode missing allowances',async()=>{
  const a=await app();
  a.context.rpcError={code:'UNKNOWN_ERROR',shortMessage:'could not coalesce error',error:{code:-32000,message:'in-flight transaction limit reached for delegated accounts'}};
  assert.match(a.exec('formatWalletError(rpcError)'),/待确认交易/);
  const iface=new ethers.Interface(['error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)']);
  a.context.rpcError={code:'UNKNOWN_ERROR',shortMessage:'could not coalesce error',info:{error:{data:{originalError:{data:iface.encodeErrorResult('ERC20InsufficientAllowance',['0x8201A0bB36E7c705431e4B859A12462a40ac6b8F',0n,10n**18n])}}}}};
  assert.match(a.exec('formatWalletError(rpcError)'),/授权额度不足/);
  a.exec('fail(rpcError)');assert.equal(a.get('errorDetails').hidden,false);
  assert.match(a.get('errorDetailsText').textContent,/1000000000000000000/);
});

test('liquidity waits for and verifies both approvals before mint simulation and sending',async()=>{
  const a=await app(),calls=[],allowances=new Map();
  const addresses=['0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333'];
  const amounts=[10000n*10n**18n,10n**18n];
  a.context.ethers={...ethers,Contract:class{
    constructor(address){this.address=address;}
    async balanceOf(){calls.push('balance:'+this.address);return 100000n*10n**18n;}
    async allowance(_account,_spender,overrides){calls.push((overrides?'verify:':'allowance:')+this.address);if(overrides)assert.equal(overrides.blockTag,42);return allowances.get(this.address)||0n;}
    async approve(_spender,value){const address=this.address;calls.push('approve:'+address);return{hash:'0x'+'11'.repeat(32),async wait(){calls.push('confirmed:'+address);allowances.set(address,value);return{status:1,blockNumber:42}}};}
  }};
  const mint=async params=>{calls.push('mint');assert.equal(params.amount0Desired,amounts[0]);assert.equal(params.amount1Desired,amounts[1]);return{hash:'0x'+'22'.repeat(32),async wait(){return{status:1,blockNumber:43}}};};
  mint.staticCall=async()=>{calls.push('simulate');for(let i=0;i<2;i++)assert.equal(allowances.get(addresses[i]),amounts[i]);return{liquidity:1n};};
  a.context.fakeMint=mint;
  a.exec(`account='0x1111111111111111111111111111111111111111';signer={};provider={};pools=[{token0:'${addresses[0]}',token1:'${addresses[1]}',index:0n,m0:{address:'${addresses[0]}',symbol:'M_USDT',decimals:18},m1:{address:'${addresses[1]}',symbol:'M_ETH',decimals:18}}];contracts={PositionManager:{mint:fakeMint}};refresh=async()=>{}`);
  a.get('lpPool').value='0';a.get('lpAmount0').value='10000';a.get('lpAmount1').value='1';
  await a.exec('addLiquidity()');
  assert.deepEqual(calls.slice(0,2),addresses.map(v=>'balance:'+v));
  for(const address of addresses)assert.ok(calls.indexOf('verify:'+address)<calls.indexOf('simulate'));
  assert.equal(calls.at(-1),'mint');
});

test('a confirmed approval that is still insufficient stops before adding liquidity',async()=>{
  const a=await app();let sends=0;
  a.context.ethers={...ethers,Contract:class{
    async allowance(){return 0n;}
    async approve(){sends++;return{hash:'0x'+'11'.repeat(32),async wait(){return{status:1,blockNumber:42}}};}
  }};
  a.exec("account='0x1111111111111111111111111111111111111111';signer={}");
  await assert.rejects(a.exec("approve({address:'0x2222222222222222222222222222222222222222',symbol:'M_ETH'},ADDR.PositionManager,1n)"),/额度仍不足/);
  assert.equal(sends,1);
});

test('RPC gas-price cooldown with code -32002 is not mislabeled as a pending wallet prompt',async()=>{
  const a=await app();
  a.context.rpcError={code:'UNKNOWN_ERROR',shortMessage:'could not coalesce error',error:{code:-32002,message:'RPC 0x7a69 Custom eth_gasPrice: RPC endpoint returned too many errors, retrying in 0.43 minutes. Consider using a different RPC endpoint.'}};
  const message=a.exec('formatWalletError(rpcError)');
  assert.match(message,/RPC 暂时不可用/);assert.match(message,/11155111/);assert.match(message,/31337/);
  assert.doesNotMatch(message,/待处理请求/);
  a.context.rpcError={code:'UNKNOWN_ERROR',error:{code:-32002,message:'Request of type eth_requestAccounts already pending'}};
  assert.match(a.exec('formatWalletError(rpcError)'),/待处理请求/);
});

test('liquidity preview explains the 1000 USDT / 2 ETH mismatch and fills the matching amount',async()=>{
  const a=await app();
  a.exec("pools=[{token0:'0x2222222222222222222222222222222222222222',token1:'0x3333333333333333333333333333333333333333',tickLower:-52986,tickUpper:-46054,sqrtPriceX96:7911230275093791286156619990n,liquidity:137250872007063784060n,wallet0:20000n*10n**18n,wallet1:10n*10n**18n,m0:{symbol:'M_USDT',decimals:18},m1:{symbol:'M_ETH',decimals:18}}]");
  a.get('lpPool').value='0';a.get('lpAmount0').value='1000';a.get('lpAmount1').value='2';
  a.exec('renderLiquidityPreview()');
  const rows=a.get('lpPreview').children[1].children[1].children;
  assert.match(rows[0].children[2].textContent,/1\.00516893/);
  assert.match(rows[0].children[3].textContent,/998\.99483106/);
  assert.equal(rows[1].children[2].textContent,'2');
  a.exec('fillLpMatch(1)');
  assert.equal(a.get('lpAmount0').value,'1.005168935060106706');
  a.get('lpAmount1').value='11';a.exec('renderLiquidityPreview()');
  assert.match(a.get('lpAmount1').validationMessage,/超过钱包余额/);
});

test('preview math matches SDK tick and liquidity integer rounding',()=>{
  const math=require('../liquidity-math.js');
  const {TickMath,maxLiquidityForAmounts,SqrtPriceMath}=require('../../swap-contract/node_modules/@uniswap/v3-sdk');
  const JSBI=require('../../swap-contract/node_modules/jsbi');
  for(const tick of [-887272,-52986,-46054,-1,0,1,887272])assert.equal(math.sqrtAtTick(tick).toString(),TickMath.getSqrtRatioAtTick(tick).toString());
  const p={tickLower:-52986,tickUpper:-46054,sqrtPriceX96:7911230275093791286156619990n,liquidity:137250872007063784060n};
  const x=JSBI.BigInt(p.sqrtPriceX96.toString()),lo=TickMath.getSqrtRatioAtTick(p.tickLower),hi=TickMath.getSqrtRatioAtTick(p.tickUpper);
  for(const [a,b] of [[1000n*10n**18n,2n*10n**18n],[1n*10n**18n,10n*10n**18n],[0n,0n]]){
    const q=math.quote(p,a,b),l=maxLiquidityForAmounts(x,lo,hi,JSBI.BigInt(a.toString()),JSBI.BigInt(b.toString()),false);
    assert.equal(q.liquidity.toString(),l.toString());
    assert.equal(q.amount0.toString(),SqrtPriceMath.getAmount0Delta(x,hi,l,true).toString());
    assert.equal(q.amount1.toString(),SqrtPriceMath.getAmount1Delta(lo,x,l,true).toString());
    assert.ok(q.amount0<=a&&q.amount1<=b);
  }
});

test('each position recovers actual deposited amounts from its own Mint event, not pool totals or input caps',async()=>{
  const a=await app(),pm=a.exec('ADDR.PositionManager'),wallet='0x1111111111111111111111111111111111111111';
  const pool={pool:'0x4444444444444444444444444444444444444444',token0:'0x2222222222222222222222222222222222222222',token1:'0x3333333333333333333333333333333333333333'};
  const position={id:2n,token0:pool.token0,token1:pool.token1,index:0n,liquidity:42n,tokensOwed0:0n,tokensOwed1:0n};
  const iface=new ethers.Interface(JSON.parse(fs.readFileSync(path.join(root,'abi/PositionManager.json'))));
  const events=new ethers.Interface(['event Mint(address sender,address indexed owner,uint128 amount,uint256 amount0,uint256 amount1)']);
  const params={token0:pool.token0,token1:pool.token1,index:0,amount0Desired:1000n*10n**18n,amount1Desired:2n*10n**18n,recipient:wallet,deadline:2000000000};
  const makeMint=(id,amount0,amount1)=>[
    {address:pool.pool,...events.encodeEventLog(events.getEvent('Mint'),[pm,pm,42n,amount0,amount1])},
    {address:pm,...iface.encodeEventLog(iface.getEvent('Transfer'),[ethers.ZeroAddress,wallet,id])}
  ];
  const receipt={status:1,hash:'0x'+'aa'.repeat(32),logs:[...makeMint(1n,50n*10n**18n,5n*10n**18n),...makeMint(2n,1005168935060106706n,2n*10n**18n)]};
  const transaction={to:pm,from:wallet,data:iface.encodeFunctionData('mint',[params])};
  a.context.positionFixture=position;a.context.poolFixture=pool;a.context.receiptFixture=receipt;a.context.transactionFixture=transaction;
  const deposit=a.exec('extractPositionDeposit(positionFixture,poolFixture,receiptFixture,transactionFixture)');
  assert.equal(deposit.amount0,1005168935060106706n);assert.equal(deposit.amount1,2n*10n**18n);assert.equal(deposit.max0,1000n*10n**18n);
  // Actual inputs still survive when an aggregator prevents decoding direct input maximums.
  a.context.transactionFixture={...transaction,to:pm,data:'0xdeadbeef'};
  assert.equal(a.exec('extractPositionDeposit(positionFixture,poolFixture,receiptFixture,transactionFixture)').amount0,deposit.amount0);
  a.context.transactionFixture=transaction;
  a.context.fakePositionContract={interface:iface};
  a.context.fakeProvider={async getBlockNumber(){return a.exec('POSITION_MANAGER_START_BLOCK')+1},async getLogs(){return[{address:pm,transactionHash:receipt.hash,...iface.encodeEventLog(iface.getEvent('Transfer'),[ethers.ZeroAddress,wallet,2n])}]},async getTransactionReceipt(){return receipt},async getTransaction(){return transaction}};
  a.exec('contracts={PositionManager:fakePositionContract};provider=fakeProvider');
  await a.exec('loadPositionDeposits([{p:positionFixture,pool:poolFixture}])');
  assert.equal(a.exec("positionDeposits.get('2').amount0"),deposit.amount0);
  a.exec("renderPositionAmounts($('positionList'),positionFixture,{symbol:'M_USDT',decimals:18},{symbol:'M_ETH',decimals:18},null,positionDeposits.get('2'),true)");
  const rows=a.get('positionList').children[1].children[1].children;
  assert.equal(rows[0].children[0].textContent,'最初实际投入');assert.match(rows[0].children[1].textContent,/1\.00516893/);
  assert.equal(rows[1].children[1].textContent,'1,000');assert.match(rows[2].children[1].textContent,/998\.99483106/);
});

test('fresh and legacy DEX versions keep pools and position history separate while sharing issued tokens',async()=>{
  const current=await app(),legacy=await app(new Map(),'?deployment=legacy');
  assert.equal(current.exec('DEPLOYMENT_KEY'),'current');assert.equal(legacy.exec('DEPLOYMENT_KEY'),'legacy');
  assert.notEqual(current.exec('ADDR.PoolManager'),legacy.exec('ADDR.PoolManager'));
  assert.notEqual(current.exec('ADDR.PositionManager'),legacy.exec('ADDR.PositionManager'));
  assert.equal(legacy.exec('ADDR.PositionManager'),'0x8201A0bB36E7c705431e4B859A12462a40ac6b8F');
  assert.equal(legacy.exec('POSITION_MANAGER_START_BLOCK'),12011721);
  assert.ok(current.exec('POSITION_MANAGER_START_BLOCK')>12011721);
  assert.equal(current.exec('ADDR.TokenLauncher'),legacy.exec('ADDR.TokenLauncher'));
  current.get('dexVersion').value='legacy';current.get('dexVersion').onchange();
  assert.equal(new URL(current.context.redirect).searchParams.get('deployment'),'legacy');
  legacy.get('dexVersion').value='current';legacy.get('dexVersion').onchange();
  assert.equal(new URL(legacy.context.redirect).searchParams.has('deployment'),false);
});

test('market ratio conversion accounts for token order and decimal precision',async()=>{
  const a=await app();
  const ether="{address:'0xa317221F46598d8ce092FBd8153AF118abec4872',decimals:18}";
  const usd="{address:'0x68Df69BC9EAEE428803B3aE0Aa00530aF19c4769',decimals:18}";
  const sqrt=a.exec(`priceSqrtFromRatio(${ether},${usd},1n,200n)`);
  assert.equal(sqrt,a.exec('isqrt((1n<<192n)/200n)'));
  a.context.referenceFixture={sqrtPriceX96:sqrt};
  assert.ok(Math.abs(a.exec(`Math.exp(marketHumanLog(referenceFixture,${ether},${usd}))`)-200)<1e-9);
  assert.ok(Math.abs(a.exec(`Math.exp(marketHumanLog(referenceFixture,${usd},${ether}))`)-0.005)<1e-12);
  // Same human ratio with a six-decimal stablecoin has a different raw sqrt price.
  const usd6="{address:'0x68Df69BC9EAEE428803B3aE0Aa00530aF19c4769',decimals:6}";
  const scaled=a.exec(`priceSqrtFromRatio(${ether},${usd6},1n,200n)`);assert.notEqual(scaled,sqrt);
  a.context.referenceFixture={sqrtPriceX96:scaled};
  assert.ok(Math.abs(a.exec(`Math.exp(marketHumanLog(referenceFixture,${ether},${usd6}))`)-200)<1e-9);
});

test('owner reference automatically fills creation and displays separately from swap execution',async()=>{
  const a=await app(),owner='0x1111111111111111111111111111111111111111';let requested;
  const price=a.exec('isqrt((1n<<192n)/200n)');
  a.context.fakeMarket={async owner(){return owner},async getPrice(){return{sqrtPriceX96:price,version:4n,updatedAt:1000n}},async createPoolAtReference(...args){requested=args;return{hash:'0x'+'ab'.repeat(32),async wait(){return{status:1}}};}};
  a.exec(`account='${owner}';contracts={MarketPriceRegistry:fakeMarket};
    const mockA={address:'0xa317221F46598d8ce092FBd8153AF118abec4872',symbol:'M_ETH',decimals:18,chainId:11155111};
    const mockB={address:'0x68Df69BC9EAEE428803B3aE0Aa00530aF19c4769',symbol:'M_USDT',decimals:18,chainId:11155111};
    addCatalogToken(mockA,false);addCatalogToken(mockB,false);metadata.set(mockA.address.toLowerCase(),mockA);metadata.set(mockB.address.toLowerCase(),mockB);
    setCreateToken('createA',mockA);setCreateToken('createB',mockB);chosenTokens[0]=mockA;chosenTokens[1]=mockB;`);
  await a.exec('refreshMarketOwner()');await a.exec('refreshCreateMarketPrice(true)');
  assert.equal(a.get('marketAdmin').hidden,false);assert.equal(a.get('initialPrice').value,'200');assert.equal(a.get('initialPrice').readOnly,true);
  assert.equal(a.get('useMarketPrice').checked,true);
  a.get('amountIn').value='2';await a.exec('refreshSwapMarketPrice()');
  assert.match(a.get('swapMarketReference').children[0].textContent,/1 M_ETH ≈ 200 M_USDT/);
  assert.match(a.get('swapMarketReference').children[1].textContent,/400 M_USDT/);
  assert.match(a.get('swapMarketReference').children[2].textContent,/不保证按此成交/);
  a.get('fee').value='3000';a.get('tickLower').value='-60000';a.get('tickUpper').value='-40000';
  a.exec('refresh=async()=>{}');await a.exec('createPool()');
  assert.equal(requested[5],4n);assert.equal(requested[2],3000);assert.equal(requested.length,6);
  a.exec("account='0x2222222222222222222222222222222222222222'");await a.exec('refreshMarketOwner()');assert.equal(a.get('marketAdmin').hidden,true);
});

test('initial tick diagnostics explain the excluded 400-430 range and offer a valid reference-centered range',async()=>{
  const a=await app(),math=require('../liquidity-math.js');
  const {TickMath}=require('../../swap-contract/node_modules/@uniswap/v3-sdk');const JSBI=require('../../swap-contract/node_modules/jsbi');
  for(const tick of [-887272,-60641,-59918,-52986,-46054,0,887271]){
    const sqrt=math.sqrtAtTick(tick);assert.equal(math.tickAtSqrt(sqrt),TickMath.getTickAtSqrtRatio(JSBI.BigInt(String(sqrt))));
  }
  a.exec(`const exampleA={address:'0xa317221F46598d8ce092FBd8153AF118abec4872',symbol:'M_ETH',decimals:18,chainId:11155111};
    const exampleB={address:'0x68Df69BC9EAEE428803B3aE0Aa00530aF19c4769',symbol:'M_USDT',decimals:18,chainId:11155111};
    addCatalogToken(exampleA,false);addCatalogToken(exampleB,false);setCreateToken('createA',exampleA);setCreateToken('createB',exampleB);
    createMarketReference={sqrtPriceX96:isqrt((1n<<192n)/200n),version:4n,key:marketPairKey(exampleA,exampleB)};`);
  a.get('useMarketPrice').checked=true;a.get('tickLower').value='-60641';a.get('tickUpper').value='-59918';
  a.exec('renderInitialTickInfo()');assert.match(a.get('initialTickInfo').textContent,/需满足 tickLower ≤ -52986 < tickUpper/);
  a.get('fitInitialRange').onclick();
  assert.ok(Number(a.get('tickLower').value)<=-52986);assert.ok(Number(a.get('tickUpper').value)>-52986);
  assert.match(a.get('initialTickInfo').textContent,/已在当前区间内/);
});

test('unsettled position fees are separate from settled owed and included in the withdrawal estimate',async()=>{
  const a=await app();
  a.exec(`const feePosition={id:1n,liquidity:4828217995027465406356n,tokensOwed0:0n,tokensOwed1:0n,feeGrowthInside0LastX128:0n,feeGrowthInside1LastX128:0n};
    const growth=(99n*10n**16n)*(1n<<128n)/feePosition.liquidity;
    const pendingFees=estimatePositionFees(feePosition,0n,growth);
    const feePoolFixture={tickLower:-100,tickUpper:100,sqrtPriceX96:1n<<96n};
    const principalFixture=LiquidityPreviewMath.principal(feePoolFixture,feePosition.liquidity);
    renderPositionAmounts($('positionList'),feePosition,{symbol:'M_USDT',decimals:18},{symbol:'M_ETH',decimals:18},feePoolFixture,null,true,pendingFees);`);
  assert.equal(a.exec('pendingFees.amount0'),0n);
  assert.ok(a.exec('pendingFees.amount1')>98n*10n**16n);
  assert.ok(a.exec('pendingFees.amount1')<10n**18n);
  const rows=a.get('positionList').children[1].children[1].children;
  const pending=rows.find(r=>r.children[0].textContent==='未结算手续费估算');
  const settled=rows.find(r=>r.children[0].textContent==='已结算待领取（本金＋费用）');
  const total=rows.find(r=>r.children[0].textContent==='预计移除后可领取合计');
  assert.match(pending.children[2].textContent,/0\.98999999/);
  assert.equal(settled.children[2].textContent,'0');
  assert.equal(total.children[2].title,ethers.formatUnits(a.exec('principalFixture.amount1+pendingFees.amount1'),18)+' M_ETH');
});
