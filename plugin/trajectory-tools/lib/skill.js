import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=new URL('../skills/',import.meta.url);
const catalog=JSON.parse(readFileSync(new URL('catalog.json',base),'utf8'));
const body=file=>readFileSync(file,'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
export const SKILL_NAME=catalog.query.name;
export const SKILL_DESCRIPTION=catalog.query.description;
export const SKILL_WHEN_TO_USE=catalog.query.whenToUse;
export const SKILL_BODY=body(new URL('trajectory-query/SKILL.md',base));
export function loadDiagnosticSkills(){
 return catalog.diagnostics.map(skill=>{
  const directory=new URL(skill.name+'/',base);
  return {...skill,source:'runtime',content:body(new URL('SKILL.md',directory)),resourceBase:{kind:'directory',path:fileURLToPath(directory)}};
 });
}
