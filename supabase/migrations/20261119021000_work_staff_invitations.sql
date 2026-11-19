-- Review migration for WD ADMIN. Pending invitations are private until Google verifies the employee.
create table wd_auth_private.work_invitation_options
(like public.wd_work_center_test_access including defaults including constraints including indexes);
revoke all on wd_auth_private.work_invitation_options from public, anon, authenticated;

create function wd_auth_private.require_work_owner() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.wd_staff_profiles where user_id=auth.uid()
    and is_active and login_id='kfcyk50' and staff_role='owner') then
    raise insufficient_privilege;
  end if;
end $$;
revoke all on function wd_auth_private.require_work_owner() from public,anon,authenticated;

create function public.wd_work_pending_invitations() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform wd_auth_private.require_work_owner();
  return (select coalesce(jsonb_agg(to_jsonb(o)||'{"pending":true}'::jsonb),'[]'::jsonb)
          from wd_auth_private.work_invitation_options o);
end $$;

create function public.wd_work_save_invitation(p_grant jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  g wd_auth_private.work_invitation_options;
  prev wd_auth_private.work_invitation_options;
begin
  perform wd_auth_private.require_work_owner();
  select * into g from jsonb_populate_record(null::wd_auth_private.work_invitation_options,p_grant);
  g.google_email := lower(trim(g.google_email));
  if g.staff_key !~ '^staff_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or g.login_id is distinct from g.staff_key or g.google_email in ('kfcyk20@gmail.com','woori08944@gmail.com')
    then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended(g.staff_key,0));
  select * into prev from wd_auth_private.work_invitation_options where staff_key=g.staff_key for update;
  if exists(select from public.wd_work_center_test_access where staff_key=g.staff_key or login_id=g.login_id or lower(google_email)=g.google_email)
    or exists(select from public.wd_staff_profiles where login_id=g.login_id)
    or exists(select from wd_auth_private.work_google_enrollments where
      (staff_key=g.staff_key or login_id=g.login_id or google_email=g.google_email)
      and (activated_at is not null or prev.staff_key is null or staff_key<>g.staff_key))
    then raise unique_violation; end if;
  if prev.staff_key is not null then
    delete from wd_auth_private.work_google_enrollments where staff_key=g.staff_key and activated_at is null;
    if exists(select from public.wd_work_center_test_access where staff_key=g.staff_key) then raise serialization_failure; end if;
    delete from wd_auth_private.work_invitation_options where staff_key=g.staff_key;
  end if;
  insert into wd_auth_private.work_invitation_options select g.*;
  if g.enabled then
    insert into wd_auth_private.work_google_enrollments(google_email,login_id,staff_key,display_name)
      values(g.google_email,g.login_id,g.staff_key,g.display_name);
  end if;
  return to_jsonb(g)||'{"pending":true}'::jsonb;
end $$;

-- The existing activation function has already verified Google identity. Consume only its matching invitation.
create function wd_auth_private.apply_work_invitation() returns trigger
language plpgsql security definer set search_path='' as $$
declare g wd_auth_private.work_invitation_options;
begin
  delete from wd_auth_private.work_invitation_options where staff_key=new.staff_key and login_id=new.login_id
    and enabled and google_email=new.google_email returning * into g;
  if found then
    new.access_role=g.access_role; new.visible_menus=g.visible_menus;
    new.manual_actions=g.manual_actions; new.archive_actions=g.archive_actions;
    new.manual_categories=g.manual_categories; new.archive_categories=g.archive_categories;
  end if;
  return new;
end $$;
revoke all on function wd_auth_private.apply_work_invitation() from public,anon,authenticated;
create trigger wd_staff_apply_invitation before insert on public.wd_work_center_test_access
for each row execute function wd_auth_private.apply_work_invitation();

revoke all on function public.wd_work_save_invitation(jsonb),public.wd_work_pending_invitations() from public,anon;
grant execute on function public.wd_work_save_invitation(jsonb),public.wd_work_pending_invitations() to authenticated;
