'use strict';
const $ = id => document.getElementById(id);
const DEPLOYMENT_KEY=new URLSearchParams(location.search||'').get('deployment')==='legacy'?'legacy':'current';
const ACTIVE_DEPLOYMENT=DEX_DEPLOYMENTS[DEPLOYMENT_KEY];
const ADDR=Object.freeze({...ACTIVE_DEPLOYMENT.addresses});
const EXPLORER='https://sepolia.etherscan.io';
const ERC20=['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
let provider,signer,account,pools=[],reversed=false,busy=false,abis,contracts;
const metadata=new Map();
let marketOwnerAddress=null,createMarketReference=null,swapMarketReference=null,createMarketKey='';
let createMarketRequest=0,swapMarketRequest=0;
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);if(!error)$('errorDetails').hidden=true}
function walletErrorInfo(error){
  const entries=[],seen=new Set();
  function visit(value,depth=0){
    if(depth>8||!value||typeof value!=='object'||seen.has(value))return;
    seen.add(value);
    for(const key of ['reason','shortMessage','message'])if(typeof value[key]==='string')entries.push({kind:'message',value:value[key].slice(0,1000),depth});
    if(value.code!==undefined)entries.push({kind:'code',value:String(value.code),depth});
    if(typeof value.method==='string')entries.push({kind:'method',value:value.method,depth});
    if(typeof value.data==='string'&&/^0x[0-9a-f]+$/i.test(value.data))entries.push({kind:'data',value:value.data,depth});
    for(const key of ['error','info','data','originalError','cause','payload'])visit(value[key],depth+1);
  }
  visit(error);
  return entries;
}
function decodeWalletRevert(data){
  try{
    const iface=new ethers.Interface(['error Error(string)','error Panic(uint256)','error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)','error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)']);
    const parsed=iface.parseError(data);
    if(!parsed)return null;
    if(parsed.name==='Error')return String(parsed.args[0]);
    if(parsed.name==='Panic')return `合约计算异常（Panic ${parsed.args[0]}），可能为算术溢出或除零。`;
    if(parsed.name==='ERC20InsufficientAllowance')return `代币授权额度不足：现有 ${parsed.args.allowance}，需要 ${parsed.args.needed}（最小单位）。请确认对 PositionManager 的授权已上链。`;
    if(parsed.name==='ERC20InsufficientBalance')return '代币余额不足，无法完成转账。';
  }catch{/* Some RPCs do not include decodable revert data. */}
  return null;
}
function formatWalletError(error){
  const entries=walletErrorInfo(error),codes=entries.filter(e=>e.kind==='code').map(e=>e.value);
  if(codes.includes('4001')||codes.includes('ACTION_REJECTED'))return '已取消钱包操作。';
  const messages=entries.filter(e=>e.kind==='message').sort((a,b)=>b.depth-a.depth).map(e=>e.value);
  const joined=messages.join(' ');
  // Some wallets also use -32002 for failed RPC backends, not only pending prompts.
  if(/RPC endpoint returned too many errors|eth_gasPrice.*(?:failed|error|unavailable)|(?:failed|error|unavailable).*eth_gasPrice/i.test(joined))return '钱包 RPC 暂时不可用，无法获取 Gas 价格。请在钱包选择 Sepolia（Chain ID 11155111）并切换可用 RPC 后重试。'+(/0x7a69/i.test(joined)?' 错误中出现 0x7a69（31337），请核对钱包的本地链和 Sepolia RPC 配置。':'');
  if(/already pending|request.*pending/i.test(joined))return '钱包中还有待处理请求，请先在钱包里确认或取消。';
  if(/in-flight transaction limit|inflight transaction limit/i.test(joined))return 'RPC 限制该钱包同时存在的待确认交易。请先处理钱包中的待确认交易，再重新操作；不要连续重复发送。';
  for(const item of entries.filter(e=>e.kind==='data')){const decoded=decodeWalletRevert(item.value);if(decoded)return decoded;}
  if(codes.includes('INSUFFICIENT_FUNDS')||/insufficient funds/i.test(joined))return 'Sepolia ETH 不足以支付 Gas，请补充测试 ETH。';
  if(codes.includes('NONCE_EXPIRED')||/nonce.*too low/i.test(joined))return '钱包交易序号已被使用，请检查钱包的待确认交易后重试。';
  const useful=messages.find(m=>!/^could not coalesce error|^unknown error|^internal JSON-RPC error|^execution reverted(?: \(unknown custom error\))?$/i.test(m));
  return (useful||'钱包或 RPC 返回了无法识别的错误，请展开下方错误详情。').slice(0,500);
}
function fail(e){
  console.error(e);
  const message=(e.appStage?e.appStage+'：':'')+formatWalletError(e);
  status(message,true);
  $('errorDetailsText').textContent=JSON.stringify({stage:e.appStage||null,reason:formatWalletError(e),details:walletErrorInfo(e).map(v=>({kind:v.kind,value:v.value.slice(0,v.kind==='data'?300:700)}))},null,2);
  $('errorDetails').hidden=false;
  if($('tokenDialog')?.open)$('tokenDialogStatus').textContent=message;
}
async function atStep(label,action){
  try{return await action()}catch(cause){const error=new Error(formatWalletError(cause));error.cause=cause;error.appStage=label;throw error;}
}
function short(a){return a.slice(0,6)+'…'+a.slice(-4)}
function link(path,label){const a=document.createElement('a');a.href=EXPLORER+path;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';return a}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function tab(name){if(!['swap','pools','positions','release'].includes(name))name='swap';document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==name);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));history.replaceState(null,'','#'+name)}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));window.addEventListener('hashchange',()=>tab(location.hash.slice(1)));tab(location.hash.slice(1));
for(const [name,address] of Object.entries(ADDR))$('contracts').append(link('/address/'+address,name+' · '+short(address)));
async function run(action){if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input,select')].map(b=>[b,b.disabled]);controls.forEach(([b])=>b.disabled=true);try{await action()}catch(e){fail(e)}finally{busy=false;controls.forEach(([b,disabled])=>b.disabled=disabled)}}
async function init(){abis=Object.fromEntries(await Promise.all(Object.keys(ADDR).map(async k=>{const r=await fetch('abi/'+k+'.json');if(!r.ok)throw Error('无法加载合约 ABI，请通过本地 HTTP 服务打开页面。');return[k,await r.json()]})));}
const ready=init();ready.catch(fail);
async function ensureChain(){if(!window.ethereum)throw Error('请安装 MetaMask 等浏览器钱包后重试。');const chain=await window.ethereum.request({method:'eth_chainId'});if(chain!=='0xaa36a7'){try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]})}catch(e){if(e.code!==4902)throw e;await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0xaa36a7',chainName:'Sepolia',nativeCurrency:{name:'Sepolia Ether',symbol:'ETH',decimals:18},rpcUrls:['https://ethereum-sepolia-rpc.publicnode.com'],blockExplorerUrls:[EXPLORER]}]})}}}
async function connect(){await tokenReady;await ensureChain();await window.ethereum.request({method:'eth_requestAccounts'});provider=new ethers.BrowserProvider(window.ethereum);signer=await provider.getSigner();account=await signer.getAddress();contracts=Object.fromEntries(Object.entries(ADDR).map(([k,a])=>[k,new ethers.Contract(a,abis[k],signer)]));$('connect').textContent=short(account)+' ↗';$('swapAction').textContent='授权并兑换';await refreshMarketOwner();await refresh();}
async function requireWallet(){if(!account)throw Error('请先连接钱包。');const chain=await window.ethereum.request({method:'eth_chainId'});const accounts=await window.ethereum.request({method:'eth_accounts'});if(chain!=='0xaa36a7'||accounts[0]?.toLowerCase()!==account.toLowerCase())throw Error('钱包账户或网络已更改，请重新连接。');}
if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>location.reload());window.ethereum.on?.('chainChanged',()=>{if(account)location.reload()});}
$('connect').onclick=()=>run(connect);
async function token(address){const key=address.toLowerCase();if(metadata.has(key))return metadata.get(key);const t=new ethers.Contract(address,ERC20,provider);const [symbol,decimals]=await Promise.all([t.symbol().catch(()=>short(address)),t.decimals()]);const m={address,symbol:String(symbol).slice(0,28),decimals:Number(decimals)};metadata.set(key,m);return m;}
function selected(id='swapPool'){const p=pools[Number($(id).value)];if($(id).value===''||!p)throw Error('请先选择交易池；没有池子时请先创建并添加流动性。');return p}
async function refresh(){await requireWallet();status('正在读取 Sepolia 链上数据…');const chainPools=await contracts.PoolManager.getAllPools();pools=await Promise.all(chainPools.map(async p=>readPoolBalances({pool:p.pool,token0:p.token0,token1:p.token1,index:p.index,fee:p.fee,tickLower:p.tickLower,tickUpper:p.tickUpper,sqrtPriceX96:p.sqrtPriceX96,liquidity:p.liquidity,m0:await token(p.token0),m1:await token(p.token1)})));const lp=$('lpPool');const previous=lp.value;lp.replaceChildren(new Option(pools.length?'请选择交易池':'暂无交易池，请先创建',''));pools.forEach((p,i)=>{lp.add(new Option(`${p.m0.symbol} / ${p.m1.symbol} · ${Number(p.fee)/10000}% · #${p.index}`,String(i)));for(const m of [p.m0,p.m1])addCatalogToken({...m,name:m.symbol,chainId:11155111,source:'本 DEX 池子'},false)});if(pools.length)lp.value=pools[Number(previous)]&&previous!==''?previous:'0';renderPools();await Promise.all([updateTokens(),loadPositions()]);await loadReleasedTokens();await refreshCreateMarketPrice();await updateLPLabels();$('chainStatus').textContent=`Sepolia 已连接 · ${pools.length} 个交易池`;status(pools.length?'链上数据已更新。':'暂无交易池。前往「流动性池」创建并添加流动性。');}
function invalidateQuote(){$('amountOut').textContent='0.0';$('quoteDetail').textContent='报价来自链上模拟，最终以交易结果为准。'}
async function updateTokens(){invalidateQuote();matchSwapPools();for(const [i,id,balance] of [[0,'tokenIn','balanceIn'],[1,'tokenOut','balanceOut']]){const m=chosenTokens[i];$(id).textContent=m?m.symbol+' ▾':'选择代币 ▾';$(balance).textContent='余额 —';if(m&&account){try{const actual=await token(m.address);chosenTokens[i]={...m,...actual};const n=await new ethers.Contract(m.address,ERC20,provider).balanceOf(account);$(balance).textContent='余额 '+pretty(n,actual.decimals)}catch{$(balance).textContent='余额读取失败'}}}await refreshSwapMarketPrice();}
function pretty(n,d){const s=ethers.formatUnits(n,d);const [a,b]=s.split('.');const fraction=b?.slice(0,6).replace(/0+$/,'');return fraction?a+'.'+fraction:a}
$('amountIn').oninput=invalidateQuote;$('slippage').oninput=invalidateQuote;
$('swapPool').onchange=()=>{invalidateQuote();syncDirection()};$('flip').onclick=()=>run(async()=>{chosenTokens.reverse();await updateTokens()});
$('refresh').onclick=()=>run(async()=>{if(!account)return connect();await refresh()});
function swapInput(){const p=selected();syncDirection();const [a,b]=reversed?[p.m1,p.m0]:[p.m0,p.m1];const n=ethers.parseUnits($('amountIn').value.trim(),a.decimals);if(n<=0n)throw Error('请输入大于 0 的支付数量。');if(p.liquidity===0n)throw Error('该池子暂无流动性，请先添加。');const slip=Number($('slippage').value);if(!Number.isFinite(slip)||slip<0.01||slip>50)throw Error('滑点范围为 0.01% 至 50%。');return{p,a,b,n,bps:BigInt(Math.round(slip*100)),limit:reversed?1461446703485210103287273052203988822378723970341n:4295128740n}}
async function quoteValue(s){await refreshSwapMarketPrice();const out=await contracts.SwapRouter.quoteExactInput.staticCall({tokenIn:s.a.address,tokenOut:s.b.address,indexPath:[s.p.index],amountIn:s.n,sqrtPriceLimitX96:s.limit});if(out<=0n)throw Error('当前池子无法提供有效报价。');const min=out*(10000n-s.bps)/10000n;if(min===0n)throw Error('金额过小，滑点保护后的最低接收量为 0。');$('amountOut').textContent=pretty(out,s.b.decimals);$('quoteDetail').textContent=`最低接收 ${ethers.formatUnits(min,s.b.decimals)} ${s.b.symbol} · 手续费 ${Number(s.p.fee)/10000}%`;return{out,min}}
$('quote').onclick=()=>run(async()=>{await requireWallet();status('正在模拟链上报价…');await quoteValue(swapInput());status('报价已更新。兑换时将重新获取报价。')});
async function send(label,action){
  await requireWallet();status(label+'：请在钱包确认…');
  const tx=await atStep(label+'（钱包签名或发送）',action);
  const a=link('/tx/'+tx.hash,label+' · '+short(tx.hash)+' · 等待确认');$('transactions').prepend(a);
  status(label+'：交易已发送，等待确认…');
  const receipt=await atStep(label+'（等待确认）',()=>tx.wait());
  if(!receipt||receipt.status!==1)throw Error(label+'失败');
  a.textContent=label+' · '+short(tx.hash)+' · 已确认';return receipt;
}
async function approve(m,spender,n){
  if(n===0n)return;
  const t=new ethers.Contract(m.address,ERC20,signer);
  const allowance=await atStep('读取 '+m.symbol+' 授权额度',()=>t.allowance(account,spender));
  if(allowance>=n)return;
  const receipt=await send('授权 '+m.symbol,()=>t.approve(spender,n));
  // Pin the read to the mined block instead of reusing a cached pre-approval "latest" call.
  const confirmed=await atStep('确认 '+m.symbol+' 授权已生效',()=>t.allowance(account,spender,{blockTag:receipt.blockNumber}));
  if(confirmed<n)throw Error(m.symbol+' 授权交易已确认，但额度仍不足。请核对代币授权，不要直接重复添加流动性。');
}
$('swapAction').onclick=()=>run(async()=>{if(!account)return connect();await requireWallet();const s=swapInput();await quoteValue(s);const t=new ethers.Contract(s.a.address,ERC20,provider);if(await t.balanceOf(account)<s.n)throw Error('代币余额不足。');await approve(s.a,ADDR.SwapRouter,s.n);const {min}=await quoteValue(s);const params={tokenIn:s.a.address,tokenOut:s.b.address,indexPath:[s.p.index],recipient:account,deadline:Math.floor(Date.now()/1000)+1200,amountIn:s.n,amountOutMinimum:min,sqrtPriceLimitX96:s.limit};await contracts.SwapRouter.exactInput.staticCall(params);await send('兑换',()=>contracts.SwapRouter.exactInput(params));$('amountIn').value='';await refresh();status('兑换成功。')});
function renderPools(){const list=$('poolList');list.replaceChildren();list.classList.toggle('empty',!pools.length);if(!pools.length){list.textContent='还没有交易池，创建第一个池子开始体验。';return;}pools.forEach((p,i)=>{const c=node('div',undefined,'pool-card');c.append(node('b',`${p.m0.symbol} / ${p.m1.symbol}`),node('p',`#${p.index} · 手续费 ${Number(p.fee)/10000}% · Tick ${p.tickLower} → ${p.tickUpper}`),renderPoolPriceRange(p),renderPoolBalances(p),node('p',p.liquidity>0n?'已有流动性':'等待添加流动性'),link('/address/'+p.pool,short(p.pool)+' ↗'));const btn=node('button','添加流动性','secondary');btn.onclick=()=>{$('lpPool').value=String(i);updateLPLabels();$('lpAmount0').focus()};c.append(node('br'),btn);list.append(c)})}
async function updateLPLabels(){await loadLiquidityForm();}
$('lpPool').onchange=updateLPLabels;
$('toggleCreate').onclick=()=>{$('createForm').hidden=!$('createForm').hidden};
function isqrt(n){if(n<0n)throw Error('价格无效');if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n}return x}
async function createPool(){
  await requireWallet();
  const aa=ethers.getAddress($('createA').value.trim()),bb=ethers.getAddress($('createB').value.trim());
  if(aa===bb||aa===ethers.ZeroAddress||bb===ethers.ZeroAddress)throw Error('请使用两个不同且非零的 ERC-20 地址。');
  const [a,b]=await Promise.all([token(aa),token(bb)]);
  const fee=Number($('fee').value),lo=Number($('tickLower').value),hi=Number($('tickUpper').value);
  if(!Number.isInteger(fee)||fee<0||fee>16777215)throw Error('手续费参数必须是 uint24 范围内的整数。');
  if(!$('tickLower').value.trim()||!$('tickUpper').value.trim()||!Number.isInteger(lo)||!Number.isInteger(hi)||lo < -887272||hi>887272||lo>=hi)throw Error('Tick 必须为 -887272 至 887272 之间的整数，且下限小于上限。');
  let sqrt,reference=null;
  if($('useMarketPrice').checked){
    reference=await fetchMarketPrice(a,b);
    if(!reference)throw Error('当前代币对未配置模拟市场价，请由 owner 设置，或取消勾选后手动输入初始化价格。');
    if(createMarketReference?.key===reference.key&&createMarketReference.version!==reference.version){await refreshCreateMarketPrice();throw Error('模拟市场价已更新，请确认最新价格与区间后重新创建。');}
    createMarketReference=reference;applyCreateReference();
    sqrt=reference.sqrtPriceX96;
  }else{
    const value=$('initialPrice').value.trim();
    if(!/^\d+(\.\d{1,36})?$/.test(value))throw Error('请输入有效初始价格，最多 36 位小数。');
    sqrt=priceSqrtFromRatio(a,b,10n**36n,ethers.parseUnits(value,36));
  }
  const initialTick=LiquidityPreviewMath.tickAtSqrt(sqrt);
  if(initialTick<lo||initialTick>=hi)throw Error(`实际初始化 Tick 为 ${initialTick}（1 ${a.symbol} ≈ ${previewPrice(marketHumanLog({sqrtPriceX96:sqrt},a,b))} ${b.symbol}），不在 [${lo}, ${hi}) 内。请检查代币 A/B、参考价勾选与上下限，或点击按初始价设置区间。`);
  if(reference){
    await send('按模拟市场价创建池子',()=>contracts.MarketPriceRegistry.createPoolAtReference(a.address,b.address,fee,lo,hi,reference.version));
  }else{
    const sorted=BigInt(a.address)<BigInt(b.address);
    await send('创建交易池',()=>contracts.PoolManager.createAndInitializePoolIfNecessary({token0:sorted?a.address:b.address,token1:sorted?b.address:a.address,fee,tickLower:lo,tickUpper:hi,sqrtPriceX96:sqrt}));
  }
  await refresh();status('池子已创建或已存在，可添加流动性。已存在池子的价格不会被参考价重置。');
}
$('createForm').onsubmit=e=>{e.preventDefault();run(createPool)};
async function addLiquidity(){
  await requireWallet();
  const p=selected('lpPool');
  const a=ethers.parseUnits($('lpAmount0').value.trim(),p.m0.decimals),b=ethers.parseUnits($('lpAmount1').value.trim(),p.m1.decimals);
  if(a<0n||b<0n||a+b===0n)throw Error('请填写有效代币数量。');
  // Check both balances before asking for either approval.
  for(const [m,n] of [[p.m0,a],[p.m1,b]]){
    status('正在检查 '+m.symbol+' 余额…');
    const balance=await atStep('读取 '+m.symbol+' 余额',()=>new ethers.Contract(m.address,ERC20,provider).balanceOf(account));
    if(balance<n)throw Error(m.symbol+' 余额不足');
  }
  await approve(p.m0,ADDR.PositionManager,a);
  await approve(p.m1,ADDR.PositionManager,b);
  const params={token0:p.token0,token1:p.token1,index:p.index,amount0Desired:a,amount1Desired:b,recipient:account,deadline:Math.floor(Date.now()/1000)+1200};
  status('两种代币授权已就绪，正在模拟添加流动性…');
  const result=await atStep('模拟添加流动性',()=>contracts.PositionManager.mint.staticCall(params));
  if(result.liquidity===0n)throw Error('当前数量无法生成有效流动性。');
  const mintReceipt=await send('添加流动性',()=>contracts.PositionManager.mint(params));
  cachePositionMintReceipt(p,params,mintReceipt);
  try{await refresh();status('流动性已添加，NFT 仓位可在「我的仓位」中查看。')}
  catch(e){fail(e);status('添加流动性交易已确认，但页面刷新失败。请点击刷新，不要重复添加。',true);}
}
$('liquidityForm').onsubmit=e=>{e.preventDefault();run(addLiquidity)};
async function loadPositions(){
  const list=$('positionList');list.replaceChildren();
  const all=await contracts.PositionManager.getAllPositions(),visible=[];
  for(const p of all){
    let owner;
    try{owner=await contracts.PositionManager.ownerOf(p.id)}
    catch(e){
      let nonexistent=false;
      for(const entry of walletErrorInfo(e).filter(v=>v.kind==='data')){try{if(contracts.PositionManager.interface.parseError(entry.value)?.name==='ERC721NonexistentToken')nonexistent=true}catch{}}
      if(nonexistent)continue;
      throw e;
    }
    if(owner.toLowerCase()!==account.toLowerCase())continue;
    const [a,b]=await Promise.all([token(p.token0),token(p.token1)]);
    const pool=pools.find(v=>v.token0.toLowerCase()===p.token0.toLowerCase()&&v.token1.toLowerCase()===p.token1.toLowerCase()&&v.index===p.index);
    const c=node('div',undefined,'pool-card position-card');
    c.append(node('b',`#${p.id} · ${a.symbol} / ${b.symbol}`),node('p',`手续费 ${Number(p.fee)/10000}% · Tick ${p.tickLower} → ${p.tickUpper} · ${p.liquidity>0n?'流动性持有中':'已移除，等待领取'}`));
    const detail=node('div');renderPositionAmounts(detail,p,a,b,pool,null,false);c.append(detail);
    if(p.liquidity>0n){
      const burn=node('button','移除全部流动性','secondary');
      burn.onclick=()=>run(async()=>{await send('移除仓位 #'+p.id,()=>contracts.PositionManager.burn(p.id));await refresh();status('流动性已移除，请点击「领取」取回代币。')});c.append(burn);
    }
    const collect=node('button','领取本金与手续费','secondary');collect.disabled=p.liquidity>0n;
    collect.title=p.liquidity>0n?'请先移除流动性':'领取后销毁已清空的仓位 NFT';
    collect.onclick=()=>run(async()=>{await send('领取仓位 #'+p.id,()=>contracts.PositionManager.collect(p.id,account));await refresh();status('代币已领取，仓位 NFT 已销毁，因此不再列在当前仓位中。')});c.append(collect);list.append(c);
    visible.push({p,a,b,pool,detail});
  }
  list.classList.toggle('empty',visible.length===0);
  if(!visible.length){list.textContent='你的钱包还没有当前仓位。已领取并销毁的仓位不会显示在这里。';return;}
  // Read each pool's growth once, sharing it across the user's positions.
  const feeReads=new Map();
  await Promise.all(visible.map(async v=>{
    if(v.p.liquidity===0n)v.fees={amount0:0n,amount1:0n};
    else if(v.pool){
      try{
        const key=v.pool.pool.toLowerCase();
        if(!feeReads.has(key)){
          const feePool=new ethers.Contract(v.pool.pool,['function feeGrowthGlobal0X128() view returns(uint256)','function feeGrowthGlobal1X128() view returns(uint256)'],provider);
          feeReads.set(key,Promise.all([feePool.feeGrowthGlobal0X128(),feePool.feeGrowthGlobal1X128()]));
        }
        const [g0,g1]=await feeReads.get(key);v.fees=estimatePositionFees(v.p,g0,g1);
      }catch{v.fees=null;}
    }
    renderPositionAmounts(v.detail,v.p,v.a,v.b,v.pool,positionDeposits.get(v.p.id.toString()),false,v.fees);
  }));
  // Load historical deposits separately so a log-RPC failure cannot hide current positions.
  try{await loadPositionDeposits(visible)}catch{}
  for(const v of visible)renderPositionAmounts(v.detail,v.p,v.a,v.b,v.pool,positionDeposits.get(v.p.id.toString()),true,v.fees);
}

