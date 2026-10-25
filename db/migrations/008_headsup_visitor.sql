alter table followups add column if not exists notified_at timestamptz;
alter table leads add column if not exists visitor_seen_at timestamptz;
