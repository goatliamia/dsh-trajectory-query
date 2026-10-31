// Report Markdown only: no template selection, external compiler or raw HTML.
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeHref=s=>/^(?:https?:\/\/|mailto:|#|\.{0,2}\/|[^:/\s]+(?:\.md|\.html)(?:#|$))/i.test(s)&&!/[\u0000-\u0020\u007f\\]/.test(s);

function inline(text,depth=0){
 if(depth>12)return escape(text);
 let result='',at=0;
 while(at<text.length){
  const tail=text.slice(at);let match;
  if((match=/^\\([\\`*_[\]{}()#+.!|>~-])/.exec(tail))){result+=escape(match[1]);at+=match[0].length;continue;}
  if((match=/^(`+)([\s\S]*?)\1(?!`)/.exec(tail))){result+='<code>'+escape(match[2])+'</code>';at+=match[0].length;continue;}
  if((match=/^\[([^\]\n]+)\]\(([^\s)]+)(?:\s+"([^"\n]*)")?\)/.exec(tail))){
   result+=safeHref(match[2])?'<a href="'+escape(match[2])+'"'+(match[3]?' title="'+escape(match[3])+'"':'')+'>'+inline(match[1],depth+1)+'</a>':escape(match[0]);at+=match[0].length;continue;
  }
  if((match=/^(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/.exec(tail))){const tag=match[1]==='~~'?'del':'strong';result+='<'+tag+'>'+inline(match[2],depth+1)+'</'+tag+'>';at+=match[0].length;continue;}
  if((match=/^(\*|_)(?=\S)([^\n]*?\S)\1/.exec(tail))){result+='<em>'+inline(match[2],depth+1)+'</em>';at+=match[0].length;continue;}
  result+=escape(text[at++]);
 }
 return result;
}
const fence=line=>/^ {0,3}(`{3,}|~{3,})([\w-]*)\s*$/.exec(line);
const list=line=>/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/.exec(line);
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(cell=>cell.trim());
const tableRule=line=>line.includes('|')&&cells(line).every(cell=>/^:?-{3,}:?$/.test(cell));
const special=line=>!line.trim()||fence(line)||/^ {0,3}#{1,6}\s/.test(line)||/^ {0,3}>/.test(line)||/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)||list(line);

export function compileMarkdown(markdown){
 const source=String(markdown).replace(/\r\n?/g,'\n'),lines=source.split('\n'),blocks=[],map={version:1,blocks:{}},headings=new Map();
 const add=(type,start,end,html,extra={})=>{const id='md-'+(blocks.length+1),position={startLine:start+1,endLine:end};map.blocks[id]=position;blocks.push({id,type,...position,html,...extra});};
 let at=0;
 while(at<lines.length){
  if(!lines[at].trim()){at++;continue;}
  const start=at,line=lines[at];let match;
  if((match=fence(line))){
   const marker=match[1],language=match[2];at++;
   while(at<lines.length&&!new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$').test(lines[at]))at++;
   const code=lines.slice(start+1,at).join('\n');if(at<lines.length)at++;
   add('code',start,at,'<pre><code'+(language?' class="language-'+escape(language)+'"':'')+'>'+escape(code)+'</code></pre>',{language,code});continue;
  }
  if((match=/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))){at++;const level=match[1].length,base=match[2].toLowerCase().replace(/[*_`~]/g,'').replace(/[^\p{L}\p{N}-]+/gu,'-').replace(/^-|-$/g,'')||'section',count=(headings.get(base)||0)+1;headings.set(base,count);add('heading',start,at,'<h'+level+' id="'+escape(base+(count>1?'-'+count:''))+'">'+inline(match[2])+'</h'+level+'>');continue;}
  if(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){add('rule',start,++at,'<hr>');continue;}
  if(at+1<lines.length&&line.includes('|')&&tableRule(lines[at+1])){
   const headers=cells(line),align=cells(lines[at+1]);at+=2;const rows=[];
   while(at<lines.length&&lines[at].trim()&&lines[at].includes('|'))rows.push(cells(lines[at++]));
   const row=(values,tag)=>'<tr>'+headers.map((_,i)=>'<'+tag+(align[i]?.endsWith(':')?' style="text-align:'+(align[i].startsWith(':')?'center':'right')+'"':'')+'>'+inline(values[i]||'')+'</'+tag+'>').join('')+'</tr>';
   add('table',start,at,'<table><thead>'+row(headers,'th')+'</thead><tbody>'+rows.map(values=>row(values,'td')).join('')+'</tbody></table>');continue;
  }
  if((match=list(line))){
   const ordered=/^\d/.test(match[1]),items=[];
   while(at<lines.length){const item=list(lines[at]);if(!item||/^\d/.test(item[1])!==ordered)break;let text=item[2];at++;
    while(at<lines.length&&/^ {2,}\S/.test(lines[at])&&!list(lines[at]))text+=' '+lines[at++].trim();
    items.push('<li>'+inline(text)+'</li>');
   }
   const tag=ordered?'ol':'ul';add('list',start,at,'<'+tag+'>'+items.join('')+'</'+tag+'>');continue;
  }
  if(/^ {0,3}>/.test(line)){
   const quote=[];while(at<lines.length&&/^ {0,3}>/.test(lines[at]))quote.push(lines[at++].replace(/^ {0,3}>\s?/,''));
   add('quote',start,at,'<blockquote>'+compileMarkdown(quote.join('\n')).blocks.map(block=>block.html).join('\n')+'</blockquote>');continue;
  }
  at++;while(at<lines.length&&!special(lines[at])&&!(at+1<lines.length&&tableRule(lines[at+1])))at++;
  const text=lines.slice(start,at).join('\n');add('paragraph',start,at,'<p>'+inline(text)+'</p>',{text});
 }
 return {blocks,map};
}