// Token lists identify assets; executable quotes still require our own pool liquidity.
const catalog=new Map();
const chosenTokens=[null,null];
let tokenTarget='in';
const STORAGE_KEY='metanode:tokens:11155111:v1';
function normalizeToken(t,source){if(!t||Number(t.chainId)!==11155111||!ethers.isAddress(t.address)||t.address===ethers.ZeroAddress||!Number.isInteger(t.decimals)||t.decimals<0||t.decimals>255||typeof t.symbol!=='string'||!t.symbol.trim())return null;return{chainId:11155111,address:ethers.getAddress(t.address),symbol:t.symbol.slice(0,28),name:String(t.name||t.symbol).slice(0,90),decimals:t.decimals,source:source||t.source||'本地导入',...(ethers.isAddress(t.creator||'')?{creator:ethers.getAddress(t.creator)}:{})};}
function addCatalogToken(t,persist=true){const m=normalizeToken(t);if(!m)return false;const k=m.address.toLowerCase();if(catalog.has(k))return false;catalog.set(k,m);if(persist)saveCatalog();return true;}
function saveCatalog(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify([...catalog.values()].filter(t=>t.source==='本地导入'||t.source==='自定义代币'||t.source==='本站发行')))}catch{$('tokenDialogStatus').textContent='当前浏览器无法保存代币，下次访问需重新导入。'}}
async function loadTokenCatalog(){const r=await fetch('tokens.json');if(!r.ok)throw Error('代币列表加载失败，请通过本地 HTTP 服务打开。');const data=await r.json();for(const t of data.tokens)addCatalogToken(t,false);try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');if(Array.isArray(saved))for(const t of saved.slice(0,10000))addCatalogToken({...t,source:t.source==='本站发行'?'本站发行':'本地导入'},false)}catch{/* Ignore invalid or unavailable browser-local storage. */}chosenTokens[0]=[...catalog.values()].find(t=>t.symbol==='WETH')||null;chosenTokens[1]=[...catalog.values()].find(t=>t.symbol==='USDC')||null;renderReleasedTokens();await updateTokens();}
const tokenReady=ready.then(loadTokenCatalog);tokenReady.catch(fail);
function matchesPair(p){const a=chosenTokens[0]?.address.toLowerCase(),b=chosenTokens[1]?.address.toLowerCase();if(!a||!b)return false;return(p.token0.toLowerCase()===a&&p.token1.toLowerCase()===b)||(p.token1.toLowerCase()===a&&p.token0.toLowerCase()===b)}
function syncDirection(){if($('swapPool').value==='')return;const p=selected();if(!matchesPair(p))throw Error('所选交易池与代币不匹配，请重新选择。');reversed=chosenTokens[0].address.toLowerCase()!==p.token0.toLowerCase()}
function matchSwapPools(){const s=$('swapPool'),previous=s.value;const matches=pools.map((p,i)=>({p,i})).filter(({p})=>matchesPair(p));s.replaceChildren(new Option(!account?'连接钱包后匹配交易池':matches.length?'请选择交易池':'当前代币对暂无交易池',''));for(const {p,i} of matches)s.add(new Option(`${Number(p.fee)/10000}% 手续费 · #${p.index} · ${p.liquidity>0n?'有流动性':'暂无流动性'}`,String(i)));if(matches.length){const preferred=matches.find(({i})=>String(i)===previous)||matches.find(({p})=>p.liquidity>0n)||matches[0];s.value=String(preferred.i);syncDirection()}$('createPair').hidden=!account||matches.length>0||!chosenTokens.every(Boolean);$('routeHint').textContent=!account?'可先选择代币，连接钱包后匹配流动性。':matches.length?`找到 ${matches.length} 个交易池，报价使用上方选中的池子。`:'这对代币在当前 DEX 中还没有池子。创建池子并添加流动性后即可获取报价。';}
function showTokenDialog(target){if(busy)return;tokenTarget=target;$('tokenSearch').value='';$('tokenDialogStatus').textContent='';renderTokenResults();$('tokenDialog').showModal();$('tokenSearch').focus()}
$('tokenIn').onclick=()=>showTokenDialog('in');$('tokenOut').onclick=()=>showTokenDialog('out');$('chooseCreateA').onclick=()=>showTokenDialog('createA');$('chooseCreateB').onclick=()=>showTokenDialog('createB');$('closeTokenDialog').onclick=()=>$('tokenDialog').close();
$('tokenDialog').addEventListener('click',e=>{if(e.target===$('tokenDialog')){const r=$('tokenDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('tokenDialog').close()}});
function setCreateToken(id,m){$(id).value=m.address;$(id==='createA'?'chooseCreateA':'chooseCreateB').textContent=m.symbol+' ▾';updateTickPreview();void refreshCreateMarketPrice();}
async function pickToken(m){if(busy)return;await run(async()=>{if(account){await requireWallet();m={...m,...await token(m.address)}}if(tokenTarget==='in'||tokenTarget==='out'){const i=tokenTarget==='in'?0:1,j=1-i;if(chosenTokens[j]?.address.toLowerCase()===m.address.toLowerCase())chosenTokens[j]=chosenTokens[i];chosenTokens[i]=m;await updateTokens()}else{const other=tokenTarget==='createA'?'createB':'createA';if($(other).value.toLowerCase()===m.address.toLowerCase())throw Error('池子的两个代币必须不同。');setCreateToken(tokenTarget,m)}$('tokenDialog').close();status('已选择 '+m.symbol+' · Sepolia')})}
function tokenBadge(m){const symbols={WBTC:'₿',USDT:'₮'};const colors={USDC:'usdc',WETH:'weth',USDT:'usdt',WBTC:'wbtc'};return node('span',symbols[m.symbol]||m.symbol.slice(0,1),`token-avatar ${colors[m.symbol]||''}`)}
function renderTokenResults(){const q=$('tokenSearch').value.trim().toLowerCase(),list=$('tokenResults');list.replaceChildren();const chips=$('popularTokens');chips.replaceChildren();for(const t of [...catalog.values()].filter(t=>['WETH','USDC','UNI','USDT','WBTC'].includes(t.symbol)).slice(0,5)){const b=node('button',t.symbol,'popular-token');b.type='button';b.onclick=()=>pickToken(t);chips.append(b)}const results=[...catalog.values()].sort((a,b)=>Number(b.source==='本站发行')-Number(a.source==='本站发行')).filter(t=>`${t.symbol} ${t.name} ${t.address} ${t.symbol==='WETH'?'ETH Ethereum 以太坊':t.symbol==='WBTC'?'BTC Bitcoin 比特币':t.symbol==='USDT'?'Tether 泰达币':''}`.toLowerCase().includes(q));for(const t of results.slice(0,100)){const row=node('button',undefined,'token-row');row.type='button';const text=node('span',undefined,'token-row-text');text.append(node('b',t.symbol),node('span',t.name,'token-name'),node('span',t.address,'token-address'));row.append(tokenBadge(t),text,node('span',t.source,'token-source'));row.onclick=()=>pickToken(t);list.append(row)}if(!results.length)list.append(node('p','没有找到代币。可粘贴 Sepolia 合约地址导入，或导入 Token List JSON。','empty'));else if(results.length>100)list.append(node('p','仅显示前 100 项，请搜索缩小范围。','small muted'));$('tokenImport').hidden=!ethers.isAddress(q)||catalog.has(q);$('importDescription').textContent='导入地址：'+$('tokenSearch').value.trim();}
$('tokenSearch').oninput=()=>{$('tokenDialogStatus').textContent='';renderTokenResults()};
$('importToken').onclick=async()=>{const address=$('tokenSearch').value.trim();if(!ethers.isAddress(address))return;try{if(!account)throw Error('请先关闭弹窗并连接 Sepolia 钱包，再读取自定义代币。');await requireWallet();$('importToken').disabled=true;$('tokenDialogStatus').textContent='正在读取链上 ERC-20 信息…';const code=await provider.getCode(address);if(code==='0x')throw Error('该地址在 Sepolia 上没有合约。');const m=await token(ethers.getAddress(address));const c=new ethers.Contract(m.address,ERC20,provider);const name=await c.name().catch(()=>m.symbol);addCatalogToken({...m,name,chainId:11155111,source:'自定义代币'});renderTokenResults();$('tokenDialogStatus').textContent='已导入。请核对地址后点击代币选择。'}catch(e){$('tokenDialogStatus').textContent=e.reason||e.shortMessage||e.message||'导入失败'}finally{$('importToken').disabled=false}};
$('tokenListFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>2*1024*1024)throw Error('代币列表文件不能超过 2 MB。');const data=JSON.parse(await f.text());const items=Array.isArray(data)?data:data.tokens;if(!Array.isArray(items)||items.length>10000)throw Error('请选择包含 tokens 数组的 Token List JSON，最多 10000 项。');let count=0;for(const t of items)if(addCatalogToken({...t,source:'本地导入'},false))count++;saveCatalog();renderTokenResults();$('tokenDialogStatus').textContent=`已添加 ${count} 个 Sepolia 代币，其他网络或重复地址已跳过。`}catch(err){$('tokenDialogStatus').textContent=err.message}finally{e.target.value=''}};
$('createPair').onclick=()=>{if(!chosenTokens.every(Boolean))return;setCreateToken('createA',chosenTokens[0]);setCreateToken('createB',chosenTokens[1]);tab('pools');$('createForm').hidden=false;$('chooseCreateA').focus()};

// Every launch is registered on chain so new assets can be discovered across browsers.
let releaseCursor=0n;
function issuedTokens(){return [...catalog.values()].filter(t=>t.source==='本站发行')}
function rememberIssued(t){const m=normalizeToken({...t,decimals:18,chainId:11155111,source:'本站发行'});if(!m)throw Error('发行登记信息无效');catalog.set(m.address.toLowerCase(),m);return m}
async function loadReleasedTokens(){await requireWallet();try{const count=await contracts.TokenLauncher.tokenCount();while(releaseCursor<count){const page=await contracts.TokenLauncher.getTokens(releaseCursor,100);if(!page.length)throw Error('发行登记簿读取中断，请重试同步。');for(const t of page)rememberIssued({address:t.token,name:t.name,symbol:t.symbol,creator:t.creator});releaseCursor+=BigInt(page.length)}saveCatalog();renderReleasedTokens()}catch(e){$('releaseList').replaceChildren(node('p','发行记录同步失败，可点击「同步链上记录」重试。','small muted'));renderPoolIssued();throw e}}
function renderPoolIssued(){const box=$('releasedForPool');box.replaceChildren();const head=node('div',undefined,'issued-heading');head.append(node('span','选择已发行的代币','small'));const add=node('button','＋ 发行新代币','text-btn');add.type='button';add.onclick=()=>tab('release');head.append(add);box.append(head);const items=issuedTokens();if(!items.length){box.append(node('p',account?'还没有发行记录，可以先发行代币。':'连接钱包后同步已发行代币，也可选择浏览器中保存的代币。','small muted'));return}const choices=node('div',undefined,'issued-choices');for(const t of items.slice().reverse()){const b=node('button',`${t.symbol} · ${short(t.address)}`,'issued-token');b.type='button';b.title=t.name+' · '+t.address;b.onclick=()=>prepareIssuedPool(t);choices.append(b)}box.append(choices,node('p','点击带入代币 A；全部代币也可在 A / B 选择器中搜索。','small muted'))}
function renderReleasedTokens(){const list=$('releaseList');list.replaceChildren();const items=issuedTokens();list.classList.toggle('empty',!items.length);if(!items.length)list.textContent=account?'还没有发行代币，完成首次发行后将在这里显示。':'连接钱包后同步链上发行记录。';for(const t of items.slice().reverse()){const card=node('div',undefined,'pool-card');card.append(node('b',`${t.symbol} · ${t.name}`),node('p',`100,000 枚 · 18 位精度${t.creator&&account&&t.creator.toLowerCase()===account.toLowerCase()?' · 由你发行':''}`),link('/address/'+t.address,t.address+' ↗'));const btn=node('button','创建流动池 →','secondary');btn.type='button';btn.onclick=()=>prepareIssuedPool(t);card.append(node('br'),btn);list.append(card)}renderPoolIssued()}
function prepareIssuedPool(t){if(busy)return;setCreateToken('createA',t);const b=$('createB').value;let other=b&&catalog.get(b.toLowerCase());if(!other||other.address.toLowerCase()===t.address.toLowerCase())other=[...catalog.values()].find(m=>m.symbol==='WETH'&&m.address.toLowerCase()!==t.address.toLowerCase());if(other)setCreateToken('createB',other);tab('pools');$('createForm').hidden=false;$('initialPrice').focus();status('已带入 '+t.symbol+'，请设置初始价格与区间后创建池子。')}
async function addIssuedToWallet(t){await requireWallet();await window.ethereum.request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:t.address,symbol:t.symbol,decimals:18}}})}
function showReleaseSuccess(t){const box=$('releaseSuccess');box.replaceChildren(node('h3','代币发行成功'),node('p',`100,000 ${t.symbol} 已发到你的钱包。`),link('/address/'+t.address,t.address+' ↗'));const row=node('div',undefined,'actions');const watch=node('button','添加到钱包','secondary');watch.type='button';watch.onclick=()=>run(()=>addIssuedToWallet(t));const pool=node('button','创建流动池 →','primary');pool.type='button';pool.onclick=()=>prepareIssuedPool(t);row.append(watch,pool);box.append(row);box.hidden=false}
$('syncReleased').onclick=()=>run(async()=>{if(!account)await connect();else await loadReleasedTokens();status('已同步链上发行记录，创建池子时可直接选择。')});
$('releaseForm').onsubmit=e=>{e.preventDefault();run(async()=>{await requireWallet();const name=$('releaseName').value.trim(),symbol=$('releaseSymbol').value.trim();if(!name||ethers.toUtf8Bytes(name).length>96)throw Error('名称不能为空，UTF-8 长度最多 96 字节。');if(!symbol||ethers.toUtf8Bytes(symbol).length>16)throw Error('符号不能为空，UTF-8 长度最多 16 字节。');const creator=account;const receipt=await send('发行 '+symbol,()=>contracts.TokenLauncher.createToken(name,symbol));let created;for(const log of receipt.logs){if(log.address.toLowerCase()!==ADDR.TokenLauncher.toLowerCase())continue;try{const event=contracts.TokenLauncher.interface.parseLog(log);if(event?.name==='TokenCreated'&&event.args.creator.toLowerCase()===creator.toLowerCase())created=event.args}catch{/* Ignore unrelated receipt logs. */}}if(!created)throw Error('交易已确认，暂未解析到发行地址。请同步链上记录，勿重复发行。');const t=rememberIssued({address:created.token,creator:created.creator,name:created.name,symbol:created.symbol});saveCatalog();renderReleasedTokens();setCreateToken('createA',t);const weth=[...catalog.values()].find(m=>m.symbol==='WETH');if(weth)setCreateToken('createB',weth);showReleaseSuccess(t);$('releaseName').value='';$('releaseSymbol').value='';status('发行成功！代币已加入列表，创建流动池时可直接选择。')})};

function tickPercent(logRatio){const value=Math.expm1(logRatio)*100;if(!Number.isFinite(value))return '超出显示范围';if(Math.abs(value)<0.0000005)return '0.00%';const magnitude=Math.abs(value);const text=magnitude>=1000000?magnitude.toExponential(3):magnitude.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:4});return (value<0?'−':'+')+text+'%'}
function tickHumanLogPrice(tick,a,b){const sorted=BigInt(a.address)<BigInt(b.address);const d0=sorted?a.decimals:b.decimals,d1=sorted?b.decimals:a.decimals;const logPrice=tick*Math.log1p(0.0001)+(d0-d1)*Math.LN10;return sorted?logPrice:-logPrice}
function previewPrice(logPrice){const p=Math.exp(logPrice);if(!Number.isFinite(p)||p===0)return '超出显示范围';return p>=1000000||p<0.0001?p.toExponential(4):p.toLocaleString('zh-CN',{maximumSignificantDigits:8})}
function tickPriceContext(){
  const find=id=>metadata.get($(id).value.toLowerCase())||catalog.get($(id).value.toLowerCase());
  const a=find('createA'),b=find('createB');
  const pair=Boolean(a&&b&&a.address.toLowerCase()!==b.address.toLowerCase());
  const initial=Number($('initialPrice').value);
  return {a,b,pair,initial,relative:pair&&Number.isFinite(initial)&&initial>0};
}
function tickFromHumanLogPrice(logPrice,a,b){
  if(a&&b){
    const sorted=BigInt(a.address)<BigInt(b.address);
    const decimalsDifference=sorted?a.decimals-b.decimals:b.decimals-a.decimals;
    logPrice=(sorted?logPrice:-logPrice)-decimalsDifference*Math.LN10;
  }
  return Math.round(logPrice/Math.log1p(0.0001));
}
function tickFromPrice(price,a,b){return tickFromHumanLogPrice(Math.log(price),a,b);}
function tickFromPercent(percent,a,b,initial){
  const logPrice=Math.log1p(percent/100)+(a&&b?Math.log(initial):0);
  return tickFromHumanLogPrice(logPrice,a,b);
}
function setTickChange(id,logRatio){
  const input=$(id),percent=Math.expm1(logRatio)*100;
  input.setCustomValidity('');
  input.placeholder=percent<=-100?'接近 -100%':'输入百分比';
  input.value=!Number.isFinite(percent)||percent<=-100?'':Math.abs(percent)<0.0001&&percent!==0||percent>=1000000?percent.toExponential(6):percent < -99.9999?String(percent):String(Number(percent.toFixed(4)));
}
function updateTickPreview(skipInputId){
  const {a,b,pair,initial,relative}=tickPriceContext();
  for(const [field,out,price,change] of [['tickLower','tickLowerPercent','tickLowerPrice','tickLowerChange'],['tickUpper','tickUpperPercent','tickUpperPrice','tickUpperChange']]){
    const priceInput=field+'PriceInput';
    $(field+'PriceUnit').textContent=pair?`（${b.symbol} / ${a.symbol}）`:'（B / A）';
    const text=$(field).value.trim(),tick=Number(text);
    if(!text||!Number.isInteger(tick)||tick < -887272||tick>887272){
      $(out).textContent='请输入有效整数 Tick';$(price).textContent='';
      if(skipInputId!==change){$(change).value='';$(change).setCustomValidity('');}
      if(skipInputId!==priceInput){$(priceInput).value='';$(priceInput).setCustomValidity('');}
      continue;
    }
    const logPrice=pair?tickHumanLogPrice(tick,a,b):tick*Math.log1p(0.0001);
    const logRatio=relative?logPrice-Math.log(initial):logPrice;
    $(out).textContent=relative?'实际相对初始价 ≈ '+tickPercent(logRatio):pair?'请输入有效初始价格':'实际相对 Tick 0 ≈ '+tickPercent(logRatio);
    $(price).textContent=pair?`价格 ≈ ${previewPrice(logPrice)} ${b.symbol} / ${a.symbol}`:'选择代币后显示实际价格及相对初始价的涨跌幅。';
    if(skipInputId!==priceInput){
      const p=pair?Math.exp(logPrice):NaN;
      $(priceInput).setCustomValidity('');
      $(priceInput).value=Number.isFinite(p)&&p>0?String(Number(p.toPrecision(12))):'';
      $(priceInput).placeholder=pair?'输入大于 0 的价格':'先选择代币 A / B';
    }
    if(skipInputId!==change){
      if(pair&&!relative){$(change).value='';$(change).setCustomValidity('');}
      else setTickChange(change,logRatio);
    }
  }
  const lo=Number($('tickLower').value),hi=Number($('tickUpper').value);
  const valid=$('tickLower').value.trim()&&$('tickUpper').value.trim()&&Number.isInteger(lo)&&Number.isInteger(hi)&&lo>=-887272&&hi<=887272&&lo<hi;
  $('tickRangeSummary').textContent=valid?`区间价格跨度 ≈ ${tickPercent((hi-lo)*Math.log1p(0.0001))} · 每增加 1 Tick，token1 / token0 原始价格约增加 0.01%。${pair?' 上方价格按 B / A 展示；代币顺序反转时，价格方向也会反转。':''}`:'请设置有效区间，tickLower 必须小于 tickUpper。';
  renderInitialTickInfo();
}
function applyTickChange(bound){
  const input=$('tick'+bound+'Change'),field=$('tick'+bound),out=$('tick'+bound+'Percent');
  const percent=Number(input.value),{a,b,pair,initial,relative}=tickPriceContext();
  let error='';
  if(!input.value.trim()||!Number.isFinite(percent)||percent<=-100)error='请输入大于 -100% 的有效涨跌幅。';
  else if(pair&&!relative)error='请先输入大于 0 的初始价格。';
  if(error){input.setCustomValidity(error);out.textContent=error;return;}
  const tick=tickFromPercent(percent,pair?a:null,pair?b:null,initial);
  const min=bound==='Lower'?-887272:-887271,max=bound==='Lower'?887271:887272;
  if(!Number.isFinite(tick)||tick<min||tick>max){error='该百分比对应的 Tick 超出允许范围。';input.setCustomValidity(error);out.textContent=error;return;}
  input.setCustomValidity('');field.value=String(tick);updateTickPreview(input.id||'tick'+bound+'Change');
}
function applyTickPrice(bound){
  const id='tick'+bound+'PriceInput',input=$(id),field=$('tick'+bound),out=$('tick'+bound+'Percent');
  const price=Number(input.value),{a,b,pair}=tickPriceContext();
  let error='';
  if(!pair)error='请先选择两个不同的代币，价格按 B / A 换算。';
  else if(!input.value.trim()||!Number.isFinite(price)||price<=0)error='请输入大于 0 的有效价格。';
  if(error){input.setCustomValidity(error);out.textContent=error;return;}
  const tick=tickFromPrice(price,a,b);
  const min=bound==='Lower'?-887272:-887271,max=bound==='Lower'?887271:887272;
  if(!Number.isFinite(tick)||tick<min||tick>max){error='该价格对应的 Tick 超出允许范围。';input.setCustomValidity(error);out.textContent=error;return;}
  input.setCustomValidity('');field.value=String(tick);updateTickPreview(id);
}
for(const bound of ['Lower','Upper']){
  const input=$('tick'+bound+'Change');
  input.addEventListener('input',()=>applyTickChange(bound));
  input.addEventListener('blur',()=>{if(!input.validationMessage)updateTickPreview();});
  const priceInput=$('tick'+bound+'PriceInput');
  priceInput.addEventListener('input',()=>applyTickPrice(bound));
  priceInput.addEventListener('blur',()=>{if(!priceInput.validationMessage)updateTickPreview();});
}
for(const id of ['tickLower','tickUpper','initialPrice'])$(id).addEventListener('input',updateTickPreview);
updateTickPreview();


