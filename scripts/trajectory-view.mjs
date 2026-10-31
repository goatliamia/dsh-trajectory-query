#!/usr/bin/env node
import {generateTraceView} from '../view/generate.mjs';
import {serveViewFile,openViewBrowser} from '../view/serve.mjs';
const args=process.argv.slice(2),option=key=>{const at=args.indexOf(key);return at<0?undefined:args[at+1];};
if(args.includes('--help'))console.log('trajectory-view --host pi|codex|claude [--file native-session|snapshot] [--thread ID] [--leaf ID] [--capture file] [--api-only] [--out view.html] [--serve] [--open]');
else try{
 const view=await generateTraceView({host:option('--host'),file:option('--file'),thread:option('--thread'),leafId:option('--leaf'),captureFile:option('--capture'),rollout:option('--rollout'),apiOnly:args.includes('--api-only'),synthetic:args.includes('--synthetic'),output:option('--out')});
 if(args.includes('--serve')||args.includes('--open'))Object.assign(view,await serveViewFile(view.output));
 if(args.includes('--open'))await openViewBrowser(view.url);
 console.log(JSON.stringify({ok:true,...view}));
}catch(error){console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
