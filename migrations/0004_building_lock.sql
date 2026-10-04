alter table city_members add column if not exists building_key text;
alter table city_members add column if not exists room_slot integer;

create unique index if not exists city_members_building_key_uq
  on city_members (building_key)
  where building_key is not null;
