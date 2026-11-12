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
  has_card_number boolean not null default false check (
    not has_card_number or (kind = 'card' and last_four is not null)
  ),
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);

create unique index work_office_payment_methods_name_unique
  on public.work_office_payment_methods (lower(name));

alter table public.work_office_payment_methods enable row level security;
revoke all on public.work_office_payment_methods from public, anon, authenticated;
grant select on public.work_office_payment_methods to authenticated;

create policy "Work center owner manages payment method aliases"
  on public.work_office_payment_methods
  for select
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
  );

alter table public.work_finance_transactions
  add column payment_method_id uuid references public.work_office_payment_methods(id);
alter table public.work_subscriptions
  add column payment_method_id uuid references public.work_office_payment_methods(id);

create schema wd_office_private;
revoke all on schema wd_office_private from public, anon, authenticated;

create table wd_office_private.card_number_secrets (
  method_id uuid primary key references public.work_office_payment_methods(id),
  secret_id uuid not null unique references vault.secrets(id)
);
revoke all on wd_office_private.card_number_secrets from public, anon, authenticated;

create function wd_office_private.is_payment_owner()
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.wd_staff_profiles p
    where p.user_id = (select auth.uid())
      and p.login_id = 'kfcyk50'
      and p.staff_role = 'owner'
      and p.is_active
      and 'work' = any(p.allowed_spaces)
  );
$$;
revoke all on function wd_office_private.is_payment_owner() from public, anon, authenticated;

create function public.work_office_save_payment_method(
  p_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_card_number text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  method public.work_office_payment_methods%rowtype;
  existing_secret uuid;
begin
  if not wd_office_private.is_payment_owner() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_expected_updated_at is null then
    method.kind := p_changes->>'kind';
    method.archived := false;
    if method.kind is null or method.kind not in ('card', 'account') then
      raise exception 'Invalid payment method type' using errcode = '22023';
    end if;
  else
    select * into method from public.work_office_payment_methods
      where id = p_id and updated_at = p_expected_updated_at for update;
    if not found then
      raise exception 'Payment method changed' using errcode = '40001';
    end if;
  end if;

  if p_card_number is not null and (method.kind <> 'card' or p_card_number !~ '^[0-9]{12,19}$') then
    raise exception 'Invalid card number' using errcode = '22023';
  end if;

  if p_changes ? 'name' then method.name := p_changes->>'name'; end if;
  if p_changes ? 'issuer' then method.issuer := p_changes->>'issuer'; end if;
  if p_changes ? 'institution' then method.institution := p_changes->>'institution'; end if;
  if p_changes ? 'archived' then method.archived := (p_changes->>'archived')::boolean; end if;
  if method.kind = 'account' and p_changes ? 'last_four' then method.last_four := p_changes->>'last_four'; end if;
  if p_card_number is not null then method.last_four := right(p_card_number, 4); end if;
  method.has_card_number := coalesce(method.has_card_number, false) or p_card_number is not null;

  if p_expected_updated_at is null then
    insert into public.work_office_payment_methods(id,kind,name,issuer,institution,last_four,has_card_number,archived)
      values (p_id,method.kind,method.name,method.issuer,method.institution,method.last_four,method.has_card_number,method.archived);
  else
    update public.work_office_payment_methods
      set name=method.name, issuer=method.issuer, institution=method.institution, last_four=method.last_four,
          has_card_number=method.has_card_number, archived=method.archived, updated_at=clock_timestamp()
      where id=p_id;
  end if;

  if p_card_number is not null then
    select secret_id into existing_secret from wd_office_private.card_number_secrets where method_id=p_id;
    if found then
      perform vault.update_secret(existing_secret, p_card_number);
    else
      insert into wd_office_private.card_number_secrets(method_id,secret_id)
        values (p_id,vault.create_secret(p_card_number));
    end if;
  end if;
  return p_id;
end;
$$;
revoke all on function public.work_office_save_payment_method(uuid,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function public.work_office_save_payment_method(uuid,timestamptz,jsonb,text) to authenticated;

create function public.work_office_reveal_card_number(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  card_number text;
begin
  if not wd_office_private.is_payment_owner() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  perform set_config('response.headers','[{"Cache-Control":"private, no-store"},{"Pragma":"no-cache"}]',true);
  select secret.decrypted_secret into card_number
  from wd_office_private.card_number_secrets mapping
  join vault.decrypted_secrets secret on secret.id=mapping.secret_id
  where mapping.method_id=p_id;
  return card_number;
end;
$$;
revoke all on function public.work_office_reveal_card_number(uuid) from public, anon, authenticated;
grant execute on function public.work_office_reveal_card_number(uuid) to authenticated;

commit;
