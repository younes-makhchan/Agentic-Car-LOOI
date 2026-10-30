// Only scene-shaped collections are changed; provider settings and chat history are ignored.
export function cleanStoredScenes(items){
 return items.map(scene=>{
   const steps=scene.steps.filter(step=>['move','stop','pause','face','expression'].includes(step.kind));
   const result={...scene,steps};delete result.usesHead;
   result.animationType=steps.some(x=>x.kind==='move')?'body':'face';return result;
 }).filter(scene=>scene.steps.some(step=>['move','face','expression'].includes(step.kind)));
}
export function migrateStoredScenes(storage=globalThis.localStorage){
 if(!storage)return;
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith('looi.')||!/scenario/i.test(key))continue;
  try{const data=JSON.parse(storage.getItem(key));if(Array.isArray(data)&&data.length&&data.every(scene=>scene&&Array.isArray(scene.steps)))storage.setItem(key,JSON.stringify(cleanStoredScenes(data)));}catch{/* Leave malformed user data untouched for manual recovery. */}
 }
}