function poolRangeValues(p){
  const decimalsLog=(p.m0.decimals-p.m1.decimals)*Math.LN10;
  const lowerLog=Number(p.tickLower)*Math.log1p(0.0001)+decimalsLog;
  const upperLog=Number(p.tickUpper)*Math.log1p(0.0001)+decimalsLog;
  // sqrtPriceX96 is read from the pool, so percentages track the actual current price.
  const currentLog=p.sqrtPriceX96>0n?2*(Math.log(Number(p.sqrtPriceX96))-96*Math.LN2)+decimalsLog:null;
  return {lowerLog,upperLog,currentLog};
}
function renderPoolPriceRange(p){
  const {lowerLog,upperLog,currentLog}=poolRangeValues(p);
  const box=node('div',undefined,'pool-price-range');
  box.append(node('div',`价格区间 · ${p.m1.symbol} / ${p.m0.symbol}`,'pool-range-title'));
  const bounds=node('div',undefined,'pool-range-bounds');
  for(const [label,logPrice] of [['下限',lowerLog],['上限',upperLog]]){
    const item=node('div');
    item.append(node('span',label,'pool-bound-label'),node('strong',previewPrice(logPrice)),node('span',currentLog===null?'尚未初始化价格':`相对当前价 ≈ ${tickPercent(logPrice-currentLog)}`,'pool-bound-change'));
    bounds.append(item);
  }
  box.append(bounds,node('p',`当前价格：${currentLog===null?'尚未初始化':previewPrice(currentLog)} · 1 ${p.m0.symbol} 对应的 ${p.m1.symbol} 数量`),node('p',`区间价格跨度 ≈ ${tickPercent(upperLog-lowerLog)}（相对下限）`));
  return box;
}


