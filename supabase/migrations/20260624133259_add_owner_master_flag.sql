alter table owners add column if not exists is_master boolean not null default false;
create unique index if not exists owners_single_master_idx on owners (is_master) where is_master = true;
