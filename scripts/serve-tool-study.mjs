import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
const root=resolve('docs/demo/tool-study'),data=resolve('.dsh/tool-study');
const files=new Map([['/',resolve(data,'original.html')],['/cards',resolve(root,'index.html')],['/app.js',resolve(root,'app.js')],['/style.css',resolve(root,'style.css')],['/model.mjs',resolve(root,'model.mjs')],['/session.json',resolve(data,'session.json')],
  ['/analysis-view/trace/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],['/analysis-view/trace/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')],
  ['/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],['/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')]]);
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'};
const cached=new Map();
const server=http.createServer((req,res)=>{
  const path=files.get(new URL(req.url,'http://localhost').pathname);
  if(!path||req.method!=='GET'){res.writeHead(404).end();return;}
  try{
    // Only the immutable snapshot is cached; authored preview assets can refresh.
    let body=path===files.get('/session.json')?cached.get(path):null;
    if(!body){const raw=readFileSync(path);body={raw,gzip:gzipSync(raw,{level:1})};if(path===files.get('/session.json'))cached.set(path,body);}
    const gzip=String(req.headers['accept-encoding']||'').includes('gzip'),bytes=gzip?body.gzip:body.raw;
    res.writeHead(200,{'content-type':types[extname(path)]+'; charset=utf-8','cache-control':'no-store',vary:'accept-encoding',...(gzip?{'content-encoding':'gzip'}:{}),'content-length':bytes.length});res.end(bytes);
  }catch{res.writeHead(500).end('Preview asset unavailable');}
});
server.listen(Number(process.argv[2]||3086),'127.0.0.1',()=>console.log('Tool study: http://127.0.0.1:'+server.address().port+'/'));
