import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const report=[];
for(const options of [
 {name:'bundled-high-performance',executablePath:chromium.executablePath(),args:['--force-high-performance-gpu']},
 {name:'installed-chrome',channel:'chrome'},
]) {
 const {name,...launch}=options;
 let browser;
 try {
  browser=await chromium.launch({headless:true,...launch});
  const cdp=await browser.newBrowserCDPSession();
  const system=await cdp.send('SystemInfo.getInfo');
  const page=await browser.newPage();
  await page.route('**/__gpu-probe',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Local GPU probe</title>'}));
  await page.goto('http://127.0.0.1:5187/__gpu-probe',{waitUntil:'domcontentloaded',timeout:60000});
  const result=await page.evaluate(async()=>{
   const started=performance.now();
   if(!navigator.gpu)return {available:false};
   const adapter=await Promise.race([navigator.gpu.requestAdapter({powerPreference:'high-performance'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Adapter request exceeded 60 seconds')),60000))]);
   if(!adapter)return {adapter:null,ms:performance.now()-started};
   return {info:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},ms:performance.now()-started};
  });
  report.push({name,version:browser.version(),devices:system.gpu.devices,features:system.gpu.featureStatus,aux:system.gpu.auxAttributes,result});
 }catch(error){report.push({name,error:String(error)});}
 finally{await browser?.close();}
}
await writeFile('../docs/allocation-progress/gpu-current-probe.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
