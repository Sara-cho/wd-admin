// Deploy to the branch manager's insurance project only. HQ verifies its own bearer.
const origin = 'https://admin.wdwave.kr';
const headquarters = 'https://mzftzadtoepcrwhnwdmn.supabase.co';
const insurance = 'https://tiwgzmmizmkbvbyfgmyw.supabase.co';
const hqKey = 'sb_publishable_rp4QHXzXMgnxKmKL0QERAw_cKX0dSgh';
const googleHash = 'a37ec1583d4030b725fefd2fe3a99d8f49886dacde14206475afbae120cd5b22';
const companyHash = '0517ae8c51f060f93d62054524b1d3c4069a71690a0985d4e5843f9fd45cc5a1';
const insuranceEmailHash = 'b06dc36e0aee884231d3b1a3690f78eaae42abeb53c8d34c536c567a6527c268';
const managerId = '8515240b-19db-4aec-9a7b-e50c6c070a1d';
const cors = {
  'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, content-type', 'Cache-Control': 'no-store', 'Vary': 'Origin',
};
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '').trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function api(url, headers, payload) {
  return fetch(url, {method: payload ? 'POST' : 'GET', headers: {...headers, 'Content-Type':'application/json'},
    body: payload ? JSON.stringify(payload) : undefined, redirect:'error', signal:AbortSignal.timeout(5000)});
}
export async function handle(request) {
  if (request.headers.get('Origin') !== origin) return new Response(null, {status:403});
  const reply = (status, data) => Response.json(data, {status, headers:cors});
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:cors});
  if (request.method !== 'POST') return reply(405, {});
  if (Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') !== insurance) return reply(503, {});
  try {
    const {hq_access_token: token} = await request.json();
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) return reply(401, {});
    const headers = {apikey:hqKey, Authorization:'Bearer '+token};
    const verified = await api(headquarters+'/auth/v1/user', headers);
    if (!verified.ok) return reply(401, {});
    const user = await verified.json();
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    const identities = user.identities || [];
    if (identities.some(i => !['email','google'].includes(i.provider))) return reply(403, {});
    const providers = identities.filter(i => i.provider === 'google' && i.identity_data?.email_verified === true);
    if (!user.id || user.is_anonymous || claims.sub !== user.id || !claims.session_id ||
        !claims.amr?.some(a => a.method === 'oauth') || await hash(user.email) !== companyHash ||
        !(await Promise.all(providers.map(i => hash(i.identity_data.email)))).includes(googleHash)) return reply(403, {});
    const profile = await api(headquarters+'/rest/v1/wd_staff_profiles?select=user_id,login_id,staff_role,is_active,allowed_spaces&user_id=eq.'+encodeURIComponent(user.id), headers);
    if (!profile.ok) return reply(403, {});
    const rows = await profile.json();
    const p = rows[0];
    if (rows.length !== 1 || p.user_id !== user.id || p.login_id !== 'kfcyk50' || p.staff_role !== 'owner' ||
        p.is_active !== true || !p.allowed_spaces?.includes('hq')) return reply(403, {});

    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!service || !publicKey) return reply(503, {});
    const admin = {apikey:service, Authorization:'Bearer '+service};
    const lookup = await api(insurance+'/auth/v1/admin/users/'+managerId, admin);
    if (!lookup.ok) return reply(503, {});
    const owner = await lookup.json();
    if (owner.id !== managerId || !owner.email_confirmed_at || owner.is_anonymous || await hash(owner.email) !== insuranceEmailHash) return reply(403, {});
    const link = await api(insurance+'/auth/v1/admin/generate_link', admin, {type:'magiclink', email:owner.email});
    if (!link.ok) return reply(503, {});
    const issued = await link.json();
    if (issued.id !== managerId || !issued.hashed_token) return reply(403, {});
    const verifiedLink = await api(insurance+'/auth/v1/verify', {apikey:publicKey}, {type:'email', token_hash:issued.hashed_token});
    if (!verifiedLink.ok) return reply(503, {});
    const session = await verifiedLink.json();
    if (session.user?.id !== managerId || !session.access_token || !session.refresh_token) return reply(503, {});
    return reply(200, {access_token:session.access_token, refresh_token:session.refresh_token});
  } catch {
    return reply(503, {});
  }
}
Deno.serve(handle);
