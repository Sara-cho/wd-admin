begin;

create table public.work_branding_customer_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  account_type text not null default '브랜딩고객계정' check (account_type = '브랜딩고객계정'),
  customer_name text not null check (customer_name = btrim(customer_name) and char_length(customer_name) between 1 and 120),
  service_name text not null check (service_name = btrim(service_name) and char_length(service_name) between 1 and 120),
  account_id text,
  pw text,
  has_password boolean generated always as (coalesce(pw, '') <> '') stored,
  url text,
  link_url text,
  memo text,
  pw_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.work_branding_customer_accounts enable row level security;
revoke all on public.work_branding_customer_accounts from public, anon, authenticated;
grant select, insert, delete on public.work_branding_customer_accounts to authenticated;
grant update (customer_name, service_name, account_id, pw, url, link_url, memo, pw_updated_at)
  on public.work_branding_customer_accounts to authenticated;

create policy "Authorized Work Center accounts read branding accounts"
  on public.work_branding_customer_accounts for select to authenticated using (
    user_id in ('kfcyk50', 'kfcyk30') and exists (
      select 1 from public.wd_staff_profiles p
      where p.user_id=(select auth.uid()) and p.is_active and 'work'=any(p.allowed_spaces)
        and ((p.login_id='kfcyk50' and p.staff_role='owner') or
             (p.login_id='kfcyk30' and p.staff_role='ops_lead' and exists (
                select 1 from public.wd_work_center_test_access grant_row
                where grant_row.login_id=p.login_id and grant_row.enabled
                  and 'accounts'=any(grant_row.visible_menus)
             )))
    )
  );

create policy "Owners manage their own branding accounts"
  on public.work_branding_customer_accounts for all to authenticated using (
    exists (select 1 from public.wd_staff_profiles p
      where p.user_id=(select auth.uid()) and p.is_active and 'work'=any(p.allowed_spaces)
        and p.login_id=work_branding_customer_accounts.user_id
        and ((p.login_id='kfcyk50' and p.staff_role='owner') or
             (p.login_id='kfcyk30' and p.staff_role='ops_lead' and exists (
                select 1 from public.wd_work_center_test_access grant_row
                where grant_row.login_id=p.login_id and grant_row.enabled
                  and 'accounts'=any(grant_row.visible_menus)
             ))))
  ) with check (
    exists (select 1 from public.wd_staff_profiles p
      where p.user_id=(select auth.uid()) and p.is_active and 'work'=any(p.allowed_spaces)
        and p.login_id=work_branding_customer_accounts.user_id
        and ((p.login_id='kfcyk50' and p.staff_role='owner') or
             (p.login_id='kfcyk30' and p.staff_role='ops_lead' and exists (
                select 1 from public.wd_work_center_test_access grant_row
                where grant_row.login_id=p.login_id and grant_row.enabled
                  and 'accounts'=any(grant_row.visible_menus)
             ))))
  );

commit;
