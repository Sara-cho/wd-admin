-- Review with all existing attendance/payroll consumers before production.
-- Apply to every request alongside existing permissive policies. Service roles keep their existing behavior.
create function wd_auth_private.can_access_work_hours(p_login_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.wd_staff_profiles p
    where p.user_id=auth.uid() and p.is_active and (
      (p.staff_role='owner' and p.login_id='kfcyk50') or
      (p.login_id=p_login_id and (
        (p.staff_role='ops_lead' and p.login_id='kfcyk30') or
        (p.staff_role='assistant_staff' and exists (
          select 1 from public.wd_work_center_test_access g join auth.identities i on i.user_id=p.user_id
          where g.login_id=p.login_id and g.enabled and i.provider='google'
            and i.identity_data->'email_verified'='true'::jsonb
            and lower(i.identity_data->>'email')=lower(g.google_email)
        ))
      ))
    )
  );
$$;
revoke all on function wd_auth_private.can_access_work_hours(text) from public,anon;
grant execute on function wd_auth_private.can_access_work_hours(text) to authenticated;
create policy work_hours_no_guest on public.work_hours as restrictive for all to anon
using (false) with check(false);
create policy work_hours_authorized_rows on public.work_hours as restrictive for all to authenticated
using (wd_auth_private.can_access_work_hours(user_id))
with check (wd_auth_private.can_access_work_hours(user_id));
