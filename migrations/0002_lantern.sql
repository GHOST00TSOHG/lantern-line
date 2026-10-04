create table if not exists cities (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists cities_owner_idx on cities (owner_user_id);

create table if not exists city_members (
  city_id text not null references cities (id) on delete cascade,
  user_id text not null,
  role text not null,
  building_name text not null,
  joined_at timestamptz not null default now(),
  primary key (city_id, user_id),
  constraint city_members_role_chk check (role in ('owner', 'guest'))
);

create index if not exists city_members_user_idx on city_members (user_id);

create table if not exists invites (
  id text primary key,
  city_id text not null references cities (id) on delete cascade,
  code_hash text not null unique,
  code_plain text not null,
  created_by text not null,
  redeemed_by text,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

create index if not exists invites_city_idx on invites (city_id);

create table if not exists bots (
  id text primary key,
  city_id text not null references cities (id) on delete cascade,
  owner_user_id text not null,
  name text not null,
  room_slot integer not null,
  token_hash text not null unique,
  token_plain text not null,
  status text not null default 'idle',
  last_file text,
  color text not null,
  updated_at timestamptz not null default now(),
  unique (city_id, owner_user_id, room_slot),
  constraint bots_status_chk check (status in ('idle', 'working')),
  constraint bots_slot_chk check (room_slot between 0 and 5)
);

create index if not exists bots_city_idx on bots (city_id);

create table if not exists city_events (
  id text primary key,
  city_id text not null references cities (id) on delete cascade,
  bot_id text not null,
  bot_name text not null,
  owner_user_id text not null,
  kind text not null,
  filename text,
  color text not null,
  created_at timestamptz not null default now(),
  constraint city_events_kind_chk check (kind in ('start', 'stop', 'upload'))
);

create index if not exists city_events_city_idx on city_events (city_id, created_at desc);
