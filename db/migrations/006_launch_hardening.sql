alter table leads add column if not exists contact_key text;
alter table leads add column if not exists qualified boolean not null default true;

update leads
set contact_key = case
  when contact like '%@%' then lower(btrim(contact))
  when length(regexp_replace(contact, '\D', '', 'g')) >= 10 then right(regexp_replace(contact, '\D', '', 'g'), 10)
  else regexp_replace(contact, '\D', '', 'g')
end
where contact_key is null;

create index if not exists idx_leads_contact_key on leads(tenant_id, contact_key);
create index if not exists idx_leads_qualified on leads(tenant_id, qualified, created_at desc);

create table if not exists unsubscribes (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  contact_key text not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, contact_key)
);

alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists verify_token_hash text;
alter table users add column if not exists verify_token_expires_at timestamptz;
update users set email_verified_at = created_at where email_verified_at is null;
create index if not exists idx_users_verify_token on users(verify_token_hash) where verify_token_hash is not null;

alter table sites add column if not exists last_seen_at timestamptz;
alter table sites add column if not exists last_seen_host text;

create table if not exists blocked_events (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references sites(id) on delete cascade,
  host       text,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_blocked_events_site on blocked_events(site_id, created_at desc);

alter table tenants add column if not exists plan_status text not null default 'active';
alter table tenants add column if not exists plan_renews_at timestamptz;
alter table tenants add column if not exists razorpay_customer_id text;
alter table tenants add column if not exists razorpay_subscription_id text;

create table if not exists billing_events (
  id          text primary key,
  type        text not null,
  tenant_id   uuid references tenants(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
