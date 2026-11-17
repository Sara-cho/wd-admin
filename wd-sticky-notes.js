(function(){
  'use strict';

  const colors={
    yellow:['노랑','#fff5b6','#ffe887','#ead78b'],
    purple:['연보라','#f0e7ff','#d9c3f6','#d4c2e8'],
    blue:['하늘','#e6f3ff','#bcdcf6','#c0d9ed'],
    pink:['분홍','#ffe8ef','#f7bfd2','#ecc5d3'],
    peach:['살구','#ffeddd','#ffd3ac','#edceb2'],
    gray:['연회색','#f0eff3','#d8d6df','#d6d3dd']
  };
  const colorKey=value=>Object.hasOwn(colors,value)?value:'yellow';
  const style=value=>{
    const [,background,accent,border]=colors[colorKey(value)];
    return `--note-bg:${background};--note-accent:${accent};--note-border:${border}`;
  };
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]
  ));
  const title=body=>(body.split('\n').find(line=>line.trim())||'제목 없는 메모').trim().slice(0,60);
  const displayDate=value=>new Date(value).toLocaleString('ko-KR');
  const columns='id,body,color,created_at,updated_at,deleted_at,revision';
  const hqLegacyId='legacy-668e6f0a5a538a4b924fa15edb3d71f3f8d3b1442f51e2dd8b4df5ecb2dd0fd8';

  function createStore({base,key,uid,getToken}){
    async function request(params, options={}){
      const token=await getToken(uid);
      if(!token)throw new Error('본진 계정으로 다시 로그인해 주세요.');
      const response=await fetch(base+'/rest/v1/wd_sticky_notes?'+new URLSearchParams(params),{
        method:options.method||'GET',headers:{apikey:key,Authorization:'Bearer '+token,
          'Content-Type':'application/json',...(options.prefer?{Prefer:options.prefer}:{})},
        body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',
        signal:AbortSignal.timeout(10000)
      });
      if(!response.ok)throw new Error('스티커노트 저장소에 연결하지 못했습니다.');
      // PostgREST returns an empty 201 for imports that request return=minimal.
      if(options.expectNoBody)return;
      return response.status===204?[]:response.json();
    }
    // Only the HQ legacy key was scoped to a verified account. Keep older Work Center imports out of results.
    const scope={owner_id:'eq.'+uid,or:'(id.not.like.legacy-*,id.eq.'+hqLegacyId+')'};
    async function readOne(id){
      const rows=await request({...scope,id:'eq.'+id,select:columns});
      return rows[0]||null;
    }
    return {
      readOne,
      async read(){
        const rows=[];
        let after='';
        for(;;){
          const batch=await request({...scope,select:columns,deleted_at:'is.null',order:'id.asc',limit:'200',
            ...(after?{id:'gt.'+after}:{})});
          rows.push(...batch);
          if(batch.length<200)return rows;
          after=batch.at(-1).id;
        }
      },
      async insert(note){
        const rows=await request({select:columns},{
          method:'POST',prefer:'return=representation,resolution=ignore-duplicates,missing=default',
          body:{id:note.id,body:note.body,color:note.color,created_at:note.created_at}
        });
        if(rows.length)return rows[0];
        const existing=await readOne(note.id);
        if(existing)return existing;
        throw new Error('노트 저장 결과를 확인하지 못했습니다.');
      },
      async update(note, fields){
        const rows=await request({...scope,id:'eq.'+note.id,revision:'eq.'+note.revision,select:columns},{
          method:'PATCH',prefer:'return=representation',body:fields
        });
        return rows[0]||null;
      },
      async importHqNote(body){
        await request({}, {method:'POST',expectNoBody:true,prefer:'return=minimal,resolution=ignore-duplicates',
          body:{id:hqLegacyId,body,color:'yellow',created_at:new Date().toISOString()}});
      }
    };
  }

  function bind({base,key,identity,getToken,trigger,onChange=()=>{},keepFresh=()=>false,beforeOpen=()=>true}){
    let state=null,dock=null,edit=null,showList=false,draftColor='yellow';

    function current(){
      const uid=identity();
      if(!uid){if(state)reset();return null;}
      if(state?.uid===uid)return state;
      reset();
      state={uid,store:createStore({base,key,uid,getToken}),rows:new Map(),loading:null,
        mutation:0,imported:false,status:'노트를 불러오는 중…',ready:false,undo:null};
      return state;
    }
    const active=context=>state===context&&identity()===context.uid;
    function rows(){
      if(!state||!active(state))return [];
      return [...state.rows.values()].filter(note=>!note.deleted_at)
        .sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id));
    }
    function redraw(){
      if(dock&&state&&active(state))paintList();
      onChange();
    }
    async function refresh(){
      const context=current();
      if(!context)return;
      if(context.loading)return context.loading;
      if(edit?.pending||edit?.flight)return;
      const version=context.mutation;
      const task=Promise.resolve().then(async()=>{
        try{
          if(!context.imported){
            let prior='';
            try{prior=localStorage.getItem('wdhq-sticky-note-v1:'+context.uid)||'';}catch{}
            if(prior.trim())await context.store.importHqNote(prior);
            if(!active(context))return;
            context.imported=true;
          }
          const notes=await context.store.read();
          if(!active(context)||version!==context.mutation||edit?.pending||edit?.flight)return;
          context.rows=new Map(notes.map(note=>[note.id,note]));
          context.ready=true;
          context.status='';
          if(edit?.note){
            const row=context.rows.get(edit.note.id);
            if(row&&row.revision!==edit.note.revision){
              edit.note=row;edit.field.value=row.body;paintColor(row.color);hint('다른 화면의 최신 노트를 불러왔습니다.');
            }else if(!row&&!edit.busy){
              choose(null);hint('다른 화면에서 삭제된 노트입니다.');
            }
          }
          if(edit&&!edit.note&&!edit.field.value)hint('입력하면 자동 저장됩니다.');
        }catch(error){
          if(!active(context))return;
          context.status=error.message||'노트를 불러오지 못했습니다.';
          hint(context.status,true);
        }finally{
          if(active(context)){context.loading=null;redraw();}
        }
      });
      context.loading=task;
      return task;
    }
    function hint(text,retry=false){
      if(!dock)return;
      dock.querySelector('[data-sticky-status]').textContent=text;
      dock.querySelector('[data-sticky-retry]').hidden=!retry;
    }
    function paintColor(value){
      const color=colorKey(value);
      dock.setAttribute('data-note-color',color);
      dock.setAttribute('style',style(color));
      for(const button of dock.querySelectorAll('[data-sticky-color]')){
        const selected=button.dataset.stickyColor===color;
        button.setAttribute('aria-pressed',String(selected));
        button.textContent=selected?'✓':'';
      }
    }
    function paintList(){
      const notes=rows();
      const list=dock.querySelector('[data-sticky-list]');
      list.innerHTML=`<div class="wd48-listhead"><b>내 노트 ${notes.length}개</b></div>
        <div class="wd48-listrows">${notes.map(note=>`<button type="button" data-sticky-id="${esc(note.id)}"
          data-note-color="${colorKey(note.color)}" style="${style(note.color)}" class="${note.id===edit?.note?.id?'active':''}">
          <b>${esc(title(note.body))}</b><span>${esc(note.body.split('\n').slice(1).join('\n'))}</span>
          <small>${esc(displayDate(note.updated_at))}</small></button>`).join('')||
          '<p class="wd-sticky-empty">저장된 노트가 없습니다.</p>'}</div>
        ${state.undo?'<button type="button" class="wd48-undo" data-sticky-undo>삭제 취소</button>':''}`;
    }
    function choose(note){
      const field=dock.querySelector('textarea');
      edit={field,note,pending:false,flight:null,busy:false,timer:null,color:note?.color||draftColor};
      field.value=note?.body||'';
      paintColor(edit.color);
      dock.querySelector('[data-sticky-delete]').disabled=!note;
      hint(note?'자동저장됨 · '+displayDate(note.updated_at):state.status||'입력하면 자동 저장됩니다.');
      paintList();
      field.focus();
    }
    function change(){
      if(!edit||!state||!active(state))return;
      if(!edit.note&&!edit.field.value.trim()&&!edit.pending)return;
      edit.pending=true;
      state.mutation++;
      hint('저장 대기 중…');
      clearTimeout(edit.timer);
      edit.timer=setTimeout(()=>void flush(),350);
    }
    function flush(){
      const context=state, entry=edit;
      if(!context||!active(context)||!entry)return Promise.resolve(true);
      clearTimeout(entry.timer);
      if(entry.flight)return entry.flight;
      if(!entry.pending)return Promise.resolve(true);
      const task=Promise.resolve().then(async()=>{
        try{
          while(entry.pending&&active(context)){
            entry.pending=false;
            const body=entry.field.value, color=entry.color;
            if(!entry.note&&!body.trim())continue;
            const candidate=entry.note||{id:entry.newId??=crypto.randomUUID()};
            hint('저장 중…');
            let saved;
            if(candidate.revision){
              saved=await context.store.update(candidate,{body,color});
              if(!saved&&active(context)){
                const latest=await context.store.readOne(candidate.id);
                if(!active(context))return false;
                if(latest&&!latest.deleted_at&&latest.body===body&&latest.color===color){
                  saved=latest;
                }else{
                  entry.copyId??=crypto.randomUUID();
                  saved=await context.store.insert({id:entry.copyId,body,color});
                  if(latest&&!latest.deleted_at)context.rows.set(latest.id,latest);
                  else context.rows.delete(candidate.id);
                }
              }
            }else{
              saved=await context.store.insert({...candidate,body,color});
              if(active(context)&&(saved.body!==body||saved.color!==color||saved.deleted_at)){
                entry.copyId??=crypto.randomUUID();
                saved=await context.store.insert({id:entry.copyId,body,color});
              }
            }
            if(!active(context))return false;
            entry.note=saved;context.rows.set(saved.id,saved);context.mutation++;
            const copied=entry.copyId===saved.id;
            entry.copyId=null;
            dock.querySelector('[data-sticky-delete]').disabled=false;
            hint(copied?'다른 화면에서 변경되어 새 노트로 저장했습니다.':'자동저장됨 · '+displayDate(saved.updated_at));
            redraw();
          }
          return active(context);
        }catch(error){
          if(active(context)){entry.pending=true;hint(error.message||'노트를 저장하지 못했습니다.',true);}
          return false;
        }finally{entry.flight=null;}
      });
      entry.flight=task;
      return task;
    }
    async function select(id){
      const context=state;
      if(!context||!dock||edit?.busy||!await flush()||!active(context)||!dock)return;
      if(!id)draftColor='yellow';
      choose(id?context.rows.get(id)||null:null);
    }
    async function removeOrRestore(restore){
      const context=state, entry=edit;
      if(!context||!entry||entry.busy||(!restore&&!window.confirm('삭제하시겠습니까?')))return;
      entry.busy=true;
      entry.field.readOnly=true;
      try{
        if(!await flush()||!active(context))return;
        const note=restore?context.undo:entry.note;
        if(!note)return;
        context.mutation++;
        const result=await context.store.update(note,{deleted_at:restore?null:new Date().toISOString()});
        if(!active(context)||!dock)return;
        if(!result){hint('다른 화면에서 변경되었습니다. 노트를 다시 불러와 주세요.',true);return;}
        if(restore)context.rows.set(result.id,result);
        else context.rows.delete(result.id);
        context.undo=restore?null:result;
        context.mutation++;
        showList=true;applyList();choose(restore?result:null);redraw();
      }catch(error){
        if(active(context))hint(error.message||'노트를 변경하지 못했습니다.',true);
      }finally{entry.busy=false;entry.field.readOnly=false;}
    }
    function applyList(){
      dock.classList.toggle('wd48-withlist',showList);
      dock.querySelector('[data-sticky-list]').hidden=!showList;
      dock.querySelector('[data-sticky-toggle]').setAttribute('aria-expanded',String(showList));
    }
    function reset(){
      if(edit)clearTimeout(edit.timer);
      dock?.remove();dock=null;edit=null;state=null;showList=false;draftColor='yellow';
      trigger()?.setAttribute('aria-expanded','false');
    }
    function hasPending(){return !!(edit?.pending||edit?.flight||edit?.busy);}
    function close(){
      if(!dock)return true;
      if(!state||!active(state)){reset();return true;}
      if(edit?.busy)return false;
      if(edit?.pending||edit?.flight){
        void flush().then(saved=>{if(saved)close();});
        return false;
      }
      dock.remove();dock=null;edit=null;
      trigger()?.setAttribute('aria-expanded','false');
      return true;
    }
    async function open(id){
      const context=current();
      if(!context||!beforeOpen())return;
      if(dock){
        if(id===undefined){close();return;}
        await select(id);return;
      }
      dock=document.createElement('section');
      dock.id='wd-shared-sticky-dock';
      dock.className='stickyPanel stickyDock wd48-dock';
      dock.setAttribute('role','dialog');
      dock.setAttribute('aria-label','스티커노트');
      dock.innerHTML=`<div class="wd48-dockhead"><div class="wd48-headleft">
        <button type="button" data-sticky-toggle title="노트 목록" aria-label="노트 목록"><svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5H17M5 10H17M5 15H17M2 5H2.1M2 10H2.1M2 15H2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
        <button type="button" data-sticky-new title="새 노트" aria-label="새 노트">＋</button>
        </div><strong>스티커노트</strong><div class="wd48-headright">
        <button type="button" data-sticky-delete title="노트 삭제" aria-label="노트 삭제"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 5H16M8 3H12M6 5L7 17H13L14 5M9 8V14M11 8V14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" data-sticky-close title="닫기" aria-label="노트 닫기">×</button></div></div>
        <div class="wd49-palette" role="group" aria-label="노트 색상 선택"><span>노트 색상</span>
        ${Object.entries(colors).map(([value,[label,,accent]])=>`<button type="button" data-sticky-color="${value}"
          title="${label}" aria-label="${label} 노트" style="background:${accent}"></button>`).join('')}</div>
        <div class="wd48-dockbody"><section class="wd48-docklist" data-sticky-list hidden></section>
        <section class="wd48-editor"><textarea aria-label="노트 내용" placeholder="여기에 메모하세요. 첫 줄이 노트 제목이 됩니다."></textarea>
        <div class="stickyHint"><span data-sticky-status role="status"></span>
        <button type="button" data-sticky-retry hidden>다시 시도</button></div></section></div>`;
      document.body.append(dock);
      trigger()?.setAttribute('aria-expanded','true');
      applyList();choose(id?context.rows.get(id)||null:null);
      dock.querySelector('textarea').addEventListener('input',change);
      dock.addEventListener('click',event=>{
        const button=event.target.closest('button');
        if(!button)return;
        if(button.matches('[data-sticky-toggle]')){showList=!showList;applyList();void refresh();}
        if(button.matches('[data-sticky-close]')){if(close())trigger()?.focus();}
        if(button.matches('[data-sticky-new]'))void select(null);
        if(button.matches('[data-sticky-delete]'))void removeOrRestore(false);
        if(button.matches('[data-sticky-undo]'))void removeOrRestore(true);
        if(button.matches('[data-sticky-retry]'))void (edit.pending?flush():refresh());
        if(button.dataset.stickyId)void select(button.dataset.stickyId);
        if(button.dataset.stickyColor){edit.color=draftColor=button.dataset.stickyColor;paintColor(edit.color);change();}
      });
      dock.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.stopPropagation();if(close())trigger()?.focus();}
      });
      void refresh();
    }
    const resume=()=>{if(dock||keepFresh())void refresh();};
    window.addEventListener('storage',()=>{
      if(state&&!active(state)){reset();onChange();}
    });
    window.addEventListener('focus',resume);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
    setInterval(()=>{
      if(state&&!active(state)){reset();onChange();return;}
      if(!document.hidden)resume();
    },12000);
    window.addEventListener('beforeunload',event=>{
      if(hasPending()&&state&&active(state)){event.preventDefault();event.returnValue='';}
    });
    return {open,close,reset,refresh,rows,hasPending,isOpen:()=>!!dock,status:()=>state?.status||''};
  }

  window.WDStickyNotes=Object.freeze({bind});
})();
