-- Production-readiness migration. Applied to the live project as a named migration.
-- Payment capture and settlement remain disabled until a regulated gateway is connected.

alter table public.profiles add column if not exists provider_verified_at timestamptz;
alter table public.profiles add column if not exists provider_verified_by uuid references auth.users(id);

create or replace function public.admin_set_provider_verified(p_provider_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'غير مصرح'; end if;
  update public.profiles
  set provider_verified_at = case when p_verified then now() else null end,
      provider_verified_by = case when p_verified then auth.uid() else null end
  where id = p_provider_id and account_type = 'provider';
  if not found then raise exception 'مقدم الخدمة غير موجود'; end if;
end; $$;

create or replace function public.admin_get_provider_approvals()
returns table(provider_id uuid, verified_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.provider_verified_at from public.profiles p
  where auth.uid() is not null and public.is_admin() and p.account_type = 'provider';
$$;

create or replace function public.get_open_requests_for_providers()
returns table(id uuid, seeker_id uuid, seeker_username text, academic_level text,
  specialization text, service_type text, title text, details text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.seeker_id, p.username, r.academic_level, r.specialization,
    r.service_type, r.title, r.details, r.created_at
  from public.service_requests r join public.profiles p on p.id = r.seeker_id
  where r.status = 'open' and auth.uid() is not null and exists (
    select 1 from public.profiles actor where actor.id = auth.uid()
      and actor.account_type = 'provider' and actor.provider_verified_at is not null
      and actor.suspended = false
  )
  order by r.created_at desc;
$$;

create or replace function public.get_providers()
returns table(id uuid, username text, provider_service_type text, completed_count bigint,
  avg_rating numeric, review_count bigint)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.provider_service_type,
    (select count(*) from public.conversations c where c.provider_id = p.id and c.completed_at is not null),
    round(coalesce((select avg(r.rating) from public.provider_reviews r where r.provider_id = p.id), 0)::numeric, 1),
    (select count(*) from public.provider_reviews r where r.provider_id = p.id)
  from public.profiles p
  where p.account_type = 'provider' and p.provider_verified_at is not null and p.suspended = false;
$$;

create or replace function public.get_provider_services(p_provider_id uuid)
returns table(id uuid, service_type_id uuid, service_name text, price_omr numeric)
language sql stable security definer set search_path = '' as $$
  select ps.id, st.id, st.name, ps.price_omr
  from public.provider_services ps join public.service_types st on st.id = ps.service_type_id
  join public.profiles p on p.id = ps.provider_id
  where ps.provider_id = p_provider_id and
    ((p.provider_verified_at is not null and not p.suspended) or p.id = auth.uid() or public.is_admin())
  order by st.name;
$$;

create or replace function public.get_service_type_stats()
returns table(service_name text, min_price numeric, request_count bigint)
language sql stable security definer set search_path = '' as $$
  select st.name,
    (select min(ps.price_omr) from public.provider_services ps
      join public.profiles p on p.id = ps.provider_id
      where ps.service_type_id = st.id and p.provider_verified_at is not null and not p.suspended),
    (select count(*) from public.service_requests r where r.service_type = st.name)
  from public.service_types st;
$$;

create or replace function public.create_conversation_for_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_seeker uuid; v_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'provider'
      and p.provider_verified_at is not null and not p.suspended
  ) then raise exception 'يجب اعتماد مقدم الخدمة أولاً'; end if;
  select r.seeker_id into v_seeker from public.service_requests r
    where r.id = p_request_id and r.status = 'open';
  if v_seeker is null or v_seeker = auth.uid() then raise exception 'الطلب غير متاح'; end if;
  select c.id into v_id from public.conversations c where c.request_id = p_request_id and c.provider_id = auth.uid();
  if v_id is not null then return v_id; end if;
  insert into public.conversations(seeker_id, provider_id, request_id)
  values (v_seeker, auth.uid(), p_request_id) returning id into v_id;
  return v_id;
end; $$;

drop policy if exists provider_creates_conversation_from_request on public.conversations;
create policy provider_creates_conversation_from_request on public.conversations
  for insert to authenticated with check (
    provider_id = (select auth.uid()) and request_id is not null and exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.account_type = 'provider' and p.provider_verified_at is not null and not p.suspended
    ) and exists (
      select 1 from public.service_requests r where r.id = conversations.request_id
        and r.seeker_id = conversations.seeker_id and r.status = 'open'
    )
  );

drop policy if exists seeker_creates_conversation on public.conversations;
create policy seeker_creates_conversation on public.conversations
  for insert to authenticated with check (
    seeker_id = (select auth.uid()) and exists (
      select 1 from public.profiles p where p.id = conversations.provider_id
        and p.account_type = 'provider' and p.provider_verified_at is not null and not p.suspended
    )
  );

-- A quote is not a charge. Only a gateway integration may advance approved -> held.
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending','approved','held','released','refunded','failed'));
alter table public.payments add column if not exists approved_at timestamptz;
alter table public.payments add column if not exists expires_at timestamptz default (now() + interval '14 days');
alter table public.payments add column if not exists gateway_name text;
alter table public.payments add column if not exists gateway_reference text;
create unique index if not exists payments_gateway_ref_unique on public.payments(gateway_name,gateway_reference)
  where gateway_reference is not null;

drop policy if exists provider_creates_payment_request on public.payments;
create policy provider_creates_payment_request on public.payments
  for insert to authenticated with check (
    provider_id = (select auth.uid()) and status = 'pending'
    and amount_omr > 0 and amount_omr <= 100000
    and approved_at is null and gateway_name is null and gateway_reference is null
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.account_type = 'provider' and p.provider_verified_at is not null and not p.suspended)
    and exists (select 1 from public.conversations c where c.id = payments.conversation_id
      and c.provider_id = (select auth.uid()) and c.seeker_id = payments.seeker_id and c.completed_at is null)
  );

