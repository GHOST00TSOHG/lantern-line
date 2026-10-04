create table if not exists building_messages (
  id text primary key,
  city_id text not null references cities (id) on delete cascade,
  building_key text not null,
  user_id text not null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists building_messages_key_idx
  on building_messages (city_id, building_key, created_at);
