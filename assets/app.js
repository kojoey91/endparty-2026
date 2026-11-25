(function(){
'use strict';
var PRIZES=[{key:5,name:'五獎',amount:2000,quota:60},{key:6,name:'六獎',amount:1000,quota:90}];
var pz=function(k){return PRIZES.find(function(p){return p.key===k})};
var money=function(n){return '$'+n.toLocaleString('en-US')};
var UI_KEY='raffle2-ui',ME_KEY='raffle2-me';
var LOGO='assets/logo.svg';
function logo(cls){return h('span',{class:'logo '+(cls||'')},h('img',{src:LOGO,alt:'國泰健康管理'}))}
var $=function(s){return document.querySelector(s)};
var noop=function(){};
var hm=function(t){try{return new Date(t).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})}catch(e){return ''}};
function normId(s){return String(s||'').replace(/[！-～]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xFEE0)}).replace(/[\s　]+/g,'').toUpperCase()}
function validId(id){return /^[A-Z0-9]{6}$/.test(id)}
function ss(fn){try{return fn(window.sessionStorage)}catch(e){return null}}
function ls(fn){try{return fn(window.localStorage)}catch(e){return null}}

function h(tag,props){
  var el=document.createElement(tag);props=props||{};
  Object.keys(props).forEach(function(k){
    var v=props[k];if(v==null||v===false)return;
    if(k==='class')el.className=v;
    else if(k==='text')el.textContent=v;
    else if(k.slice(0,2)==='on')el.addEventListener(k.slice(2),v);
    else if(k==='value')el.value=v;
    else if(v===true)el.setAttribute(k,'');
    else el.setAttribute(k,v);
  });
  for(var i=2;i<arguments.length;i++)[].concat(arguments[i]).forEach(function(c){if(c==null||c===false)return;el.append(c.nodeType?c:document.createTextNode(c))});
  return el;
}

/* ================= data ================= */
var CFG=window.RAFFLE_CONFIG||{},PAGE=window.RAFFLE_PAGE||'employee';
var saved={eventName:'',claimNote:'',final:false,showNames:false,shareUrl:'',winners:[]};
var sb=null,db=null,isEditor=false,authUser=null,authState='checking',authErr=null,authBusy=false;
var liveWinners=null,liveSettings=null,winnersOk=false,settingsOk=false,liveSlow=false,liveDead=false,rtStatus='connecting',lastFetch=0;
var downloadsNS={save:function(o){return new Promise(function(res){var blob=o.data instanceof Blob?o.data:new Blob([o.data],{type:/\.svg$/.test(o.filename)?'image/svg+xml':'text/plain'});var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=o.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},4000);res()})}};
function pick(o,k,d){return o&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:d}
function data(){
  var s=liveSettings||{};
  return {eventName:String(pick(s,'eventName',saved.eventName)||''),claimNote:String(pick(s,'claimNote',saved.claimNote)||''),
    final:!!pick(s,'final',saved.final),showNames:!!pick(s,'showNames',saved.showNames),shareUrl:String(pick(s,'shareUrl',saved.shareUrl)||''),winners:liveWinners||saved.winners};
}
function isLive(){return !!(db&&winnersOk&&!liveDead)}
function _unused_sig(d){return JSON.stringify([d.eventName,d.claimNote,!!d.final,!!d.showNames,d.shareUrl||'',d.winners.map(function(w){return w.id+'|'+w.p+'|'+w.t+'|'+(w.n||'')+'|'+(w.d||'')})])}
function byId(id){return data().winners.find(function(w){return w.id===id})}
function seqOf(id){var W=data().winners;for(var i=0;i<W.length;i++)if(W[i].id===id)return i+1;return 0}
function countP(k){return data().winners.filter(function(w){return w.p===k}).length}

/* ================= ui state ================= */
var mode='employee',atab='reg',sel=5;
var idDraft='',toast=null,toastTimer=null,pending=null,busy=false,focusSel=null;
var listFilter='',listPrize=0,delArm=null,editKey=null,editDraft='',editErr=null,editBusy=false;
var batchOpen=false,batchText='',batchRun=null;
var setDraft={},qrMsg=null;
var lastAct=Date.now();
var seen=null,freshIds={};
var qDraft='',ePrize=0,eSort='new',eShowAll=false,celebrate=null;
var ui=ss(function(s){return JSON.parse(s.getItem(UI_KEY)||'null')})||{};
if(ui.sel===5||ui.sel===6)sel=ui.sel;
atab=ui.atab==='setup'?'setup':'reg';
var me=ls(function(s){return JSON.parse(s.getItem(ME_KEY)||'null')});
qDraft=(ui.qDraft!=null?ui.qDraft:(me&&me.id))||'';
function persistUI(){ss(function(s){s.setItem(UI_KEY,JSON.stringify({mode:mode,sel:sel,atab:atab,qDraft:qDraft}))})}
function saveMe(){ls(function(s){me?s.setItem(ME_KEY,JSON.stringify(me)):s.removeItem(ME_KEY)})}
function touch(){lastAct=Date.now()}
function errText(e){
  var c=e&&e.code,m=String(e&&e.message||'');
  if(c==='23505')return '重複:這個員編已經登錄過了。';
  if(c==='42501'||/row-level security|permission/i.test(m))return '這個帳號沒有權限,請確認已用工作人員帳號登入。';
  if(c==='23514'||/check constraint/i.test(m))return '員編格式不對,須為 6 碼英數字。';
  if(/JWT|expired/i.test(m))return '登入已過期,請重新登入。';
  return '連線不穩,請再試一次。';
}
/* ================= live ================= */
function rowToW(r){var o={id:String(r.emp_id),p:Number(r.prize),t:Date.parse(r.drawn_at)||0};if(r.name)o.n=String(r.name).slice(0,40);if(r.dept)o.d=String(r.dept).slice(0,40);return o}
function fetchAll(table,cols,order){
  var out=[],step=1000;
  return (function page(from){
    var q=sb.from(table).select(cols).range(from,from+step-1);if(order)q=q.order(order,{ascending:true});
    return q.then(function(r){if(r.error)throw r.error;out=out.concat(r.data||[]);return (r.data||[]).length===step?page(from+step):out});
  })(0);
}
function loadWinners(){
  return fetchAll('winners','emp_id,prize,drawn_at,name,dept','drawn_at').then(function(rows){
    var arr=rows.filter(function(r){return validId(String(r.emp_id))&&(r.prize===5||r.prize===6)}).map(rowToW);
    arr.sort(function(a,b){return a.t-b.t||(a.id<b.id?-1:a.id>b.id?1:0)});
    liveWinners=arr;winnersOk=true;liveSlow=false;liveDead=false;lastFetch=Date.now();scheduleRender();
  });
}
function loadSettings(){
  return sb.from('settings').select('*').eq('id',1).maybeSingle().then(function(r){
    if(r.error)throw r.error;var x=r.data||{};
    liveSettings={eventName:x.event_name||'',claimNote:x.claim_note||'',final:!!x.final,showNames:!!x.show_names,shareUrl:x.share_url||''};
    settingsOk=true;scheduleRender();
  });
}
var wTimer=null,sTimer=null;
function refetchSoon(which){
  if(which==='s'){clearTimeout(sTimer);sTimer=setTimeout(function(){loadSettings().catch(noop)},250)}
  else{clearTimeout(wTimer);wTimer=setTimeout(function(){loadWinners().catch(noop)},250+Math.random()*400)}
}
function startLive(){
  var t=setTimeout(function(){if(!winnersOk){liveSlow=true;scheduleRender()}},10000);
  Promise.all([loadWinners(),loadSettings()]).then(function(){clearTimeout(t)},function(){liveDead=true;clearTimeout(t);scheduleRender()});
  try{
    sb.channel('raffle-public')
      .on('postgres_changes',{event:'*',schema:'public',table:'winners'},function(){refetchSoon('w')})
      .on('postgres_changes',{event:'*',schema:'public',table:'settings'},function(){refetchSoon('s')})
      .subscribe(function(st){
        var prev=rtStatus;rtStatus=st==='SUBSCRIBED'?'live':(st==='CLOSED'?'closed':'retry');
        if(rtStatus==='live'&&prev!=='live'){refetchSoon('w');refetchSoon('s')}
        scheduleRender();
      });
  }catch(e){rtStatus='retry'}
  /* safety net: realtime can drop or hit the connection cap with ~600 viewers, so poll as well */
  setInterval(function(){
    var gap=rtStatus==='live'?60000:12000;
    if(Date.now()-lastFetch>=gap&&!document.hidden){loadWinners().then(function(){liveDead=false},function(){liveDead=true;scheduleRender()});loadSettings().catch(noop)}
  },4000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastFetch>8000){refetchSoon('w');refetchSoon('s')}});
}
var rq=false;
function scheduleRender(){if(rq)return;rq=true;requestAnimationFrame(function(){rq=false;render()})}