async function readPoolBalances(p){
  const results=await Promise.allSettled([new ethers.Contract(p.token0,ERC20,provider).balanceOf(p.pool),new ethers.Contract(p.token1,ERC20,provider).balanceOf(p.pool)]);
  return {...p,balance0:results[0].status==='fulfilled'?results[0].value:null,balance1:results[1].status==='fulfilled'?results[1].value:null};
}
function poolBalanceText(amount,decimals){
  if(typeof amount!=='bigint')return '读取失败，点击 ↻ 重试';
  const full=ethers.formatUnits(amount,decimals),[integer,fraction='']=full.split('.');
  const significant=fraction.replace(/0+$/,'');
  if(amount>0n&&integer==='0'&&significant.length>8&&!/[1-9]/.test(significant.slice(0,8)))return '<0.00000001';
  const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,','),tail=significant.slice(0,8).replace(/0+$/,'');
  return (significant.length>8?'≈ ':'')+grouped+(tail?'.'+tail:'');
}
function renderPoolBalances(p){
  const box=node('div',undefined,'pool-balances');
  box.append(node('div','池内代币余额','pool-range-title'));
  const row=node('div',undefined,'pool-range-bounds');
  for(const [m,amount] of [[p.m0,p.balance0],[p.m1,p.balance1]]){
    const cell=node('div'),value=node('strong',poolBalanceText(amount,m.decimals));
    if(typeof amount==='bigint')value.title=ethers.formatUnits(amount,m.decimals)+' '+m.symbol;
    cell.append(node('span',m.symbol,'pool-bound-label'),value);row.append(cell);
  }
  box.append(row,node('p',`流动性 L（合约原始值）：${p.liquidity.toString()}`),node('p','以上为池子合约的实际持币量，可能包含待领取本金或手续费；不是单个钱包的仓位余额。点击 ↻ 刷新。'));
  return box;
}

