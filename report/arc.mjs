// Build-time adapter only: no Archify template selection or browser runtime.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function arcCompiler(root) {
  const {compile}=await import(pathToFileURL(resolve(root,'document/compile.mjs')));
  const require=createRequire(resolve(root,'package.json'));
  const html=await import(pathToFileURL(require.resolve('parse5')));
  const allowed=new Set('h1 h2 h3 h4 h5 h6 p pre code blockquote ul ol li hr br strong em s del table thead tbody tr th td a span'.split(' '));
  const safe=source=>{
    const fragment=html.parseFragment(source);
    const walk=node=>{
      if(!node.childNodes)return;
      node.childNodes=node.childNodes.flatMap(child=>{
        if(!child.tagName){if(child.nodeName==='#text')return [child];return [];}
        if(!allowed.has(child.tagName))return [];
        child.attrs=(child.attrs||[]).filter(attr=>{
          if(['id','data-src'].includes(attr.name))return true;
          if(attr.name==='class')return /^language-[\w-]+$/.test(attr.value);
          if(child.tagName==='a'&&attr.name==='href')return /^(?:https?:\/\/|#|\.{0,2}\/|[^:/\s]+(?:\.md|\.html)(?:#|$))/i.test(attr.value.trim());
          if(child.tagName==='a'&&attr.name==='title')return true;
          return false;
        });walk(child);return [child];
      });
    };walk(fragment);return html.serialize(fragment);
  };
  return markdown=>{const result=compile(markdown);return {...result,blocks:result.blocks.map(block=>({...block,html:safe(block.html)}))};};
}