/* ================= admin: roster (員工名冊, editors only) ================= */
var roster=[],rosterById={},rosterInfo=null,rosterStarted=false,rosterLoaded=false,importDraft=null,rosterMsg=null,rosterClearArm=false,candHi=-1;
function hasRoster(){return roster.length>0}
function person(id){return rosterById[id]||null}
function whoText(id){var p=person(id);return p?(p.name+(p.dept?'・'+p.dept:'')):''}
function loadRoster(){
  if(!sb||!isEditor)return Promise.resolve();
  return fetchAll('roster','emp_id,name,dept','emp_id').then(function(rows){
    roster=rows.map(function(r){return {id:String(r.emp_id),name:String(r.name||''),dept:String(r.dept||'')}});
    rosterById={};roster.forEach(function(p){rosterById[p.id]=p});
    rosterInfo=roster.length?{count:roster.length}:null;rosterLoaded=true;scheduleRender();
  });
}
function startRoster(){if(rosterStarted||!sb||!isEditor)return;rosterStarted=true;loadRoster().catch(function(e){rosterMsg={k:'err',t:'讀取名冊失敗:'+errText(e)};render()})}
function fw(s){return String(s||'').replace(/[！-～]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xFEE0)})}
function toks(raw){return fw(raw).toUpperCase().split(/[\s　,，、]+/).filter(Boolean)}
function findPeople(raw){
  var T=toks(raw);if(!T.length||!roster.length)return [];
  var out=[];
  roster.forEach(function(p){
    var nm=p.name.toUpperCase(),dp=p.dept.toUpperCase(),score=0;
    for(var i=0;i<T.length;i++){
      var t=T[i],s=0;
      if(p.id===t)s=100;else if(p.id.indexOf(t)===0)s=60;else if(nm===t)s=80;else if(nm.indexOf(t)>=0)s=40;else if(p.id.indexOf(t)>=0)s=30;else if(dp.indexOf(t)>=0)s=20;
      if(!s)return;score+=s;
    }
    out.push({p:p,s:score});
  });
  out.sort(function(a,b){return b.s-a.s||(a.p.id<b.p.id?-1:1)});
  return out.map(function(x){return x.p});
}

/* ================= admin: entry ================= */
function resolve(raw){
  var id=normId(raw);
  if(!id)return {k:'idle',t:hasRoster()?'輸入員編、姓名或部門,按 Enter 登錄':'輸入 6 碼英數字,按 Enter 登錄'};
  var dupT=function(x){var ex=byId(x.id);return ex?('重複:'+(person(x.id)?person(x.id).name+' ':'')+x.id+' 已登錄為'+pz(ex.p).name+'(第 '+seqOf(x.id)+' 筆)'):null};
  if(!hasRoster()){
    if(id.length<6&&/^[A-Z0-9]+$/.test(id))return {k:'idle',t:'還差 '+(6-id.length)+' 碼'};
    if(!validId(id))return {k:'err',t:id.length>6&&/^[A-Z0-9]+$/.test(id)?('多了 '+(id.length-6)+' 碼,員編是 6 碼'):'只能輸入英文字母與數字'};
    var d0=dupT({id:id});
    return d0?{k:'err',t:d0}:{k:'ok',target:{id:id},t:'可以登錄'};
  }
  if(validId(id)&&rosterById[id]){var p=rosterById[id],d1=dupT(p);return {k:d1?'err':'ok',target:p,cands:[p],t:d1||'名冊比對成功'}}
  var c=findPeople(raw);
  if(c.length){
    var lim=Math.min(c.length,8),hi=candHi;
    if(hi<0||hi>=lim){hi=0;for(var i=0;i<lim;i++)if(!byId(c[i].id)){hi=i;break}}
    var tg=c[hi],d2=dupT(tg);
    return {k:d2?'err':'pick',target:tg,cands:c,hi:hi,t:d2||(c.length===1?'找到 1 位,按 Enter 登錄':'找到 '+c.length+' 位,用 ↑↓ 選擇後按 Enter')};
  }
  if(validId(id)){var d3=dupT({id:id});return d3?{k:'err',t:d3}:{k:'ok',target:{id:id},t:'名冊裡沒有 '+id+'(可能是新人),可以直接登錄'}}
  return {k:'idle',t:'名冊裡找不到「'+String(raw).trim()+'」'};
}
function selectPrize(k){sel=k;pending=null;persistUI();focusSel='#idin';render()}
function showToast(t){toast=t;clearTimeout(toastTimer);if(t&&t.undo)toastTimer=setTimeout(function(){if(toast===t){toast.undo=null;refreshToast()}},12000)}
function register(force,pickId){
  if(busy)return;
  if(!isLive()){showToast({k:'err',t:'尚未連上資料庫,請稍候或重新整理頁面。'});render();return}
  var r=pickId?resolve(pickId):resolve(idDraft),p=pz(sel);
  if(r.k==='idle'||r.k==='err'){showToast({k:'err',t:r.k==='idle'&&!normId(idDraft)?'請輸入員編、姓名或部門':r.t});focusSel='#idin';render();return}
  var id=r.target.id,reasons=[];
  var cnt=countP(sel);if(cnt>=p.quota)reasons.push(p.name+'已登錄 '+cnt+' 名,已達名額 '+p.quota+' 名。');
  if(reasons.length&&!force){pending={id:id,pick:pickId,t:reasons.join(' ')+'確定還要登錄嗎?'};render();return}
  busy=true;pending=null;touch();refreshEntryState();
  var at=new Date().toISOString(),prizeKey=sel;
  sb.from('winners').insert({emp_id:id,prize:prizeKey,drawn_at:at}).then(function(res){
    busy=false;touch();
    if(!res.error){idDraft='';candHi=-1;if(!byId(id))liveWinners=(liveWinners||[]).concat([{id:id,p:prizeKey,t:Date.parse(at)}]);showToast({k:'ok',id:id,p:prizeKey,t:Date.parse(at),at:at,undo:true});refetchSoon('w')}
    else if(res.error.code==='23505'){
      sb.from('winners').select('prize').eq('emp_id',id).maybeSingle().then(function(r2){
        var pp=r2&&r2.data?pz(r2.data.prize):null;
        showToast({k:'err',id:id,t:'重複:'+id+' 已被登錄為'+(pp?pp.name:'其他獎項')+',同一個員編只能登錄一次。'});refetchSoon('w');render();
      });
    }
    else showToast({k:'err',t:errText(res.error)});
    focusSel='#idin';render();
  },function(e){busy=false;showToast({k:'err',t:errText(e)});focusSel='#idin';render()});
}
function undoLast(){
  var t=toast;if(!t||!t.undo)return;
  t.undo=null;
  sb.from('winners').delete().eq('emp_id',t.id).eq('drawn_at',t.at).select('emp_id').then(function(r){
    if(r.error){showToast({k:'err',t:errText(r.error)});render();return}
    if(r.data&&r.data.length){idDraft=t.id;showToast({k:'info',t:'已復原 '+(whoText(t.id)?whoText(t.id)+' ':'')+t.id+',可以重新輸入'});refetchSoon('w');focusSel='#idin';render()}
    else{showToast({k:'err',t:'這筆已被修改,請到右側名單處理'});render()}
  },function(e){showToast({k:'err',t:errText(e)});render()});
}
function goText(r){
  var p=pz(sel),nm=r&&r.target&&person(r.target.id);
  if(busy)return '登錄中…';
  return '登錄'+(nm?' '+nm.name+' →':'')+' '+p.name+' '+money(p.amount);
}
function candsNode(r){
  if(!r.cands||!r.cands.length||(r.cands.length===1&&r.k==='ok'&&normId(idDraft)===r.cands[0].id&&!hasRoster()))return null;
  var shown=r.cands.slice(0,8);
  return h('div',{class:'cands',role:'listbox','aria-label':'符合的人'},
    shown.map(function(p,i){
      var ex=byId(p.id),on=p===r.target;
      return h('button',{type:'button',role:'option','aria-selected':on?'true':'false',class:'cand'+(on?' on':'')+(ex?' won':''),disabled:!!ex,
        onmouseenter:function(){if(candHi!==i){candHi=i;refreshEntryState()}},
        onclick:function(){candHi=i;register(false,p.id)}},
        h('span',{class:'cn',text:p.name||'(未填姓名)'}),
        h('span',{class:'cd',text:p.dept||''}),
        h('span',{class:'mono ci',text:p.id}),
        ex?h('span',{class:'pill p'+ex.p,text:'已中'+pz(ex.p).name}):(on?h('kbd',{text:'Enter'}):h('span')));
    }),
    r.cands.length>8?h('p',{class:'hint more-c',text:'還有 '+(r.cands.length-8)+' 位,多打幾個字可以縮小範圍(例如「資訊 王」)'}):null);
}
function refreshEntryState(){
  var r=resolve(idDraft),st=$('#idstat'),len=$('#idlen'),go=$('#go'),cb=$('#cbox');
  if(st){st.className='idstat '+(r.k==='pick'?'ok':r.k==='warn'?'idle':r.k);st.textContent=r.t}
  if(len){var n=normId(idDraft);len.textContent=/^[A-Z0-9]*$/.test(n)?n.length+'/6':'';}
  if(go){go.disabled=busy||r.k==='err';go.textContent=goText(r)}
  if(cb)cb.replaceChildren(candsNode(r)||'');
}
function refreshToast(){var b=$('#toastbox');if(b)b.replaceChildren(toastNode()||'')}
function toastNode(){
  if(pending)return h('div',{class:'toast err',role:'alert'},h('span',{class:'t',text:pending.t}),
    h('button',{type:'button',class:'btn small danger',onclick:function(){register(true,pending&&pending.pick)},text:'仍要登錄'}),
    h('button',{type:'button',class:'btn small',onclick:function(){pending=null;focusSel='#idin';render()},text:'取消'}));
  if(!toast)return null;
  if(toast.k==='ok'){var p=pz(toast.p),w=person(toast.id);
    return h('div',{class:'toast ok',role:'status'},
      h('span',{class:'t'},'已登錄 ',w?h('b',{text:w.name+(w.dept?'('+w.dept+')':'')+' '}):null,h('span',{class:'mono',text:toast.id}),' → '+p.name+' '+money(p.amount)),
      toast.undo?h('button',{type:'button',class:'btn small',onclick:undoLast,text:'復原'}):null);
  }
  return h('div',{class:'toast '+(toast.k==='info'?'ok':'err'),role:toast.k==='err'?'alert':'status'},h('span',{class:'t',text:toast.t}));
}
function entryCard(){
  var tiles=PRIZES.map(function(p){
    var n=countP(p.key),fill=h('i');fill.style.width=Math.min(100,n/p.quota*100)+'%';
    return h('button',{type:'button',role:'radio',class:'prize p'+p.key,'aria-checked':sel===p.key?'true':'false',onclick:function(){selectPrize(p.key)}},
      h('span',{class:'nm'},h('span',{text:p.name}),n>=p.quota?h('span',{class:'pill',text:'已滿'}):null),
      h('span',{class:'amt',text:money(p.amount)}),
      h('span',{class:'cnt'},'已登錄 ',h('b',{text:String(n)}),' / '+p.quota+' 名'),
      h('span',{class:'bar'},fill));
  });
  var r=resolve(idDraft);
  var input=h('input',{id:'idin',type:'text',class:'id-input'+(hasRoster()?' wide':''),maxlength:'40',autocomplete:'off',autocapitalize:'characters',spellcheck:'false',
    role:'combobox','aria-expanded':r.cands&&r.cands.length?'true':'false','aria-describedby':'idstat',
    placeholder:hasRoster()?'輸入員編、姓名或部門':'輸入抽出的員工編號',value:idDraft,
    oninput:function(e){idDraft=e.target.value;candHi=-1;touch();if(pending){pending=null;refreshToast()}refreshEntryState()},
    onkeydown:function(e){
      var rr=resolve(idDraft),list=rr.cands&&rr.cands.length>1;
      if((e.key==='ArrowUp'||e.key==='ArrowDown')&&list){e.preventDefault();var n=Math.min(rr.cands.length,8);candHi=((rr.hi||0)+(e.key==='ArrowDown'?1:n-1))%n;refreshEntryState()}
      else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();selectPrize(sel===5?6:5)}
      else if(e.key==='Escape'){idDraft='';candHi=-1;e.target.value='';refreshEntryState()}
    }});
  var n0=normId(idDraft);
  return h('section',{class:'card entry','aria-label':'登錄中獎者'},
    h('div',{class:'prizes',role:'radiogroup','aria-label':'獎項'},tiles),
    h('form',{class:'stack',onsubmit:function(e){e.preventDefault();register(false)}},
      h('label',{class:'lbl',for:'idin',text:hasRoster()?'員編／姓名／部門':'員工編號'}),
      h('div',{class:'idbox'},input,h('span',{id:'idlen',class:'len',text:/^[A-Z0-9]*$/.test(n0)?n0.length+'/6':''})),
      h('div',{id:'cbox'},candsNode(r)),
      h('div',{id:'idstat',class:'idstat '+(r.k==='pick'?'ok':r.k==='warn'?'idle':r.k),'aria-live':'polite',text:r.t}),
      h('button',{id:'go',type:'submit',class:'btn primary go',disabled:busy||r.k==='err',text:goText(r)})),
    h('div',{id:'toastbox'},toastNode()),
    h('div',{class:'keys'},h('span',{},h('kbd',{text:'Enter'}),' 登錄'),
      hasRoster()?h('span',{},h('kbd',{text:'↑'}),h('kbd',{text:'↓'}),' 選人'):h('span',{},h('kbd',{text:'↑'}),h('kbd',{text:'↓'}),' 切換獎項'),
      h('span',{},h('kbd',{text:'Esc'}),' 清空')),
    !hasRoster()&&rosterStarted?h('p',{class:'hint'},'想用姓名或部門找人?到「名單設定」匯入員工名冊。'):null,
    batchSection());
}

