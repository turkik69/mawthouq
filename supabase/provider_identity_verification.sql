-- Optional civil-ID review. Account approval and identity verification are separate decisions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('provider-identities', 'provider-identities', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.provider_identity_checks (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles(id) on delete cascade,
  file_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint provider_identity_file_path_format check (
    file_path is null or file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|pdf)$'
  ),
  constraint provider_identity_pending_file check (status <> 'pending' or file_path is not null),
  constraint provider_identity_review_consistency check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)
  ),
  unique (file_path)
);
create unique index if not exists provider_identity_one_pending
  on public.provider_identity_checks(provider_id) where status = 'pending';
create index if not exists provider_identity_lookup
  on public.provider_identity_checks(provider_id, submitted_at desc);
alter table public.provider_identity_checks enable row level security;
revoke all on public.provider_identity_checks from public, anon, authenticated;
grant select, insert on public.provider_identity_checks to authenticated;

create policy provider_identity_read on public.provider_identity_checks
  for select to authenticated using (provider_id = (select auth.uid()) or (select public.is_admin()));
create policy provider_identity_submit on public.provider_identity_checks
  for insert to authenticated with check (
    provider_id = (select auth.uid()) and status = 'pending'
    and reviewed_at is null and reviewed_by is null
    and file_path like ((select auth.uid())::text || '/%')
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.account_type = 'provider' and not p.suspended)
    and exists (select 1 from storage.objects o where o.bucket_id = 'provider-identities'
      and o.name = file_path and o.owner_id = (select auth.uid())::text)
  );

create policy provider_identity_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'provider-identities'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(jpg|png|pdf)$')
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.account_type = 'provider' and not p.suspended)
    and not exists (select 1 from public.provider_identity_checks c
      where c.provider_id = (select auth.uid()) and c.status in ('pending', 'approved'))
  );
create policy provider_identity_read_files on storage.objects
  for select to authenticated using (
    bucket_id = 'provider-identities'
    and (owner_id = (select auth.uid())::text or (select public.is_admin()))
  );
create policy provider_identity_delete_files on storage.objects
  for delete to authenticated using (
    bucket_id = 'provider-identities'
    and ((select public.is_admin()) or
      (owner_id = (select auth.uid())::text and not exists (
        select 1 from public.provider_identity_checks c where c.file_path = objects.name)))
  );

create or replace function public.admin_review_provider_identity(p_check_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_check public.provider_identity_checks%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'غير مصرح'; end if;
  select * into v_check from public.provider_identity_checks where id = p_check_id for update;
  if not found or v_check.status <> 'pending' then raise exception 'طلب المراجعة غير متاح'; end if;
  if p_approve and not exists (
    select 1 from storage.objects o where o.bucket_id = 'provider-identities'
      and o.name = v_check.file_path and o.owner_id = v_check.provider_id::text
  ) then raise exception 'ملف الهوية غير موجود'; end if;
  update public.provider_identity_checks set status = case when p_approve then 'approved' else 'rejected' end,
    reviewed_at = now(), reviewed_by = auth.uid() where id = p_check_id;
end; $$;

create or replace function public.get_trusted_provider_ids()
returns table(provider_id uuid) language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.account_type = 'provider'
    and p.provider_verified_at is not null and not p.suspended
    and exists (select 1 from public.provider_identity_checks c
      where c.provider_id = p.id and c.status = 'approved');
$$;
create or replace function public.admin_clear_identity_file(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'غير مصرح'; end if;
  select file_path into v_path from public.provider_identity_checks
    where id = p_check_id and status <> 'pending' for update;
  if not found then raise exception 'يجب إنهاء المراجعة أولاً'; end if;
  if v_path is not null and exists (
    select 1 from storage.objects o where o.bucket_id = 'provider-identities' and o.name = v_path
  ) then raise exception 'احذف الملف من التخزين أولاً'; end if;
  update public.provider_identity_checks set file_path = null where id = p_check_id;
end; $$;
revoke all on function public.admin_review_provider_identity(uuid, boolean),
  public.get_trusted_provider_ids(), public.admin_clear_identity_file(uuid) from public, anon, authenticated;
grant execute on function public.admin_review_provider_identity(uuid, boolean) to authenticated;
grant execute on function public.admin_clear_identity_file(uuid) to authenticated;
grant execute on function public.get_trusted_provider_ids() to anon, authenticated;
