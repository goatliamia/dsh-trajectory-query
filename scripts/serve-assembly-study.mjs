import http from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
const root=resolve('docs/demo/assembly-study');
const files=new Map([['/',join(root,'index.html')],['/assembly.js',join(root,'assembly.js')],['/assembly.css',join(root,'assembly.css')],
['/sequence.mjs',join(root,'sequence.mjs')],['/real.json',resolve('.dsh/report-study/assembly-data.json')],
['/design/',resolve('design/index.html')],...['tokens.mjs','tokens.css','primitives.css','icons.svg'].map(name=>['/design/'+name,resolve('design',name)]),
...['assembly.mjs','assembly-model.mjs','palette.mjs','assembly.css'].map(name=>['/components/'+name,resolve('report',name)]),
['/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],['/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')]]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer((req,res)=>{const file=files.get(new URL(req.url,'http://localhost').pathname);if(req.method!=='GET'||!file){res.writeHead(404).end();return}try{res.writeHead(200,{'content-type':types[extname(file)],'cache-control':'no-store'});res.end(readFileSync(file))}catch{res.writeHead(500).end('Preview asset unavailable')}}).listen(Number(process.argv[2]||3088),'127.0.0.1',function(){console.log('Assembly component: http://127.0.0.1:'+this.address().port+'/')});
