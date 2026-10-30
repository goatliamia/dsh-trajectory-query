import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
const source=resolve('docs/demo/injection-study'), data=resolve('.dsh/injection-study');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'};
const publicFiles=new Map([['/',join(source,'index.html')],['/app.js',join(source,'app.js')],['/graph.js',join(source,'graph.js')],['/style.css',join(source,'style.css')],
  ['/fonts/Geist-Variable.woff2',resolve('docs/demo/layout-review/fonts/Geist-Variable.woff2')],
  ['/fonts/GeistMono-Variable.woff2',resolve('docs/demo/layout-review/fonts/GeistMono-Variable.woff2')]]);
const manifest=JSON.parse(readFileSync(join(data,'manifest.json'))), ids=new Set(manifest.cases.map(c=>c.id));
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405).end();return}
  const url=new URL(req.url,'http://localhost'); let file=publicFiles.get(url.pathname), gzip=false;
  if(url.pathname==='/manifest.json')file=join(data,'manifest.json');
  if(url.pathname==='/snapshot'&&ids.has(url.searchParams.get('id'))){
    gzip=String(req.headers['accept-encoding']||'').includes('gzip');file=join(data,url.searchParams.get('id')+'.json'+(gzip?'.gz':''));
  }
  if(url.pathname==='/evidence'&&/^\d+$/.test(url.searchParams.get('seq')||''))file=join(data,'evidence',url.searchParams.get('seq')+'.json');
  if(url.pathname==='/receipt'&&/^\d+$/.test(url.searchParams.get('seq')||''))file=join(data,'receipts',url.searchParams.get('seq')+'.json');
  if(!file||!existsSync(file)){res.writeHead(404).end('Not found');return}
  try{const body=readFileSync(file), extension=gzip?'.json':extname(file);
    res.writeHead(200,{'content-type':(types[extension]||'application/octet-stream')+'; charset=utf-8','cache-control':'no-store',
      'x-content-type-options':'nosniff',vary:'accept-encoding',...(gzip?{'content-encoding':'gzip'}:{}),'content-length':body.length});res.end(body);
  }catch{res.writeHead(500).end('Preview asset unavailable');}
});
server.listen(Number(process.argv[2]||3087),'127.0.0.1',()=>console.log('Context provenance study: http://127.0.0.1:'+server.address().port+'/'));
