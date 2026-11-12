const $ = id => document.getElementById(id);
const calendar = $("calendar"), monthLabel = $("monthLabel");
let viewDate = new Date(); viewDate.setDate(1);
let selectedKey = null, selectedCell = null;
let db = null, auth = null, user = null, dataRef = null, remoteData = {};
let strokes = [], currentStroke = null, tool = "pen", undoStack = [];
let saveTimer = null, syncing = false;

const todayKey = () => keyOf(new Date());
function keyOf(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function setStatus(msg,kind=""){const el=$("syncStatus");el.textContent=msg;el.className="status "+kind;}
function config(){try{return JSON.parse(localStorage.getItem("calendarFirebaseConfig")||"null")}catch{return null}}

function initFirebase(){
  const cfg=config();
  if(!cfg){setStatus("共有設定が必要です");return false}
  try{
    if(!firebase.apps.length) firebase.initializeApp(cfg);
    auth=firebase.auth(); db=firebase.database();
    return true;
  }catch(e){setStatus("Firebase設定を確認してください","error");return false}
}
async function login(){
  const cfgText=$("firebaseConfig").value.trim();
  if(cfgText){try{localStorage.setItem("calendarFirebaseConfig",JSON.stringify(JSON.parse(cfgText)))}catch(e){$("settingsMessage").textContent="Firebase設定のJSON形式が正しくありません";return}}
  if(!initFirebase()){$("settingsMessage").textContent="先にFirebase設定を保存してください";return}
  const email=$("email").value.trim(), password=$("password").value;
  if(!email||!password){$("settingsMessage").textContent="メールアドレスとパスワードを入力してください";return}
  try{
    const result=await auth.signInWithEmailAndPassword(email,password);
    user=result.user; attachSync(); $("settingsMessage").textContent="ログインしました。同期を開始します。";
  }catch(e){$("settingsMessage").textContent=errorText(e)}
}
function errorText(e){
  const map={"auth/invalid-credential":"メールアドレスまたはパスワードが違います。","auth/user-not-found":"共有アカウントがありません。Firebaseで先に作成してください。","auth/wrong-password":"パスワードが違います。","auth/invalid-email":"メールアドレスの形式を確認してください。","auth/network-request-failed":"通信状態を確認してください。"};
  return map[e.code]||`エラー：${e.message}`;
}
function attachSync(){
  if(!user||!db)return;
  if(dataRef)dataRef.off();
  dataRef=db.ref(`calendarData/${user.uid}`);
  setStatus("同期中…");
  dataRef.on("value",snap=>{
    remoteData=snap.val()||{};
    if(selectedKey && !syncing){strokes=remoteData[selectedKey]?.strokes||[];drawCanvas();undoStack=[]}
    renderCalendar();setStatus("同期済み","ok");
  },err=>setStatus("同期エラー："+err.message,"error"));
}
function saveSelected(){
  if(!selectedKey||!dataRef||!user)return;
  const payload={strokes,updatedAt:Date.now()};
  syncing=true;
  dataRef.child(selectedKey).set(payload).then(()=>{remoteData[selectedKey]=payload;renderCalendar();setStatus("保存済み・同期済み","ok")})
  .catch(e=>setStatus("保存失敗："+e.message,"error"))
  .finally(()=>syncing=false);
}
function scheduleSave(){setStatus("保存中…");clearTimeout(saveTimer);saveTimer=setTimeout(saveSelected,500)}

function renderCalendar(){
  calendar.innerHTML="";
  const year=viewDate.getFullYear(), month=viewDate.getMonth();
  monthLabel.textContent=`${year}年 ${month+1}月`;
  const first=new Date(year,month,1), start=new Date(year,month,1-first.getDay());
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    const key=keyOf(d), cell=document.createElement("button");
    cell.type="button";cell.className="day";
    if(d.getMonth()!==month)cell.classList.add("outside");
    if(key===todayKey())cell.classList.add("today");
    if(key===selectedKey)cell.classList.add("selected");
    const num=document.createElement("span");num.className="date";num.textContent=d.getDate();cell.appendChild(num);
    if(remoteData[key]?.strokes?.length){
      const img=document.createElement("canvas");img.className="preview";img.width=240;img.height=100;
      drawStrokes(img,remoteData[key].strokes);cell.appendChild(img);
    }
    cell.addEventListener("click",()=>selectDate(key,cell));
    calendar.appendChild(cell);
  }
}
function selectDate(key,cell){
  selectedKey=key;selectedCell=cell;
  $("selectedDateLabel").textContent=new Date(key+"T12:00:00").toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short"});
  $("editor").classList.remove("hidden");
  strokes=remoteData[key]?.strokes||[];undoStack=[];drawCanvas();renderCalendar();
}
const canvas=$("drawingCanvas"),ctx=canvas.getContext("2d");
function resizeCanvas(){
  const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  const old=document.createElement("canvas");old.width=canvas.width;old.height=canvas.height;old.getContext("2d").drawImage(canvas,0,0);
  canvas.width=Math.max(1,Math.round(rect.width*ratio));canvas.height=Math.max(1,Math.round(rect.height*ratio));
  ctx.setTransform(ratio,0,0,ratio,0,0);
  if(old.width&&old.height)ctx.drawImage(old,0,0,old.width,old.height,0,0,rect.width,rect.height);
  drawCanvas();
}
function drawStrokes(target,list){
  const c=target.getContext("2d"),w=target.width,h=target.height;
  c.clearRect(0,0,w,h);
  for(const s of list||[]){
    if(!s.points?.length)continue;
    c.save();c.strokeStyle=s.tool==="eraser"?"#ffffff":(s.color||"#202020");c.lineWidth=(s.width||3)*(w/600);c.lineCap="round";c.lineJoin="round";
    c.beginPath();s.points.forEach((p,i)=>{const x=p.x*w,y=p.y*h;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();c.restore();
  }
}
function drawCanvas(){
  const r=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();ctx.scale(ratio,ratio);
  for(const s of strokes){
    if(!s.points?.length)continue;
    ctx.beginPath();ctx.strokeStyle=s.tool==="eraser"?"#ffffff":(s.color||"#202020");
    ctx.lineWidth=s.tool==="eraser"?18:(s.width||2.8);ctx.lineCap="round";ctx.lineJoin="round";
    s.points.forEach((p,i)=>{const x=p.x*r.width,y=p.y*r.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
  }
  ctx.restore();
}
function point(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
canvas.addEventListener("pointerdown",e=>{
  if(!selectedKey)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);
  undoStack.push(JSON.stringify(strokes));
  currentStroke={tool,color:"#202020",width:tool==="eraser"?18:2.8,points:[point(e)]};strokes.push(currentStroke);drawCanvas();
});
canvas.addEventListener("pointermove",e=>{
  if(!currentStroke)return;e.preventDefault();currentStroke.points.push(point(e));drawCanvas();
});
function endStroke(){if(currentStroke){currentStroke=null;scheduleSave()}}
canvas.addEventListener("pointerup",endStroke);canvas.addEventListener("pointercancel",endStroke);
$("penBtn").onclick=()=>{tool="pen";$("penBtn").classList.add("active");$("eraserBtn").classList.remove("active")};
$("eraserBtn").onclick=()=>{tool="eraser";$("eraserBtn").classList.add("active");$("penBtn").classList.remove("active")};
$("undoBtn").onclick=()=>{if(undoStack.length){strokes=JSON.parse(undoStack.pop());drawCanvas();scheduleSave()}};
$("clearBtn").onclick=()=>{if(confirm("この日の書き込みをすべて消しますか？")){undoStack.push(JSON.stringify(strokes));strokes=[];drawCanvas();scheduleSave()}};
$("prevMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()-1);renderCalendar()};
$("nextMonth").onclick=()=>{viewDate.setMonth(viewDate.getMonth()+1);renderCalendar()};
$("todayBtn").onclick=()=>{viewDate=new Date();viewDate.setDate(1);selectDate(todayKey());renderCalendar()};
$("settingsBtn").onclick=()=>{$("firebaseConfig").value=JSON.stringify(config()||{},null,2);$("settingsDialog").showModal()};
$("saveConfigBtn").onclick=()=>{try{localStorage.setItem("calendarFirebaseConfig",JSON.stringify(JSON.parse($("firebaseConfig").value)));$("settingsMessage").textContent="設定を保存しました。次にログインしてください。"}catch(e){$("settingsMessage").textContent="JSON形式を確認してください。"}};
$("loginBtn").onclick=login;
$("logoutBtn").onclick=async()=>{if(auth)await auth.signOut();user=null;if(dataRef)dataRef.off();dataRef=null;remoteData={};setStatus("ログアウトしました");$("settingsMessage").textContent="ログアウトしました。"};
window.addEventListener("resize",()=>{if(!$("editor").classList.contains("hidden"))resizeCanvas()});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
renderCalendar();setTimeout(resizeCanvas,100);
if(initFirebase()){auth.onAuthStateChanged(u=>{user=u;if(u)attachSync();else setStatus("共有設定からログインしてください")})}
