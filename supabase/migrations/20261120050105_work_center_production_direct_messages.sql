-- Work Center direct messages. The existing owner / operations conversation retains its original history.
create schema wd_work_talk;
revoke all on schema wd_work_talk from public, anon, authenticated;

create table wd_work_talk.rooms (
  id uuid primary key default gen_random_uuid(),
  member_a uuid not null references public.wd_staff_profiles(user_id),
  member_b uuid not null references public.wd_staff_profiles(user_id),
  created_at timestamptz not null default now(),
  check (member_a < member_b),
  unique (member_a, member_b)
);
create table wd_work_talk.messages (
  id uuid primary key,
  seq bigint generated always as identity unique,
  room_id uuid not null references wd_work_talk.rooms,
  sender_id uuid not null references public.wd_staff_profiles(user_id),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index on wd_work_talk.messages (room_id, seq desc);
create table wd_work_talk.reads (
  room_id uuid not null references wd_work_talk.rooms,
  reader_id uuid not null references public.wd_staff_profiles(user_id),
  through_seq bigint not null,
  primary key (room_id, reader_id)
);
alter table wd_work_talk.rooms enable row level security;
alter table wd_work_talk.messages enable row level security;
alter table wd_work_talk.reads enable row level security;
revoke all on all tables in schema wd_work_talk from public, anon, authenticated;
revoke all on all sequences in schema wd_work_talk from public, anon, authenticated;

create view wd_work_talk.people as
select p.user_id as uid, p.login_id, coalesce(nullif(trim(a.display_name),''),p.display_name) as name,
  p.staff_role='owner' as is_owner, p.login_id='kfcyk30' and p.staff_role='ops_lead' as legacy, a.google_email
from public.wd_staff_profiles p left join public.wd_work_center_test_access a on a.login_id=p.login_id
where p.is_active and (
  (p.login_id='kfcyk50' and p.staff_role='owner') or
  (p.login_id='kfcyk30' and p.staff_role='ops_lead' and coalesce(a.enabled,true)) or
  (p.staff_role='assistant_staff' and a.enabled)
);
revoke all on wd_work_talk.people from public, anon, authenticated;

create function wd_work_talk.peers()
returns table(peer_id uuid,peer_name text,peer_owner boolean,legacy boolean)
language sql stable set search_path='' as $$
  select p.uid,p.name,p.is_owner,(me.is_owner and p.legacy) or (me.legacy and p.is_owner)
  from wd_work_talk.people me join wd_work_talk.people p on p.uid<>me.uid
  where me.uid=auth.uid()
$$;
create function wd_work_talk.room_for(p_peer uuid)
returns uuid language plpgsql stable set search_path='' as $$
declare v_room uuid;
begin
  select r.id into v_room from wd_work_talk.peers() p join wd_work_talk.rooms r
    on r.member_a=least(auth.uid(),p.peer_id)
    and r.member_b=greatest(auth.uid(),p.peer_id)
    where p.peer_id=p_peer and not p.legacy;
  if v_room is null then raise exception using errcode='42501',message='대화방을 이용할 수 없어요.'; end if;
  return v_room;
end $$;

create function public.wd_work_talk_directory()
returns table(peer_id uuid,peer_name text,peer_owner boolean,legacy boolean,started boolean,unread_count bigint,last_at timestamptz)
language sql stable security definer set search_path='' as $$
  select p.peer_id,p.peer_name,p.peer_owner,p.legacy,p.legacy or r.id is not null,
    (select count(*) from wd_work_talk.messages m where m.room_id=r.id
       and m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0)),
    coalesce((select m.created_at from wd_work_talk.messages m where m.room_id=r.id order by m.seq desc limit 1),r.created_at)
  from wd_work_talk.peers() p left join wd_work_talk.rooms r
    on r.member_a=least(auth.uid(),p.peer_id)
    and r.member_b=greatest(auth.uid(),p.peer_id)
    left join wd_work_talk.reads rd on rd.room_id=r.id and rd.reader_id=auth.uid()
  order by 7 desc nulls last,2,1
$$;
create function public.wd_work_talk_open(p_peer uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from wd_work_talk.peers() p where p.peer_id=p_peer and not p.legacy) then
    raise exception using errcode='42501',message='대화 상대를 확인해 주세요.';
  end if;
  insert into wd_work_talk.rooms(member_a,member_b) values(least(auth.uid(),p_peer),greatest(auth.uid(),p_peer))
    on conflict do nothing;
end $$;
create function public.wd_work_talk_history(p_peer uuid,p_search text default '',p_after uuid default null,p_backup boolean default false)
returns table(id uuid,sender_id uuid,body text,created_at timestamptz,seq bigint,is_unread boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_room uuid;
begin
  v_room:=wd_work_talk.room_for(p_peer);
  if p_backup then
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk.messages m
        left join wd_work_talk.reads rd on (rd.room_id,rd.reader_id)=(m.room_id,auth.uid())
      where m.room_id=v_room and (p_after is null or m.id>p_after) order by m.id limit 200;
  else
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk.messages m
        left join wd_work_talk.reads rd on (rd.room_id,rd.reader_id)=(m.room_id,auth.uid())
      where m.room_id=v_room and (coalesce(p_search,'')='' or strpos(lower(m.body),lower(left(p_search,100)))>0)
      order by m.seq desc limit 300;
  end if;
end $$;
create function public.wd_work_talk_send(p_peer uuid,p_id uuid,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare v_room uuid;
begin
  v_room:=wd_work_talk.room_for(p_peer);
  perform 1 from wd_work_talk.rooms where id=v_room for update;
  if exists(select 1 from wd_work_talk.messages where id=p_id and room_id=v_room and sender_id=auth.uid() and body=p_body) then return; end if;
  insert into wd_work_talk.messages(id,room_id,sender_id,body) values(p_id,v_room,auth.uid(),p_body);
end $$;
create function public.wd_work_talk_read(p_peer uuid,p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_room uuid; v_seq bigint;
begin
  v_room:=wd_work_talk.room_for(p_peer);
  select seq into v_seq from wd_work_talk.messages where room_id=v_room and id=p_message and sender_id<>auth.uid();
  if v_seq is not null then
    insert into wd_work_talk.reads as r(room_id,reader_id,through_seq) values(v_room,auth.uid(),v_seq)
      on conflict(room_id,reader_id) do update set through_seq=excluded.through_seq where r.through_seq<excluded.through_seq;
  end if;
end $$;
create function public.wd_work_talk_delete_backed_up(p_peer uuid,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare v_room uuid; n integer;
begin
  v_room:=wd_work_talk.room_for(p_peer);
  if not exists(select 1 from wd_work_talk.people where uid=auth.uid() and is_owner) then
    raise exception using errcode='42501',message='대표 계정에서 이용해 주세요.';
  end if;
  delete from wd_work_talk.messages where room_id=v_room and id=any(p_ids);
  get diagnostics n = row_count; return n;
end $$;
create function public.wd_work_talk_peer_email(p_peer uuid)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  perform wd_work_talk.room_for(p_peer);
  return (select google_email from wd_work_talk.people where uid=p_peer);
end $$;
revoke all on all functions in schema wd_work_talk from public, anon, authenticated;
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('wd_work_talk_directory','wd_work_talk_open','wd_work_talk_history','wd_work_talk_send','wd_work_talk_read','wd_work_talk_delete_backed_up','wd_work_talk_peer_email')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',fn);
    execute format('grant execute on function %s to authenticated',fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
