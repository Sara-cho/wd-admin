begin;

create table public.work_office_category_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision uuid not null,
  categories jsonb not null,
  constraint work_office_category_settings_format check (
    jsonb_typeof(categories) = 'object'
    and categories ?& array['수입', '지출']
    and categories - '수입' - '지출' = '{}'::jsonb
    and jsonb_typeof(categories -> '수입') = 'array'
    and jsonb_typeof(categories -> '지출') = 'array'
    and jsonb_path_exists(categories -> '수입', '$[*] ? (@.archived == false)')
    and jsonb_path_exists(categories -> '지출', '$[*] ? (@.archived == false)')
  )
);

alter table public.work_office_category_settings enable row level security;

revoke all on table public.work_office_category_settings from public, anon, authenticated;
grant select, insert, update on table public.work_office_category_settings to authenticated;

create policy work_office_category_settings_owner
  on public.work_office_category_settings
  for all
  to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.wd_staff_profiles as profile
      where profile.user_id = work_office_category_settings.owner_id
        and profile.staff_role = 'owner'
        and profile.is_active
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.wd_staff_profiles as profile
      where profile.user_id = work_office_category_settings.owner_id
        and profile.staff_role = 'owner'
        and profile.is_active
    )
  );

commit;