/* ---- batch ---- */
function batchResolve(tok){
  var id=normId(tok);
  if(validId(id))return {id:id};
  if(hasRoster()){var m=roster.filter(function(p){return p.name===String(tok).trim()});if(m.length===1)return {id:m[0].id,from:tok};if(m.length>1)return {bad:'同名 '+m.length+' 位,請改用員編'}}
  return {bad:'找不到'};
}
function batchItems(){
  var seenIn={};
  return String(batchText||'').split(/[\n\r\t,，、;；]+/).map(function(s){return s.trim()}).filter(Boolean).map(function(tok){
    var r=batchResolve(tok),id=r.id||normId(tok),st='ok',why='';
    if(r.bad){st='bad';why=r.bad}
    else if(seenIn[id]){st='bad';why='貼上內容重複'}
    else if(byId(id)){st='bad';why='已登錄為'+pz(byId(id).p).name}
    if(r.id)seenIn[id]=1;
    if(batchRun&&batchRun.done[id])st='done';
    var w=person(id);
    return {id:id,st:st,why:why,label:w?(w.name+' '+id):(r.bad?tok:id)};
  });
}
function batchSection(){
  var items=batchItems(),okN=items.filter(function(x){return x.st==='ok'}).length,badN=items.filter(function(x){return x.st==='bad'}).length;
  var p=pz(sel),over=countP(sel)+okN-p.quota;
  var d=h('details',{class:'batch',open:batchOpen},
    h('summary',{text:'一次貼上多筆(補登用)'}),
    h('div',{class:'stack',style:'margin-top:10px'},
      h('p',{class:'hint',text:'從紙本或 Excel 貼上,一行一筆。'+(hasRoster()?'可以貼員編或姓名(同名的請用員編)。':'')+'會全部登錄為目前選的'+p.name+'。'}),
      h('textarea',{id:'bt','aria-label':'批次貼上',spellcheck:'false',value:batchText,placeholder:'例如:\nA12345\nB23456',
        oninput:function(e){batchText=e.target.value;batchRun=null;touch();refreshBatch()}}),
      h('div',{id:'bprev'},batchPreview(items,okN,badN,over))));
  d.addEventListener('toggle',function(){batchOpen=d.open});
  return d;
}
function batchPreview(items,okN,badN,over){
  if(!items.length)return batchRun&&batchRun.msg?h('div',{class:'note '+(batchRun.err?'err':'ok'),text:batchRun.msg}):h('span');
  var p=pz(sel),running=batchRun&&batchRun.running;
  return h('div',{class:'stack'},
    h('div',{class:'bitems'},items.map(function(x){return h('span',{class:'bit '+x.st,title:x.why||null,text:x.label})})),
    h('p',{class:'hint'},'可登錄 '+okN+' 筆'+(badN?',略過 '+badN+' 筆(劃線的是找不到、同名或已登錄,滑過去可看原因)':'')+(over>0?'。登錄後會超過'+p.name+'名額 '+over+' 名':'')),
    batchRun&&batchRun.msg?h('div',{class:'note '+(batchRun.err?'err':'ok'),text:batchRun.msg}):null,
    h('div',{class:'row'},
      h('button',{type:'button',class:'btn primary small',disabled:!okN||running,onclick:runBatch,text:running?'登錄中 '+batchRun.n+'/'+batchRun.total:'登錄 '+okN+' 筆為'+p.name}),
      h('button',{type:'button',class:'btn small ghost',disabled:running,onclick:function(){batchText='';batchRun=null;render()},text:'清空'})));
}
function refreshBatch(){var b=$('#bprev');if(!b)return;var items=batchItems();var okN=items.filter(function(x){return x.st==='ok'}).length;b.replaceChildren(batchPreview(items,okN,items.filter(function(x){return x.st==='bad'}).length,countP(sel)+okN-pz(sel).quota))}
function runBatch(){
  if(!isLive())return;
  var ids=batchItems().filter(function(x){return x.st==='ok'}).map(function(x){return x.id});
  var p=sel,run={running:true,n:0,total:ids.length,done:{},fail:[]};batchRun=run;refreshBatch();
  var i=0,base=Date.now();
  (function next(){
    if(i>=ids.length){
      run.running=false;
      run.msg='已登錄 '+Object.keys(run.done).length+' 筆'+pz(p).name+(run.fail.length?';失敗 '+run.fail.length+' 筆:'+run.fail.join('、'):'');
      run.err=!!run.fail.length;touch();
      if(!run.fail.length)batchText='';
      refetchSoon('w');render();return;
    }
    var id=ids[i++];
    sb.from('winners').insert({emp_id:id,prize:p,drawn_at:new Date(base+i).toISOString()}).then(function(r){if(!r.error)run.done[id]=1;else run.fail.push(id)},function(){run.fail.push(id)})
      .then(function(){run.n=i;touch();refreshBatch();setTimeout(next,120)});
  })();
}

