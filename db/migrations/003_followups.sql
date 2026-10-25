alter table followups add column if not exists channel text;
alter table followups add column if not exists approved_at timestamptz;
alter table followups add column if not exists sent_at timestamptz;
create index if not exists idx_followups_lead on followups(lead_id);