let lpLoadVersion=0;
function currentLp(){return $('lpPool').value===''?null:pools[Number($('lpPool').value)]||null;}
function lpQuantity(amount,m){return poolBalanceText(amount,m.decimals)+' '+m.symbol;}
function renderLpContext(p){
  const box=$('lpPoolContext');box.replaceChildren();
  const prices=poolRangeValues(p),unit=p.m1.symbol+' / '+p.m0.symbol;
  box.append(node('b',`${p.m0.symbol} / ${p.m1.symbol} · 最大投入量说明`),node('p',`当前价：${prices.currentLog===null?'未初始化':previewPrice(prices.currentLog)} ${unit}`),node('p',`区间：${previewPrice(prices.lowerLog)} ～ ${previewPrice(prices.upperLog)} ${unit}`));
  try{
    const matched=LiquidityPreviewMath.match(p,10n**BigInt(p.m1.decimals),1);
    box.append(node('p',`当前区间配比：投入 1 ${p.m1.symbol}，约需 ${lpQuantity(matched.amount0,p.m0)}。这不是两种代币的即时兑换价格。`));
  }catch(e){box.append(node('p',e.message));}
  if(typeof p.wallet0==='bigint'&&typeof p.wallet1==='bigint'){
    try{const capacity=LiquidityPreviewMath.quote(p,p.wallet0,p.wallet1);box.append(node('p',`按钱包余额与当前配比，最多可配对投入约 ${lpQuantity(capacity.amount0,p.m0)} + ${lpQuantity(capacity.amount1,p.m1)}。`));}
    catch(e){box.append(node('p','钱包余额配对上限暂不可计算：'+e.message));}
  }
}
async function loadLiquidityForm(){
  const version=++lpLoadVersion,p=currentLp();
  for(const id of ['lpAmount0','lpAmount1'])$(id).setCustomValidity('');
  if(!p){$('lpPoolContext').textContent='请先选择流动性池。';$('lpPreview').textContent='选择池子并填写最大投入量后显示预计结果。';for(const id of ['lpRange0','lpRange1'])$(id).textContent='钱包范围：选择池子后读取';return;}
  $('lpLabel0').firstChild.textContent=p.m0.symbol+' 最大投入量';$('lpLabel1').firstChild.textContent=p.m1.symbol+' 最大投入量';
  $('lpMatch0').textContent='按 '+p.m0.symbol+' 数量计算 '+p.m1.symbol+' ↗';$('lpMatch1').textContent='按 '+p.m1.symbol+' 数量计算 '+p.m0.symbol+' ↙';
  renderLpContext(p);renderLiquidityPreview();
  if(!account||!provider)return;
  for(const id of ['lpRange0','lpRange1'])$(id).textContent='正在读取钱包余额…';
  const values=await Promise.allSettled([new ethers.Contract(p.token0,ERC20,provider).balanceOf(account),new ethers.Contract(p.token1,ERC20,provider).balanceOf(account)]);
  if(version!==lpLoadVersion||currentLp()!==p)return;
  for(let i=0;i<2;i++){
    const m=i===0?p.m0:p.m1,value=values[i];p['wallet'+i]=value.status==='fulfilled'?value.value:null;
    $('lpRange'+i).textContent=value.status==='fulfilled'?`钱包可输入范围：0 ～ ${lpQuantity(value.value,m)}`:'钱包余额读取失败，可点击 ↻ 重试。';
    if(value.status==='fulfilled')$('lpRange'+i).title='钱包精确余额：'+ethers.formatUnits(value.value,m.decimals)+' '+m.symbol;
  }
  renderLpContext(p);renderLiquidityPreview();
}
function parseLpInput(p,side){
  const m=side===0?p.m0:p.m1,input=$('lpAmount'+side);input.setCustomValidity('');
  let amount;
  try{amount=ethers.parseUnits(input.value.trim()||'0',m.decimals)}catch{const message=m.symbol+' 数量格式或小数位数不正确。';input.setCustomValidity(message);throw Error(message);}
  if(amount<0n){const message=m.symbol+' 数量不能为负数。';input.setCustomValidity(message);throw Error(message);}
  if(typeof p['wallet'+side]==='bigint'&&amount>p['wallet'+side]){const message=m.symbol+' 超过钱包余额，请减小输入。';input.setCustomValidity(message);throw Error(message);}
  return amount;
}
function renderLiquidityPreview(){
  const p=currentLp(),box=$('lpPreview');if(!p)return;
  box.replaceChildren();
  try{
    const a=parseLpInput(p,0),b=parseLpInput(p,1);
    if(a===0n&&b===0n){box.textContent='填写至少一边数量后，可点击配比按钮计算另一边；填写两边后查看实际投入与未使用数量。';return;}
    const q=LiquidityPreviewMath.quote(p,a,b);
    box.append(node('b','预计实际投入与未使用数量'));
    const table=node('table',undefined,'lp-amount-table'),head=node('tr');
    for(const text of ['代币','最大投入','实际投入','未使用'])head.append(node('th',text));
    const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
    for(const [m,desired,used,left] of [[p.m0,a,q.amount0,q.remaining0],[p.m1,b,q.amount1,q.remaining1]]){
      const row=node('tr');row.append(node('td',m.symbol));
      for(const n of [desired,used,left]){const cell=node('td',poolBalanceText(n,m.decimals));cell.title=ethers.formatUnits(n,m.decimals)+' '+m.symbol;row.append(cell)}
      body.append(row);
    }
    table.append(body);box.append(table);
    if(q.liquidity===0n)box.append(node('p','当前组合无法产生有效流动性。请点击配比按钮计算另一边，或增加过小的数量。','lp-warning'));
    else if(q.remaining0*100n>a||q.remaining1*100n>b)box.append(node('p','两边数量与池子区间配比不一致：实际只投入可配对的部分，其余留在钱包，不会先转入再退款。','lp-warning'));
    box.append(node('p','以上为当前池子状态的估算；兑换费率不会直接按比例扣掉添加流动性的本金。'));
  }catch(e){box.append(node('p',e.message,'lp-warning'));}
}
function fillLpMatch(side){
  const p=currentLp();if(!p)return;
  try{const amount=parseLpInput(p,side),q=LiquidityPreviewMath.match(p,amount,side);$('lpAmount'+(1-side)).value=ethers.formatUnits(side===0?q.amount1:q.amount0,side===0?p.m1.decimals:p.m0.decimals);renderLiquidityPreview();}
  catch(e){$('lpPreview').replaceChildren(node('p',e.message,'lp-warning'));}
}
for(const id of ['lpAmount0','lpAmount1'])$(id).addEventListener('input',renderLiquidityPreview);
$('lpMatch0').onclick=()=>fillLpMatch(0);$('lpMatch1').onclick=()=>fillLpMatch(1);

