-- Leadworks — initial schema
-- Single database, shared schema, multi-tenant via tenant_id + RLS.

create extension if not exists "pgcrypto";

-- ============ tenants ============
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  plan          text not null default 'free',   -- free | pro | growth
  created_at    timestamptz not null default now()
);

-- ============ sites (a tenant's website) ============
create table sites (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  domain        text,
  api_key       text not null unique default encode(gen_random_bytes(18), 'hex'),
  settings      jsonb not null default '{}'::jsonb, -- module on/off flags
  created_at    timestamptz not null default now()
);
create index idx_sites_tenant on sites(tenant_id);
create index idx_sites_api_key on sites(api_key);

-- ============ users (owner + staff login) ============
create table users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  email         text not null unique,
  password_hash text not null,
  role          text not null default 'owner',   -- owner | staff
  created_at    timestamptz not null default now()
);
create index idx_users_tenant on users(tenant_id);

-- ============ leads (every enquiry) ============
create table leads (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  site_id           uuid references sites(id) on delete set null,
  name              text,
  contact           text not null,               -- phone or email
  message           text,
  source            text not null default 'form', -- form | chat_widget | whatsapp | missed_call
  status            text not null default 'new',  -- new | replied | closed | won | lost
  score             int not null default 0,
  custom_fields     jsonb,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index idx_leads_tenant on leads(tenant_id);
create index idx_leads_site on leads(site_id);
create index idx_leads_status on leads(tenant_id, status);
create index idx_leads_created on leads(tenant_id, created_at desc);

-- ============ messages (conversation thread on a lead) ============
create table messages (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  channel       text not null,                   -- whatsapp | email | chat
  direction     text not null,                   -- inbound | outbound
  body          text not null,
  ai_generated  boolean not null default false,
  created_at    timestamptz not null default now()
);
create index idx_messages_lead on messages(lead_id);

-- ============ lead_events (audit / timeline) ============
create table lead_events (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  type          text not null,                   -- created | status_changed | alert_sent | ai_reply_sent | followup_scheduled ...
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index idx_lead_events_lead on lead_events(lead_id);

-- ============ offers (banner / discount) ============
create table offers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  site_id       uuid references sites(id) on delete cascade,
  title         text not null,
  body          text,
  active        boolean not null default false,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index idx_offers_site on offers(site_id);

-- ============ ai_config (what the AI knows about the business) ============
create table ai_config (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null unique references tenants(id) on delete cascade,
  business_info jsonb not null default '{}'::jsonb, -- { about, services, tone, faqs, timings }
  updated_at    timestamptz not null default now()
);

-- ============ followups (nurture schedule) ============
create table followups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  run_at        timestamptz not null,
  status        text not null default 'pending', -- pending | sent | cancelled
  template      text,
  created_at    timestamptz not null default now()
);
create index idx_followups_run_at on followups(status, run_at);

-- ============ Row-Level Security ============
-- Enforced at the Postgres layer for defence-in-depth. The app additionally
-- scopes every raw SQL query by tenant_id (see lib/services).
alter table sites        enable row level security;
alter table users         enable row level security;
alter table leads         enable row level security;
alter table messages      enable row level security;
alter table lead_events   enable row level security;
alter table offers        enable row level security;
alter table ai_config     enable row level security;
alter table followups     enable row level security;

-- Example policy shape (Supabase-style, using a session-set tenant claim).
-- Adjust to your auth provider before enabling in production.
-- create policy tenant_isolation on leads
--   using (tenant_id = current_setting('app.tenant_id')::uuid);
