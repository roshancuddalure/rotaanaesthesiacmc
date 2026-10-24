import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=process.env.MEMBER_TEST_URL || 'http://127.0.0.1:5197';
const evidence=[];
for(const mode of ['default','discrete']) {
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:mode==='discrete'?['--force-high-performance-gpu']:[]});
  try {
    const page=await browser.newPage();
    await page.route('**/__premium-gpu',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><title>GPU parity fixture</title><body>Numeric-only GPU verification</body></html>'}));
    await page.goto(base+'/__premium-gpu');
    const result=await page.evaluate(async()=>{
      const {ComputeWorker}=await import('/src/compute-device.ts');
      const worker=new ComputeWorker('high-performance');
      try {
        const device=await worker.call('test');
        const rows=Array.from({length:513},(_,i)=>[(i*17)%31-15,-2147483648+i,2147483647-i]);
        const ties=rows.map((_,i)=>rows.length-i);
        const ranked=await worker.call('score',{kernel:'lexicographic',version:3,rows,ties});
        const expected=rows.map((_,i)=>i).sort((a,b)=>{
          for(let k=0;k<3;k++)if(rows[a][k]!==rows[b][k])return rows[a][k]<rows[b][k]?-1:1;
          return ties[a]-ties[b];
        });
        const ranks=Array(rows.length);expected.forEach((index,rank)=>ranks[index]=rank);
        return {device,parity:JSON.stringify(ranked.scores)===JSON.stringify(ranks)&&ranked.winner===expected[0],gpu_ms:ranked.gpu_ms};
      }finally{worker.close();}
    });
    assert.equal(result.device.software,false);
    assert.equal(result.device.parity,true);assert.equal(result.parity,true);
    evidence.push({mode,vendor:result.device.vendor,architecture:result.device.architecture,parity:result.parity,gpu_ms:result.gpu_ms});
  }finally{await browser.close();}
}
await writeFile('../docs/premium-ui/gpu-parity.json',JSON.stringify({evidence,scope:'Unchanged numeric worker regression; no backend calls or scheduling mutations',limit:'Browsers choose the adapter; this test does not enumerate all physical devices or accelerate coding models.'},null,2)+'\n');
console.log('Premium UI GPU regression passed on '+evidence.map(row=>row.vendor).join(' and ')+'.');
