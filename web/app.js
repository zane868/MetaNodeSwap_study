'use strict';
const $ = id => document.getElementById(id);
const ADDR = Object.freeze({TokenLauncher:'0xf319Bbd5F66e9e841Ca01B988548443AB5b46448',PoolManager:'0x218D5C07333E0819BfBa2455FD5Ff508Bcd08B86',PositionManager:'0x8201A0bB36E7c705431e4B859A12462a40ac6b8F',SwapRouter:'0x547959a9a8a68b20bCEFF2E3A83451e02F0357D8'});
const EXPLORER='https://sepolia.etherscan.io';
const ERC20=['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'];
let provider,signer,account,pools=[],reversed=false,busy=false,abis,contracts;
const metadata=new Map();
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
function fail(e){console.error(e);const message=e.code===4001||e.code==='ACTION_REJECTED'?'已取消钱包操作。':(e.reason||e.shortMessage||e.message||'操作失败').slice(0,320);status(message,true);if($('tokenDialog')?.open)$('tokenDialogStatus').textContent=message}
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
async function connect(){await tokenReady;await ensureChain();await window.ethereum.request({method:'eth_requestAccounts'});provider=new ethers.BrowserProvider(window.ethereum);signer=await provider.getSigner();account=await signer.getAddress();contracts=Object.fromEntries(Object.entries(ADDR).map(([k,a])=>[k,new ethers.Contract(a,abis[k],signer)]));$('connect').textContent=short(account)+' ↗';$('swapAction').textContent='授权并兑换';await refresh();}
async function requireWallet(){if(!account)throw Error('请先连接钱包。');const chain=await window.ethereum.request({method:'eth_chainId'});const accounts=await window.ethereum.request({method:'eth_accounts'});if(chain!=='0xaa36a7'||accounts[0]?.toLowerCase()!==account.toLowerCase())throw Error('钱包账户或网络已更改，请重新连接。');}
if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>location.reload());window.ethereum.on?.('chainChanged',()=>{if(account)location.reload()});}
$('connect').onclick=()=>run(connect);
async function token(address){const key=address.toLowerCase();if(metadata.has(key))return metadata.get(key);const t=new ethers.Contract(address,ERC20,provider);const [symbol,decimals]=await Promise.all([t.symbol().catch(()=>short(address)),t.decimals()]);const m={address,symbol:String(symbol).slice(0,28),decimals:Number(decimals)};metadata.set(key,m);return m;}
function selected(id='swapPool'){const p=pools[Number($(id).value)];if($(id).value===''||!p)throw Error('请先选择交易池；没有池子时请先创建并添加流动性。');return p}
async function refresh(){await requireWallet();status('正在读取 Sepolia 链上数据…');const chainPools=await contracts.PoolManager.getAllPools();pools=await Promise.all(chainPools.map(async p=>({pool:p.pool,token0:p.token0,token1:p.token1,index:p.index,fee:p.fee,tickLower:p.tickLower,tickUpper:p.tickUpper,sqrtPriceX96:p.sqrtPriceX96,liquidity:p.liquidity,m0:await token(p.token0),m1:await token(p.token1)})));const lp=$('lpPool');const previous=lp.value;lp.replaceChildren(new Option(pools.length?'请选择交易池':'暂无交易池，请先创建',''));pools.forEach((p,i)=>{lp.add(new Option(`${p.m0.symbol} / ${p.m1.symbol} · ${Number(p.fee)/10000}% · #${p.index}`,String(i)));for(const m of [p.m0,p.m1])addCatalogToken({...m,name:m.symbol,chainId:11155111,source:'本 DEX 池子'},false)});if(pools.length)lp.value=pools[Number(previous)]&&previous!==''?previous:'0';renderPools();await Promise.all([updateTokens(),loadPositions()]);await loadReleasedTokens();updateLPLabels();$('chainStatus').textContent=`Sepolia 已连接 · ${pools.length} 个交易池`;status(pools.length?'链上数据已更新。':'暂无交易池。前往「流动性池」创建并添加流动性。');}
function invalidateQuote(){$('amountOut').textContent='0.0';$('quoteDetail').textContent='报价来自链上模拟，最终以交易结果为准。'}
async function updateTokens(){invalidateQuote();matchSwapPools();for(const [i,id,balance] of [[0,'tokenIn','balanceIn'],[1,'tokenOut','balanceOut']]){const m=chosenTokens[i];$(id).textContent=m?m.symbol+' ▾':'选择代币 ▾';$(balance).textContent='余额 —';if(m&&account){try{const actual=await token(m.address);chosenTokens[i]={...m,...actual};const n=await new ethers.Contract(m.address,ERC20,provider).balanceOf(account);$(balance).textContent='余额 '+pretty(n,actual.decimals)}catch{$(balance).textContent='余额读取失败'}}}}
function pretty(n,d){const s=ethers.formatUnits(n,d);const [a,b]=s.split('.');const fraction=b?.slice(0,6).replace(/0+$/,'');return fraction?a+'.'+fraction:a}
$('amountIn').oninput=invalidateQuote;$('slippage').oninput=invalidateQuote;
$('swapPool').onchange=()=>{invalidateQuote();syncDirection()};$('flip').onclick=()=>run(async()=>{chosenTokens.reverse();await updateTokens()});
$('refresh').onclick=()=>run(async()=>{if(!account)return connect();await refresh()});
function swapInput(){const p=selected();syncDirection();const [a,b]=reversed?[p.m1,p.m0]:[p.m0,p.m1];const n=ethers.parseUnits($('amountIn').value.trim(),a.decimals);if(n<=0n)throw Error('请输入大于 0 的支付数量。');if(p.liquidity===0n)throw Error('该池子暂无流动性，请先添加。');const slip=Number($('slippage').value);if(!Number.isFinite(slip)||slip<0.01||slip>50)throw Error('滑点范围为 0.01% 至 50%。');return{p,a,b,n,bps:BigInt(Math.round(slip*100)),limit:reversed?1461446703485210103287273052203988822378723970341n:4295128740n}}
async function quoteValue(s){const out=await contracts.SwapRouter.quoteExactInput.staticCall({tokenIn:s.a.address,tokenOut:s.b.address,indexPath:[s.p.index],amountIn:s.n,sqrtPriceLimitX96:s.limit});if(out<=0n)throw Error('当前池子无法提供有效报价。');const min=out*(10000n-s.bps)/10000n;if(min===0n)throw Error('金额过小，滑点保护后的最低接收量为 0。');$('amountOut').textContent=pretty(out,s.b.decimals);$('quoteDetail').textContent=`最低接收 ${ethers.formatUnits(min,s.b.decimals)} ${s.b.symbol} · 手续费 ${Number(s.p.fee)/10000}%`;return{out,min}}
$('quote').onclick=()=>run(async()=>{await requireWallet();status('正在模拟链上报价…');await quoteValue(swapInput());status('报价已更新。兑换时将重新获取报价。')});
async function send(label,action){await requireWallet();status(label+'：请在钱包确认…');const tx=await action();const a=link('/tx/'+tx.hash,label+' · '+short(tx.hash)+' · 等待确认');$('transactions').prepend(a);status(label+'：交易已发送，等待确认…');const receipt=await tx.wait();if(!receipt||receipt.status!==1)throw Error(label+'失败');a.textContent=label+' · '+short(tx.hash)+' · 已确认';return receipt;}
async function approve(m,spender,n){if(n===0n)return;const t=new ethers.Contract(m.address,ERC20,signer);if(await t.allowance(account,spender)>=n)return;await send('授权 '+m.symbol,()=>t.approve(spender,n));}
$('swapAction').onclick=()=>run(async()=>{if(!account)return connect();await requireWallet();const s=swapInput();await quoteValue(s);const t=new ethers.Contract(s.a.address,ERC20,provider);if(await t.balanceOf(account)<s.n)throw Error('代币余额不足。');await approve(s.a,ADDR.SwapRouter,s.n);const {min}=await quoteValue(s);const params={tokenIn:s.a.address,tokenOut:s.b.address,indexPath:[s.p.index],recipient:account,deadline:Math.floor(Date.now()/1000)+1200,amountIn:s.n,amountOutMinimum:min,sqrtPriceLimitX96:s.limit};await contracts.SwapRouter.exactInput.staticCall(params);await send('兑换',()=>contracts.SwapRouter.exactInput(params));$('amountIn').value='';await refresh();status('兑换成功。')});
function renderPools(){const list=$('poolList');list.replaceChildren();list.classList.toggle('empty',!pools.length);if(!pools.length){list.textContent='还没有交易池，创建第一个池子开始体验。';return;}pools.forEach((p,i)=>{const c=node('div',undefined,'pool-card');c.append(node('b',`${p.m0.symbol} / ${p.m1.symbol}`),node('p',`#${p.index} · 手续费 ${Number(p.fee)/10000}% · Tick ${p.tickLower} → ${p.tickUpper}`),renderPoolPriceRange(p),node('p',p.liquidity>0n?'已有流动性':'等待添加流动性'),link('/address/'+p.pool,short(p.pool)+' ↗'));const btn=node('button','添加流动性','secondary');btn.onclick=()=>{$('lpPool').value=String(i);updateLPLabels();$('lpAmount0').focus()};c.append(node('br'),btn);list.append(c)})}
function updateLPLabels(){if(!pools.length||$('lpPool').value==='')return;const p=selected('lpPool');$('lpLabel0').firstChild.textContent=p.m0.symbol+' 数量';$('lpLabel1').firstChild.textContent=p.m1.symbol+' 数量'}
$('lpPool').onchange=updateLPLabels;
$('toggleCreate').onclick=()=>{$('createForm').hidden=!$('createForm').hidden};
function isqrt(n){if(n<0n)throw Error('价格无效');if(n<2n)return n;let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n}return x}
$('createForm').onsubmit=e=>{e.preventDefault();run(async()=>{await requireWallet();const aa=ethers.getAddress($('createA').value.trim()),bb=ethers.getAddress($('createB').value.trim());if(aa===bb||aa===ethers.ZeroAddress||bb===ethers.ZeroAddress)throw Error('请使用两个不同且非零的 ERC-20 地址。');const [a,b]=await Promise.all([token(aa),token(bb)]);const v=$('initialPrice').value.trim();if(!/^\d+(\.\d{1,36})?$/.test(v))throw Error('请输入有效初始价格，最多 36 位小数。');const parts=v.split('.'),num=BigInt(parts.join('')),den=10n**BigInt(parts[1]?.length||0);if(num<=0n)throw Error('初始价格必须大于 0。');const sorted=BigInt(aa)<BigInt(bb),m0=sorted?a:b,m1=sorted?b:a;const n=sorted?num:den,d=sorted?den:num;const sqrt=isqrt(((n*10n**BigInt(m1.decimals))<<192n)/(d*10n**BigInt(m0.decimals)));if(sqrt<=4295128739n||sqrt>=1461446703485210103287273052203988822378723970342n)throw Error('初始价格超出可用范围。');const fee=Number($('fee').value);if(!Number.isInteger(fee)||fee<0||fee>16777215)throw Error('手续费参数必须是 uint24 范围内的整数。');const lo=Number($('tickLower').value),hi=Number($('tickUpper').value);if(!Number.isInteger(lo)||!Number.isInteger(hi)||lo < -887272||hi>887272||lo>=hi)throw Error('Tick 必须为 -887272 至 887272 之间的整数，且下限小于上限。');const tick=2*Math.log(Number(sqrt)/2**96)/Math.log(1.0001);if(tick<lo||tick>=hi)throw Error('初始价格必须位于 Tick 区间内。');await send('创建交易池',()=>contracts.PoolManager.createAndInitializePoolIfNecessary({token0:m0.address,token1:m1.address,fee,tickLower:lo,tickUpper:hi,sqrtPriceX96:sqrt}));await refresh();status('交易池已就绪，可添加流动性。')})};
$('liquidityForm').onsubmit=e=>{e.preventDefault();run(async()=>{await requireWallet();const p=selected('lpPool');const a=ethers.parseUnits($('lpAmount0').value.trim(),p.m0.decimals),b=ethers.parseUnits($('lpAmount1').value.trim(),p.m1.decimals);if(a<0n||b<0n||a+b===0n)throw Error('请填写有效代币数量。');for(const [m,n] of [[p.m0,a],[p.m1,b]]){if(await new ethers.Contract(m.address,ERC20,provider).balanceOf(account)<n)throw Error(m.symbol+'余额不足');await approve(m,ADDR.PositionManager,n)}const params={token0:p.token0,token1:p.token1,index:p.index,amount0Desired:a,amount1Desired:b,recipient:account,deadline:Math.floor(Date.now()/1000)+1200};const result=await contracts.PositionManager.mint.staticCall(params);if(result.liquidity===0n)throw Error('当前数量无法生成有效流动性。');await send('添加流动性',()=>contracts.PositionManager.mint(params));await refresh();status('流动性已添加，NFT 仓位可在「我的仓位」中查看。')})};
async function loadPositions(){const list=$('positionList');list.replaceChildren();const all=await contracts.PositionManager.getAllPositions();let count=0;for(const p of all){let owner;try{owner=await contracts.PositionManager.ownerOf(p.id)}catch{continue}if(owner.toLowerCase()!==account.toLowerCase())continue;count++;const [a,b]=await Promise.all([token(p.token0),token(p.token1)]);const c=node('div',undefined,'pool-card');c.append(node('b',`#${p.id} · ${a.symbol} / ${b.symbol}`),node('p',`Tick ${p.tickLower} → ${p.tickUpper} · ${p.liquidity>0n?'流动性持有中':'已移除，等待领取'}`),node('p',`已结算待领：${pretty(p.tokensOwed0,a.decimals)} ${a.symbol} / ${pretty(p.tokensOwed1,b.decimals)} ${b.symbol}`));if(p.liquidity>0n){const burn=node('button','移除全部流动性','secondary');burn.onclick=()=>run(async()=>{await send('移除仓位 #'+p.id,()=>contracts.PositionManager.burn(p.id));await refresh();status('流动性已移除，请点击「领取」取回代币。')});c.append(burn)}const collect=node('button','领取本金与手续费','secondary');collect.disabled=p.liquidity>0n;collect.title=p.liquidity>0n?'请先移除流动性':'领取后销毁已清空的仓位 NFT';collect.onclick=()=>run(async()=>{await send('领取仓位 #'+p.id,()=>contracts.PositionManager.collect(p.id,account));await refresh();status('代币已领取。')});c.append(collect);list.append(c)}list.classList.toggle('empty',count===0);if(!count)list.textContent='你的钱包还没有仓位。添加流动性后将在这里显示。';}

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
function setCreateToken(id,m){$(id).value=m.address;$(id==='createA'?'chooseCreateA':'chooseCreateB').textContent=m.symbol+' ▾';updateTickPreview();}
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
