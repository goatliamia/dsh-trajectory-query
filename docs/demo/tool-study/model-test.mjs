import assert from 'node:assert/strict';
import { projectOperations, describeOperation, fileId, filePath } from './model.mjs';
const event=(seq,type,data)=>({seq,type,time:seq*10,data});
const content=text=>[{type:'text',text}];
const events=[
  event(0,'tool/call',{turn:1,step:1,callId:'root',name:'run_code',arguments:'{"code":"opaque"}'}),
  event(1,'tool/ptc-dispatch-start',{rootCallId:'root',subCallId:'read',name:'read'}),
  event(2,'tool/ptc-dispatch',{rootCallId:'root',parentCallId:'root',subCallId:'read',name:'read',arguments:{file_path:'src/a.ts'},isError:false,content:content('<path>src/a.ts</path>\n<type>file</type>\n<content>\n1: hello\n2: world\n</content>')}),
  event(3,'tool/ptc-dispatch',{rootCallId:'root',parentCallId:'root',subCallId:'grep',name:'grep',arguments:{path:'.',pattern:'hello'},isError:false,content:content('Found 1 of 30 matches\n\nsrc/a.ts\nLine 2: hello\n\n(Full grep result stored at: spill.txt)')}),
  event(4,'tool/result',{message:{source:{callId:'root'},content:content('done')}}),
  event(5,'tool/call',{turn:1,step:2,callId:'glob',name:'glob',arguments:'{"path":"src","pattern":"*.ts"}'}),
  event(6,'tool/result',{message:{source:{callId:'glob'},content:content('src/a.ts\nsrc/b.ts')}}),
  event(7,'tool/call',{turn:1,step:3,callId:'pure',name:'run_code',arguments:'{"code":"1+1"}'}),
];
const result=projectOperations(events,{workspace:'D:/work'});
assert.deepEqual(result.calls.map(c=>c.name),['read','grep','glob','run_code']);
assert.equal(result.counts.wrappers,1);
assert.equal(result.files.length,1,'a search root, glob path and spill locator must not become content reads');
assert.deepEqual(result.files[0].accesses.map(a=>a.access),['read','match']);
const grep=result.calls.find(c=>c.name==='grep');assert.equal(grep.search.total,30);assert.equal(grep.search.shown,1);assert.equal(grep.search.truncated,true);assert.equal(grep.files[0].lines[0],2);
assert.equal(result.calls.at(-1).status,'pending','pure Code Mode and missing returns remain visible');
const empty=describeOperation({name:'grep',status:'returned'},{path:'src',pattern:'none'},'No matches found',null,'D:/work');assert.equal(empty.files.length,0);assert.equal(empty.search.total,0);
const structured=describeOperation({name:'grep',status:'returned'},{},'unrelated text',{shape:'matches',total:2,truncated:false,files:[{path:'a.ts',matches:[{lineNumber:3,line:'a'},{lineNumber:8,line:'b'}]}]},'D:/work');assert.equal(structured.files[0].lines.length,2);
const command=describeOperation({name:'pwsh',status:'returned'},{command:'Get-Content docs/lean-notes.md'},'PASS one item',null,'');assert.doesNotMatch(command.title,/Lean/);assert.match(command.summary,/通过项/);assert.doesNotMatch(command.summary,/退出码 0|全部通过/);
assert.equal(fileId(filePath('.\\src\\..\\a.ts','D:\\Work')),'d:/work/a.ts');
console.log('PASS native inner-call projection, wrapper deduplication, missing returns, content-vs-path evidence, grep retention and command result semantics');
