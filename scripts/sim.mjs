import { buildSwap } from './swap-lib.mjs';
const RPC='https://rpc.mainnet.chain.robinhood.com';
const r=async(m,p)=>{for(let a=0;a<10;a++){let j;try{j=await (await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})})).json();}catch{j={error:{message:'many'}}} if(!j.error) return j.result; if(!/many/i.test(j.error.message)) return {err:j.error.message, data:j.error.data}; await new Promise(r=>setTimeout(r,1500*(a+1)));}};
const PM='0x8366a39cc670b4001a1121b8f6a443a643e40951', INIT='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const POOL='0x1aa689a06ac9cd35b7b5270ba1249c02dacb9f85d6d033ec1a0595e919576688'; // V4M (Pons graduation pool) from DexScreener earlier
const head=parseInt(await r('eth_blockNumber',[]),16);
let init=null;for(let b=0;b<10&&!init;b++){const to=head-b*9_900_000;const ls=await r('eth_getLogs',[{address:PM,topics:[INIT,POOL],fromBlock:'0x'+Math.max(0,to-9_900_000).toString(16),toBlock:'0x'+to.toString(16)}]);if(Array.isArray(ls)&&ls.length)init=ls[0];}
const d=init.data.slice(2).match(/.{64}/g);
const key={c0:'0x'+init.topics[2].slice(26),c1:'0x'+init.topics[3].slice(26),fee:parseInt(d[0],16),ts:parseInt(d[1],16),hooks:'0x'+d[2].slice(24)};
console.log('key',key);
const user='0x0fc735ce54de29d20aedef289e9f0c1551de2608'; // EOA with ETH, used only as eth_call sender
const tx=buildSwap({key,side:'buy',amountIn:10n**15n,minOut:1n,user,feeBips:25,feeRecipient:'0x000000000000000000000000000000000000dEaD',deadline:BigInt(Math.floor(Date.now()/1000)+600)});
const res=await r('eth_call',[{from:user,to:tx.to,value:'0x'+tx.value.toString(16),data:tx.data},'latest']);
console.log('BUY simulate:',res);
const gas=await r('eth_estimateGas',[{from:user,to:tx.to,value:'0x'+tx.value.toString(16),data:tx.data}]);console.log('gas',gas);
const tx2=buildSwap({key,side:'buy',amountIn:10n**15n,minOut:10n**40n,user,feeBips:25,feeRecipient:'0x000000000000000000000000000000000000dEaD',deadline:BigInt(Math.floor(Date.now()/1000)+600)});
console.log('BUY with impossible minOut (must fail):',JSON.stringify(await r('eth_call',[{from:user,to:tx2.to,value:'0x'+tx2.value.toString(16),data:tx2.data},'latest'])).slice(0,160));
// find a recent seller of this pool through the Universal Router
const SWAP='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const sw=await r('eth_getLogs',[{address:PM,topics:[SWAP,POOL],fromBlock:'0x'+(head-300000).toString(16),toBlock:'0x'+head.toString(16)}]);
let seller=null;
for(const l of sw.reverse()){const a0=BigInt.asIntN(128,BigInt('0x'+l.data.slice(2+32,2+64)));// amount0 (int128, from pool's view: positive = user paid)
 const tx=await r('eth_getTransactionByHash',[l.transactionHash]);if(tx.to.toLowerCase()!=='0x8876789976decbfcbbbe364623c63652db8c0904')continue;
 if(a0<0n||true){const bal=await r('eth_call',[{to:key.c1,data:'0x70a08231'+tx.from.slice(2).padStart(64,'0')},'latest']);const b=BigInt(bal);if(b>10n**20n){seller={who:tx.from,bal:b};break;}}}
console.log('seller',seller&&seller.who, seller&&Number(seller.bal)/1e18);
if(seller){const amt=seller.bal/100n;const tx3=buildSwap({key,side:'sell',amountIn:amt,minOut:1n,user:seller.who,feeBips:25,feeRecipient:'0x000000000000000000000000000000000000dEaD',deadline:BigInt(Math.floor(Date.now()/1000)+600)});
 console.log('SELL simulate:',JSON.stringify(await r('eth_call',[{from:seller.who,to:tx3.to,value:'0x0',data:tx3.data},'latest'])).slice(0,200));}
