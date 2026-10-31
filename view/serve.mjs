import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';

// A view server exposes exactly one generated file, never its directory.
export async function startViewServer(file,{idleMs=15*60*1000,maxAgeMs=60*60*1000,port=0}={}){
 const token=randomBytes(20).toString('hex'),path='/'+token+'/',source=resolve(file);let idle;
 const touch=()=>{clearTimeout(idle);idle=setTimeout(close,idleMs);idle.unref();};
 const server=http.createServer(async(req,res)=>{
  if(req.url!==path||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
  touch();try{const bytes=req.method==='HEAD'?null:await readFile(source);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}).end(bytes);}catch{res.writeHead(404).end('View file unavailable');}
 });
 const close=()=>{clearTimeout(idle);clearTimeout(expiry);server.close();server.closeAllConnections?.();};
 const expiry=setTimeout(close,maxAgeMs);expiry.unref();
 await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});touch();
 return {url:'http://127.0.0.1:'+server.address().port+path,close};
}
export async function serveViewFile(file){
 const target=resolve(file),registry=target+'.server.json';
 try{
  const old=JSON.parse(await readFile(registry,'utf8')),url=new URL(old.url);
  if(old.file===target&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^\/[a-f0-9]{40}\/$/.test(url.pathname)&&!url.username&&!url.password&&!url.search&&!url.hash){
   const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(800),redirect:'error'});if(response.ok)return {url:old.url,reused:true};
  }
 }catch{}
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--file',target],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const result=await new Promise((done,fail)=>{
  const timer=setTimeout(()=>{child.kill();fail(Error('View server startup timed out'));},8000);
  child.once('error',error=>{clearTimeout(timer);fail(error);});
  child.once('exit',()=>{clearTimeout(timer);fail(Error('View server exited during startup'));});
  child.once('message',message=>{clearTimeout(timer);if(message.error){child.kill();fail(Error(message.error));}else done(message);});
 });
 child.disconnect();child.unref();await mkdir(dirname(registry),{recursive:true});await writeFile(registry,JSON.stringify({file:target,url:result.url}));return{url:result.url,reused:false};
}
export async function openViewBrowser(url){
 const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1')throw Error('Only generated localhost views may be opened');
 const [command,args]=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 await new Promise((done,fail)=>{const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.once('error',fail);child.once('spawn',()=>{child.unref();done();});});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const view=await startViewServer(process.argv[process.argv.indexOf('--file')+1]);process.send?.({url:view.url});}catch(error){process.send?.({error:error.message});process.exitCode=1;}
}
