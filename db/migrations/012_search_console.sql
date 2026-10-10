create table if not exists search_console_connections (
  tenant_id          uuid primary key references tenants(id) on delete cascade,
  google_email       text,
  refresh_token_enc  text not null,
  property           text,
  connected_at       timestamptz not null default now(),
  last_error         text
);

create table if not exists search_console_snapshots (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  property    text not null,
  range_days  int not null,
  data        jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (tenant_id, property, range_days)
);
