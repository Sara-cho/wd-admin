begin;

do $$
begin
  if to_regclass('public.wd_partners_customers') is not null then
    raise exception 'Install this migration only in the new empty planner pilot project';
  end if;
end;
$$;

create schema wd09_private;
revoke all on schema wd09_private from public;
grant usage on schema wd09_private to authenticated;

create table wd09_private.planner_access (
  email text primary key check (email = lower(btrim(email)) and length(email) <= 254),
  display_name text not null check (length(display_name) between 1 and 40),
  planner_uid text not null unique default ('WDG' || replace(gen_random_uuid()::text, '-', '')),
  auth_user_id uuid unique references auth.users(id),
  can_invite boolean not null default false,
  invited_at timestamptz not null default now(),
  check (can_invite = (planner_uid = 'WDTESTADMIN'))
);

alter table wd09_private.planner_access enable row level security;
revoke all on table wd09_private.planner_access from public, anon, authenticated;

create function wd09_private.invite_planner(target_email text, target_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(target_email));
  normalized_name text := btrim(target_name);
  invited_uid text;
begin
  if not exists (
    select 1 from wd09_private.planner_access
    where auth_user_id = (select auth.uid()) and can_invite
  ) then
    raise exception using errcode = '42501', message = 'Only the planner administrator can invite users';
  end if;
  if normalized_email is null or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or normalized_name is null or length(normalized_name) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'Invalid name or email';
  end if;
  if exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = normalized_email
  ) then
    raise exception using errcode = '22023', message = 'The administrator already has access';
  end if;

  insert into wd09_private.planner_access as invitation(email, display_name)
  values (normalized_email, normalized_name)
  on conflict (email) do update
  set display_name = excluded.display_name, invited_at = now()
  where invitation.auth_user_id is null
  returning planner_uid into invited_uid;

  if invited_uid is null then
    raise exception using errcode = '23505', message = 'This planner already has access';
  end if;
  return invited_uid;
end;
$$;

create function wd09_private.activate_planner()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  google_email text;
  profile wd09_private.planner_access%rowtype;
begin
  if caller is null or not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) method
    where method->>'method' = 'oauth'
  ) then
    raise exception using errcode = '42501', message = 'Google sign-in is required';
  end if;

  select lower(i.identity_data->>'email') into google_email
  from auth.identities i join auth.users u on u.id = i.user_id
  where i.user_id = caller and i.provider = 'google'
    and i.identity_data->>'email_verified' = 'true'
    and lower(i.identity_data->>'email') = lower(u.email);

  update wd09_private.planner_access invitation
  set auth_user_id = caller
  where invitation.email = google_email
    and (invitation.auth_user_id is null or invitation.auth_user_id = caller)
  returning * into profile;

  if not found then
    raise exception using errcode = '42501', message = 'No invitation for this Google account';
  end if;

  return jsonb_build_object(
    'uid', profile.planner_uid, 'name', profile.display_name,
    'email', profile.email, 'canInvite', profile.can_invite
  );
end;
$$;

create function wd09_private.allow_google_signup(event jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when event #>> '{user,app_metadata,provider}' = 'google'
    and exists (
      select 1 from wd09_private.planner_access
      where email = lower(event #>> '{user,email}') and auth_user_id is null
    )
    then '{}'::jsonb
    else jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'An invitation is required'))
  end
$$;

grant usage on schema wd09_private to supabase_auth_admin;
revoke execute on function wd09_private.allow_google_signup(jsonb) from public, anon, authenticated;
grant execute on function wd09_private.allow_google_signup(jsonb) to supabase_auth_admin;

create function wd09_private.current_planner_uid()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select planner_uid from wd09_private.planner_access where auth_user_id = (select auth.uid())
$$;

revoke execute on function wd09_private.invite_planner(text,text),
  wd09_private.activate_planner(), wd09_private.current_planner_uid() from public, anon;
grant execute on function wd09_private.invite_planner(text,text),
  wd09_private.activate_planner(), wd09_private.current_planner_uid() to authenticated;

create function public.wd09_invite_planner(target_email text, target_name text)
returns text
language sql
security invoker
set search_path = ''
as $$ select wd09_private.invite_planner(target_email, target_name) $$;

create function public.wd09_activate_planner()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select wd09_private.activate_planner() $$;

revoke execute on function public.wd09_invite_planner(text,text), public.wd09_activate_planner() from public, anon;
grant execute on function public.wd09_invite_planner(text,text), public.wd09_activate_planner() to authenticated;

create table public.wd_partners_claim_records (
  id bigint not null,
  uid text not null,
  customer_id bigint not null,
  date text,
  ins_category text,
  ins_company text,
  claim_type text,
  content text,
  file_name text,
  status text,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, customer_id, id)
);
alter table public.wd_partners_claim_records enable row level security;
grant select, insert, update, delete on public.wd_partners_claim_records to authenticated;
revoke all on public.wd_partners_claim_records from anon, public;

create table public.wd_partners_communications (
  id bigint not null,
  uid text not null,
  customer_id bigint not null,
  type text,
  content text,
  date text,
  file_name text,
  next_date text,
  next_content text,
  no_next_contact boolean default false,
  contact_done boolean default false,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, customer_id, id)
);
alter table public.wd_partners_communications enable row level security;
grant select, insert, update, delete on public.wd_partners_communications to authenticated;
revoke all on public.wd_partners_communications from anon, public;

