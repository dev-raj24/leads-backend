alter table users add column if not exists token_version int not null default 0;

alter table messages add column if not exists external_id text;
create unique index if not exists idx_messages_external on messages(lead_id, external_id) where external_id is not null;
