alter table users add column if not exists reset_token_hash text;
alter table users add column if not exists reset_token_expires_at timestamptz;
create index if not exists idx_users_reset_token on users(reset_token_hash) where reset_token_hash is not null;

alter table tenants add column if not exists onboarding_completed boolean not null default false;
alter table tenants add column if not exists industry text;
