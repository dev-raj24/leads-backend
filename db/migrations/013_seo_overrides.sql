create table if not exists seo_overrides (
  site_id     uuid not null references sites(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  path        text not null,
  page_url    text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (site_id, path)
);