create or replace function public.accept_payment_quote(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  update public.payments p set status = 'approved', approved_at = now()
  where p.id = p_payment_id and p.status = 'pending' and p.seeker_id = auth.uid()
    and (p.expires_at is null or p.expires_at > now())
    and exists (select 1 from public.conversations c where c.id = p.conversation_id
      and c.seeker_id = auth.uid() and c.provider_id = p.provider_id and c.completed_at is null);
  if not found then raise exception 'العرض غير متاح أو انتهت صلاحيته'; end if;
end; $$;

-- Explicitly prevent administrative test helpers from creating fictitious payments.
revoke execute on function public.admin_mark_payment_held(uuid) from public, anon, authenticated;
revoke execute on function public.mark_payment_paid_out(uuid) from public, anon, authenticated;

-- Remove Postgres's default PUBLIC EXECUTE on all exposed privileged functions.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

-- Only the following read endpoints are genuinely public.
grant execute on function public.get_providers(), public.get_provider_reviews(uuid),
  public.get_provider_services(uuid), public.get_service_type_stats() to anon, authenticated;

grant execute on function public.is_admin(), public.get_username(uuid),
  public.get_conversation_partner_email(uuid), public.get_my_accepted_requests(),
  public.get_my_conversations(), public.get_my_recent_activity(integer),
  public.get_my_service_requests(), public.get_open_requests_for_providers(),
  public.create_conversation_for_request(uuid), public.mark_conversation_completed(uuid),
  public.accept_payment_quote(uuid), public.get_all_conversations_admin(),
  public.get_all_payments_admin(), public.get_all_registrants(),
  public.get_all_service_requests(), public.admin_set_provider_verified(uuid, boolean),
  public.admin_get_provider_approvals(), public.admin_add_service_type(text,numeric),
  public.admin_remove_service_type(uuid), public.admin_update_service_type(uuid,text,numeric),
  public.admin_hide_block(text), public.admin_restore_block(text),
  public.admin_set_page_content(text,text), public.admin_set_provider_suspended(uuid,boolean)
  to authenticated;

update storage.buckets set file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg','image/png']
where id = 'request-files';
