create table public.wd_work_drive_items (
  staff_key text not null,
  item_key text not null,
  drive_id text not null unique,
  fingerprint text not null default '',
  primary key(staff_key,item_key)
);
alter table public.wd_work_drive_items enable row level security;
revoke all on public.wd_work_drive_items from public, anon, authenticated;
grant select, insert on public.wd_work_drive_items to service_role;

create function public.wd_work_report_folders()
returns table(staff_key text,folder_id text)
language plpgsql security definer set search_path = '' as $$
begin
  perform wd_auth_private.require_work_owner();
  return query select i.staff_key,i.drive_id from public.wd_work_drive_items i where i.item_key='folder';
end;
$$;
revoke all on function public.wd_work_report_folders() from public,anon;
grant execute on function public.wd_work_report_folders() to authenticated;
