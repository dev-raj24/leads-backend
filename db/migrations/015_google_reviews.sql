create table if not exists google_business_connections (
  tenant_id          uuid primary key references tenants(id) on delete cascade,
  google_email       text,
  refresh_token_enc  text not null,
  account_id         text,
  location_id        text,
  location_name      text,
  connected_at       timestamptz not null default now(),
  last_polled_at     timestamptz,
  last_error         text
);

create table if not exists reviews (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  review_id     text not null,
  reviewer_name text,
  rating        int,
  comment       text,
  create_time   timestamptz,
  ai_draft      text,
  status        text not null default 'pending', -- pending | sent | skipped
  sent_reply    text,
  sent_at       timestamptz,
  fetched_at    timestamptz not null default now(),
  unique (tenant_id, review_id)
);

create index if not exists idx_reviews_tenant on reviews (tenant_id, create_time desc);
