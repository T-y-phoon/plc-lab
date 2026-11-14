const el=id=>document.getElementById(id),isAWP=location.pathname.toLowerCase().startsWith('/awp/'),isBridge=location.pathname.startsWith('/bridge/'),hasTransport=isAWP||isBridge,exchangeLimit=isBridge?9000:5000;
const plant={connected:false,valid:false,preview:false,desired:{Start:false,StopOK:true,OverloadOK:true},feedback:null,queue:[],busy:false,closing:false,generation:0,abort:null,timer:null,note:''};
let link=null;
function renderPlant(){
 const canUse=hasTransport?plant.connected&&!plant.closing:true;
 for(const id of ['start','stop','overload'])el(id).disabled=!canUse;
 el('connect').disabled=!hasTransport||plant.connected||plant.busy;
 el('disconnect').disabled=!plant.connected||plant.closing;
 el('login').hidden=!isAWP;el('preview-tools').hidden=hasTransport;
 const f=plant.feedback,motor=plant.valid&&f?f.MotorCommand:null;
 el('rotor').classList.toggle('rotating',motor===true);
 el('contactor').setAttribute('fill',motor===null?'#c7d2c5':motor?'#80b149':'#c7d2c5');
 el('motor-state').textContent=motor===null?'PLC反馈未知':(plant.preview?'界面注入 · ':'PLC命令 · ')+(motor?'电机运行':'电机停止');
 el('start').classList.toggle('pressed',plant.desired.Start);el('stop').classList.toggle('pressed',!plant.desired.StopOK);
 el('overload').setAttribute('aria-pressed',String(!plant.desired.OverloadOK));el('overload').innerHTML=(plant.desired.OverloadOK?'模拟过载 FR':'恢复过载 FR')+'<br><small>OverloadOK = '+Number(plant.desired.OverloadOK)+'</small>';
 el('connection-state').textContent=plant.preview?'界面验证 · 未连接PLC':plant.connected?(plant.closing?'发送停止请求，等待PLC确认':'已连接 · PLC循环已确认'):'未连接PLC';
 el('connection-note').textContent=plant.note||(isBridge?'本地WinCC Advanced桥：先启动PLCSIM与WinCC仿真，确认VBS标签变化事件运行，再连接。':isAWP?'请先登录CPU Web服务器，再连接当前PLC。':'当前是公开网页预览。将web文件夹配置为PLC用户自定义网页后，才可连接实体PLC；普通PLCSIM V18不支持AWP。');
 el('signal-values').innerHTML=['Start','StopOK','OverloadOK','MotorCommand'].map(k=>{const input=k!=='MotorCommand',value=input?plant.desired[k]:motor,actual=f?.[k];return '<article class="signal '+(value===true?'active':'')+'"><b>'+k+' · '+(input?'网页 → PLC':'PLC → 网页')+'</b><code>DB_StartPlant.'+k+'</code><span>'+(value===null?'未知':Number(value))+(input?'；PLC回读 '+(plant.valid&&actual!==undefined?Number(actual):'未知'):'')+'</span></article>';}).join('');
 const wrong=motor===true&&f&&(!f.StopOK||!f.OverloadOK);
 const pending=plant.connected&&f&&['Start','StopOK','OverloadOK'].some(k=>plant.desired[k]!==f[k]);
 el('diagnostic').classList.toggle('warning',wrong);
 el('diagnostic').textContent=wrong?'停止/过载条件已出现，但运行命令仍为1：请检查PLC程序；网页没有替你屏蔽错误输出。':plant.preview?'界面验证：反馈来自手动注入，不是PLC。':pending?'输入已改变，等待PLC确认本帧；当前仍显示上一帧反馈。':plant.connected?'操作按钮，比较网页输入与PLC回读；电机只由MotorCommand决定。':'连接后，按启动检查PLC程序。';
}
function snapshot(){return {...plant.desired};}
function enqueueInputs(priority=false){if(!plant.connected||plant.closing)return;if(priority)plant.queue=[];plant.queue.push(snapshot());pumpPlant();}
function setField(key,value){if(plant.closing)return;plant.desired[key]=value;if(plant.preview&&plant.feedback)plant.feedback={...plant.feedback,...snapshot()};renderPlant();enqueueInputs(key==='StopOK'&&!value);}
function losePlant(message){plant.generation++;plant.abort?.abort();clearTimeout(plant.timer);plant.connected=false;plant.valid=false;plant.busy=false;plant.closing=false;plant.queue=[];plant.desired.Start=false;plant.desired.StopOK=false;plant.note=message;renderPlant();}
async function pumpPlant(){
 if(plant.busy||!plant.connected)return;
 clearTimeout(plant.timer);plant.busy=true;const generation=plant.generation;
 try{
  while(plant.queue.length&&plant.connected){
   const input=plant.queue.shift();const deadline=setTimeout(()=>plant.abort?.abort(),exchangeLimit);let r;try{r=await link.exchange(input,plant.abort.signal);}finally{clearTimeout(deadline);}
   if(generation!==plant.generation)return;plant.feedback=r;plant.valid=true;renderPlant();
  }
  plant.busy=false;
  if(plant.closing){const last=plant.feedback;losePlant(last?.MotorCommand?'已发送停止请求，但PLC仍返回运行命令1；请检查学生程序。':'PLC已确认停止请求，通信已断开。');return;}
  plant.timer=setTimeout(()=>{plant.queue.push(snapshot());pumpPlant();},500);
 }catch(error){if(generation===plant.generation)losePlant('通信中断，反馈未知：'+error.message);}
}
async function connectPlant(){
 if(!hasTransport||plant.busy||plant.connected)return;
 plant.preview=false;plant.busy=true;plant.valid=false;plant.abort=new AbortController();plant.generation++;const generation=plant.generation;
 plant.note='正在发送初始停止状态，并等待PLC循环确认…';renderPlant();
 const deadline=setTimeout(()=>plant.abort?.abort(),exchangeLimit);
 try{
  link=new StartPlantLink((...args)=>fetch(...args),isBridge?8000:4000);await link.initialize(plant.abort.signal);
  const r=await link.exchange({Start:false,StopOK:false,OverloadOK:true},plant.abort.signal);
  if(generation!==plant.generation)return;
  clearTimeout(deadline);plant.feedback=r;plant.valid=true;plant.connected=true;plant.busy=false;plant.closing=false;plant.note=(isBridge?'通过WinCC Advanced连接；VBS标签事件交换，输入确认会有采集延迟。':'')+'专用DB通信已连接；不操作物理I/Q。每次输入经PLC循环确认后才显示反馈。';
  plant.desired={Start:false,StopOK:true,OverloadOK:true};plant.queue.push(snapshot());renderPlant();pumpPlant();
 }catch(error){if(generation===plant.generation)losePlant('连接失败：'+error.message+'。请检查CPU Web登录、写权限、AWP与PLC程序。');}finally{clearTimeout(deadline);}
}
function disconnectPlant(){if(!plant.connected||plant.closing)return;plant.closing=true;plant.desired.Start=false;plant.desired.StopOK=false;plant.queue=[snapshot()];renderPlant();pumpPlant();}
function bindMomentary(id,key,pressedValue){
 const node=el(id);let held=false;
 const press=()=>{if(node.disabled||held)return;held=true;setField(key,pressedValue);};
 const release=()=>{if(!held)return;held=false;setField(key,!pressedValue);};
 node.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();node.setPointerCapture(e.pointerId);press();});
 node.addEventListener('pointerup',release);node.addEventListener('pointercancel',release);node.addEventListener('lostpointercapture',release);
 node.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)press();}});node.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();release();}});
 window.addEventListener('blur',release);
}
bindMomentary('start','Start',true);bindMomentary('stop','StopOK',false);
el('overload').onclick=()=>setField('OverloadOK',!plant.desired.OverloadOK);
el('connect').onclick=connectPlant;el('disconnect').onclick=disconnectPlant;
for(const [id,on]of [['preview-on',true],['preview-off',false]])el(id).onclick=()=>{if(hasTransport)return;plant.preview=true;plant.valid=true;plant.feedback={...snapshot(),MotorCommand:on,Ack:0};renderPlant();};
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnectPlant();});
window.addEventListener('pagehide',()=>{if(!plant.connected)return;const body=StartPlantProtocol.encode({Start:false,StopOK:false,OverloadOK:plant.desired.OverloadOK},(link.frame+1)%65536);navigator.sendBeacon('io.htm',body);});
renderPlant();