const POSITION_MANAGER_START_BLOCK=ACTIVE_DEPLOYMENT.positionManagerStartBlock;
const positionDeposits=new Map(),positionMintTransactions=new Map();
let positionHistoryCursor=POSITION_MANAGER_START_BLOCK;
function extractPositionDeposit(position,pool,receipt,transaction){
  if(!pool||!receipt||receipt.status!==1)return null;
  const nft=new ethers.Interface(abis.PositionManager),poolEvents=new ethers.Interface(['event Mint(address sender,address indexed owner,uint128 amount,uint256 amount0,uint256 amount1)']);
  const logs=receipt.logs||[];let mintIndex=-1,recipient;
  for(let i=0;i<logs.length;i++){
    if(logs[i].address.toLowerCase()!==ADDR.PositionManager.toLowerCase())continue;
    try{const event=nft.parseLog(logs[i]);if(event?.name==='Transfer'&&event.args.from===ethers.ZeroAddress&&event.args.tokenId===position.id){mintIndex=i;recipient=event.args.to;break}}catch{}
  }
  for(let i=mintIndex-1;i>=0;i--){
    const log=logs[i];if(log.address.toLowerCase()!==pool.pool.toLowerCase())continue;
    try{
      const event=poolEvents.parseLog(log);
      if(event?.name!=='Mint'||event.args.owner.toLowerCase()!==ADDR.PositionManager.toLowerCase()||event.args.sender.toLowerCase()!==ADDR.PositionManager.toLowerCase())continue;
      if(position.liquidity>0n&&event.args.amount!==position.liquidity)continue;
      const deposit={amount0:event.args.amount0,amount1:event.args.amount1,liquidity:event.args.amount,hash:receipt.hash||receipt.transactionHash,recipient};
      // Requested maximums are recoverable only for a direct call to PositionManager.mint.
      try{if(transaction?.to?.toLowerCase()===ADDR.PositionManager.toLowerCase()){
        const call=nft.parseTransaction({data:transaction.data,value:transaction.value||0});
        if(call?.name==='mint'){
          const params=call.args[0];
          if(params.token0.toLowerCase()===position.token0.toLowerCase()&&params.token1.toLowerCase()===position.token1.toLowerCase()&&params.index===position.index&&params.recipient.toLowerCase()===recipient.toLowerCase()&&params.amount0Desired>=deposit.amount0&&params.amount1Desired>=deposit.amount1){
            deposit.max0=params.amount0Desired;deposit.max1=params.amount1Desired;deposit.payer=transaction.from;
          }
        }
      }}catch{/* Keep actual inputs even when requested maximums cannot be decoded. */}
      return deposit;
    }catch{/* Ignore unrelated receipt logs. */}
  }
  return null;
}
async function loadPositionDeposits(visible){
  const missing=visible.filter(v=>!positionDeposits.has(v.p.id.toString())&&v.pool);if(!missing.length)return;
  const latest=await provider.getBlockNumber();
  const transferTopic=ethers.id('Transfer(address,address,uint256)'),zeroTopic=ethers.zeroPadValue(ethers.ZeroAddress,32);
  let span=2000;
  while(positionHistoryCursor<=latest){
    const end=Math.min(latest,positionHistoryCursor+span-1);
    let logs;
    try{logs=await provider.getLogs({address:ADDR.PositionManager,topics:[transferTopic,zeroTopic],fromBlock:positionHistoryCursor,toBlock:end})}
    catch(e){if(span>125&&/range|too large|limit|maximum/i.test(formatWalletError(e))){span=Math.max(125,Math.floor(span/2));continue}throw e;}
    for(const log of logs){try{const event=contracts.PositionManager.interface.parseLog(log);if(event?.name==='Transfer'&&event.args.from===ethers.ZeroAddress)positionMintTransactions.set(event.args.tokenId.toString(),log.transactionHash)}catch{}}
    positionHistoryCursor=end+1;
  }
  const receipts=new Map();
  for(const v of missing){
    const hash=positionMintTransactions.get(v.p.id.toString());if(!hash)continue;
    try{
      if(!receipts.has(hash))receipts.set(hash,await provider.getTransactionReceipt(hash));
      const receipt=receipts.get(hash);let transaction=null;
      try{transaction=await provider.getTransaction(hash)}catch{}
      const deposit=extractPositionDeposit(v.p,v.pool,receipt,transaction);
      if(deposit)positionDeposits.set(v.p.id.toString(),deposit);
    }catch{/* Preserve other position cards when this receipt cannot be read. */}
  }
}
function renderPositionAmounts(box,p,a,b,pool,deposit,finished,fees=null){
  box.replaceChildren();box.className='position-amounts';
  box.append(node('div','本仓位的代币数量','pool-range-title'));
  const table=node('table',undefined,'position-amount-table'),head=node('tr');
  for(const text of ['项目',a.symbol,b.symbol])head.append(node('th',text));
  const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  function row(label,x,y,cls){const r=node('tr',undefined,cls);r.append(node('td',label));for(const [n,m] of [[x,a],[y,b]]){const cell=node('td',typeof n==='bigint'?poolBalanceText(n,m.decimals):'—');if(typeof n==='bigint')cell.title=ethers.formatUnits(n,m.decimals)+' '+m.symbol;r.append(cell)}body.append(r);}
  row('最初实际投入',deposit?.amount0,deposit?.amount1,'initial-deposit');
  if(deposit?.max0!==undefined){row('当时填写的上限',deposit.max0,deposit.max1);row('当时未使用（留在钱包）',deposit.max0-deposit.amount0,deposit.max1-deposit.amount1);}
  let principal=null;
  if(p.liquidity===0n)principal={amount0:0n,amount1:0n};
  else if(pool){try{principal=LiquidityPreviewMath.principal(pool,p.liquidity)}catch{}}
  row('当前本金估算（不含费用）',principal?.amount0,principal?.amount1);
  if(p.liquidity===0n)fees={amount0:0n,amount1:0n};
  row('未结算手续费估算',fees?.amount0,fees?.amount1,'unsettled-fees');
  row('已结算待领取（本金＋费用）',p.tokensOwed0,p.tokensOwed1);
  row('预计移除后可领取合计',principal&&fees?principal.amount0+fees.amount0+p.tokensOwed0:null,principal&&fees?principal.amount1+fees.amount1+p.tokensOwed1:null,'claim-total');
  table.append(body);box.append(table,node('p',`本仓位流动性 L：${p.liquidity}（不是代币数量）`));
  if(deposit?.hash)box.append(link('/tx/'+deposit.hash,'查看建仓交易与实际投入 ↗'));
  else box.append(node('p',finished?'历史投入暂未读取到，可点击 ↻ 重试；“—”不表示投入为 0。':'正在从链上建仓记录读取实际投入…','position-history-note'));
  box.append(node('p','实际投入属于这个 NFT 的历史记录；NFT 转手后，不代表当前持有人当时出资。当前本金会随池价变化，未结算费用单独列出。'));
  box.append(node('p',p.liquidity>0n?'持有中：未结算手续费不等于已结算待领取。移除时才会结算本金与费用，随后还需点击领取；合计为当前状态的估算。':'已移除：本金和费用已计入待领取，点击领取后转回钱包。'));
  if(p.liquidity>0n&&!fees)box.append(node('p','未结算手续费暂未读取到，“—”不表示没有收益，可点击刷新重试。'));
}

