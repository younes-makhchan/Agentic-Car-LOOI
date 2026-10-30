// SHA-256 fallback for the ESP's HTTP panel, where SubtleCrypto is unavailable.
export function sha256(buffer) {
  const input=new Uint8Array(buffer),size=Math.ceil((input.length+9)/64)*64,bytes=new Uint8Array(size);
  bytes.set(input);bytes[input.length]=128;
  const view=new DataView(bytes.buffer);view.setUint32(size-8,Math.floor(input.length/0x20000000));view.setUint32(size-4,(input.length*8)>>>0);
  const k=[],initial=[];let prime=2;
  while(k.length<64){let yes=true;for(let d=2;d*d<=prime;d++)if(prime%d===0){yes=false;break;}if(yes){if(initial.length<8)initial.push((Math.sqrt(prime)%1*0x100000000)>>>0);k.push((Math.cbrt(prime)%1*0x100000000)>>>0);}prime++;}
  const h=initial.slice(),w=new Uint32Array(64),rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let start=0;start<size;start+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(start+i*4);
    for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,z]=h;
    for(let i=0;i<64;i++){const t1=(z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
  }
  return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
