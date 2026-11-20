/* Room list and private conversation transport for the Work Center. */
const workTalkRooms = (() => {
  async function api(token, action, args = {}) {
    const result = await fetch(adminAuthBase + '/rest/v1/rpc/wd_work_talk_' + action, {
      method: 'POST', headers: {apikey: adminAuthPublic, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!result.ok) {
      const error = new Error(result.status === 401 || result.status === 403 ?
        '이 대화방의 이용 권한을 확인해 주세요.' : '대화방에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      error.status = result.status;
      throw error;
    }
    const text = await result.text();
    return text ? JSON.parse(text) : null;
  }

  function roomList(state) {
    const panel = document.createElement('aside');
    panel.id = 'workspaceTalk';
    panel.className = 'wd109-talk-dock wd-talk-surface wd-room-list';
    panel.setAttribute('aria-labelledby', 'workspaceTalkTitle');
    panel.innerHTML = `<header class="talk-heading"><h2 id="workspaceTalkTitle">WD TALK</h2><div class="talk-tools">
      <button type="button" class="talk-icon talk-close" id="closeWorkspaceTalk" aria-label="WD TALK 닫기" title="닫기">×</button>
      </div></header><div class="wd-room-section"><h3 id="workspaceTalkRoomHeading">대화방</h3></div>
      <p id="workspaceRoomNotice" class="talk-info" role="status"></p><div id="workspaceTalkRoomList" aria-labelledby="workspaceTalkRoomHeading"></div>`;
    document.body.append(panel);
    const list = $('workspaceTalkRoomList'), notice = $('workspaceRoomNotice');
    let busy = false, signature = null;
    function paint() {
      if (!panel.isConnected) return;
      const rows = state.rooms;
      const model = rows.map(r => [r.peer_id, r.peer_name, unreadCount(state, r)]);
      const next = JSON.stringify([busy, state.ready, model]);
      notice.textContent = state.error || '';
      if (signature === next) return;
      signature = next;
      const fragment = document.createDocumentFragment();
      for (const room of rows) {
        const button = document.createElement('button'), avatar = document.createElement('span');
        const name = document.createElement('strong'), count = document.createElement('span');
        button.type = 'button'; button.className = 'wd-room-row'; button.dataset.talkRoom = room.peer_id;
        button.disabled = busy;
        avatar.className = 'wd-room-avatar'; avatar.setAttribute('aria-hidden','true');
        avatar.textContent = Array.from(room.peer_name || '직')[0];
        name.textContent = room.peer_name; button.append(avatar,name);
        const unread = unreadCount(state,room);
        if (unread) {
          count.className='wd-room-count'; count.textContent=unread>99?'99+':String(unread);
          count.setAttribute('aria-label','안 읽은 메시지 '+unread+'건');button.append(count);
        }
        button.onclick = async () => {
          if (busy || !current()) return;
          busy = true; paint();
          try {
            const {token, uid} = await workspaceTalkIdentity();
            if (!current() || uid !== state.uid) return;
            if (!room.legacy) await api(token,'open',{p_peer:room.peer_id});
            if (!current()) return;
            const latest = state.rooms.find(r=>r.peer_id===room.peer_id);
            if (!latest) throw new Error('대화 상대의 이용 권한을 확인해 주세요.');
            panel.remove();
            selectWorkTalkRoom(state,latest);
          } catch (error) {if(current())notice.textContent = error.message;}
          finally {busy=false;if(current()) {signature=null; const msg=notice.textContent;paint();if(msg)notice.textContent=msg;}}
        };
        fragment.append(button);
      }
      if (!rows.length) {
        const p=document.createElement('p');p.className='wd-room-empty';
        p.textContent=state.ready?'대화할 수 있는 다른 직원이 아직 없어요.':'대화방을 불러오는 중…';
        fragment.append(p);
      }
      list.replaceChildren(fragment);
    }
    const current=()=>panel.isConnected&&workspaceTalkState===state&&talkAccountCurrent(state);
    panel.paintTalk=paint;
    panel.closeDock=()=>{panel.remove();$('openWorkspaceTalk')?.setAttribute('aria-expanded','false');return true;};
    function close(){panel.closeDock();$('openWorkspaceTalk')?.focus();}
    $('closeWorkspaceTalk').onclick=close;
    panel.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();close();}};
    $('openWorkspaceTalk')?.setAttribute('aria-expanded','true');
    paint();$('closeWorkspaceTalk').focus();
  }

  function unreadCount(state,room) {
    if (room.legacy) return state.legacyRows.filter(row=>row.sender_id!==state.uid&&talkReadPoint(row)>state.legacyRead).length;
    return Number(room.unread_count)||0;
  }
  return {api,roomList,unreadCount};
})();