function cachePositionMintReceipt(pool,params,receipt){
  if(!pool?.pool||!receipt?.logs)return;
  const nft=new ethers.Interface(abis.PositionManager);
  for(const log of receipt.logs){
    if(log.address.toLowerCase()!==ADDR.PositionManager.toLowerCase())continue;
    try{
      const event=nft.parseLog(log);if(event?.name!=='Transfer'||event.args.from!==ethers.ZeroAddress)continue;
      const position={id:event.args.tokenId,token0:params.token0,token1:params.token1,index:params.index,liquidity:0n};
      const transaction={to:ADDR.PositionManager,data:nft.encodeFunctionData('mint',[params]),from:account};
      const deposit=extractPositionDeposit(position,pool,receipt,transaction);
      if(deposit){positionDeposits.set(position.id.toString(),deposit);positionMintTransactions.set(position.id.toString(),deposit.hash);}
    }catch{/* The next refresh can recover the record from the public mint event. */}
  }
}


$('dexVersion').value=DEPLOYMENT_KEY;
$('dexVersionNotice').textContent=DEPLOYMENT_KEY==='legacy'?'当前为旧版合约。原有池子、资金和仓位保留在这里，可在「我的仓位」移除并领取。':'当前为新版合约，从空池子列表重新开始；已发行代币继续可选。原有资金仍在旧版，可切换版本查看和领取。';
$('dexVersion').onchange=()=>{
  if(busy)return;
  const url=new URL(location.href);
  if($('dexVersion').value==='legacy')url.searchParams.set('deployment','legacy');else url.searchParams.delete('deployment');
  location.assign(url.href);
};


