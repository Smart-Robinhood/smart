// Compiles SmartBuyback.sol with solc 0.8.24 (optimizer 200 runs) into build/SmartBuyback.json.
// Use the same settings when verifying on Blockscout.
import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const input = {
  language: 'Solidity',
  sources: { 'SmartBuyback.sol': { content: readFileSync(new URL('./SmartBuyback.sol', import.meta.url), 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors || []) console.log(e.severity, e.formattedMessage);
if ((out.errors || []).some((e) => e.severity === 'error')) process.exit(1);
const c = out.contracts['SmartBuyback.sol'].SmartBuyback;
mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
writeFileSync(new URL('./build/SmartBuyback.json', import.meta.url), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1));
console.log('compiled, bytecode', c.evm.bytecode.object.length / 2, 'bytes');
