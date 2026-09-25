-- Restore the ability to withdraw an identity badge after a later review.
create or replace function public.admin_revoke_provider_identity(p_check_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'غير مصرح'; end if;
  update public.provider_identity_checks set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
    where id = p_check_id and status = 'approved';
  if not found then raise exception 'توثيق الهوية غير موجود'; end if;
end; $$;
revoke all on function public.admin_revoke_provider_identity(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_provider_identity(uuid) to authenticated;
