alter table public.owners
  add constraint owners_user_id_key unique (user_id);
