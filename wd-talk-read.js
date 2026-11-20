/* WD TALK has one shared conversation. Keep the existing work-center cursor per signed-in user. */
(() => {
  'use strict';
  const remembered=new Map();
  const key=uid=>'wd_work_talk_'+uid+'_read';
  const later=(a,b)=>a==null?b:b==null?a:a>b?a:b;
  function point(row){
    // Supabase sends UTC timestamps with variable fractional precision on REST and Realtime.
    const value=String(row.created_at);
    const match=value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)$/);
    if(!match)return value+'|'+row.id;
    let [ ,seconds,fraction='',offset]=match;
    if(!/^(Z|[+-]00(?::?00)?)$/.test(offset)){
      if(offset.length===3)offset+=':00';
      seconds=new Date(seconds+offset).toISOString().slice(0,19);
    }
    return seconds+'.'+fraction.padEnd(6,'0').slice(0,6)+'|'+row.id;
  }
  function read(uid){
    if(!uid)return null;
    let stored=null;
    try{stored=localStorage.getItem(key(uid));}catch{}
    const latest=later(remembered.get(uid),stored);
    if(latest!=null)remembered.set(uid,latest);
    return latest??null;
  }
  function write(uid,value){
    if(!uid||value==null)return;
    const latest=later(read(uid),value);
    remembered.set(uid,latest);
    try{if(localStorage.getItem(key(uid))!==latest)localStorage.setItem(key(uid),latest);}catch{}
  }
  function observe(event,uid){
    if(!uid||event.key!==key(uid)||event.newValue==null)return false;
    // A delayed storage event must never move the current read position backwards.
    write(uid,event.newValue);
    return true;
  }
  window.WDTalkRead=Object.freeze({point,read,write,observe});
})();
