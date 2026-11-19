const reportsRoot='19893_XG7jXziYDYK-q5xaNlrtQna0ubf';
const manuals='1yx-Ded0o4oKHULmPjYUrY4GUBAZwZkQa';
const archives=new Map([
  ['회사운영','1V4arkZhihHmWJ2f9t4Sh03hPl9rH8DrR'],['보험업무','1uPvy82jNaEZAKnNHW6Ll7mNSyVRGtm7Z'],
  ['퍼스널브랜딩','1WoUGC6xKoeE5IoofLCH3cLt0jjmh2skf'],['AI강의','1K48EB1apq0immg2zpKTl5zQYb9ppx1x1'],
  ['정리이전자료','1PTAJXgPGB4gielNyeUeWeSWs6z_Czfex']
]);
const ownerEmail='kfcyk20@gmail.com';
const api='https://www.googleapis.com/drive/v3/files';
const folderType='application/vnd.google-apps.folder', native='application/vnd.google-apps.';
const fields='id,name,parents,mimeType,trashed,modifiedTime,size,appProperties';
const maxSize=25*1024*1024;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=data=>Response.json(data);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{5,200}$/.test(id);
const newStaff=id=>/^staff_[0-9a-f-]{36}$/.test(id);
export function categoryOf(name){
  const group=name.match(/^\[([^_\]]+)_(?:업무)?(?:매뉴얼|메뉴얼)\]/)?.[1];
  return ({회사:'회사운영',보험:'보험업무',브랜딩:'퍼스널브랜딩',강의:'AI강의'})[group]||group;
}
export function libraryScope(grant,menu,category,action){
  if(!['manual','archive'].includes(menu)||!archives.has(category)||!grant.visible_menus.includes(menu)||
    !grant[menu+'_categories'].includes(category))fail(403,'이 자료를 열 권한이 없어요.');
  if(action&&!grant[menu+'_actions'].includes(action))fail(403,'이 작업의 권한이 변경됐어요.');
  return menu==='manual'?manuals:archives.get(category);
}
export function inScope(file,parent,menu,category){
  return !file.trashed&&file.parents?.includes(parent)&&file.mimeType!==folderType&&file.mimeType!==native+'shortcut'&&
    (menu!=='manual'||categoryOf(file.name)===category);
}
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
const utf=s=>new TextEncoder().encode(s);
const cleanName=s=>typeof s==='string'&&s.trim().length>0&&s.length<=240&&!/[\x00-\x1f]/.test(s);
let cached;
const defaultClient='525415823143-vrl5bfgrfo94rk1f92r2h0v2j2tg7n1g.apps.googleusercontent.com';
function googleConfig(env){
  return {client_id:env('WD_WORK_GOOGLE_CLIENT_ID')||defaultClient,client_secret:env('WD_WORK_GOOGLE_CLIENT_SECRET')||env('GOOGLE_CLIENT_SECRET')};
}
async function vault(env,params={}){
  const key=env('SUPABASE_SERVICE_ROLE_KEY');
  const r=await fetch(env('SUPABASE_URL')+'/rest/v1/rpc/wd_work_drive_connection',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(params)});
  if(!r.ok)fail(503,'회사 Drive 연결 정보를 저장하거나 읽을 수 없어요.');
  return params.p_new?null:r.json();
}
async function authorizeOwner(env,input){
  const {client_id,client_secret}=googleConfig(env);
  if(!client_secret)fail(503,'회사 서버에 Google 앱 비밀번호(WD_WORK_GOOGLE_CLIENT_SECRET)를 먼저 등록해 주세요.');
  if(typeof input.code!=='string'||input.code.length>4096)fail(400,'Google 승인을 다시 열어 주세요.');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id,client_secret,code:input.code,redirect_uri:'https://admin.wdwave.kr',grant_type:'authorization_code'})});
  const g=await r.json();
  if(!r.ok||!g.refresh_token||!g.scope?.split(' ').includes('https://www.googleapis.com/auth/drive'))fail(400,'회사 Google 계정의 Drive 권한을 다시 승인해 주세요.');
  const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+g.access_token}});
  if(!about.ok||(await about.json()).user?.emailAddress?.toLowerCase()!==ownerEmail)fail(403,'지정된 회사 Google 계정으로 승인해 주세요.');
  await vault(env,{p_new:g.refresh_token});cached=null;
  return json({connected:true});
}
async function companyToken(env){
  if(cached?.until>Date.now())return cached.token;
  const {client_id,client_secret}=googleConfig(env);
  if(!client_secret)fail(503,'회사 Drive의 최초 연결이 필요해요. 대표님께 알려 주세요.');
  const refresh_token=await vault(env)||env('WD_WORK_DRIVE_REFRESH_TOKEN');
  if(!refresh_token)fail(503,'직원관리에서 회사 Drive 연결을 한 번 승인해 주세요.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id,client_secret,refresh_token,grant_type:'refresh_token'})});
  if(!response.ok)fail(503,'회사 Drive 연결을 갱신해 주세요.');
  const token=await response.json();
  const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+token.access_token}});
  if(!about.ok||(await about.json()).user?.emailAddress?.toLowerCase()!==ownerEmail)fail(503,'회사 Drive 소유 계정을 확인해 주세요.');
  cached={token:token.access_token,until:Date.now()+Math.max(0,Number(token.expires_in)-120)*1000};
  return cached.token;
}
export async function handle(req,env){
  const origin=req.headers.get('Origin');
  const cors={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin==='https://admin.wdwave.kr')Object.assign(cors,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'});
  const result=async()=>{
    if(req.method==='OPTIONS')return new Response(null,{status:204});
    if(req.method!=='POST'||(origin&&origin!=='https://admin.wdwave.kr'))fail(403,'접근할 수 없어요.');
    const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY'),auth=req.headers.get('Authorization');
    if(!auth?.startsWith('Bearer '))fail(401,'업무센터에 다시 로그인해 주세요.');
    const who=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:auth}});
    if(!who.ok)fail(401,'업무센터에 다시 로그인해 주세요.');
    const user=await who.json();
    const db=async(table,query,options={})=>{
      const r=await fetch(base+'/rest/v1/'+table+'?'+new URLSearchParams(query),{...options,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...options.headers}});
      if(!r.ok)fail(503,'업무센터 등록 상태를 확인하지 못했어요.');
      return r.json();
    };
    const [profile]=await db('wd_staff_profiles',{user_id:'eq.'+user.id,is_active:'eq.true',select:'login_id,staff_role'});
    if(!profile)fail(403,'업무센터 접근이 중지됐어요.');
    const action=new URL(req.url).searchParams.get('action');
    const input=req.headers.get('Content-Type')?.startsWith('multipart/form-data')?Object.fromEntries(await req.formData()):await req.json();
    const owner=profile.login_id==='kfcyk50'&&profile.staff_role==='owner';
    if(action==='authorize'||action==='setup'){
      if(!owner)fail(403,'대표 계정이 필요해요.');
      if(action==='authorize')return authorizeOwner(env,input);
      const {client_id,client_secret}=googleConfig(env);
      return json({client_id,configured:!!client_secret,connected:!!client_secret&&!!(await vault(env)||env('WD_WORK_DRIVE_REFRESH_TOKEN'))});
    }
    let grant;
    if(action==='provision'&&owner){
      if(!newStaff(input.staff))fail(400,'직원 등록을 확인해 주세요.');
      const [active]=await db('wd_work_center_test_access',{staff_key:'eq.'+input.staff,select:'staff_key,display_name,enabled'});
      const pend=active?[]:await db('rpc/wd_work_pending_invitations',{}, {method:'POST',body:'{}',headers:{Authorization:auth}});
      grant=active||pend.find(row=>row.staff_key===input.staff);
    }else{
      const email=user.email?.toLowerCase();
      if(profile.staff_role!=='assistant_staff'||!newStaff(profile.login_id)||!user.identities?.some(i=>i.provider==='google'&&i.identity_data?.email_verified===true&&i.identity_data?.email?.toLowerCase()===email))fail(403,'등록된 Google 계정으로 로그인해 주세요.');
      [grant]=await db('wd_work_center_test_access',{login_id:'eq.'+profile.login_id,google_email:'eq.'+email,enabled:'eq.true',select:'*'});
    }
    if(!grant?.enabled||!newStaff(grant.staff_key))fail(403,'업무센터 접근 권한을 확인해 주세요.');
    let token;
    if(owner&&action==='provision'&&input.companySession){
      const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:'Bearer '+input.companySession}});
      if(!about.ok||(await about.json()).user?.emailAddress?.toLowerCase()!==ownerEmail)fail(403,'회사 Drive 연결을 갱신해 주세요.');
      token=input.companySession;
    }else token=await companyToken(env);
    const drive=async(url,options={},allowed=[])=>{
      const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
      if(!r.ok&&!allowed.includes(r.status))fail(r.status===404?404:502,'회사 Drive 요청을 완료하지 못했어요. 다시 시도해 주세요.');
      return r;
    };
    const fileUrl=id=>api+'/'+id+'?'+new URLSearchParams({fields,supportsAllDrives:'true'});
    const getFile=async id=>{
      if(!validId(id))fail(400,'파일을 확인해 주세요.');
      return (await drive(fileUrl(id))).json();
    };
    const list=async parent=>{
      const q=new URLSearchParams({q:"'"+parent+"' in parents and trashed = false",fields:'nextPageToken,files('+fields+')',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      const rows=[];
      for(;;){const p=await (await drive(api+'?'+q)).json();rows.push(...(p.files||[]));if(!p.nextPageToken)break;q.set('pageToken',p.nextPageToken);}
      return rows;
    };
    const reserve=async(item,fingerprint)=>{
      const query={staff_key:'eq.'+grant.staff_key,item_key:'eq.'+item,select:'drive_id,fingerprint'};
      let [row]=await db('wd_work_drive_items',query);
      if(!row){
        const fresh=await (await drive(api+'/generateIds?count=1&space=drive')).json();
        if(!validId(fresh.ids?.[0]))fail(502,'Drive 파일 번호를 발급하지 못했어요.');
        await db('wd_work_drive_items',{on_conflict:'staff_key,item_key'}, {method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({staff_key:grant.staff_key,item_key:item,drive_id:fresh.ids[0],fingerprint})});
        [row]=await db('wd_work_drive_items',query);
      }
      if(!row||row.fingerprint!==fingerprint)fail(409,'같은 날짜에 다른 내용으로 제출한 보고서가 있어요.');
      return row.drive_id;
    };
    const putFile=async(meta,blob,method='POST')=>{
      const boundary='wd'+crypto.randomUUID(),type=blob.type||'application/octet-stream';
      const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(meta),'\r\n--'+boundary+'\r\nContent-Type: '+type+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
      return drive('https://www.googleapis.com/upload/drive/v3/files'+(method==='PATCH'?'/'+input.id:'')+'?uploadType=multipart&supportsAllDrives=true&fields=id',{method,headers:{'Content-Type':'multipart/related; boundary='+boundary},body},method==='POST'&&meta.id?[409]:[]);
    };
    const folder=async()=>{
      const id=await reserve('folder','');
      const old=await drive(fileUrl(id),{},[404]);
      if(old.status===404)await drive(api+'?supportsAllDrives=true',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name:grant.display_name+' 업무보고',mimeType:folderType,parents:[reportsRoot],appProperties:{wdStaffKey:grant.staff_key}})},[409]);
      const f=await getFile(id);
      if(f.trashed||f.mimeType!==folderType||!f.parents?.includes(reportsRoot)||f.appProperties?.wdStaffKey!==grant.staff_key)fail(409,'회사 업무보고 폴더 위치를 확인해 주세요.');
      return id;
    };
    if(action==='provision'){if(!owner)fail(403,'대표 계정이 필요해요.');return json({folder:await folder()});}
    if(['reports','attach','submit','reportFile'].includes(action)){
      const parent=await folder();
      if(action==='reports')return json((await list(parent)).filter(f=>f.appProperties?.wdWorkDay).map(f=>({id:f.id,name:f.name,date:f.appProperties.wdReportSubmittedDay,workDate:f.appProperties.wdWorkDay})));
      if(action==='reportFile'){
        const f=await getFile(input.id);
        if(!inScope(f,parent)||(!f.appProperties?.wdWorkDay&&!f.appProperties?.wdAttachDay))fail(403,'본인 업무보고만 열 수 있어요.');
        return drive(api+'/'+f.id+'?alt=media');
      }
      const day=input.date;
      if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)fail(400,'근무일을 확인해 주세요.');
      let item,fingerprint,name,blob,props;
      if(action==='attach'){
        blob=input.file;
        if(!(blob instanceof File)||blob.size>maxSize||!cleanName(blob.name))fail(400,'첨부파일은 개당 25MB까지 저장할 수 있어요.');
        fingerprint=await sha(await blob.arrayBuffer());item='attachment:'+day+':'+await sha(utf(blob.name+':'+fingerprint));
        name=blob.name;props={wdAttachDay:day,wdReportAttachment:item.slice(-64)};
      }else{
        if(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000||!Array.isArray(input.attachments)||input.attachments.length>40)fail(400,'보고서 본문과 첨부를 확인해 주세요.');
        const links=[];
        for(const id of [...new Set(input.attachments)]){
          const f=await getFile(id);
          if(!inScope(f,parent)||f.appProperties?.wdAttachDay!==day)fail(403,'해당 보고서의 첨부만 선택할 수 있어요.');
          links.push(f.name+' https://drive.google.com/open?id='+id);
        }
        const body=input.text.trim()+(links.length?'\n\n첨부파일\n'+links.join('\n'):'');
        fingerprint=await sha(utf(body));item='report:'+day;blob=new Blob([body],{type:'text/plain'});
        name=day.slice(2).replaceAll('-','')+'_'+grant.display_name+'→대표_업무보고.txt';
        props={wdWorkDay:day,wdReportSubmittedDay:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())};
      }
      const id=await reserve(item,fingerprint);
      const existing=await drive(fileUrl(id),{},[404]);
      if(existing.status===404)await putFile({id,name,parents:[parent],appProperties:{...props,wdFingerprint:fingerprint}},blob);
      const f=await getFile(id);
      if(!inScope(f,parent)||f.appProperties?.wdFingerprint!==fingerprint)fail(409,'저장한 파일의 위치와 내용을 확인해 주세요.');
      return json({id});
    }
    const operations={list:null,preview:null,download:'download',upload:'upload',rename:'edit',remove:'delete',replace:'replace'};
    if(!Object.hasOwn(operations,action))fail(400,'지원하지 않는 작업이에요.');
    const {menu,category}=input,parent=libraryScope(grant,menu,category,operations[action]);
    const title=name=>menu==='manual'?'['+category+'_매뉴얼] '+name:name;
    if(action==='list')return json((await list(parent)).filter(f=>inScope(f,parent,menu,category)).map(({id,name,mimeType,modifiedTime})=>({id,name,mimeType,modifiedTime})));
    if(action!=='upload'){
      const f=await getFile(input.id);
      if(!inScope(f,parent,menu,category))fail(403,'이 분류에 속한 자료만 열 수 있어요.');
      if(action==='preview'||action==='download'){
        const exportType=f.mimeType===native+'document'?'text/plain':f.mimeType.startsWith(native)?'application/pdf':null;
        if(action==='preview'&&!exportType&&!/^(text\/(plain|markdown|csv)|image\/(png|jpeg|webp|gif)|application\/pdf)$/.test(f.mimeType))fail(415,'이 형식은 미리보기를 지원하지 않아요.');
        if(action==='preview'&&Number(f.size)>maxSize)fail(413,'큰 파일은 다운로드로 확인해 주세요.');
        if(action==='preview'&&!exportType&&!f.mimeType.startsWith('text/')&&!grant[menu+'_actions'].includes('download')){
          const thumb=await (await drive(api+'/'+f.id+'?fields=thumbnailLink&supportsAllDrives=true')).json();
          const url=thumb.thumbnailLink?new URL(thumb.thumbnailLink):null;
          if(!url||url.protocol!=='https:'||!(url.hostname.endsWith('.googleusercontent.com')||url.hostname==='drive.google.com'))fail(415,'이 자료의 미리보기 이미지가 없어요.');
          const preview=await drive(url.href);
          if(!/^image\/(png|jpeg|gif|webp)/.test(preview.headers.get('content-type')||''))fail(415,'미리보기 이미지를 열 수 없어요.');
          return preview;
        }
        return drive(exportType?api+'/'+f.id+'/export?mimeType='+encodeURIComponent(exportType):api+'/'+f.id+'?alt=media');
      }
      if(action==='remove'||action==='rename'){
        if(action==='rename'&&!cleanName(input.title))fail(400,'자료 제목을 입력해 주세요.');
        await drive(fileUrl(f.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='remove'?{trashed:true}:{name:title(input.title.trim())})});
        return json({id:f.id});
      }
      if(f.mimeType.startsWith(native))fail(400,'Google 문서는 원본 편집이 필요해요.');
    }
    const blob=input.file;
    if(!(blob instanceof File)||blob.size>maxSize||!cleanName(blob.name))fail(400,'25MB 이하의 파일을 선택해 주세요.');
    const saved=await putFile(action==='replace'?{}:{name:title(blob.name),parents:[parent]},blob,action==='replace'?'PATCH':'POST');
    return json(await saved.json());
  };
  let response;
  try{response=await result();}catch(e){response=Response.json({error:e.status?e.message:'요청을 처리하지 못했어요. 다시 시도해 주세요.'},{status:e.status||500});}
  // Only propagate content type. Never forward Google cookies, redirects or auth headers.
  return new Response(response.body,{status:response.status,headers:{...cors,'Content-Type':response.headers.get('Content-Type')||'application/octet-stream','Content-Security-Policy':"sandbox; default-src 'none'"}});
}
