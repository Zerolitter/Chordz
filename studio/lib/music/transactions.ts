import type { ProjectDocument } from "./types";
export type FieldPath=(string|{id:string})[];
export interface FieldPatch {path:FieldPath;before:unknown;after:unknown;}
export interface EditTransaction {owner?:string;projectId:string;label:string;patches:FieldPatch[];invalid:string|null;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const entities=(value:unknown):value is (Record<string,unknown>&{id:string})[]=>Array.isArray(value)&&value.every(v=>record(v)&&typeof v.id==="string")&&new Set(value.map(v=>v.id)).size===value.length;
export function documentDiff(before:unknown,after:unknown,path:FieldPath=[]):FieldPatch[]{
  if(equal(before,after))return [];
  if(entities(before)&&entities(after)&&before.filter(v=>after.some(w=>v.id===w.id)).map(v=>v.id).join()!==after.filter(v=>before.some(w=>v.id===w.id)).map(v=>v.id).join())return [{path,before:structuredClone(before),after:structuredClone(after)}];
  if(entities(before)&&entities(after))return [...new Set([...before.map(v=>v.id),...after.map(v=>v.id)])].flatMap(id=>documentDiff(before.find(v=>v.id===id),after.find(v=>v.id===id),[...path,{id}]));
  if(record(before)&&record(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>documentDiff(before[key],after[key],[...path,key]));
  return [{path,before:structuredClone(before),after:structuredClone(after)}];
}
function read(value:unknown,path:FieldPath):unknown{
  for(const part of path){value=typeof part==="string"?(record(value)?value[part]:undefined):Array.isArray(value)?(value.filter(v=>record(v)&&v.id===part.id).length===1?value.find(v=>record(v)&&v.id===part.id):undefined):undefined;}return value;
}
function write(value:unknown,path:FieldPath,next:unknown):unknown{
  if(!path.length)return structuredClone(next);
  const [part,...rest]=path;
  if(typeof part==="string")return {...(record(value)?value:{}),[part]:write(record(value)?value[part]:undefined,rest,next)};
  if(!Array.isArray(value))throw Error("The edited item no longer exists.");
  const index=value.findIndex(v=>record(v)&&v.id===part.id);
  if(index<0){if(rest.length)throw Error("The edited item no longer exists.");return next===undefined?value:[...value,structuredClone(next)];}
  if(!rest.length&&next===undefined)return value.filter((_,i)=>i!==index);
  return value.map((item,i)=>i===index?write(item,rest,next):item);
}
export function applyPreview(document:ProjectDocument,transaction:EditTransaction|null):ProjectDocument{
  if(!transaction||transaction.projectId!==document.id)return document;
  return transaction.patches.reduce((doc,patch)=>{try{return write(doc,patch.path,patch.after) as ProjectDocument;}catch{return doc;}},document);
}
export function previewEdit(transaction:EditTransaction,before:ProjectDocument,after:ProjectDocument):EditTransaction{
  const baseline=applyPreview(before,{...transaction,patches:transaction.patches.map(p=>({...p,after:p.before}))});
  return {...transaction,patches:documentDiff(baseline,after)};
}
export function commitTransaction(document:ProjectDocument,transaction:EditTransaction):{ok:true;document:ProjectDocument}|{ok:false;error:string}{
  if(document.id!==transaction.projectId)return {ok:false,error:"This edit belongs to another song."};
  if(transaction.invalid)return {ok:false,error:transaction.invalid};
  if(transaction.patches.some(p=>!equal(read(document,p.path),p.before)||p.path.some((part,i)=>typeof part!=="string"&&(i<p.path.length-1||p.before!==undefined)&&(!Array.isArray(read(document,p.path.slice(0,i)))||(read(document,p.path.slice(0,i)) as {id:string}[]).filter(v=>v.id===part.id).length!==1))))return {ok:false,error:"Another edit changed or removed this item. The newer edit is kept; reapply or discard your proposal."};
  try{return {ok:true,document:transaction.patches.reduce((doc,p)=>write(doc,p.path,p.after) as ProjectDocument,document)};}catch{return {ok:false,error:"The edited item was removed. Discard the proposal or restore the item first."};}
}
export function rebaseTransaction(document:ProjectDocument,transaction:EditTransaction):EditTransaction|null{
  for(const patch of transaction.patches)for(const [i,part]of patch.path.entries())if(typeof part!=="string"){
    const list=read(document,patch.path.slice(0,i));if(!Array.isArray(list))return null;
    const count=list.filter(v=>record(v)&&v.id===part.id).length;
    if(count!==1&&!(count===0&&i===patch.path.length-1&&patch.before===undefined))return null;
  }
  return {...transaction,patches:transaction.patches.map(p=>({...p,before:structuredClone(read(document,p.path))}))};
}
