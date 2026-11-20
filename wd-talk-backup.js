(function(){
  'use strict';

  const pageSize=200;
  const messageOrder=(a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id);

  function transcriptOrder(a,b){
    const elapsed=Date.parse(a.created_at)-Date.parse(b.created_at);
    if(elapsed)return elapsed;
    // PostgreSQL timestamps can differ within one JavaScript millisecond.
    const fraction=row=>(row.created_at.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0');
    return fraction(a).localeCompare(fraction(b))||a.id.localeCompare(b.id);
  }

  async function readAll(readPage,identity,active,order){
    const rows=[];
    let cursor='';
    while(active()){
      const page=await readPage(identity,cursor,pageSize);
      if(!active())return [];
      if(!Array.isArray(page))throw new Error('대화 목록을 확인하지 못했어요.');
      for(const row of page){
        if(typeof row.id!=='string'||row.id<=cursor)throw new Error('백업 목록이 변경됐어요. 다시 시도해 주세요.');
        rows.push({id:row.id,sender_id:row.sender_id,created_at:row.created_at,body:row.body});
        cursor=row.id;
      }
      if(page.length<pageSize)return rows.sort(order);
    }
    return [];
  }

  function textArchive(rows,identity,transcript,exportedAt){
    const kst=new Intl.DateTimeFormat('sv-SE',{
      timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    });
    const exported=kst.format(exportedAt);
    const peer=transcript.peerName?.trim()||'상대방';
    const me=identity.displayName?.trim()||'나';
    const lines=['WD TALK 대화 백업', '참여자 · '+me+' / '+peer,
      '백업 일시 · '+exported+' (한국시간)', '메시지 · '+rows.length+'건'];
    for(const row of rows){
      const sender=row.sender_id===identity.uid?me:peer;
      lines.push('', '['+kst.format(new Date(row.created_at))+'] '+sender, transcript.formatBody(row.body??''));
    }
    const safePeer=peer.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,48).trim().replace(/[. ]+$/g,'')||'대화';
    const name='WD-TALK_'+safePeer+'_'+exported.replace(' ','_').replace(/:/g,'-')+'.txt';
    const content=lines.join('\n').replace(/\r\n?|\n/g,'\r\n');
    return {name,file:new Blob(['\uFEFF',content,'\r\n'],{type:'text/plain;charset=utf-8'})};
  }

  function download(rows,identity,transcript){
    const exportedAt=new Date();
    const archive=transcript?textArchive(rows,identity,transcript,exportedAt):{
      name:'WD-TALK-backup-'+exportedAt.toISOString().replace(/[:.]/g,'-')+'.json',
      file:new Blob([JSON.stringify({version:1,room:'WD TALK',exported_at:exportedAt.toISOString(),messages:rows},null,2)],
        {type:'application/json;charset=utf-8'})
    };
    const href=URL.createObjectURL(archive.file),link=document.createElement('a');
    link.href=href;
    link.download=archive.name;
    document.body.append(link);
    try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
  }

  function bind({root,getIdentity,readPage,deleteMessages,onDeleted,active,canDelete,transcript}){
    const backup=root.querySelector('[data-talk-backup]');
    const remove=root.querySelector('[data-talk-clear]');
    const status=root.querySelector('[data-talk-backup-status]');
    let snapshot=null,busy=false,version=0;
    const update=()=>{
      backup.disabled=busy;
      remove.hidden=!canDelete();
      remove.disabled=busy||!snapshot?.ids.length||remove.hidden;
    };
    const reset=()=>{
      version++;snapshot=null;busy=false;status.textContent='';update();
    };
    backup.onclick=async()=>{
      if(busy||!active())return;
      const request=++version;
      const current=()=>active()&&request===version;
      busy=true;snapshot=null;update();
      status.textContent='백업할 대화를 불러오는 중…';
      try{
        const identity=await getIdentity();
        if(!current())return;
        const rows=await readAll(readPage,identity,current,transcript?transcriptOrder:messageOrder);
        if(!current())return;
        if(!rows.length){status.textContent='백업할 대화가 없어요.';return;}
        const fresh=await getIdentity();
        if(!current())return;
        if(fresh.uid!==identity.uid)throw new Error('계정이 바뀌었어요. TALK를 다시 열어 주세요.');
        download(rows,identity,transcript);
        snapshot={uid:identity.uid,ids:rows.map(row=>row.id)};
        status.textContent='대화 '+rows.length+'건의 '+(transcript?'TXT ':'')+'백업 다운로드를 시작했어요.';
      }catch(error){if(current())status.textContent=error.message||'대화를 백업하지 못했어요.';}
      finally{if(request===version){busy=false;update();}}
    };
    remove.onclick=async()=>{
      if(busy||!active()||!canDelete()||!snapshot?.ids.length)return;
      const {uid,ids}=snapshot;
      const warning=transcript?'이 방에서 백업한 메시지 '+ids.length+'건을 삭제할까요?\n\n먼저 TXT 파일이 저장됐는지 확인해 주세요. 삭제하면 수파베이스와 두 사람의 대화에서 사라져요. Drive 첨부 원본은 남아요.':
        '백업한 대화 '+ids.length+'건을 삭제하시겠습니까?\n\n백업 파일이 저장됐는지 먼저 확인해 주세요. 삭제한 메시지는 본진과 업무센터에서 사라집니다.';
      if(!window.confirm(warning))return;
      const request=++version;
      const current=()=>active()&&request===version;
      busy=true;update();
      status.textContent='백업한 대화를 삭제하는 중…';
      try{
        const identity=await getIdentity();
        if(!current())return;
        if(identity.uid!==uid||!canDelete())throw new Error('계정이 바뀌었어요. TALK를 다시 열어 주세요.');
        const count=await deleteMessages(identity,ids);
        if(!current())return;
        if(!Number.isSafeInteger(count)||count<0||count>ids.length)throw new Error('삭제 결과를 확인하지 못했어요.');
        snapshot=null;
        status.textContent=count?'백업한 대화 '+count+'건을 삭제했어요.':'이미 삭제된 대화예요.';
        onDeleted(ids);
      }catch(error){if(current())status.textContent=error.message||'대화를 삭제하지 못했어요.';}
      finally{if(request===version){busy=false;update();}}
    };
    update();
    return {reset};
  }

  window.WDTalkBackup=Object.freeze({bind});
})();
