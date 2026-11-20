// The HQ shortcut hosts the production Work Center conversation surface.
(() => {
  const button = document.getElementById('wdhq-talk-open');
  const panel = document.getElementById('wdhq-talk-panel');
  const badge = document.getElementById('wdhq-talk-badge');
  const preview = document.getElementById('wdhq-talk-preview');
  let owner = '', frame = null, open = false, previewTimer, channel;

  function account() {
    const p = WDHQ_AUTH_PROFILE;
    if (!p?.is_active || p.user_id !== WDHQ_AUTH_SESSION?.user?.id ||
        !p.allowed_spaces?.includes('work') ||
        !['owner','ops_lead','assistant_staff'].includes(p.staff_role) ||
        document.body.matches('.wdhq-auth-locked,.wdhq-auth-checking')) return '';
    return p.user_id;
  }
  function active(source, uid) {
    return !!uid && source === frame?.contentWindow && uid === owner && owner === account();
  }
  function hidePreview() {
    clearTimeout(previewTimer);
    preview.classList.remove('show');
  }
  function hide() {
    open = false;
    hidePreview();
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden','true');
    button.setAttribute('aria-expanded','false');
  }
  function close() {
    if (frame?.contentWindow?.WDWorkTalkFrame?.close() === false) return false;
    hide();
    return true;
  }
  function show() {
    sync();
    if (!owner || !frame) return;
    window.WDHQStickyNote?.close();
    if (document.getElementById('wdhq-noah-panel')?.classList.contains('open')) window.WDHQNoah?.close();
    hidePreview();
    open = true;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden','false');
    button.setAttribute('aria-expanded','true');
    frame.contentWindow?.WDWorkTalkFrame?.open();
    frame.focus();
  }
  function setBadge(count) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('show',count > 0);
    button.setAttribute('aria-label',count ? 'WD TALK 열기 · 안 읽은 메시지 '+count+'건' : 'WD TALK 열기');
  }
  function sync() {
    const uid = account();
    if (uid === owner) return;
    hide();
    if (channel) { void WDHQ_SUPABASE.removeChannel(channel); channel = null; }
    frame?.remove(); frame = null;
    owner = uid;
    setBadge(0);
    document.body.classList.toggle('wdhq-talk-ready',Boolean(uid));
    if (!uid) return;
    frame = document.createElement('iframe');
    frame.title = 'WD TALK 대화방';
    frame.allow = 'clipboard-write';
    frame.src = './wd-work-center.html?view=talk&from=wdhq&v=shared1';
    panel.append(frame);
    if (['owner','ops_lead'].includes(WDHQ_AUTH_PROFILE.staff_role)) {
      channel = WDHQ_SUPABASE.channel('wdhq-work-talk-'+uid)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'wd_talk_messages'},()=>{
          if (account() === uid) frame?.contentWindow?.WDWorkTalkFrame?.refresh();
        }).subscribe();
    }
  }
  window.WDHQTalk = Object.freeze({
    open:show, close,
    current(source) { return source === frame?.contentWindow && owner === account() ? owner : ''; },
    ready(source,uid) { if (open && active(source,uid)) source.WDWorkTalkFrame.open(); },
    closed(source,uid) { if (active(source,uid)) { hide(); button.focus(); } },
    badge(source,uid,count) { if (active(source,uid)) setBadge(count); },
    incoming(source,uid,peer,text) {
      if (!active(source,uid) || open) return;
      document.getElementById('wdhq-talk-preview-name').textContent = peer;
      document.getElementById('wdhq-talk-preview-text').textContent = text;
      preview.classList.add('show');
      clearTimeout(previewTimer); previewTimer = setTimeout(hidePreview,5000);
    }
  });
  button.addEventListener('click',()=>open ? close() : show());
  preview.addEventListener('click',show);
  document.getElementById('wdhq-noah-open')?.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && open && close()) button.focus();});
  document.addEventListener('pointerdown',()=>frame?.contentWindow?.WDWorkTalkFrame?.prime(),true);
  window.addEventListener('pageshow',sync);
  window.addEventListener('storage',sync);
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class','data-wdhq-login-id']});
  setInterval(sync,1000);
  sync();
})();
