import { renderFigure } from './components.mjs';
import { compileMarkdown } from './compile.mjs';

const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
export function assembleMarkdown(markdown, { compile = compileMarkdown, datasets, figures = {} }) {
  const compiled = compile(markdown), used = [], blocks = [];
  for (const block of compiled.blocks) {
   try {
    const inline = block.html.match(/<code class="language-report-figure">([\s\S]*?)<\/code>/);
    const legacy = block.type === 'paragraph' ? block.text.trim().match(/^\[\[figure:([\w-]+)\]\]$/) : !block.type && block.html.match(/^<p>\[\[figure:([\w-]+)\]\]<\/p>$/);
    let spec;
    if (inline) spec = JSON.parse(decode(inline[1]));
    else if (legacy) spec = figures[legacy[1]];
    if (inline || legacy) {
      if (!spec) throw Error('Unbound figure declaration');
      if (!spec.id) spec = { ...spec, id: 'figure-' + (used.length + 1) };
      if (used.some(row => row.id === spec.id)) throw Error('Duplicate figure ID');
      used.push(spec); blocks.push({ ...block, html: renderFigure(spec, datasets), figure: spec.id });
    } else blocks.push(block);
   } catch(error) {
    const diagnostic={block:block.id,startLine:block.startLine,endLine:block.endLine,message:error.message};
    throw Object.assign(new Error('Report block '+block.id+' (line '+block.startLine+'): '+error.message),{diagnostic});
   }
  }
  return { html: blocks.map(b=>b.html).join('\n'), blocks, figures: used, sourceMap: compiled.map };
}
