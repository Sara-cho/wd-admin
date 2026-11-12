begin;

create table public.work_office_payment_methods (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('card', 'account')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  issuer text check (
    issuer is null or (kind = 'card' and issuer in
      ('shinhan', 'samsung', 'kb', 'hyundai', 'lotte', 'hana', 'woori', 'nh', 'bc', 'other'))
  ),
  institution text check (institution is null or (kind = 'account' and
    institution = btrim(institution) and char_length(institution) between 1 and 60)),
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);

create unique index work_office_payment_methods_name_unique
  on public.work_office_payment_methods (lower(name));

alter table public.work_office_payment_methods enable row level security;
revoke all on public.work_office_payment_methods from public, anon, authenticated;
grant select, insert, update on public.work_office_payment_methods to authenticated;

create policy "Work center owner manages payment method aliases"
  on public.work_office_payment_methods
  for all
  to authenticated
  using (
    exists (
      select 1 from public.wd_staff_profiles p
      where p.user_id = (select auth.uid())
        and p.login_id = 'kfcyk50'
        and p.staff_role = 'owner'
        and p.is_active
        and 'work' = any(p.allowed_spaces)
    )
  )
  with check (
    exists (
      select 1 from public.wd_staff_profiles p
      where p.user_id = (select auth.uid())
        and p.login_id = 'kfcyk50'
        and p.staff_role = 'owner'
        and p.is_active
        and 'work' = any(p.allowed_spaces)
    )
  );

alter table public.work_finance_transactions
  add column payment_method_id uuid references public.work_office_payment_methods(id);
alter table public.work_subscriptions
  add column payment_method_id uuid references public.work_office_payment_methods(id);

commit;
