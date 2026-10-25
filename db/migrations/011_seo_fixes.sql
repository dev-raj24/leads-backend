alter table seo_audits add column if not exists fixes jsonb not null default '{}'::jsonb;
