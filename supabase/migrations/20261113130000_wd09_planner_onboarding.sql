begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wd_partners_customers'
      and policyname = 'rep_auth_all'
  ) then
    raise exception 'Expected existing insurance project and owner policy';
  end if;
end;
$$;

create schema wd09_private;
revoke all on schema wd09_private from public;
grant usage on schema wd09_private to authenticated;

create table wd09_private.planner_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (length(display_name) between 1 and 40),
  planner_uid text not null unique default ('WDG' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now()
);

alter table wd09_private.planner_accounts enable row level security;
revoke all on table wd09_private.planner_accounts from public, anon, authenticated;

-- Legacy login identities keep their existing planner codes.
create table wd09_private.legacy_auth_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade
);

insert into wd09_private.legacy_auth_users (auth_user_id)
select id from auth.users;

alter table wd09_private.legacy_auth_users enable row level security;
revoke all on wd09_private.legacy_auth_users from public, anon, authenticated;

create function wd09_private.activate_planner()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  google_email text;
  google_name text;
  profile wd09_private.planner_accounts%rowtype;
begin
  if caller is null or not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) method
    where method->>'method' = 'oauth'
  ) then
    raise exception using errcode = '42501', message = 'Google sign-in is required';
  end if;

  select lower(i.identity_data->>'email'), i.identity_data->>'name'
  into google_email, google_name
  from auth.identities i join auth.users u on u.id = i.user_id
  where i.user_id = caller and i.provider = 'google'
    and i.identity_data->>'email_verified' = 'true'
    and lower(i.identity_data->>'email') = lower(u.email)
  limit 1;

  if exists (select 1 from wd09_private.legacy_auth_users where auth_user_id = caller) then
    raise exception using errcode = '42501', message = 'Use the existing employee login';
  end if;

  if google_email is null then
    raise exception using errcode = '42501', message = 'A verified Google account is required';
  end if;

  insert into wd09_private.planner_accounts (auth_user_id, email, display_name)
  values (caller, google_email, left(coalesce(nullif(btrim(google_name), ''), split_part(google_email, '@', 1)), 40))
  on conflict (auth_user_id) do update set email = excluded.email
  returning * into profile;

  return jsonb_build_object('uid', profile.planner_uid, 'name', profile.display_name, 'email', profile.email);
end;
$$;

create function wd09_private.current_planner_uid()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select planner_uid from wd09_private.planner_accounts where auth_user_id = (select auth.uid())
$$;

revoke execute on function wd09_private.activate_planner(), wd09_private.current_planner_uid() from public, anon;
grant execute on function wd09_private.activate_planner(), wd09_private.current_planner_uid() to authenticated;

create function public.wd09_activate_planner()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select wd09_private.activate_planner() $$;

revoke execute on function public.wd09_activate_planner() from public, anon;
grant execute on function public.wd09_activate_planner() to authenticated;

-- The former constraint accepted only the legacy representative code.
alter table public.wd_partners_consultations
  drop constraint wd_partners_consultations_uid_check,
  add constraint wd_partners_consultations_uid_check
    check (uid = 'WD23000' or uid ~ '^WDG[a-f0-9]{32}$');

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
      'create policy wd09_planner_owner on public.%I for all to authenticated
       using (uid = (select wd09_private.current_planner_uid()))
       with check (uid = (select wd09_private.current_planner_uid()))', name
    );
  end loop;
end;
$$;

create policy wd09_planner_own_files on storage.objects for all to authenticated
  using (
    bucket_id in ('wd-partners-attachments', 'wd-consultation-signatures')
    and (storage.foldername(name))[1] = (select wd09_private.current_planner_uid())
  )
  with check (
    bucket_id in ('wd-partners-attachments', 'wd-consultation-signatures')
    and (storage.foldername(name))[1] = (select wd09_private.current_planner_uid())
  );

commit;
