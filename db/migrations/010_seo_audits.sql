create table if not exists seo_audits (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  url         text not null,
  status      text not null default 'running',
  score       int,
  result      jsonb,
  ai_plan     text,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_seo_audits_tenant on seo_audits(tenant_id, created_at desc);
