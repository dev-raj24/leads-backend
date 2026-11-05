-- Reviews moved from a Google OAuth connection (needed Google's own app approval to post
-- replies) to a read-only lookup via a third-party search API, keyed by the business's
-- Google Maps "data_id" instead of an OAuth-linked account/location.
drop table if exists google_business_connections;

create table if not exists review_source_connections (
  tenant_id       uuid primary key references tenants(id) on delete cascade,
  data_id         text not null,
  business_name   text not null,
  address         text,
  connected_at    timestamptz not null default now(),
  last_polled_at  timestamptz,
  last_error      text
);