create table public.wd_partners_consultations (
  id uuid default gen_random_uuid() not null,
  uid text not null,
  customer_id text not null,
  customer_name text,
  consultation_status text default '진행 중'::text not null,
  current_step integer default 0 not null,
  consultation_started_at timestamp with time zone default now() not null,
  consultation_completed_at timestamp with time zone,
  consultation_data jsonb default '{}'::jsonb not null,
  signature_bucket text default 'wd-consultation-signatures'::text,
  signature_path text,
  signature_signed_at timestamp with time zone,
  report_generated_at timestamp with time zone,
  next_consultation_at timestamp with time zone,
  next_consultation_mode text,
  communication_saved boolean default false not null,
  communication_saved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  consultation_number integer not null,
  CHECK ((consultation_number >= 1)),
  CHECK ((consultation_status = ANY (ARRAY['진행 중'::text, '완료'::text, '보류'::text]))),
  CHECK (((current_step >= 0) AND (current_step <= 8))),
  PRIMARY KEY (id)
);
alter table public.wd_partners_consultations enable row level security;
grant select, insert, update, delete on public.wd_partners_consultations to authenticated;
revoke all on public.wd_partners_consultations from anon, public;

create table public.wd_partners_contracts (
  id bigint not null,
  uid text not null,
  customer_id bigint not null,
  insurer text,
  product text,
  status text,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, id)
);
alter table public.wd_partners_contracts enable row level security;
grant select, insert, update, delete on public.wd_partners_contracts to authenticated;
revoke all on public.wd_partners_contracts from anon, public;

create table public.wd_partners_customers (
  id bigint not null,
  uid text not null,
  name text not null,
  phone text,
  ctype text,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, id)
);
alter table public.wd_partners_customers enable row level security;
grant select, insert, update, delete on public.wd_partners_customers to authenticated;
revoke all on public.wd_partners_customers from anon, public;

create table public.wd_partners_design_requests (
  uid text not null,
  id bigint not null,
  customer_id bigint,
  customer_name text,
  ins_type text,
  done boolean default false,
  date text,
  data jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, id)
);
alter table public.wd_partners_design_requests enable row level security;
grant select, insert, update, delete on public.wd_partners_design_requests to authenticated;
revoke all on public.wd_partners_design_requests from anon, public;

create table public.wd_partners_home_flow (
  uid text not null,
  work_date date not null,
  status text default '출근 대기'::text not null,
  state jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, work_date)
);
alter table public.wd_partners_home_flow enable row level security;
grant select, insert, update, delete on public.wd_partners_home_flow to authenticated;
revoke all on public.wd_partners_home_flow from anon, public;

create table public.wd_partners_hub_system_accounts (
  id uuid default gen_random_uuid() not null,
  uid text not null,
  company_type text not null,
  company_name text not null,
  carrier_code text,
  login_id text,
  login_pw text,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (id),
  UNIQUE (uid, company_type, company_name)
);
alter table public.wd_partners_hub_system_accounts enable row level security;
grant select, insert, update, delete on public.wd_partners_hub_system_accounts to authenticated;
revoke all on public.wd_partners_hub_system_accounts from anon, public;

create table public.wd_partners_quickmemo (
  uid text not null,
  date text,
  content text,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid)
);
alter table public.wd_partners_quickmemo enable row level security;
grant select, insert, update, delete on public.wd_partners_quickmemo to authenticated;
revoke all on public.wd_partners_quickmemo from anon, public;

create table public.wd_partners_todos (
  id bigint not null,
  uid text not null,
  txt text,
  date text,
  done boolean default false,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  PRIMARY KEY (uid, id)
);
alter table public.wd_partners_todos enable row level security;
grant select, insert, update, delete on public.wd_partners_todos to authenticated;
revoke all on public.wd_partners_todos from anon, public;


insert into storage.buckets (id, name, public)
values ('wd-partners-attachments', 'wd-partners-attachments', false),
       ('wd-consultation-signatures', 'wd-consultation-signatures', false);

do $$
declare
  name text;
begin
  foreach name in array array[
    'wd_partners_customers', 'wd_partners_claim_records', 'wd_partners_communications',
    'wd_partners_contracts', 'wd_partners_consultations', 'wd_partners_design_requests',
    'wd_partners_home_flow', 'wd_partners_quickmemo', 'wd_partners_todos',
    'wd_partners_hub_system_accounts'
  ] loop
    execute format(
      'create policy wd09_invited_planner_owner on public.%I for all to authenticated
       using (uid = (select wd09_private.current_planner_uid()))
       with check (uid = (select wd09_private.current_planner_uid()))', name
    );
  end loop;
end;
$$;

create policy wd09_invited_planner_own_files on storage.objects for all to authenticated
  using (
    bucket_id in ('wd-partners-attachments', 'wd-consultation-signatures')
    and (storage.foldername(name))[1] = (select wd09_private.current_planner_uid())
  )
  with check (
    bucket_id in ('wd-partners-attachments', 'wd-consultation-signatures')
    and (storage.foldername(name))[1] = (select wd09_private.current_planner_uid())
  );

commit;
