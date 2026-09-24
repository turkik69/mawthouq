-- Suspended provider accounts cannot message or attach new deliverables.
drop policy if exists send_messages_in_own_conversations on public.messages;
create policy send_messages_in_own_conversations on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid()) and exists (
      select 1 from public.conversations c where c.id = messages.conversation_id
      and (c.seeker_id = (select auth.uid()) or c.provider_id = (select auth.uid()))
    ) and not exists (
      select 1 from public.profiles p where p.id = (select auth.uid())
        and p.account_type = 'provider' and p.suspended
    )
  );

drop policy if exists insert_conversation_files on public.conversation_files;
create policy insert_conversation_files on public.conversation_files
  for insert to authenticated with check (
    uploaded_by = (select auth.uid())
    and file_path like ((select auth.uid())::text || '/conv-' || conversation_id::text || '/%')
    and exists (select 1 from public.conversations c where c.id = conversation_id
      and (c.seeker_id = (select auth.uid()) or c.provider_id = (select auth.uid())))
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.account_type = 'provider' and p.suspended)
  );

drop policy if exists "upload own request files" on storage.objects;
create policy "upload own request files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'request-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
    and not exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.account_type = 'provider' and p.suspended)
  );

-- Replaced by read_shared_conversation_files; keeping both broadens permission unions.
drop policy if exists "provider reads linked request files" on storage.objects;
drop policy if exists "read conversation files if participant" on storage.objects;
