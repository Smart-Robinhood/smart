import { buildSwap } from './swap-lib.mjs';
import { keccak256, encodeAbiParameters } from '../../house/worker/node_modules/viem/_esm/index.js';
const RPC='https://rpc.mainnet.chain.robinhood.com';
const r=async(m,p)=>{for(let a=0;a<10;a++){let j;try{j=await (await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})})).json();}catch{j={error:{message:'many'}}} if(!j.error) return j.result; if(!/many/i.test(j.error.message)) return {err:j.error.message, data:j.error.data}; await new Promise(r=>setTimeout(r,1500*(a+1)));}};
const key={c0:'0x0000000000000000000000000000000000000000',c1:'0xbd1a43744409a33d131cfc0c14103d6dcff11c12',fee:0,ts:200,hooks:'0xe5e702641ea86f4ae6cc3cdaed2b886f976be044'};
const seller='0x723237836c8e09ce702ccbd4c2f57d2fb2c60ee9', UR='0x8876789976decbfcbbbe364623c63652db8c0904', P2='0x000000000022D473030F116dDEE9F6B43aC78BA3';
const allow=BigInt(await r('eth_call',[{to:key.c1,data:'0xdd62ed3e'+seller.slice(2).padStart(64,'0')+P2.slice(2).padStart(64,'0')},'latest']));
console.log('token allowance to Permit2', allow>0n?'yes':'no');
// Permit2.allowance[owner][token][spender] lives at slot 1
const enc=(k,s)=>keccak256(encodeAbiParameters([{type:'address'},{type:'bytes32'}],[k,s]));
const s1=enc(seller,'0x'+(1).toString(16).padStart(64,'0')); const s2=enc(key.c1,s1); const s3=enc(UR,s2);
const exp=BigInt(Math.floor(Date.now()/1000)+86400); const packed=(0n<<208n)|(exp<<160n)|((1n<<160n)-1n);
const override={[P2]:{stateDiff:{[s3]:'0x'+packed.toString(16).padStart(64,'0')}}};
const bal=BigInt(await r('eth_call',[{to:key.c1,data:'0x70a08231'+seller.slice(2).padStart(64,'0')},'latest']));
const tx=buildSwap({key,side:'sell',amountIn:bal/100n,minOut:1n,user:seller,feeBips:25,feeRecipient:'0x000000000000000000000000000000000000dEaD',deadline:BigInt(Math.floor(Date.now()/1000)+600)});
console.log('SELL with permit2 allowance:',JSON.stringify(await r('eth_call',[{from:seller,to:tx.to,value:'0x0',data:tx.data},'latest',override])).slice(0,200));
const txBad=buildSwap({key,side:'sell',amountIn:bal/100n,minOut:10n**30n,user:seller,feeBips:25,feeRecipient:'0x000000000000000000000000000000000000dEaD',deadline:BigInt(Math.floor(Date.now()/1000)+600)});
console.log('SELL impossible minOut (must fail):',JSON.stringify(await r('eth_call',[{from:seller,to:txBad.to,value:'0x0',data:txBad.data},'latest',override])).slice(0,160));
let slotFound=null;
for(let i=0;i<12&&slotFound===null;i++){const a=enc(seller,'0x'+i.toString(16).padStart(64,'0'));const b=enc(P2,a);
 const ov={[key.c1]:{stateDiff:{[b]:'0x'+((1n<<255n)).toString(16).padStart(64,'0')}}};
 const v=await r('eth_call',[{to:key.c1,data:'0xdd62ed3e'+seller.slice(2).padStart(64,'0')+P2.slice(2).padStart(64,'0')},'latest',ov]);
 if(typeof v==='string'&&BigInt(v)>0n){slotFound={i,b};}}
console.log('token allowance slot',slotFound&&slotFound.i);
if(slotFound){const ov2={...override,[key.c1]:{stateDiff:{[slotFound.b]:'0x'+((1n<<255n)).toString(16).padStart(64,'0')}}};
 console.log('SELL full overrides:',JSON.stringify(await r('eth_call',[{from:seller,to:tx.to,value:'0x0',data:tx.data},'latest',ov2])).slice(0,200));
 console.log('SELL impossible minOut (must fail):',JSON.stringify(await r('eth_call',[{from:seller,to:txBad.to,value:'0x0',data:txBad.data},'latest',ov2])).slice(0,140));}