function marketPairKey(a,b){return a&&b?[a.address.toLowerCase(),b.address.toLowerCase()].sort().join(':'):'';}
function priceSqrtFromRatio(a,b,amountA,amountB){
  if(amountA<=0n||amountB<=0n)throw Error('比例两边必须大于 0。');
  const sorted=BigInt(a.address)<BigInt(b.address),m0=sorted?a:b,m1=sorted?b:a;
  const numerator=(sorted?amountB:amountA)*10n**BigInt(m1.decimals),denominator=(sorted?amountA:amountB)*10n**BigInt(m0.decimals);
  const sqrt=isqrt((numerator<<192n)/denominator);
  if(sqrt<=4295128739n||sqrt>=1461446703485210103287273052203988822378723970342n)throw Error('比例对应价格超出合约支持范围。');
  return sqrt;
}
function marketHumanLog(reference,a,b){
  const sorted=BigInt(a.address)<BigInt(b.address),d0=sorted?a.decimals:b.decimals,d1=sorted?b.decimals:a.decimals;
  const log=2*(Math.log(Number(reference.sqrtPriceX96))-96*Math.LN2)+(d0-d1)*Math.LN10;
  return sorted?log:-log;
}
async function fetchMarketPrice(a,b){
  if(!contracts?.MarketPriceRegistry||!a||!b||a.address.toLowerCase()===b.address.toLowerCase())return null;
  const price=await contracts.MarketPriceRegistry.getPrice(a.address,b.address);
  return price.version>0n&&price.sqrtPriceX96>0n?{sqrtPriceX96:price.sqrtPriceX96,version:price.version,updatedAt:price.updatedAt,key:marketPairKey(a,b)}:null;
}
async function refreshMarketOwner(){
  $('marketAdmin').hidden=true;marketOwnerAddress=null;
  if(!contracts?.MarketPriceRegistry){$('marketOwnerInfo').textContent='此合约版本未接入模拟市场价。';return;}
  try{marketOwnerAddress=await contracts.MarketPriceRegistry.owner();$('marketOwnerInfo').textContent='参考价 owner：'+marketOwnerAddress;$('marketAdmin').hidden=marketOwnerAddress.toLowerCase()!==account?.toLowerCase();}
  catch{$('marketOwnerInfo').textContent='Owner 信息读取失败，可点击刷新参考价重试。';}
}
function applyCreateReference(){
  const {a,b,pair}=tickPriceContext();
  const use=pair&&createMarketReference?.key===marketPairKey(a,b)&&$('useMarketPrice').checked;
  $('initialPrice').readOnly=Boolean(use);
  if(use){
    const n=Math.exp(marketHumanLog(createMarketReference,a,b));
    $('initialPrice').value=n.toLocaleString('en-US',{useGrouping:false,maximumSignificantDigits:12});
    updateTickPreview();
  }
}
async function refreshCreateMarketPrice(preferReference=false){
  const request=++createMarketRequest,{a,b,pair}=tickPriceContext(),key=pair?marketPairKey(a,b):'';
  $('marketPairLabel').textContent=pair?`当前设置：${a.symbol} 数量 : ${b.symbol} 数量（例如 1 : 200）`:'先选择上方代币 A / B，再设置 A:B 比例。';
  if(key!==createMarketKey){createMarketKey=key;createMarketReference=null;$('initialPrice').readOnly=false;}
  if(!pair){$('createMarketReference').textContent='选择两种代币后读取链上参考比例。';return;}
  if(!account||!contracts?.MarketPriceRegistry){$('createMarketReference').textContent=account?'此版本未接入参考价，请切换新版或手动输入价格。':'连接钱包后读取 owner 设置的参考价。';$('useMarketPrice').checked=false;$('initialPrice').readOnly=false;return;}
  $('createMarketReference').textContent='正在读取链上模拟市场价…';
  try{
    const wasConfigured=Boolean(createMarketReference);const price=await fetchMarketPrice(a,b);
    if(request!==createMarketRequest)return;
    createMarketReference=price;
    if(!price){$('createMarketReference').textContent='Owner 尚未配置这个代币对，可在下方设置，或先手动填写初始化价格。';$('useMarketPrice').checked=false;$('initialPrice').readOnly=false;return;}
    if(preferReference||!wasConfigured)$('useMarketPrice').checked=true;
    $('createMarketReference').textContent=`模拟市场参考价：1 ${a.symbol} ≈ ${previewPrice(marketHumanLog(price,a,b))} ${b.symbol} · 版本 ${price.version}。勾选后由合约直接读取此价格初始化新池子；不重置已有池子。`;
    applyCreateReference();
  }catch(e){if(request!==createMarketRequest)return;createMarketReference=null;$('initialPrice').readOnly=false;$('createMarketReference').textContent='参考价读取失败：'+formatWalletError(e);}
}
function renderSwapMarketReference(){
  const box=$('swapMarketReference'),[a,b]=chosenTokens;box.replaceChildren();
  if(!a||!b){box.textContent='选择代币后显示模拟市场参考价。';return;}
  const reference=swapMarketReference;
  if(!reference||reference.key!==marketPairKey(a,b)){box.textContent=account?'此代币对暂无 owner 模拟参考价，池子报价仍可独立获取。':'连接钱包后读取模拟市场参考价。';return;}
  const log=marketHumanLog(reference,a,b);
  box.append(node('b',`模拟市场参考价：1 ${a.symbol} ≈ ${previewPrice(log)} ${b.symbol}`));
  const amount=Number($('amountIn').value);
  if(Number.isFinite(amount)&&amount>0)box.append(node('p',`按参考价：${$('amountIn').value} ${a.symbol} ≈ ${previewPrice(Math.log(amount)+log)} ${b.symbol}`));
  box.append(node('p',`Owner 设置 · 版本 ${reference.version} · 仅用于模拟行情，不含手续费、滑点，不保证按此成交。实际兑换使用池子报价。`));
}
async function refreshSwapMarketPrice(){
  const request=++swapMarketRequest,[a,b]=chosenTokens;
  try{const price=await fetchMarketPrice(a,b);if(request!==swapMarketRequest)return;swapMarketReference=price;renderSwapMarketReference();}
  catch(e){if(request!==swapMarketRequest)return;swapMarketReference=null;$('swapMarketReference').textContent='模拟市场价读取失败：'+formatWalletError(e);}
}
$('useMarketPrice').onchange=applyCreateReference;
$('reloadMarketPrice').onclick=()=>run(async()=>{await requireWallet();await refreshMarketOwner();await refreshCreateMarketPrice();await refreshSwapMarketPrice();});
$('saveMarketPrice').onclick=()=>run(async()=>{
  await requireWallet();if(!contracts?.MarketPriceRegistry)throw Error('当前版本没有模拟市场价配置。');
  const owner=await contracts.MarketPriceRegistry.owner();if(owner.toLowerCase()!==account.toLowerCase())throw Error('只有参考价合约 owner 可以设置价格。');
  const {a,b,pair}=tickPriceContext();if(!pair)throw Error('请先选择两个不同的代币。');
  const [actualA,actualB]=await Promise.all([token(a.address),token(b.address)]);
  const amountA=ethers.parseUnits($('marketAmountA').value.trim(),18),amountB=ethers.parseUnits($('marketAmountB').value.trim(),18);
  const sqrt=priceSqrtFromRatio(actualA,actualB,amountA,amountB),sorted=BigInt(a.address)<BigInt(b.address);
  await send('更新模拟市场价',()=>contracts.MarketPriceRegistry.setPrice(sorted?a.address:b.address,sorted?b.address:a.address,sqrt));
  await refreshCreateMarketPrice(true);await refreshSwapMarketPrice();status('模拟市场参考价已更新；新池子可直接采用，已有池子的价格与资金不变。');
});
$('amountIn').addEventListener('input',renderSwapMarketReference);


function currentInitializationSqrt(){
  const {a,b,pair}=tickPriceContext();if(!pair)throw Error('先选择代币 A / B。');
  if($('useMarketPrice').checked){
    if(!createMarketReference||createMarketReference.key!==marketPairKey(a,b))throw Error('等待参考价读取；可点击「刷新参考价」。');
    return {a,b,sqrt:createMarketReference.sqrtPriceX96,source:'owner 参考价'};
  }
  const value=$('initialPrice').value.trim();if(!/^\d+(\.\d{1,36})?$/.test(value))throw Error('请填写有效初始价格。');
  return {a,b,sqrt:priceSqrtFromRatio(a,b,10n**36n,ethers.parseUnits(value,36)),source:'手动初始化价'};
}
function renderInitialTickInfo(){
  const box=$('initialTickInfo');
  try{
    const {a,b,sqrt,source}=currentInitializationSqrt(),tick=LiquidityPreviewMath.tickAtSqrt(sqrt);
    const lo=Number($('tickLower').value),hi=Number($('tickUpper').value);
    const inside=$('tickLower').value.trim()&&$('tickUpper').value.trim()&&Number.isInteger(lo)&&Number.isInteger(hi)&&lo<=tick&&tick<hi;
    box.textContent=`实际初始化：1 ${a.symbol} ≈ ${previewPrice(marketHumanLog({sqrtPriceX96:sqrt},a,b))} ${b.symbol} · Tick ${tick}（${source}）。${inside?'已在当前区间内。':`需满足 tickLower ≤ ${tick} < tickUpper。`}`;
    box.classList.toggle('outside',!inside);
  }catch(e){box.textContent=e.message;box.classList.toggle('outside',false);}
}
$('fitInitialRange').onclick=()=>{
  try{
    const {a,b,sqrt}=currentInitializationSqrt(),log=marketHumanLog({sqrtPriceX96:sqrt},a,b);
    const x=tickFromHumanLogPrice(log+Math.log(0.8),a,b),y=tickFromHumanLogPrice(log+Math.log(1.2),a,b);
    $('tickLower').value=String(Math.max(-887272,Math.min(x,y)));
    $('tickUpper').value=String(Math.min(887272,Math.max(x,y)));
    updateTickPreview();
  }catch(e){status(e.message,true);}
};

function estimatePositionFees(p,global0,global1){
  const delta0=global0-p.feeGrowthInside0LastX128,delta1=global1-p.feeGrowthInside1LastX128;
  if(delta0<0n||delta1<0n)throw Error('手续费快照不一致，请刷新。');
  return {amount0:delta0*p.liquidity/(1n<<128n),amount1:delta1*p.liquidity/(1n<<128n)};
}
