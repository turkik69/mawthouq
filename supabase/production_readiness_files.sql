-- Tighten file ownership and allow conversation participants to read shared files.
drop policy if exists insert_own_request_files on public.service_request_files;
create policy insert_own_request_files on public.service_request_files
  for insert to authenticated with check (
    file_path like ((select auth.uid())::text || '/' || request_id::text || '/%')
    and exists (select 1 from public.service_requests r where r.id = request_id
      and r.seeker_id = (select auth.uid()))
  );

drop policy if exists insert_conversation_files on public.conversation_files;
create policy insert_conversation_files on public.conversation_files
  for insert to authenticated with check (
    uploaded_by = (select auth.uid())
    and file_path like ((select auth.uid())::text || '/conv-' || conversation_id::text || '/%')
    and exists (select 1 from public.conversations c where c.id = conversation_id
      and (c.seeker_id = (select auth.uid()) or c.provider_id = (select auth.uid())))
  );

drop policy if exists read_shared_conversation_files on storage.objects;
create policy read_shared_conversation_files on storage.objects
  for select to authenticated using (
    bucket_id = 'request-files' and
    (exists (select 1 from public.conversation_files f
      join public.conversations c on c.id = f.conversation_id
      where f.file_path = name and
      (c.seeker_id = (select auth.uid()) or c.provider_id = (select auth.uid())))
    or exists (select 1 from public.service_request_files f
      join public.conversations c on c.request_id = f.request_id
      where f.file_path = name and c.provider_id = (select auth.uid())))
  );

-- Email addresses are no longer a fall-back delivery path.
revoke execute on function public.get_conversation_partner_email(uuid) from public, anon, authenticated;

-- A conversation can have quote revisions, but only one accepted quote at a time.
create or replace function public.accept_payment_quote(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_conversation_id uuid;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  select p.conversation_id into v_conversation_id from public.payments p
    where p.id = p_payment_id and p.seeker_id = auth.uid() and p.status = 'pending'
    and (p.expires_at is null or p.expires_at > now()) for update;
  if v_conversation_id is null then raise exception 'العرض غير متاح أو انتهت صلاحيته'; end if;
  if exists (select 1 from public.payments p where p.conversation_id = v_conversation_id
    and p.id <> p_payment_id and p.status in ('approved','held','released'))
    then raise exception 'يوجد عرض سعر معتمد لهذه المحادثة'; end if;
  update public.payments p set status = 'approved', approved_at = now()
    where p.id = p_payment_id and exists (select 1 from public.conversations c
      where c.id = p.conversation_id and c.seeker_id = auth.uid()
        and c.provider_id = p.provider_id and c.completed_at is null);
  if not found then raise exception 'المحادثة غير متاحة'; end if;
end; $$;
revoke execute on function public.accept_payment_quote(uuid) from public, anon;
grant execute on function public.accept_payment_quote(uuid) to authenticated;
