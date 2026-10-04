create table if not exists agents (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  token_hash text not null unique,
  token_plain text not null,
  color text not null,
  created_at timestamptz not null default now()
);

insert into agents (id, owner_user_id, name, token_hash, token_plain, color, created_at)
select
  id,
  owner_user_id,
  case
    when rn = 1 then name
    else substring(name from 1 for 16) || ' ' || rn::text || substring(id from 1 for 4)
  end,
  token_hash,
  token_plain,
  color,
  updated_at
from (
  select
    b.*,
    row_number() over (
      partition by b.owner_user_id, lower(b.name)
      order by b.updated_at, b.id
    ) as rn
  from bots b
) numbered;

create unique index if not exists agents_owner_name_uq on agents (owner_user_id, lower(name));
create index if not exists agents_owner_idx on agents (owner_user_id);

alter table bots add column agent_id text;

update bots
set agent_id = agents.id,
    name = agents.name
from agents
where agents.id = bots.id;

alter table bots alter column agent_id set not null;

alter table bots
  add constraint bots_agent_fk
  foreign key (agent_id) references agents (id) on delete cascade;

create unique index if not exists bots_city_agent_uq on bots (city_id, agent_id);

alter table bots alter column token_hash drop not null;
alter table bots alter column token_plain drop not null;
update bots set token_hash = null, token_plain = null;
