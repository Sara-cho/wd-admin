begin;

create function public.wd_talk_delete_backed_up(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if not exists (
    select 1 from public.wd_staff_profiles p
    where p.user_id = (select auth.uid())
      and p.is_active
      and p.staff_role = 'owner'
      and p.login_id = 'kfcyk50'
  ) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  delete from public.wd_talk_messages
  where id = any(p_message_ids);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.wd_talk_delete_backed_up(uuid[]) from public, anon, authenticated;
grant execute on function public.wd_talk_delete_backed_up(uuid[]) to authenticated;

commit;
