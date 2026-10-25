-- Leadworks — AI blog
-- Owner types a topic, AI drafts a post, owner publishes it to their site
-- via the blog embed script (public/blog.js in leadworks-app).

create table blog_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  site_id       uuid references sites(id) on delete cascade,
  title         text not null,
  slug          text not null,
  excerpt       text,
  content       text not null,
  status        text not null default 'draft', -- draft | published
  ai_generated  boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_blog_posts_tenant on blog_posts(tenant_id);
create index idx_blog_posts_site_status on blog_posts(site_id, status, published_at desc);
create unique index idx_blog_posts_site_slug on blog_posts(site_id, slug);

alter table blog_posts enable row level security;
