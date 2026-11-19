-- =====================================================================
-- Prayer Wall – Supabase database setup
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run again: it only creates what is missing and replaces functions.
--
-- How security works: the browser only holds the public API key, which can
-- call the functions below but cannot read or write any table directly.
-- Every function checks the member's session token and enforces the rules
-- (owner-only edit/delete/answer, admin-only member management, etc.).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables ----------
create table if not exists public.users (
  id bigint generated always as identity primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  is_admin boolean not null default false,
  must_change_password boolean not null default true,
  avatar text not null default '🙂',
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token text primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists public.requests (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'General',
  status text not null default 'active' check (status in ('active', 'answered')),
  answer_note text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prayers (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.requests(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text not null
);

create table if not exists public.attempts (
  key text primary key,
  n int not null,
  first_at timestamptz not null
);

create index if not exists idx_prayers_request on public.prayers(request_id);
create index if not exists idx_prayers_user on public.prayers(user_id, created_at);
create index if not exists idx_requests_user on public.requests(user_id);
create index if not exists idx_sessions_user on public.sessions(user_id);

-- Lock every table: no direct access from the browser at all.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.requests enable row level security;
alter table public.prayers enable row level security;
alter table public.settings enable row level security;
alter table public.attempts enable row level security;
revoke all on public.users, public.sessions, public.requests, public.prayers,
  public.settings, public.attempts from anon, authenticated;

-- =====================================================================
-- Internal helpers (not callable from the browser)
-- =====================================================================

create or replace function public._default_password() returns text
language sql immutable as $$ select 'p@ssw0rd'::text $$;

create or replace function public._avatars() returns text[]
language sql immutable as $$
  select array['🙂','😊','🕊️','🌻','🌿','⭐','🔥','🦁','🐑','🌈','☀️','💧','🍇','🌾','⛰️','🎵']
$$;

create or replace function public._categories() returns text[]
language sql immutable as $$
  select array['General','Health','Family','Work','Studies','Finances','Spiritual','Thanksgiving']
$$;

create or replace function public._clean(p text, p_max int) returns text
language sql immutable as $$ select left(btrim(coalesce(p, '')), p_max) $$;

create or replace function public._user_json(u public.users) returns json
language sql stable as $$
  select json_build_object(
    'id', u.id, 'username', u.username, 'display_name', u.display_name, 'avatar', u.avatar,
    'is_admin', u.is_admin, 'must_change_password', u.must_change_password)
$$;

-- Session check. Errors carry a hint the app uses to react:
--   auth     → send to login screen
--   pwchange → send to change-password screen
create or replace function public._me(p_token text) returns public.users
language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.users;
begin
  select us.* into u from public.sessions s join public.users us on us.id = s.user_id
   where s.token = p_token and s.expires_at > now();
  if not found then
    raise exception 'Session expired, please log in again' using hint = 'auth';
  end if;
  return u;
end $$;

create or replace function public._me_ok(p_token text) returns public.users
language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.users;
begin
  u := public._me(p_token);
  if u.must_change_password then
    raise exception 'Please change your password first' using hint = 'pwchange';
  end if;
  return u;
end $$;

create or replace function public._admin(p_token text) returns public.users
language plpgsql stable security definer set search_path = public, extensions as $$
declare u public.users;
begin
  u := public._me_ok(p_token);
  if not u.is_admin then
    raise exception 'Only the System Admin can do this' using hint = 'forbidden';
  end if;
  return u;
end $$;

create or replace function public._new_session(p_user bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.sessions where expires_at < now();
  insert into public.sessions (token, user_id, expires_at) values (t, p_user, now() + interval '30 days');
  return t;
end $$;

-- Throttle: returns true if this key is blocked.
create or replace function public._blocked(p_key text, p_limit int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.attempts
                 where key = p_key and n >= p_limit and first_at > now() - interval '15 minutes')
$$;

create or replace function public._fail(p_key text) returns void
language sql security definer set search_path = public as $$
  insert into public.attempts (key, n, first_at) values (p_key, 1, now())
  on conflict (key) do update set
    n = case when attempts.first_at < now() - interval '15 minutes' then 1 else attempts.n + 1 end,
    first_at = case when attempts.first_at < now() - interval '15 minutes' then now() else attempts.first_at end
$$;

create or replace function public._new_invite_code() returns text
language sql volatile security definer set search_path = public, extensions as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
  from (select extensions.gen_random_bytes(6) as b) x, generate_series(0, 5) as i
$$;

create or replace function public._invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  select value into c from public.settings where key = 'invite_code';
  if c is null then
    c := public._new_invite_code();
    insert into public.settings (key, value) values ('invite_code', c)
      on conflict (key) do nothing;
    select value into c from public.settings where key = 'invite_code';
  end if;
  return c;
end $$;

create or replace function public._request_json(p_id bigint, p_me bigint) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', r.id, 'user_id', r.user_id, 'title', r.title, 'body', r.body, 'category', r.category,
    'status', r.status, 'answer_note', r.answer_note, 'answered_at', r.answered_at,
    'created_at', r.created_at, 'updated_at', r.updated_at,
    'author_name', u.display_name, 'author_avatar', u.avatar,
    'prayer_count', (select count(*) from public.prayers p where p.request_id = r.id),
    'is_mine', r.user_id = p_me,
    'prayed_by_me', exists (select 1 from public.prayers p where p.request_id = r.id and p.user_id = p_me))
  from public.requests r join public.users u on u.id = r.user_id
  where r.id = p_id
$$;

create or replace function public._own_request(p_me bigint, p_id bigint) returns public.requests
language plpgsql stable security definer set search_path = public as $$
declare r public.requests;
begin
  select * into r from public.requests where id = p_id;
  if not found then raise exception 'Prayer request not found' using hint = 'notfound'; end if;
  if r.user_id <> p_me then
    raise exception 'Only the person who posted this request can change it' using hint = 'forbidden';
  end if;
  return r;
end $$;

-- =====================================================================
-- Public API (called from the app)
-- Business errors that must still record a throttle attempt are returned
-- as {"error": "..."} because raising would roll back the attempt count.
-- =====================================================================

create or replace function public.setup_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('needsLeader', not exists (select 1 from public.users))
$$;

create or replace function public.login(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uname text := lower(public._clean(p_username, 40));
  k text := 'login:' || uname;
  u public.users;
begin
  if public._blocked(k, 10) then
    return json_build_object('error', 'Too many attempts. Try again in 15 minutes.');
  end if;
  select * into u from public.users where username = uname;
  if not found or u.password_hash <> extensions.crypt(coalesce(p_password, ''), u.password_hash) then
    perform public._fail(k);
    return json_build_object('error', 'Wrong username or password');
  end if;
  delete from public.attempts where key = k;
  return json_build_object('token', public._new_session(u.id), 'user', public._user_json(u));
end $$;

create or replace function public.register(p_display_name text, p_username text, p_password text, p_invite_code text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  dname text := public._clean(p_display_name, 40);
  uname text := lower(public._clean(p_username, 30));
  is_first boolean;
  u public.users;
begin
  perform pg_advisory_xact_lock(424242); -- only one sign-up at a time (first-admin race)
  is_first := not exists (select 1 from public.users);
  if not is_first then
    if public._blocked('register', 20) then
      return json_build_object('error', 'Too many attempts. Try again in 15 minutes.');
    end if;
    if upper(regexp_replace(coalesce(p_invite_code, ''), '\s', '', 'g')) <> public._invite_code() then
      perform public._fail('register');
      return json_build_object('error', 'That cell invite code is not right. Ask your system admin for it.');
    end if;
  end if;
  if dname = '' then raise exception 'Please enter your name'; end if;
  if uname !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if p_password = public._default_password() then
    raise exception 'Please choose a password other than the default';
  end if;
  if (select count(*) from public.users) >= 30 then raise exception 'Member limit reached (30)'; end if;
  if exists (select 1 from public.users where username = uname) then
    raise exception 'That username is already taken';
  end if;
  insert into public.users (username, display_name, password_hash, is_admin, must_change_password, avatar)
  values (uname, dname, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), is_first, false,
          case when is_first then '🕊️' else (public._avatars())[1 + floor(random() * 16)::int] end)
  returning * into u;
  return json_build_object('token', public._new_session(u.id), 'user', public._user_json(u), 'isLeader', is_first);
end $$;

create or replace function public.logout(p_token text) returns json
language sql security definer set search_path = public as $$
  delete from public.sessions where token = p_token;
  select json_build_object('ok', true)
$$;

create or replace function public.me(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return json_build_object('user', public._user_json(public._me(p_token)));
end $$;

create or replace function public.change_password(p_token text, p_current text, p_new text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users := public._me(p_token);
begin
  if u.password_hash <> extensions.crypt(coalesce(p_current, ''), u.password_hash) then
    raise exception 'Current password is incorrect';
  end if;
  if length(coalesce(p_new, '')) < 6 then raise exception 'New password must be at least 6 characters'; end if;
  if p_new = public._default_password() then
    raise exception 'Please choose a password other than the default';
  end if;
  update public.users set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)),
         must_change_password = false
   where id = u.id returning * into u;
  delete from public.sessions where user_id = u.id and token <> p_token; -- sign out other devices
  return json_build_object('user', public._user_json(u));
end $$;

create or replace function public.update_profile(p_token text, p_display_name text, p_avatar text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users := public._me_ok(p_token);
begin
  update public.users set
    display_name = coalesce(nullif(public._clean(p_display_name, 40), ''), display_name),
    avatar = case when p_avatar = any (public._avatars()) then p_avatar else avatar end
  where id = u.id returning * into u;
  return json_build_object('user', public._user_json(u));
end $$;

-- ---------- members ----------
create or replace function public.list_members(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._me_ok(p_token);
  return json_build_object('members', coalesce((
    select json_agg(json_build_object(
      'id', id, 'username', username, 'display_name', display_name, 'avatar', avatar,
      'is_admin', is_admin, 'must_change_password', must_change_password, 'created_at', created_at)
      order by is_admin desc, lower(display_name))
    from public.users), '[]'::json));
end $$;

create or replace function public.add_member(p_token text, p_username text, p_display_name text, p_is_admin boolean)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  uname text := lower(public._clean(p_username, 30));
  dname text := public._clean(p_display_name, 40);
  new_id bigint;
begin
  perform public._admin(p_token);
  if uname !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore';
  end if;
  if dname = '' then raise exception 'Please enter the member’s name'; end if;
  if (select count(*) from public.users) >= 30 then raise exception 'Member limit reached (30)'; end if;
  if exists (select 1 from public.users where username = uname) then
    raise exception 'That username is already taken';
  end if;
  insert into public.users (username, display_name, password_hash, is_admin, must_change_password, avatar)
  values (uname, dname, extensions.crypt(public._default_password(), extensions.gen_salt('bf', 10)),
          coalesce(p_is_admin, false), true, (public._avatars())[1 + floor(random() * 16)::int])
  returning id into new_id;
  return json_build_object('id', new_id, 'defaultPassword', public._default_password());
end $$;

create or replace function public.reset_password(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._admin(p_token);
  update public.users
     set password_hash = extensions.crypt(public._default_password(), extensions.gen_salt('bf', 10)),
         must_change_password = true
   where id = p_id;
  if not found then raise exception 'Member not found' using hint = 'notfound'; end if;
  delete from public.sessions where user_id = p_id;
  return json_build_object('ok', true, 'defaultPassword', public._default_password());
end $$;

create or replace function public.remove_member(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._admin(p_token);
begin
  if p_id = me.id then raise exception 'You cannot remove yourself'; end if;
  delete from public.users where id = p_id;
  if not found then raise exception 'Member not found' using hint = 'notfound'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.set_admin(p_token text, p_id bigint, p_is_admin boolean) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._admin(p_token);
begin
  if p_id = me.id then raise exception 'You cannot change your own admin role'; end if;
  update public.users set is_admin = coalesce(p_is_admin, false) where id = p_id;
  if not found then raise exception 'Member not found' using hint = 'notfound'; end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.get_invite(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._admin(p_token);
  return json_build_object('code', public._invite_code());
end $$;

create or replace function public.regenerate_invite(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare c text := public._new_invite_code();
begin
  perform public._admin(p_token);
  insert into public.settings (key, value) values ('invite_code', c)
    on conflict (key) do update set value = excluded.value;
  return json_build_object('code', c);
end $$;

-- ---------- prayer requests ----------
create or replace function public.list_requests(p_token text, p_filter text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token);
begin
  return json_build_object('requests', coalesce((
    select json_agg(public._request_json(r.id, me.id) order by (r.status = 'answered'), r.created_at desc)
    from public.requests r
    where case p_filter
            when 'active' then r.status = 'active'
            when 'answered' then r.status = 'answered'
            when 'mine' then r.user_id = me.id
            else true
          end), '[]'::json));
end $$;

create or replace function public.get_request(p_token text, p_id bigint) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); r json;
begin
  r := public._request_json(p_id, me.id);
  if r is null then raise exception 'Prayer request not found' using hint = 'notfound'; end if;
  return json_build_object('request', r, 'prayers', coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'request_id', p.request_id, 'user_id', p.user_id, 'body', p.body, 'created_at', p.created_at,
      'author_name', u.display_name, 'author_avatar', u.avatar, 'is_mine', p.user_id = me.id)
      order by p.created_at)
    from public.prayers p join public.users u on u.id = p.user_id
    where p.request_id = p_id), '[]'::json));
end $$;

create or replace function public._check_request(p_title text, p_body text) returns void
language plpgsql immutable as $$
begin
  if public._clean(p_title, 100) = '' then raise exception 'Please give your request a short title'; end if;
  if public._clean(p_body, 2000) = '' then raise exception 'Please describe your prayer request'; end if;
end $$;

create or replace function public.create_request(p_token text, p_title text, p_body text, p_category text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); new_id bigint;
begin
  perform public._check_request(p_title, p_body);
  insert into public.requests (user_id, title, body, category)
  values (me.id, public._clean(p_title, 100), public._clean(p_body, 2000),
          case when p_category = any (public._categories()) then p_category else 'General' end)
  returning id into new_id;
  return json_build_object('request', public._request_json(new_id, me.id));
end $$;

create or replace function public.update_request(p_token text, p_id bigint, p_title text, p_body text, p_category text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); r public.requests := public._own_request(me.id, p_id);
begin
  perform public._check_request(p_title, p_body);
  update public.requests set
    title = public._clean(p_title, 100), body = public._clean(p_body, 2000),
    category = case when p_category = any (public._categories()) then p_category else 'General' end,
    updated_at = now()
  where id = r.id;
  return json_build_object('request', public._request_json(r.id, me.id));
end $$;

create or replace function public.delete_request(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); r public.requests := public._own_request(me.id, p_id);
begin
  delete from public.requests where id = r.id;
  return json_build_object('ok', true);
end $$;

create or replace function public.set_answered(p_token text, p_id bigint, p_answered boolean, p_note text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); r public.requests := public._own_request(me.id, p_id);
begin
  if coalesce(p_answered, true) then
    update public.requests set status = 'answered', answered_at = now(),
           answer_note = nullif(public._clean(p_note, 1000), '')
     where id = r.id;
  else
    update public.requests set status = 'active', answered_at = null, answer_note = null where id = r.id;
  end if;
  return json_build_object('request', public._request_json(r.id, me.id));
end $$;

-- ---------- prayers on a request ----------
create or replace function public.add_prayer(p_token text, p_request_id bigint, p_body text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); new_id bigint;
begin
  if not exists (select 1 from public.requests where id = p_request_id) then
    raise exception 'Prayer request not found' using hint = 'notfound';
  end if;
  if public._clean(p_body, 2000) = '' then raise exception 'Please write your prayer'; end if;
  insert into public.prayers (request_id, user_id, body) values (p_request_id, me.id, public._clean(p_body, 2000))
  returning id into new_id;
  return json_build_object('id', new_id);
end $$;

create or replace function public.delete_prayer(p_token text, p_id bigint) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare me public.users := public._me_ok(p_token); owner bigint;
begin
  select user_id into owner from public.prayers where id = p_id;
  if owner is null then raise exception 'Prayer not found' using hint = 'notfound'; end if;
  if owner <> me.id then raise exception 'You can only remove your own prayers' using hint = 'forbidden'; end if;
  delete from public.prayers where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ---------- dashboard stats ----------
create or replace function public.stats(p_token text, p_tz text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  me public.users := public._me_ok(p_token);
  tz text := case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end;
  today date := (now() at time zone tz)::date;
  days date[];
  d date;
  cur date;
  streak int := 0;
begin
  select array_agg(x order by x desc) into days
  from (select distinct (created_at at time zone tz)::date as x from public.prayers where user_id = me.id) s;
  if days is not null and days[1] >= today - 1 then
    cur := days[1];
    foreach d in array days loop
      exit when d <> cur;
      streak := streak + 1;
      cur := cur - 1;
    end loop;
  end if;
  return json_build_object(
    'streak', streak,
    'prayedToday', coalesce(days[1] = today, false),
    'myPrayers', (select count(*) from public.prayers where user_id = me.id),
    'prayedThisWeek', (select count(*) from public.prayers where user_id = me.id and created_at >= now() - interval '7 days'),
    'weeklyGoal', 7,
    'active', (select count(*) from public.requests where status = 'active'),
    'answered', (select count(*) from public.requests where status = 'answered'),
    'needsPrayer', (select count(*) from public.requests r where r.status = 'active' and not exists
                     (select 1 from public.prayers p where p.request_id = r.id and p.user_id <> r.user_id)),
    'leaderboard', coalesce((select json_agg(l) from (
        select u.id, u.display_name, u.avatar, count(p.id) as n
        from public.users u
        left join public.prayers p on p.user_id = u.id and p.created_at >= now() - interval '7 days'
        group by u.id order by n desc, lower(u.display_name) limit 12) l), '[]'::json));
end $$;

-- ---------- permissions ----------
-- Helpers are internal only; the public API functions above stay callable.
revoke execute on function
  public._default_password(), public._avatars(), public._categories(), public._clean(text, int),
  public._user_json(public.users), public._me(text), public._me_ok(text), public._admin(text),
  public._new_session(bigint), public._blocked(text, int), public._fail(text),
  public._new_invite_code(), public._invite_code(), public._request_json(bigint, bigint),
  public._own_request(bigint, bigint), public._check_request(text, text)
from public, anon, authenticated;

grant execute on function
  public.setup_status(), public.login(text, text), public.register(text, text, text, text),
  public.logout(text), public.me(text), public.change_password(text, text, text),
  public.update_profile(text, text, text), public.list_members(text),
  public.add_member(text, text, text, boolean), public.reset_password(text, bigint),
  public.remove_member(text, bigint), public.set_admin(text, bigint, boolean),
  public.get_invite(text), public.regenerate_invite(text), public.list_requests(text, text),
  public.get_request(text, bigint), public.create_request(text, text, text, text),
  public.update_request(text, bigint, text, text, text), public.delete_request(text, bigint),
  public.set_answered(text, bigint, boolean, text), public.add_prayer(text, bigint, text),
  public.delete_prayer(text, bigint), public.stats(text, text)
to anon, authenticated;
