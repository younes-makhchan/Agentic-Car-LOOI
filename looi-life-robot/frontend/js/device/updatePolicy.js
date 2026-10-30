export function compareReleaseVersions(lhs,rhs){
 const parts=s=>{const [core,pre]=s.replace(/^v/,'').split('+')[0].split(/-(.*)/s);return [core.split('.'),pre?.split('.')];};
 const number=(a,b)=>{a=a.replace(/^0+/,'');b=b.replace(/^0+/,'');return a.length===b.length?(a===b?0:a>b?1:-1):a.length>b.length?1:-1;};
 const [a,ap]=parts(lhs),[b,bp]=parts(rhs);
 for(let i=0;i<Math.max(a.length,b.length);i++){const n=number(a[i]||'0',b[i]||'0');if(n)return n;}
 if(!ap||!bp)return ap===bp?0:ap?-1:1;
 for(let i=0;i<Math.min(ap.length,bp.length);i++){if(ap[i]===bp[i])continue;const an=/^\d+$/.test(ap[i]),bn=/^\d+$/.test(bp[i]);return an&&bn?number(ap[i],bp[i]):an!==bn?(an?-1:1):ap[i]>bp[i]?1:-1;}
 return Math.sign(ap.length-bp.length);
}

export function needsMotorWiring(info){return info?.hardware_configured===false;}
export function defaultMotorWiring(info){
 if(!needsMotorWiring(info)||!['n16r8','n8r8'].includes(info.hardware_profile?.board))return null;
 return {version:1,board:info.hardware_profile.board,pins:{ena:17,in1:16,in2:15,in3:7,in4:6,enb:5}};
}
