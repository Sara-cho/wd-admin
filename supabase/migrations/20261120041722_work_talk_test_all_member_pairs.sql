-- Upgrade only Work Center TEST objects. Existing room IDs keep their message and read references.
lock wd_work_talk_test.rooms, wd_work_talk_test.messages, wd_work_talk_test.reads in access exclusive mode;
drop function public.wd_work_talk_test_directory();
drop function public.wd_work_talk_test_open(uuid);
drop function public.wd_work_talk_test_history(uuid,text,uuid,boolean);
drop function public.wd_work_talk_test_send(uuid,uuid,text);
drop function public.wd_work_talk_test_read(uuid,uuid);
drop function public.wd_work_talk_test_delete_backed_up(uuid,uuid[]);
drop function public.wd_work_talk_test_peer_email(uuid);
drop function wd_work_talk_test.require_room(uuid);
drop function wd_work_talk_test.pairs();

alter table wd_work_talk_test.rooms add column id uuid;
update wd_work_talk_test.rooms set id=staff_id;
alter table wd_work_talk_test.rooms alter column id set default gen_random_uuid(), alter column id set not null;
alter table wd_work_talk_test.messages drop constraint messages_staff_id_fkey;
alter table wd_work_talk_test.reads drop constraint reads_staff_id_fkey;
alter table wd_work_talk_test.rooms drop constraint rooms_pkey;
alter table wd_work_talk_test.rooms add primary key (id);
alter table wd_work_talk_test.rooms rename column staff_id to member_a;
alter table wd_work_talk_test.rooms rename column owner_id to member_b;
create unique index rooms_unordered_pair on wd_work_talk_test.rooms
  (least(member_a,member_b),greatest(member_a,member_b));
alter table wd_work_talk_test.messages rename column staff_id to room_id;
alter table wd_work_talk_test.reads rename column staff_id to room_id;
alter table wd_work_talk_test.messages add foreign key(room_id) references wd_work_talk_test.rooms(id);
alter table wd_work_talk_test.reads add foreign key(room_id) references wd_work_talk_test.rooms(id);

create function wd_work_talk_test.peers()
returns table(peer_id uuid,peer_name text,peer_owner boolean,legacy boolean)
language sql stable set search_path='' as $$
  select p.uid,p.name,p.is_owner,(me.is_owner and p.legacy) or (me.legacy and p.is_owner)
  from wd_work_talk_test.people me join wd_work_talk_test.people p on p.uid<>me.uid
  where me.uid=auth.uid()
$$;
create function wd_work_talk_test.room_for(p_peer uuid)
returns uuid language plpgsql stable set search_path='' as $$
declare v_room uuid;
begin
  select r.id into v_room from wd_work_talk_test.peers() p join wd_work_talk_test.rooms r
    on least(r.member_a,r.member_b)=least(auth.uid(),p.peer_id)
    and greatest(r.member_a,r.member_b)=greatest(auth.uid(),p.peer_id)
    where p.peer_id=p_peer and not p.legacy;
  if v_room is null then raise exception using errcode='42501',message='대화방을 이용할 수 없어요.'; end if;
  return v_room;
end $$;

create function public.wd_work_talk_test_directory()
returns table(peer_id uuid,peer_name text,peer_owner boolean,legacy boolean,started boolean,unread_count bigint,last_at timestamptz)
language sql stable security definer set search_path='' as $$
  select p.peer_id,p.peer_name,p.peer_owner,p.legacy,p.legacy or r.id is not null,
    (select count(*) from wd_work_talk_test.messages m where m.room_id=r.id
       and m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0)),
    coalesce((select m.created_at from wd_work_talk_test.messages m where m.room_id=r.id order by m.seq desc limit 1),r.created_at)
  from wd_work_talk_test.peers() p left join wd_work_talk_test.rooms r
    on least(r.member_a,r.member_b)=least(auth.uid(),p.peer_id)
    and greatest(r.member_a,r.member_b)=greatest(auth.uid(),p.peer_id)
    left join wd_work_talk_test.reads rd on rd.room_id=r.id and rd.reader_id=auth.uid()
  order by 7 desc nulls last,2,1
$$;
create function public.wd_work_talk_test_open(p_peer uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from wd_work_talk_test.peers() p where p.peer_id=p_peer and not p.legacy) then
    raise exception using errcode='42501',message='대화 상대를 확인해 주세요.';
  end if;
  insert into wd_work_talk_test.rooms(member_a,member_b) values(least(auth.uid(),p_peer),greatest(auth.uid(),p_peer))
    on conflict do nothing;
end $$;
create function public.wd_work_talk_test_history(p_peer uuid,p_search text default '',p_after uuid default null,p_backup boolean default false)
returns table(id uuid,sender_id uuid,body text,created_at timestamptz,seq bigint,is_unread boolean)
language plpgsql stable security definer set search_path='' as $$
declare v_room uuid;
begin
  v_room:=wd_work_talk_test.room_for(p_peer);
  if p_backup then
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk_test.messages m
        left join wd_work_talk_test.reads rd on (rd.room_id,rd.reader_id)=(m.room_id,auth.uid())
      where m.room_id=v_room and (p_after is null or m.id>p_after) order by m.id limit 200;
  else
    return query select m.id,m.sender_id,m.body,m.created_at,m.seq,
      m.sender_id<>auth.uid() and m.seq>coalesce(rd.through_seq,0) from wd_work_talk_test.messages m
        left join wd_work_talk_test.reads rd on (rd.room_id,rd.reader_id)=(m.room_id,auth.uid())
      where m.room_id=v_room and (coalesce(p_search,'')='' or strpos(lower(m.body),lower(left(p_search,100)))>0)
      order by m.seq desc limit 300;
  end if;
end $$;
create function public.wd_work_talk_test_send(p_peer uuid,p_id uuid,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare v_room uuid;
begin
  v_room:=wd_work_talk_test.room_for(p_peer);
  perform 1 from wd_work_talk_test.rooms where id=v_room for update;
  if exists(select 1 from wd_work_talk_test.messages where id=p_id and room_id=v_room and sender_id=auth.uid() and body=p_body) then return; end if;
  insert into wd_work_talk_test.messages(id,room_id,sender_id,body) values(p_id,v_room,auth.uid(),p_body);
end $$;
create function public.wd_work_talk_test_read(p_peer uuid,p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_room uuid; v_seq bigint;
begin
  v_room:=wd_work_talk_test.room_for(p_peer);
  select seq into v_seq from wd_work_talk_test.messages where room_id=v_room and id=p_message and sender_id<>auth.uid();
  if v_seq is not null then
    insert into wd_work_talk_test.reads as r(room_id,reader_id,through_seq) values(v_room,auth.uid(),v_seq)
      on conflict(room_id,reader_id) do update set through_seq=excluded.through_seq where r.through_seq<excluded.through_seq;
  end if;
end $$;
create function public.wd_work_talk_test_delete_backed_up(p_peer uuid,p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare v_room uuid; n integer;
begin
  v_room:=wd_work_talk_test.room_for(p_peer);
  if not exists(select 1 from wd_work_talk_test.people where uid=auth.uid() and is_owner) then
    raise exception using errcode='42501',message='대표 계정에서 이용해 주세요.';
  end if;
  delete from wd_work_talk_test.messages where room_id=v_room and id=any(p_ids);
  get diagnostics n = row_count; return n;
end $$;
create function public.wd_work_talk_test_peer_email(p_peer uuid)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  perform wd_work_talk_test.room_for(p_peer);
  return (select google_email from wd_work_talk_test.people where uid=p_peer);
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
