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
async function app(storage=new Map()){
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context=vm.createContext({console,ethers,
    document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element()},
    history:{replaceState(_a,_b,url){context.hash=url;}},location:{hash:''},
    window:{addEventListener(){},ethereum:{on(){},async request({method}){if(method==='eth_chainId')return '0xaa36a7';if(method==='eth_accounts')return ['0x1111111111111111111111111111111111111111'];throw Error('Unexpected wallet call');}}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    Option:class{constructor(text,value){this.text=text;this.value=value;}},
    fetch:async file=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))})});
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
