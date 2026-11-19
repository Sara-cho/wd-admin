create function public.wd_work_drive_connection(p_new text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(742389540);
  select id into secret_id from vault.secrets where name='wd_work_drive_owner_offline';
  if p_new is not null then
    if length(p_new)<10 or length(p_new)>8192 then raise exception 'invalid credential'; end if;
    if secret_id is null then
      perform vault.create_secret(p_new,'wd_work_drive_owner_offline');
    else
      perform vault.update_secret(secret_id,p_new);
    end if;
    return null;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where id=secret_id);
end;
$$;
revoke all on function public.wd_work_drive_connection(text) from public,anon,authenticated;
grant execute on function public.wd_work_drive_connection(text) to service_role;
