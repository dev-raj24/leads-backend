create table if not exists search_console_rank_history (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  property     text not null,
  captured_on  text not null, -- YYYY-MM-DD, stored as text to avoid driver date/timezone coercion
  query        text not null,
  position     numeric not null,
  clicks       int not null default 0,
  impressions  int not null default 0,
  primary key (tenant_id, property, captured_on, query)
);

create index if not exists idx_rank_history_query on search_console_rank_history (tenant_id, property, query, captured_on);
