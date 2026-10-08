alter table blog_posts add column if not exists meta_title text;
alter table blog_posts add column if not exists meta_description text;

alter table sites add column if not exists public_slug text;

update sites s
set public_slug = coalesce(
  nullif(trim(both '-' from left(lower(regexp_replace(t.name, '[^a-zA-Z0-9]+', '-', 'g')), 40)), ''),
  'site'
) || '-' || substr(md5(s.id::text), 1, 4)
from tenants t
where t.id = s.tenant_id and s.public_slug is null;

create unique index if not exists idx_sites_public_slug on sites(public_slug);
