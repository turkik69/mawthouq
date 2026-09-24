-- Neutral gateway boundary. No API credentials or payment capture are configured here.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table if not exists app_private.payment_gateway_events (
  id uuid primary key default gen_random_uuid(),
  gateway_name text not null,
  gateway_event_id text not null,
  payment_id uuid references public.payments(id),
  event_type text not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique(gateway_name, gateway_event_id)
);
alter table app_private.payment_gateway_events enable row level security;
revoke all on app_private.payment_gateway_events from public, anon, authenticated;

-- Amounts in OMR have three decimal places. Existing test quotes are unaffected.
alter table public.payments add constraint payments_amount_precision
  check (amount_omr = round(amount_omr, 3)) not valid;

-- A provider may not submit a quote after a conversation has been accepted and charged.
create index if not exists payments_conversation_status_idx
  on public.payments(conversation_id, status, created_at desc);
