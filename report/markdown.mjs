import { renderFigure } from './components.mjs';

const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));
export function assembleMarkdown(markdown, { compile, datasets, figures = {} }) {
  const compiled = compile(markdown), used = [], blocks = [];
  for (const block of compiled.blocks) {
    const inline = block.html.match(/<code class="language-report-figure">([\s\S]*?)<\/code>/);
    const legacy = block.html.match(/\[\[figure:([\w-]+)\]\]/);
    let spec;
    if (inline) spec = JSON.parse(decode(inline[1]));
    else if (legacy) spec = figures[legacy[1]];
    if (inline || legacy) {
      if (!spec) throw Error('Unbound figure declaration');
      if (!spec.id) spec = { ...spec, id: 'figure-' + (used.length + 1) };
      if (used.some(row => row.id === spec.id)) throw Error('Duplicate figure ID');
      used.push(spec); blocks.push({ ...block, html: renderFigure(spec, datasets), figure: spec.id });
    } else blocks.push(block);
  }
  return { html: blocks.map(b=>b.html).join('\n'), blocks, figures: used, sourceMap: compiled.map };
}
