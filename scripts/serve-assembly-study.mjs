import http from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
const root=resolve('docs/demo/assembly-study');
const files=new Map([['/',join(root,'index.html')],['/assembly.js',join(root,'assembly.js')],['/assembly.css',join(root,'assembly.css')],
['/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],['/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')]]);
http.createServer((req,res)=>{const file=files.get(new URL(req.url,'http://localhost').pathname);if(req.method!=='GET'||!file){res.writeHead(404).end();return}try{res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[extname(file)],'cache-control':'no-store'});res.end(readFileSync(file))}catch{res.writeHead(500).end()}}).listen(Number(process.argv[2]||3088),'127.0.0.1',()=>console.log('Assembly concept: http://127.0.0.1:3088/'));
