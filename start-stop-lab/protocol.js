/* The transport owns only field inputs. MotorCommand and Ack are PLC-owned. */
const StartPlantProtocol=(()=>{
 const bool=v=>{if(/^(1|true)$/i.test(v))return true;if(/^(0|false)$/i.test(v))return false;throw Error('PLC布尔反馈格式错误：'+v);};
 function parse(text){
  const rows={};for(const line of text.split(/\r?\n/)){const m=line.trim().match(/^(Start|StopOK|OverloadOK|MotorCommand|Ack)=(.*)$/);if(m){if(Object.hasOwn(rows,m[1]))throw Error('PLC反馈字段重复');rows[m[1]]=m[2].trim();}}
  for(const k of ['Start','StopOK','OverloadOK','MotorCommand','Ack'])if(!Object.hasOwn(rows,k))throw Error('未收到PLC变量，请检查AWP生成、登录与权限');
  const ack=Number(rows.Ack);if(!/^\d+$/.test(rows.Ack)||!Number.isInteger(ack)||ack<0||ack>65535)throw Error('PLC帧确认无效');
  return {Start:bool(rows.Start),StopOK:bool(rows.StopOK),OverloadOK:bool(rows.OverloadOK),MotorCommand:bool(rows.MotorCommand),Ack:ack};
 }
 function encode(input,frame){return new URLSearchParams(Object.entries({...input,FrameId:frame}).map(([k,v])=>{if(!['Start','StopOK','OverloadOK','FrameId'].includes(k))throw Error('禁止写入PLC输出');return ['"DB_StartPlant".'+k,typeof v==='boolean'?String(Number(v)):String(v)];}));}
 const matches=(r,input,frame)=>r.Ack===frame&&['Start','StopOK','OverloadOK'].every(k=>r[k]===input[k]);
 return {parse,encode,matches};
})();
class StartPlantLink{
 constructor(fetcher){this.fetcher=fetcher;this.frame=0;}
 async read(signal){const r=await this.fetcher('io.htm?read='+Date.now(),{cache:'no-store',credentials:'same-origin',signal});if(!r.ok)throw Error('PLC读取失败 HTTP '+r.status);return StartPlantProtocol.parse(await r.text());}
 async initialize(signal){const r=await this.read(signal);this.frame=r.Ack;return r;}
 async exchange(input,signal){
  this.frame=(this.frame+1)%65536;const frame=this.frame;
  const post=await this.fetcher('io.htm',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:StartPlantProtocol.encode(input,frame),signal});
  if(!post.ok)throw Error('PLC写入失败 HTTP '+post.status);
  const end=Date.now()+4000;
  do{const r=await this.read(signal);if(StartPlantProtocol.matches(r,input,frame))return r;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end&&!signal?.aborted);
  throw Error('PLC未确认输入帧：检查CPU是否RUN、LabCycleEnd调用及变量写权限。');
 }
}