/* ---- list ---- */
function listRows(){
  var W=data().winners,f=normId(listFilter),ft=fw(listFilter).trim().toUpperCase();
  var rows=W.map(function(w,i){return {w:w,i:i}}).filter(function(r){
    if(listPrize&&r.w.p!==listPrize)return false;
    if(!ft)return true;
    var pp=person(r.w.id);
    return r.w.id.indexOf(f)>=0||(pp&&(pp.name.toUpperCase().indexOf(ft)>=0||pp.dept.toUpperCase().indexOf(ft)>=0));
  }).reverse();
  if(!rows.length)return [h('div',{class:'empty',text:W.length?'沒有符合的人':'還沒有登錄任何中獎者。從左邊開始登錄第一筆。'})];
  return rows.map(function(r){
    var w=r.w,p=pz(w.p),armed=delArm===w.id,pp=person(w.id);
    if(editKey===w.id){
      var ein=h('input',{id:'editin',type:'text',class:'id-input',maxlength:'12',autocomplete:'off',autocapitalize:'characters',spellcheck:'false','aria-label':'修改員工編號',value:editDraft,
        oninput:function(e){editDraft=e.target.value;touch();if(editErr){editErr=null;var m=$('#editerr');if(m)m.remove()}},
        onkeydown:function(e){if(e.key==='Enter'){e.preventDefault();saveEdit(w)}else if(e.key==='Escape')cancelEdit()}});
      var np=person(normId(editDraft));
      return h('div',{class:'lrow p'+w.p},
        h('span',{class:'idx',text:String(r.i+1)}),h('span',{class:'pill',text:p.name}),
        h('div',{class:'edit'},ein,np&&normId(editDraft)!==w.id?h('div',{class:'hint',style:'margin-top:4px',text:'→ '+whoText(np.id)}):null,editErr?h('div',{id:'editerr',class:'note err',style:'margin-top:6px',text:editErr}):null),
        h('span',{class:'row nowrap'},
          h('button',{type:'button',class:'btn primary small',disabled:editBusy,onclick:function(){saveEdit(w)},text:'儲存'}),
          h('button',{type:'button',class:'btn small',onclick:cancelEdit,text:'取消'})));
    }
    return h('div',{class:'lrow p'+w.p+(freshIds[w.id]?' fresh':'')},
      h('span',{class:'idx',text:String(r.i+1)}),h('span',{class:'pill',text:p.name}),
      h('span',{class:'who'},
        pp?h('span',{class:'nmrow'},h('b',{text:pp.name}),pp.dept?h('span',{class:'dp',text:pp.dept}):null):null,
        h('span',{class:'mono',text:w.id}),
        h('span',{class:'tm',text:money(p.amount)+'・'+hm(w.t)})),
      armed
        ?h('span',{class:'row nowrap'},
            h('button',{type:'button',class:'btn danger small',onclick:function(){removeWinner(w)},text:'確定刪除'}),
            h('button',{type:'button',class:'btn small',onclick:function(){delArm=null;renderList()},text:'取消'}))
        :h('span',{class:'row nowrap'},
            h('button',{type:'button',class:'btn small ghost','aria-label':'修改 '+w.id,onclick:function(){startEdit(w)},text:'修改'}),
            h('button',{type:'button',class:'btn small ghost','aria-label':'刪除 '+w.id,onclick:function(){delArm=w.id;renderList()},text:'刪除'})));
  });
}
function renderList(){var b=$('#lbody');if(b)b.replaceChildren.apply(b,listRows())}
function startEdit(w){editKey=w.id;editDraft=w.id;editErr=null;delArm=null;renderList();var el=$('#editin');if(el){el.focus();el.select()}}
function cancelEdit(){editKey=null;editErr=null;renderList()}
function saveEdit(w){
  if(editBusy)return;
  var nid=normId(editDraft);
  function fail(t){editBusy=false;editErr=t;renderList();var el=$('#editin');if(el)el.focus()}
  if(!validId(nid))return fail('員工編號須為 6 碼英數字(目前是 '+nid.length+' 碼)');
  if(nid===w.id){cancelEdit();return}
  var ex=byId(nid);if(ex)return fail('重複:'+nid+' 已登錄為'+pz(ex.p).name);
  editBusy=true;touch();
  sb.from('winners').update({emp_id:nid}).eq('emp_id',w.id).then(function(r){
    if(r.error)return fail(r.error.code==='23505'?'重複:'+nid+' 已經登錄過了':errText(r.error));
    editBusy=false;editKey=null;touch();refetchSoon('w');render();
  },function(e){fail(errText(e))});
}
function removeWinner(w){delArm=null;touch();sb.from('winners').delete().eq('emp_id',w.id).then(function(r){if(r.error){showToast({k:'err',t:'刪除失敗:'+errText(r.error)});render()}else refetchSoon('w')},function(e){showToast({k:'err',t:'刪除失敗:'+errText(e)});render()});render()}
function csvCell(v){v=String(v==null?'':v);return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function exportCsv(){
  var W=data().winners,lines=['序號,員工編號,姓名,部門,獎項,金額,登錄時間'];
  W.forEach(function(w,i){var p=pz(w.p),pp=person(w.id)||{},d=new Date(w.t);lines.push([i+1,w.id,pp.name||'',pp.dept||'',p.name,p.amount,d.toLocaleString('zh-TW',{hour12:false})].map(csvCell).join(','))});
  var name=(data().eventName.replace(/\s+/g,'')||'摸彩')+'_中獎名單.csv';
  downloadsNS.save({filename:name,data:new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv'})}).then(function(){showToast({k:'info',t:'已匯出 '+name});refreshToast()},function(e){if(!(e&&e.code==='declined')){showToast({k:'err',t:'無法在這個畫面匯出檔案'});refreshToast()}});
}
function listCard(){
  var W=data().winners;
  var chip=function(k,label,n){return h('button',{type:'button',class:'chip','aria-pressed':listPrize===k?'true':'false',onclick:function(){listPrize=k;renderList();var cs=document.querySelectorAll('#lchips .chip');[].forEach.call(cs,function(c,i){c.setAttribute('aria-pressed',[0,5,6][i]===k?'true':'false')})}},label,h('b',{text:String(n)}))};
  return h('section',{class:'card','aria-label':'已登錄名單'},
    h('div',{class:'lhead'},h('h2',{},'已登錄名單',h('span',{class:'count',text:String(W.length)})),
      downloadsNS&&W.length?h('button',{type:'button',class:'btn small',onclick:exportCsv,text:'匯出 CSV'}):null),
    h('div',{class:'ltools'},
      h('div',{id:'lchips',class:'chips'},chip(0,'全部',W.length),chip(5,'五獎',countP(5)),chip(6,'六獎',countP(6))),
      h('input',{id:'lf',type:'text','aria-label':'篩選名單',placeholder:hasRoster()?'篩選員編、姓名或部門':'篩選員編,例如 A12',value:listFilter,spellcheck:'false',oninput:function(e){listFilter=e.target.value;renderList()}})),
    h('div',{id:'lbody',class:'list'},listRows()),
    h('p',{class:'hint',style:'margin-top:10px',text:'所有工作人員看到同一份即時名單。最新的在最上面;別人登錄的也會亮一下。'}),
    W.length?h('div',{id:'wipe',class:'wipe'},wipeNode()):null);
}
/* quiet "clear all" for test runs: a faint text link, then an explicit second confirmation */
var wipeArm=false,wipeBusy=false;
function wipeNode(){
  var n=data().winners.length;
  if(!wipeArm)return h('button',{type:'button',class:'wipe-link',onclick:function(){wipeArm=true;refreshWipe()},text:'清空全部(測試用)'});
  return h('div',{class:'wipe-confirm',role:'alert'},
    h('span',{text:'確定刪除全部 '+n+' 筆中獎紀錄?刪除後無法復原。'}),
    h('span',{class:'row nowrap'},
      h('button',{type:'button',class:'btn small danger',disabled:wipeBusy,onclick:wipeAll,text:wipeBusy?'刪除中…':'確定清空'}),
      h('button',{type:'button',class:'btn small',disabled:wipeBusy,onclick:function(){wipeArm=false;refreshWipe()},text:'取消'})));
}
function refreshWipe(){var b=$('#wipe');if(b)b.replaceChildren(wipeNode())}
function wipeAll(){
  if(wipeBusy||!sb)return;wipeBusy=true;refreshWipe();touch();
  sb.from('winners').delete().neq('emp_id','').then(function(r){
    wipeBusy=false;wipeArm=false;
    if(r.error){showToast({k:'err',t:'清空失敗:'+errText(r.error)})}
    else{liveWinners=[];toast=null;showToast({k:'info',t:'已清空全部中獎紀錄'});refetchSoon('w')}
    render();
  },function(e){wipeBusy=false;showToast({k:'err',t:'清空失敗:'+errText(e)});render()});
}
function _listCardEnd(){
  return null;
}

/* ---- roster import ---- */
function parseCSV(text){
  text=String(text||'').replace(/^﻿/,'');
  var first=text.split(/\r?\n/)[0]||'',delim=first.indexOf('\t')>=0?'\t':(first.indexOf(',')>=0||first.indexOf('，')<0?',':'，');
  var rows=[],row=[],f='',q=false;
  for(var i=0;i<text.length;i++){
    var c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"'&&f==='')q=true;
    else if(c===delim){row.push(f);f=''}
    else if(c==='\n'){row.push(f);rows.push(row);row=[];f=''}
    else if(c!=='\r')f+=c;
  }
  if(f||row.length){row.push(f);rows.push(row)}
  return rows.map(function(r){return r.map(function(x){return x.trim()})}).filter(function(r){return r.some(Boolean)});
}
function buildRoster(rows){
  if(!rows.length)return {people:[],bad:[],err:'檔案是空的'};
  var H=rows[0],ci=-1,ni=-1,di=-1;
  H.forEach(function(x,i){
    if(ci<0&&/員編|員工編號|員工代號|工號|編號|^id$|emp/i.test(x))ci=i;
    else if(ni<0&&/姓名|名字|^name$|員工姓名/i.test(x))ni=i;
    else if(di<0&&/部門|單位|處別|課別|組別|dept|department/i.test(x))di=i;
  });
  var hasHead=ci>=0||ni>=0||di>=0,body=hasHead?rows.slice(1):rows;
  if(ci<0){
    var w=H.length,best=-1,bs=0;
    for(var j=0;j<w;j++){var s=body.slice(0,50).filter(function(r){return validId(normId(r[j]))}).length;if(s>bs){bs=s;best=j}}
    ci=best;
  }
  if(ci<0)return {people:[],bad:[],err:'找不到員編欄位。第一列請放欄位名稱,例如「員編,姓名,部門」。'};
  var rest=H.map(function(_,i){return i}).filter(function(i){return i!==ci&&i!==ni&&i!==di});
  if(ni<0)ni=rest.shift();if(ni==null)ni=-1;
  if(di<0)di=rest.shift();if(di==null)di=-1;
  var people=[],bad=[],seenId={};
  body.forEach(function(r,k){
    var line=k+(hasHead?2:1),id=normId(r[ci]),nm=ni>=0?(r[ni]||''):'',dp=di>=0?(r[di]||''):'';
    if(!validId(id)){bad.push({line:line,why:'員編「'+(r[ci]||'空白')+'」不是 6 碼英數字'});return}
    if(seenId[id]){bad.push({line:line,why:id+' 重複出現,只保留第一筆'});return}
    seenId[id]=1;people.push({id:id,name:nm.slice(0,40),dept:dp.slice(0,40)});
  });
  return {people:people,bad:bad,cols:{id:hasHead?H[ci]:'第 '+(ci+1)+' 欄',name:ni>=0?(hasHead?H[ni]:'第 '+(ni+1)+' 欄'):'(無)',dept:di>=0?(hasHead?H[di]:'第 '+(di+1)+' 欄'):'(無)'}};
}
function decodeBuf(buf){
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(e){}
  try{return new TextDecoder('big5').decode(buf)}catch(e){}
  return new TextDecoder().decode(buf);
}
function loadRosterText(text,src){importDraft=buildRoster(parseCSV(text));importDraft.src=src;rosterMsg=null;touch();render()}
function doImport(){
  var D=importDraft;if(!D||!D.people.length||D.running||!sb)return;
  var P=D.people,CH=500;D.running=true;render();
  sb.from('roster').delete().neq('emp_id','').then(function(r){
    if(r.error)throw r.error;
    var k=0;
    return (function next(){
      if(k>=P.length)return null;
      var part=P.slice(k,k+CH).map(function(p){return {emp_id:p.id,name:p.name,dept:p.dept}});k+=CH;
      return sb.from('roster').insert(part).then(function(r2){if(r2.error)throw r2.error;return next()});
    })();
  }).then(function(){importDraft=null;rosterMsg={k:'ok',t:'已匯入 '+P.length+' 人。現在登錄時可以輸入姓名或部門。'};return loadRoster()})
    .then(function(){refetchSoon('w');render()},function(e){D.running=false;rosterMsg={k:'err',t:'匯入中斷:'+errText(e)+' 請再按一次匯入。'};render()});
}
function clearRoster(){
  if(!sb)return;rosterClearArm=false;
  sb.from('roster').delete().neq('emp_id','').then(function(r){if(r.error)throw r.error;rosterMsg={k:'ok',t:'已清除名冊。'};return loadRoster()})
    .then(function(){refetchSoon('w');render()},function(e){rosterMsg={k:'err',t:errText(e)};render()});
}
function downloadTemplate(){
  var csv='\ufeff員編,姓名,部門\r\nA00001,王小明,資訊部\r\nA00002,陳美玲,人資部\r\nB00003,林大同,行銷部\r\n';
  downloadsNS.save({filename:'員工名冊範本.csv',data:new Blob([csv],{type:'text/csv'})}).then(function(){rosterMsg={k:'ok',t:'已下載範本:員工名冊範本.csv。把範例三列換成真實資料後再匯入。'};render()},function(e){if(!(e&&e.code==='declined')){rosterMsg={k:'err',t:'無法在這個畫面下載,請照「員編、姓名、部門」三欄自己建一個 CSV。'};render()}});
}
function rosterCard(){
  var D=importDraft;
  var file=h('input',{id:'rfile',type:'file',accept:'.csv,.txt,text/csv',class:'sr',
    onchange:function(e){var f=e.target.files&&e.target.files[0];if(!f)return;f.arrayBuffer().then(function(b){loadRosterText(decodeBuf(b),f.name)});e.target.value=''}});
  var info=hasRoster()?h('div',{class:'rinfo'},h('span',{class:'count',text:String(roster.length)}),' 人',null)
    :h('p',{class:'hint',text:'還沒有名冊。匯入後,登錄時輸入姓名或部門也能找到人。'});
  var prev=null;
  if(D){
    if(D.err)prev=h('div',{class:'note err',text:D.err});
    else prev=h('div',{class:'stack rprev'},
      h('p',{class:'hint'},'欄位對應:員編 ← ',h('b',{text:D.cols.id}),'、姓名 ← ',h('b',{text:D.cols.name}),'、部門 ← ',h('b',{text:D.cols.dept})),
      h('div',{class:'rtable'},h('div',{class:'rr rh'},h('span',{text:'員編'}),h('span',{text:'姓名'}),h('span',{text:'部門'})),
        D.people.slice(0,5).map(function(p){return h('div',{class:'rr'},h('span',{class:'mono',text:p.id}),h('span',{text:p.name}),h('span',{text:p.dept}))}),
        D.people.length>5?h('div',{class:'rr more',text:'⋯ 共 '+D.people.length+' 人'}):null),
      D.bad.length?h('div',{class:'note err'},'有 '+D.bad.length+' 列會略過:',h('ul',{},D.bad.slice(0,5).map(function(b){return h('li',{text:'第 '+b.line+' 列:'+b.why})})),D.bad.length>5?'⋯':null):null,
      h('div',{class:'row'},
        h('button',{type:'button',class:'btn primary',disabled:!D.people.length||D.running,onclick:doImport,text:D.running?'匯入中…':'匯入 '+D.people.length+' 人'+(hasRoster()?'(取代目前名冊)':'')}),
        h('button',{type:'button',class:'btn ghost',disabled:D.running,onclick:function(){importDraft=null;render()},text:'取消'})));
  }
  return h('section',{class:'card stack'},
    h('div',{class:'lhead',style:'margin:0'},h('h2',{text:'員工名冊'}),downloadsNS?h('button',{type:'button',class:'btn small',onclick:downloadTemplate,text:'下載 CSV 範本'}):null),info,
    h('div',{class:'row'},h('label',{class:'btn',for:'rfile',text:'選擇 CSV 檔'}),file,
      hasRoster()?(rosterClearArm
        ?h('span',{class:'row nowrap'},h('button',{type:'button',class:'btn small danger',onclick:clearRoster,text:'確定清除'}),h('button',{type:'button',class:'btn small',onclick:function(){rosterClearArm=false;render()},text:'取消'}))
        :h('button',{type:'button',class:'btn small ghost',onclick:function(){rosterClearArm=true;render()},text:'清除名冊'})):null),
    h('details',{class:'batch'},h('summary',{text:'或直接從 Excel 複製貼上'}),
      h('div',{class:'stack',style:'margin-top:10px'},
        h('textarea',{id:'rpaste','aria-label':'貼上名冊',spellcheck:'false',placeholder:'員編\t姓名\t部門\nA12345\t王小明\t資訊部'}),
        h('button',{type:'button',class:'btn small',onclick:function(){var t=$('#rpaste');if(t&&t.value.trim())loadRosterText(t.value,'貼上')},text:'讀取貼上的內容'}))),
    prev,
    rosterMsg?h('div',{class:'note '+rosterMsg.k,text:rosterMsg.t}):null,
    h('p',{class:'hint',text:'第一列放欄位名稱(員編、姓名、部門),Excel 存成 CSV 即可,中文編碼會自動判斷。名冊只有管理頁看得到,員工查詢頁仍然只顯示員編。'}));
}
/* ================= admin: settings & QR ================= */
var namesMsg=null;
function setShowNames(v){
  saveSetting('showNames',v);
  namesMsg={k:'ok',t:v?(hasRoster()?'已開啟:中獎者的姓名與部門會自動帶到員工頁。':'已開啟。匯入名冊後,中獎者的姓名與部門會自動帶到員工頁。'):'已關閉:員工頁上的姓名與部門會自動移除。'};render();
}
function saveSetting(k,v){
  if(!sb)return;
  var col={eventName:'event_name',claimNote:'claim_note',final:'final',showNames:'show_names',shareUrl:'share_url'}[k],body={};body[col]=v;touch();
  liveSettings=Object.assign({},liveSettings||{});liveSettings[k]=v;render();
  sb.from('settings').update(body).eq('id',1).select('id').then(function(r){
    delete setDraft[k];
    if(r.error||!r.data||!r.data.length){showToast({k:'err',t:r.error?errText(r.error):'沒有權限修改設定'});}
    refetchSoon('s');refetchSoon('w');render();
  },function(e){delete setDraft[k];showToast({k:'err',t:errText(e)});refetchSoon('s');render()});
}
function setInput(k,props){
  var d=data();
  return Object.assign({value:pick(setDraft,k,d[k]),oninput:function(e){setDraft[k]=e.target.value;touch()},
    onchange:function(e){var v=e.target.value.replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();if(v===d[k]){delete setDraft[k];return}setDraft[k]=e.target.value;saveSetting(k,v)}},props);
}
function qrModules(url){var qr=qrcode(0,'M');qr.addData(url);qr.make();return {n:qr.getModuleCount(),dark:function(r,c){return qr.isDark(r,c)}}}
function validUrl(u){return /^https?:\/\/\S+$/i.test(u||'')}
function qrPath(m,g){var d='';for(var r=0;r<m.n;r++)for(var c=0;c<m.n;c++)if(m.dark(r,c))d+='M'+(c+g)+' '+(r+g)+'h1v1h-1z';return d}
function qrNode(url){
  if(typeof qrcode==='undefined')return h('p',{class:'hint',text:'QR Code 元件載入失敗,請重新整理頁面。'});
  if(!validUrl(url))return h('p',{class:'hint',text:'貼上分享連結後,QR Code 會出現在這裡。'});
  try{var m=qrModules(url),g=4,size=m.n+g*2,ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 '+size+' '+size);svg.setAttribute('shape-rendering','crispEdges');svg.setAttribute('role','img');svg.setAttribute('aria-label','中獎查詢頁面的 QR Code');
    var bg=document.createElementNS(ns,'rect');bg.setAttribute('width',size);bg.setAttribute('height',size);bg.setAttribute('fill','#ffffff');
    var path=document.createElementNS(ns,'path');path.setAttribute('d',qrPath(m,g));path.setAttribute('fill','#000000');svg.append(bg,path);return svg;
  }catch(e){return h('p',{class:'hint',text:'這個網址太長,無法產生 QR Code。'})}
}
function saveFile(name,blob){downloadsNS.save({filename:name,data:blob}).then(function(){qrMsg='已儲存 '+name;showQrMsg()},function(e){qrMsg=e&&e.code==='declined'?'已取消儲存。':'無法在這個畫面儲存檔案,請改用截圖。';showQrMsg()})}
function showQrMsg(){var el=$('#qrmsg');if(el){el.textContent=qrMsg||'';el.hidden=!qrMsg}}
function downloadPng(){var u=data().shareUrl;if(!downloadsNS||!validUrl(u))return;
  try{var m=qrModules(u),g=4,size=m.n+g*2,px=Math.max(4,Math.floor(1200/size)),cv=document.createElement('canvas');cv.width=cv.height=px*size;
    var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);ctx.fillStyle='#000';
    for(var r=0;r<m.n;r++)for(var c=0;c<m.n;c++)if(m.dark(r,c))ctx.fillRect((c+g)*px,(r+g)*px,px,px);
    cv.toBlob(function(b){if(b)saveFile('摸彩QRCode.png',b)},'image/png');}catch(e){qrMsg='產生圖片失敗。';showQrMsg()}}
function downloadSvg(){var u=data().shareUrl;if(!downloadsNS||!validUrl(u))return;
  try{var m=qrModules(u),g=4,size=m.n+g*2;saveFile('摸彩QRCode.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" width="1024" height="1024" shape-rendering="crispEdges"><rect width="'+size+'" height="'+size+'" fill="#ffffff"/><path d="'+qrPath(m,g)+'" fill="#000000"/></svg>')}catch(e){qrMsg='產生圖片失敗。';showQrMsg()}}
function settingsView(){
  var d=data();
  var acts=h('div',{class:'row'},h('button',{type:'button',class:'btn small',onclick:downloadPng,text:'儲存 PNG'}),h('button',{type:'button',class:'btn small',onclick:downloadSvg,text:'儲存 SVG(印刷用)'}));
  acts.hidden=!(validUrl(d.shareUrl)&&downloadsNS&&typeof qrcode!=='undefined');
  var m=h('p',{id:'qrmsg',class:'hint',role:'status'});m.hidden=true;
  return h('div',{class:'sgrid'},
    h('div',{class:'col'},h('section',{class:'card stack'},
      h('h2',{text:'活動設定'}),
      h('div',{class:'field'},h('label',{class:'lbl',for:'sname',text:'活動名稱'}),h('textarea',setInput('eventName',{id:'sname',class:'ename',rows:'2'})),h('p',{class:'hint',text:'按 Enter 可以換行,員工頁的大標會照這裡的換行顯示。'})),
      h('div',{class:'field'},h('label',{class:'lbl',for:'snote',text:'領獎說明(中獎時顯示給員工)'}),h('textarea',setInput('claimNote',{id:'snote'}))),
      h('div',{class:'field'},h('span',{class:'lbl',text:'名單狀態'}),
        h('div',{class:'seg'},
          h('button',{type:'button','aria-pressed':d.final?'false':'true',onclick:function(){if(d.final)saveSetting('final',false)},text:'抽獎進行中'}),
          h('button',{type:'button','aria-pressed':d.final?'true':'false',onclick:function(){if(!d.final)saveSetting('final',true)},text:'名單已全部公布'})),
        h('p',{class:'hint',text:'全部抽完後切到「名單已全部公布」,沒中獎的員工會看到明確的結果。'})),
      h('div',{class:'field'},h('span',{class:'lbl',text:'員工頁顯示'}),
        h('div',{class:'seg'},
          h('button',{type:'button','aria-pressed':d.showNames?'false':'true',onclick:function(){if(d.showNames)setShowNames(false)},text:'只顯示員編'}),
          h('button',{type:'button','aria-pressed':d.showNames?'true':'false',onclick:function(){if(!d.showNames)setShowNames(true)},text:'也顯示姓名與部門'})),
        h('p',{class:'hint',text:'打開後,中獎者的姓名與部門會出現在員工頁,任何拿到連結的人都看得到;沒中獎的人不會公開。先開後匯入名冊也可以,會自動補上。'}),
        namesMsg?h('div',{class:'note '+namesMsg.k,text:namesMsg.t}):null)),rosterCard()),
    h('section',{class:'card stack'},
      h('h2',{text:'印在摸彩券上的 QR Code'}),
      h('div',{class:'field'},h('label',{class:'lbl',for:'qrurl',text:'員工掃描後開啟的網址'}),
        h('input',setInput('shareUrl',{id:'qrurl',type:'text',placeholder:'員工查詢頁的網址 https://…',spellcheck:'false',autocomplete:'off'})),
        h('button',{type:'button',class:'btn small',style:'align-self:flex-start',onclick:function(){saveSetting('shareUrl',employeeUrl())},text:'使用這個網站的查詢頁網址'})),
      h('div',{class:'qrbox'},qrNode(d.shareUrl)),acts,m,
      h('p',{class:'hint',text:'印刷前請用手機掃一次,確認能打開員工查詢頁。'})));
}

/* ================= admin shell ================= */
function employeeUrl(){return location.href.replace(/[#?].*$/,'').replace(/admin\.html$/,'')}
function syncNode(){
  var d=data(),cls='sync',line,sub=null;
  if(liveDead){cls+=' bad';line='連不上資料庫';sub='請確認網路;恢復後會自動重新連線。'}
  else if(!winnersOk){line='連線中…';sub=liveSlow?'連線較慢,資料可能不是最新。':null}
  else if(rtStatus==='live'){line='已即時存檔・員工頁即時更新・共 '+d.winners.length+' 筆'}
  else{cls+=' pend';line='已存檔・共 '+d.winners.length+' 筆';sub='即時連線重新連接中,員工頁會在幾秒內更新。'}
  return h('div',{id:'sync',class:cls,role:'status'},h('span',{class:'dot'}),h('p',{},line,sub?h('span',{class:'sub',text:sub}):null),
    authUser?h('span',{class:'hint',text:authUser.email}):null,
    h('button',{type:'button',class:'btn small',onclick:signOut,text:'登出'}));
}
function refreshSync(){var o=$('#sync');if(o)o.replaceWith(syncNode())}
function adminView(){
  var d=data();
  return h('div',{class:'wrap admin'},
    h('div',{class:'atop'},
      h('div',{},h('div',{class:'brand'},logo('plain')),h('span',{class:'tag',text:'摸彩管理'}),h('h1',{text:d.eventName||'員工摸彩'})),
      h('div',{class:'row'},
        h('div',{class:'seg'},
          h('button',{type:'button','aria-pressed':atab==='reg'?'true':'false',onclick:function(){atab='reg';persistUI();focusSel='#idin';render()},text:'登錄抽獎'}),
          h('button',{type:'button','aria-pressed':atab==='setup'?'true':'false',onclick:function(){atab='setup';persistUI();render()},text:'名單設定'})),
        h('button',{type:'button',class:'btn small',onclick:function(){mode='employee';persistUI();render()},text:'員工預覽'}),
        h('a',{class:'btn small',href:employeeUrl(),target:'_blank',rel:'noopener',text:'開啟員工頁'}))),
    syncNode(),
    atab==='setup'?settingsView():h('div',{class:'agrid'},h('div',{class:'col'},entryCard()),h('div',{class:'col'},listCard())));
}

/* ================= employee ================= */
function ish(k){return h('span',{class:'ish '+k,'aria-hidden':'true'})}
function nm(w,d){return !!(d.showNames&&w.n)}
function ticket(w,d){
  var p=pz(w.p);
  return h('article',{class:'ticket p'+w.p,'aria-label':'中獎:'+p.name+' '+money(p.amount)},
    h('div',{class:'main'},h('span',{class:'tag',text:'恭喜中獎'}),h('p',{class:'pn',text:p.name}),h('div',{class:'money',text:money(p.amount)})),
    h('div',{class:'stub'},h('div',{class:'stamp','aria-hidden':'true',text:'中'}),h('div',{},nm(w,d)?h('span',{class:'snm',text:w.n}):h('span',{class:'sk',text:'員工編號'}),nm(w,d)&&w.d?h('span',{class:'sk',text:w.d}):null,h('span',{class:'mono sid',text:w.id}),h('span',{class:'sk',text:'第 '+seqOf(w.id)+' 位抽出'}))),
    d.claimNote?h('p',{class:'claim',text:d.claimNote}):null);
}
function resultNode(d,id){
  if(!validId(id))return h('section',{class:'card nowin',role:'status'},h('h2',{text:'員工編號是 6 碼英數字'}),h('p',{text:'你輸入的是 '+id.length+' 碼,請再確認。'}));
  var w=d.winners.find(function(x){return x.id===id});
  if(w)return h('div',{role:'status'},ticket(w,d));
  if(d.final)return h('section',{class:'card nowin final',role:'status'},h('h2',{},'這次沒有抽中 ',h('span',{class:'mono',text:id})),h('p',{text:'中獎名單已全部公布,這組員編不在名單內。請確認員編是否輸入正確。'}));
  return h('section',{class:'card nowin',role:'status'},
    h('h2',{},h('span',{class:'mono',text:id}),' 目前還沒抽到'),
    h('p',{},'抽獎還在進行。頁面開著就好,抽到你 ',ish('tk'),' 會立刻跳出通知。'),
    h('div',{class:'watch'},h('i'),'正在幫你留意 '+id));
}
function hl(id,f){
  if(!f)return id;var i=id.indexOf(f);if(i<0)return id;
  return [id.slice(0,i),h('mark',{text:f}),id.slice(i+f.length)];
}
function eListNode(d,f){
  var W=d.winners;
  if(!W.length)return h('section',{class:'card empty',text:'目前還沒有中獎名單,抽出後會即時出現在這裡。'});
  var newest={};W.slice(-3).forEach(function(w){newest[w.id]=1});
  var ft=fw(qDraft).trim().toUpperCase(),idq=/^[A-Z0-9]+$/.test(f);
  var rows=W.map(function(w,i){return {w:w,i:i}}).filter(function(r){if(ePrize&&r.w.p!==ePrize)return false;if(!f||(idq&&validId(f)))return true;if(r.w.id.indexOf(f)>=0)return true;return nm(r.w,d)&&((r.w.n||'').toUpperCase().indexOf(ft)>=0||(r.w.d||'').toUpperCase().indexOf(ft)>=0)});
  if(eSort==='new')rows.reverse();
  var LIMIT=40,shown=eShowAll||f?rows:rows.slice(0,LIMIT);
  var chip=function(k,label,n){return h('button',{type:'button',class:'chip','aria-pressed':ePrize===k?'true':'false',onclick:function(){ePrize=k;refreshResults()}},label,h('b',{text:String(n)}))};
  var myId=me&&me.id;
  return h('section',{class:'card stack','aria-label':'中獎名單'},
    h('div',{class:'lhead',style:'margin:0'},h('h2',{},'中獎名單'),
      h('div',{class:'seg'},
        h('button',{type:'button','aria-pressed':eSort==='new'?'true':'false',onclick:function(){eSort='new';refreshResults()},text:'最新在前'}),
        h('button',{type:'button','aria-pressed':eSort==='seq'?'true':'false',onclick:function(){eSort='seq';refreshResults()},text:'抽出順序'}))),
    h('div',{class:'chips'},chip(0,'全部',W.length),chip(5,'五獎',W.filter(function(w){return w.p===5}).length),chip(6,'六獎',W.filter(function(w){return w.p===6}).length)),
    f&&!(idq&&validId(f))?h('p',{class:'hint',text:'符合「'+fw(qDraft).trim()+'」的有 '+rows.length+' 位'}):null,
    rows.length?h('div',{class:'elist'},shown.map(function(r){
      var p=pz(r.w.p);
      return h('div',{class:'erow p'+r.w.p+(myId&&r.w.id===myId?' me':'')},
        h('span',{class:'idx',text:String(r.i+1)}),
        nm(r.w,d)
          ?h('span',{class:'ewho'},h('span',{class:'enm'},h('b',{text:r.w.n}),r.w.d?h('span',{class:'edp',text:r.w.d}):null),h('span',{class:'mono eid'},hl(r.w.id,idq&&!validId(f)?f:''),!d.final&&newest[r.w.id]?h('span',{class:'new',text:'剛抽出'}):null))
          :h('span',{class:'mono'},hl(r.w.id,validId(f)?'':f),!d.final&&newest[r.w.id]?h('span',{class:'new',text:'剛抽出'}):null),
        h('span',{class:'pill',text:p.name}),h('span',{class:'eamt',text:money(p.amount)}));
    })):h('p',{class:'empty',text:d.showNames?'沒有符合的員編或姓名':'沒有符合的員編'}),
    shown.length<rows.length?h('button',{type:'button',class:'btn more',onclick:function(){eShowAll=true;refreshResults()},text:'顯示全部 '+rows.length+' 位'}):null);
}
function resultsNode(){
  var d=data(),f=normId(qDraft),ft=fw(qDraft).trim();
  var byName=d.showNames&&ft&&!/^[A-Z0-9]+$/i.test(ft)?d.winners.filter(function(w){return w.n===ft}):[];
  var top=/^[A-Z0-9]+$/.test(f)&&f.length>=6?resultNode(d,f):(byName.length?h('div',{class:'stack',role:'status'},byName.map(function(w){return ticket(w,d)})):null);
  return h('div',{class:'stack'},top,eListNode(d,f));
}
function refreshResults(){var b=$('#eres');if(b)b.replaceChildren(resultsNode())}
function trackMe(){
  /* remember the last full ID the employee looked up, and notify when it gets drawn */
  var f=normId(qDraft);
  if(validId(f)&&(!me||me.id!==f)){me={id:f,won:!!byId(f)};saveMe()}
  if(me&&!me.won&&byId(me.id)){
    me.won=true;saveMe();celebrate=byId(me.id);
    try{navigator.vibrate&&navigator.vibrate([120,60,120])}catch(e){}
  }
}
function celebrateNode(){
  if(!celebrate)return null;
  var w=celebrate,p=pz(w.p),d=data();
  var close=function(){celebrate=null;qDraft=w.id;persistUI();render()};
  return h('div',{class:'celebrate p'+w.p,role:'dialog','aria-modal':'true','aria-labelledby':'celt',onclick:function(e){if(e.target===e.currentTarget)close()}},
    h('div',{class:'box'},
      h('div',{class:'stamp','aria-hidden':'true',text:'中'}),
      h('h2',{id:'celt',text:'你中獎了!'}),
      h('span',{class:'pill',text:p.name}),
      h('div',{class:'money',text:money(p.amount)}),
      nm(w,d)?h('p',{class:'celnm'},h('b',{text:w.n}),w.d?' '+w.d:''):null,
      h('p',{class:'mono',text:w.id}),
      d.claimNote?h('p',{class:'hint',text:d.claimNote}):null,
      h('button',{type:'button',class:'btn primary',id:'celok',onclick:close,text:'好,我知道了'})));
}
function employeeView(){
  var d=data(),live=isLive();
  var stat=d.final?('名單已全部公布・共 '+d.winners.length+' 位'):('抽獎進行中・已抽出 '+d.winners.length+' 位');
  var clr=h('button',{type:'button',class:'btn',onclick:function(){qDraft='';persistUI();focusSel='#qin';render()},text:'清除'});clr.hidden=!qDraft;
  var inp=h('input',{id:'qin',type:'text',class:'id-input',maxlength:'12',autocomplete:'off',autocapitalize:'characters',spellcheck:'false',enterkeyhint:'search',
    placeholder:d.showNames?'輸入員編或姓名,查我有沒有中獎':'輸入員編,查我有沒有中獎',value:qDraft,
    oninput:function(e){qDraft=e.target.value;eShowAll=false;persistUI();clr.hidden=!qDraft;trackMe();refreshResults()}});
  return h('div',{class:'wrap'},
    isEditor?h('div',{class:'previewbar'},h('span',{text:'員工預覽:員工掃碼後看到的就是這個畫面'}),h('button',{type:'button',class:'btn small',onclick:function(){mode='admin';persistUI();render()},text:'回到管理'})):null,
    h('div',{class:'brand'},logo('plain')),
    h('header',{class:'ehero'},
      h('span',{class:'deco','aria-hidden':'true'}),h('span',{class:'deco2','aria-hidden':'true'}),
      h('span',{class:'tag',style:'align-self:flex-start',text:'中獎查詢'}),
      h('h1',{class:'big',text:d.eventName||'員工摸彩'}),
      h('p',{class:'say'},'輸入員編 ',ish('sq'),' 查一次就好,抽到你 ',ish('tk'),' 頁面會通知你。'),
      h('div',{class:'estat'},h('span',{class:'st'+(d.final?' done':' live')},h('i'),stat),
        h('span',{class:'up',text:!winnersOk?(liveDead?'連線中斷,恢復後會自動更新':'載入中…'):(rtStatus==='live'?'名單即時更新':'名單每 10 秒自動更新')}))),
    h('div',{class:'eprog'},PRIZES.map(function(p){
      var n=d.winners.filter(function(w){return w.p===p.key}).length,fill=h('i');fill.style.width=Math.min(100,n/p.quota*100)+'%';
      return h('div',{class:'pg p'+p.key},h('span',{class:'k'},h('span',{text:p.name}),h('span',{text:money(p.amount)})),
        h('span',{class:'n'},String(n),h('small',{text:' / '+p.quota+' 名'})),h('span',{class:'bar'},fill));
    })),
    h('form',{class:'card search',onsubmit:function(e){e.preventDefault();var el=$('#qin');if(el)el.blur()}},
      h('label',{class:'lbl',for:'qin',text:'我的員編'}),
      h('div',{class:'row nowrap'},h('div',{class:'grow'},inp),clr)),
    h('div',{id:'eres'},resultsNode()),
    celebrateNode());
}

/* ================= staff login (admin.html) ================= */
var loginEmail='',loginPw='';
function signOut(){if(!sb)return;sb.auth.signOut().then(function(){location.reload()})}
function loginView(){
  var msg=null;
  if(authState==='notstaff')msg=h('div',{class:'note err'},authUser.email+' 不在工作人員名單。請管理員在 Supabase 的 staff 表加入這個 Email。');
  else if(authErr)msg=h('div',{class:'note err',text:authErr});
  var form=h('form',{class:'card stack login',onsubmit:function(e){
      e.preventDefault();if(authBusy)return;
      var em=$('#lem').value.trim().toLowerCase(),pw=$('#lpw').value;
      if(!em||!pw){authErr='請輸入 Email 和密碼';render();return}
      authBusy=true;authErr=null;render();
      sb.auth.signInWithPassword({email:em,password:pw}).then(function(r){
        authBusy=false;
        if(r.error){authErr=/invalid/i.test(r.error.message)?'Email 或密碼不正確':'登入失敗:'+r.error.message;render();return}
        loginPw='';afterAuth(r.data.user);
      },function(){authBusy=false;authErr='連線不穩,請再試一次';render()});
    }},
    h('h2',{text:'工作人員登入'}),
    authState==='notstaff'?null:h('div',{class:'field'},h('label',{class:'lbl',for:'lem',text:'Email'}),h('input',{id:'lem',type:'text',inputmode:'email',autocomplete:'username',spellcheck:'false',value:loginEmail,oninput:function(e){loginEmail=e.target.value}})),
    authState==='notstaff'?null:h('div',{class:'field'},h('label',{class:'lbl',for:'lpw',text:'密碼'}),h('input',{id:'lpw',type:'password',autocomplete:'current-password',value:loginPw,oninput:function(e){loginPw=e.target.value}})),
    msg,
    authState==='notstaff'?h('button',{type:'button',class:'btn',onclick:signOut,text:'登出,換一個帳號'}):h('button',{type:'submit',class:'btn primary',disabled:authBusy,text:authBusy?'登入中…':'登入'}),
    h('p',{class:'hint'},'帳號由管理員在 Supabase 建立。員工查詢頁不用登入:',h('a',{href:employeeUrl(),text:'前往員工查詢頁'})));
  return h('div',{class:'wrap'},h('div',{class:'brand'},logo('plain')),h('span',{class:'tag',style:'align-self:flex-start',text:'摸彩管理'}),form);
}
function setupView(){
  return h('div',{class:'wrap'},h('div',{class:'brand'},logo('plain')),
    h('section',{class:'card stack'},h('h2',{text:'還沒設定資料庫'}),
      h('p',{},'請在 config.js 填入 Supabase 專案的 URL 和 anon key,詳細步驟見 README。')));
}
function afterAuth(user){
  authUser=user||null;
  if(!authUser){authState='out';isEditor=false;render();return}
  sb.from('staff').select('email').eq('email',(authUser.email||'').toLowerCase()).maybeSingle().then(function(r){
    if(r.data){authState='staff';isEditor=true;mode=ui.mode||'admin';if(atab==='reg')focusSel='#idin';startRoster()}
    else{authState='notstaff';isEditor=false}
    render();
  },function(){authErr='無法確認工作人員身分,請重新整理';authState='out';render()});
}
/* ================= render ================= */
function markFresh(){
  var W=data().winners,now={};W.forEach(function(w){now[w.id]=1});
  if(seen&&isLive()){freshIds={};W.forEach(function(w){if(!seen[w.id])freshIds[w.id]=1})}
  if(isLive()||!seen)seen=now;
}
function render(){
  var app=$('#app'),a=document.activeElement,aid=a&&a.id,s0=null,e0=null;
  if(aid&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA')){try{s0=a.selectionStart;e0=a.selectionEnd}catch(e){}}
  markFresh();
  if(!(isEditor&&mode==='admin'))trackMe();
  app.replaceChildren(!sb?setupView():(PAGE==='admin'&&!isEditor)?(authState==='checking'?h('div',{class:'wrap'},h('p',{class:'hint',text:'載入中…'})):loginView()):(isEditor&&mode==='admin'?adminView():employeeView()));
  freshIds={};
  if(celebrate){var ok=$('#celok');if(ok)ok.focus()}
  else if(focusSel){var el=$(focusSel);if(el)el.focus();focusSel=null}
  else if(aid){var back=document.getElementById(aid);if(back&&back!==document.activeElement){back.focus();try{if(s0!=null)back.setSelectionRange(s0,e0)}catch(e){}}}
}
document.addEventListener('keydown',function(e){if(isEditor)touch();if(e.key==='Escape'&&celebrate){celebrate=null;render()}},true);
(function init(){
  var ok=CFG.SUPABASE_URL&&CFG.SUPABASE_ANON_KEY&&!/YOUR-PROJECT|貼上/.test(CFG.SUPABASE_URL+CFG.SUPABASE_ANON_KEY)&&window.supabase;
  if(ok){
    sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{persistSession:PAGE==='admin',autoRefreshToken:PAGE==='admin'},realtime:{params:{eventsPerSecond:5}}});
    db=sb;startLive();
    if(PAGE==='admin'){
      sb.auth.getSession().then(function(r){afterAuth(r.data&&r.data.session?r.data.session.user:null)},function(){afterAuth(null)});
      sb.auth.onAuthStateChange(function(ev){if(ev==='SIGNED_OUT'){isEditor=false;authUser=null;authState='out';render()}});
    }
  }
  render();
})();
})();
