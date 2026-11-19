const origin='https://admin.wdwave.kr';
const legacyLogin='kfcyk30';
const columns='work_date,start_time,end_time,break_minutes,updated_at';
const validTime=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
const validDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value;
};
const kstToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

export function createHandler(env,request=fetch){
  return async req=>{
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'authorization, apikey, content-type','Cache-Control':'no-store','Vary':'Origin'};
    const respond=(status,data)=>Response.json(data,{status,headers});
    if(req.headers.get('Origin')!==origin)return respond(403,{error:'본진 업무센터 TEST에서 열어주세요.'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!['GET','POST'].includes(req.method))return respond(405,{error:'지원하지 않는 요청이에요.'});
    const authorization=req.headers.get('Authorization')||'';
    if(!/^Bearer [^\s]+$/.test(authorization))return respond(401,{error:'본진에서 먼저 로그인해 주세요.'});
    const base=env('SUPABASE_URL'),key=env('SUPABASE_ANON_KEY')||env('SUPABASE_PUBLISHABLE_KEY');
    if(!base||!key)return respond(503,{error:'근무기록 서버 설정을 확인해 주세요.'});
    const get=(path,init={})=>request(base+path,{...init,headers:{Authorization:authorization,apikey:key,...init.headers},signal:AbortSignal.timeout(8000)});
    try{
      const auth=await get('/auth/v1/user');
      if(!auth.ok)return respond(401,{error:'본진에서 다시 로그인해 주세요.'});
      const user=await auth.json();
      if(!user.id)return respond(403,{error:'직원 계정으로 로그인해 주세요.'});
      const profileQuery=new URLSearchParams({select:'login_id,staff_role,is_active',user_id:'eq.'+user.id,limit:'1'});
      const check=await get('/rest/v1/wd_staff_profiles?'+profileQuery);
      if(!check.ok)return respond(502,{error:'본진 계정을 확인하지 못했어요.'});
      const [profile]=await check.json();
      if(!profile?.is_active)return respond(403,{error:'활성 직원 계정이 필요해요.'});
      const ownLogin=profile.login_id;
      if(ownLogin===legacyLogin){
        if(profile.staff_role!=='ops_lead'||user.email?.toLowerCase()!==legacyLogin+'@admin.wdwave.kr')
          return respond(403,{error:'직원 계정을 확인해 주세요.'});
      }else{
        if(profile.staff_role!=='assistant_staff')return respond(403,{error:'직원 계정을 확인해 주세요.'});
        const query=new URLSearchParams({select:'enabled,google_email',login_id:'eq.'+ownLogin,limit:'1'});
        const access=await get('/rest/v1/wd_work_center_test_access?'+query);
        if(!access.ok)return respond(503,{error:'직원 권한을 확인할 수 없어요.'});
        const [grant]=await access.json();
        const verified=grant?.enabled&&user.identities?.some(identity=>identity.provider==='google'&&
          identity.identity_data?.email_verified===true&&identity.identity_data.email?.toLowerCase()===grant.google_email.toLowerCase());
        if(!verified)return respond(403,{error:'근무기록 권한이 필요해요.'});
      }
      const params=new URLSearchParams({select:columns,user_id:'eq.'+ownLogin});
      if(req.method==='GET'){
        const month=new URL(req.url).searchParams.get('month');
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return respond(400,{error:'조회 월을 확인해 주세요.'});
        const date=new Date(month+'-01T00:00:00Z');
        date.setUTCMonth(date.getUTCMonth()+1);
        params.set('and','(work_date.gte.'+month+'-01,work_date.lt.'+date.toISOString().slice(0,10)+')');
        params.set('order','work_date.asc');
        const result=await get('/rest/v1/work_hours?'+params);
        if(!result.ok)return respond(502,{error:'실제 근무기록을 읽지 못했어요.'});
        return respond(200,{records:await result.json()});
      }

      if(req.headers.get('Content-Type')?.split(';')[0]!=='application/json')return respond(415,{error:'요청 형식을 확인해 주세요.'});
      const raw=await req.text();
      if(raw.length>1024)return respond(400,{error:'근무기록 요청이 너무 길어요.'});
      let change;
      try{change=JSON.parse(raw);}catch{return respond(400,{error:'근무기록 입력을 확인해 주세요.'});}
      const {day,start,end,breakMinutes,existing,version}=change||{};
      const elapsed=end&&validTime(start)&&validTime(end)?minutes(end)-minutes(start):null;
      if(!validDate(day)||day>kstToday()||!validTime(start)||(end!==null&&!validTime(end))||
          !Number.isInteger(breakMinutes)||breakMinutes<0||breakMinutes>1439||
          (elapsed!==null&&(elapsed<=breakMinutes||(elapsed>=540&&breakMinutes<60)))||
          (typeof existing!=='boolean'||(!existing&&version!==null))||
          (version!==null&&(typeof version!=='string'||version.length>40||!/^\d{4}-\d{2}-\d{2}T[0-9:+.Z-]+$/.test(version)||!Number.isFinite(Date.parse(version))))){
        return respond(400,{error:'근무 날짜, 출퇴근 시각과 휴게시간을 확인해 주세요.'});
      }
      const payload={work_day:'일월화수목금토'[new Date(day+'T00:00:00Z').getUTCDay()],start_time:start,end_time:end,
        break_minutes:breakMinutes,total_minutes:elapsed===null?null:elapsed-breakMinutes,updated_at:new Date().toISOString()};
      params.set('work_date','eq.'+day);
      if(!existing){
        const prior=await get('/rest/v1/work_hours?'+params);
        if(!prior.ok)return respond(502,{error:'기존 근무기록을 확인하지 못했어요.'});
        if((await prior.json()).length)return respond(409,{error:'기존 기록이 있어요. 새로고침 후 다시 수정하세요.'});
      }else params.set('updated_at',version===null?'is.null':'eq.'+version);
      const target=!existing?'?on_conflict=user_id,work_date&select='+columns:'?'+params;
      const result=await get('/rest/v1/work_hours'+target,{
        method:!existing?'POST':'PATCH',
        headers:{'Content-Type':'application/json',Prefer:!existing?'resolution=ignore-duplicates,return=representation':'return=representation'},
        body:JSON.stringify(!existing?{...payload,user_id:ownLogin,work_date:day}:payload)
      });
      if(!result.ok)return respond(502,{error:'실제 근무기록을 저장하지 못했어요.'});
      const [record]=await result.json();
      return record?respond(200,{record}):respond(409,{error:'기록이 다른 화면에서 바뀌었어요. 다시 불러와 수정하세요.'});
    }catch{return respond(502,{error:'근무기록 연결을 확인해 주세요.'});}
  };
}
if(typeof Deno!=='undefined')Deno.serve(createHandler(name=>Deno.env.get(name)));
