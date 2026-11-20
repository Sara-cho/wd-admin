-- Isolated Work Center TEST objects. The existing two-person TALK remains in its original tables.
create schema wd_work_talk_test;
revoke all on schema wd_work_talk_test from public, anon, authenticated;

create table wd_work_talk_test.rooms (
  staff_id uuid primary key references public.wd_staff_profiles(user_id),
  owner_id uuid not null references public.wd_staff_profiles(user_id),
  created_at timestamptz not null default now(),
  check (staff_id <> owner_id)
);
create table wd_work_talk_test.messages (
  id uuid primary key,
  seq bigint generated always as identity unique,
  staff_id uuid not null references wd_work_talk_test.rooms,
  sender_id uuid not null references public.wd_staff_profiles(user_id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index on wd_work_talk_test.messages (staff_id, seq desc);
create table wd_work_talk_test.reads (
  staff_id uuid not null references wd_work_talk_test.rooms,
  reader_id uuid not null references public.wd_staff_profiles(user_id),
  through_seq bigint not null,
  primary key (staff_id, reader_id)
);
alter table wd_work_talk_test.rooms enable row level security;
alter table wd_work_talk_test.messages enable row level security;
alter table wd_work_talk_test.reads enable row level security;
revoke all on all tables in schema wd_work_talk_test from public, anon, authenticated;
revoke all on all sequences in schema wd_work_talk_test from public, anon, authenticated;

create view wd_work_talk_test.people as
select p.user_id as uid, p.login_id, coalesce(nullif(trim(a.display_name),''),p.display_name) as name,
  p.staff_role='owner' as is_owner, p.login_id='kfcyk30' and p.staff_role='ops_lead' as legacy, a.google_email
from public.wd_staff_profiles p left join public.wd_work_center_test_access a on a.login_id=p.login_id
where p.is_active and (
  (p.login_id='kfcyk50' and p.staff_role='owner') or
  (p.login_id='kfcyk30' and p.staff_role='ops_lead' and coalesce(a.enabled,true)) or
  (p.staff_role='assistant_staff' and a.enabled)
);
revoke all on wd_work_talk_test.people from public, anon, authenticated;

create function wd_work_talk_test.pairs()
returns table (staff_id uuid,owner_id uuid,peer_name text,legacy boolean)
language sql stable set search_path='' as $$
  select s.uid,o.uid,case when auth.uid()=o.uid then s.name else o.name end,s.legacy
  from wd_work_talk_test.people o cross join wd_work_talk_test.people s
  where o.is_owner and not s.is_owner and auth.uid() in (s.uid,o.uid)
$$;
create function wd_work_talk_test.require_room(p_staff uuid)
returns void language plpgsql stable set search_path='' as $$
begin
  if not exists(select 1 from wd_work_talk_test.pairs() p join wd_work_talk_test.rooms r
    on (r.staff_id,r.owner_id)=(p.staff_id,p.owner_id) where p.staff_id=p_staff and not p.legacy) then
    raise exception using errcode='42501',message='대화방을 이용할 수 없어요.';
  end if;
end $$;

create function public.wd_work_talk_test_directory()
returns table(staff_id uuid,peer_name text,legacy boolean,started boolean,unread_count bigint,last_at timestamptz)
language sql stable security definer set search_path='' as $$
  select p.staff_id,p.peer_name,p.legacy,p.legacy or r.staff_id is not null,
    (select count(*) from wd_work_talk_test.messages m where m.staff_id=r.staff_id
       and m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0)),
    coalesce((select m.created_at from wd_work_talk_test.messages m where m.staff_id=r.staff_id
       order by m.seq desc limit 1),r.created_at)
  from wd_work_talk_test.pairs() p left join wd_work_talk_test.rooms r
    on (r.staff_id,r.owner_id)=(p.staff_id,p.owner_id)
    left join wd_work_talk_test.reads rd on rd.staff_id=r.staff_id and rd.reader_id=auth.uid()
  order by 6 desc nulls last,2,1
$$;
create function public.wd_work_talk_test_open(p_staff uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from wd_work_talk_test.pairs() where staff_id=p_staff and not legacy;
  if v_owner is null then raise exception using errcode='42501',message='대화 상대를 확인해 주세요.'; end if;
  insert into wd_work_talk_test.rooms(staff_id,owner_id) values(p_staff,v_owner) on conflict(staff_id) do nothing;
  perform wd_work_talk_test.require_room(p_staff);
end $$;
create function public.wd_work_talk_test_history(p_staff uuid,p_search text default '',p_after uuid default null,p_backup boolean default false)
returns table(id uuid,sender_id uuid,body text,created_at timestamptz,seq bigint,is_unread boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  perform wd_work_talk_test.require_room(p_staff);
  if p_backup then
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk_test.messages m
        left join wd_work_talk_test.reads rd on (rd.staff_id,rd.reader_id)=(m.staff_id,auth.uid())
      where m.staff_id=p_staff and (p_after is null or m.id>p_after) order by m.id limit 200;
  else
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk_test.messages m
        left join wd_work_talk_test.reads rd on (rd.staff_id,rd.reader_id)=(m.staff_id,auth.uid())
      where m.staff_id=p_staff and (coalesce(p_search,'')='' or strpos(lower(m.body),lower(left(p_search,100)))>0)
      order by m.seq desc limit 300;
  end if;
end $$;
create function public.wd_work_talk_test_send(p_staff uuid,p_id uuid,p_body text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform wd_work_talk_test.require_room(p_staff);
  perform 1 from wd_work_talk_test.rooms where staff_id=p_staff for update;
  if exists(select 1 from wd_work_talk_test.messages where id=p_id and staff_id=p_staff and sender_id=auth.uid() and body=p_body) then return; end if;
  insert into wd_work_talk_test.messages(id,staff_id,sender_id,body) values(p_id,p_staff,auth.uid(),p_body);
end $$;
create function public.wd_work_talk_test_read(p_staff uuid,p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_seq bigint;
begin
  perform wd_work_talk_test.require_room(p_staff);
  select seq into v_seq from wd_work_talk_test.messages where staff_id=p_staff and id=p_message and sender_id<>auth.uid();
  if v_seq is not null then
    insert into wd_work_talk_test.reads as r(staff_id,reader_id,through_seq) values(p_staff,auth.uid(),v_seq)
      on conflict(staff_id,reader_id) do update set through_seq=excluded.through_seq where r.through_seq<excluded.through_seq;
  end if;
end $$;
create function public.wd_work_talk_test_delete_backed_up(p_staff uuid,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  perform wd_work_talk_test.require_room(p_staff);
  if auth.uid()<>(select owner_id from wd_work_talk_test.rooms where staff_id=p_staff) then
    raise exception using errcode='42501',message='대표 계정에서 이용해 주세요.';
  end if;
  delete from wd_work_talk_test.messages where staff_id=p_staff and id=any(p_ids);
  get diagnostics n = row_count; return n;
end $$;
create function public.wd_work_talk_test_peer_email(p_staff uuid)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  perform wd_work_talk_test.require_room(p_staff);
  -- The owner's verified company mailbox is already configured in the Work Center.
  if auth.uid()=p_staff then return null; end if;
  return (select google_email from wd_work_talk_test.people where uid=p_staff);
end $$;

revoke all on all functions in schema wd_work_talk_test from public, anon, authenticated;
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('wd_work_talk_test_directory','wd_work_talk_test_open','wd_work_talk_test_history','wd_work_talk_test_send','wd_work_talk_test_read','wd_work_talk_test_delete_backed_up','wd_work_talk_test_peer_email')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',fn);
    execute format('grant execute on function %s to authenticated',fn);
  end loop;
end $$;
