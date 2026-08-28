-- ============================================================
-- منصة موثوق — قاعدة بيانات Supabase (PostgreSQL)
-- نفّذ هذا الملف بالكامل في: Supabase Dashboard → SQL Editor → New query → Run
-- آمن لإعادة التنفيذ فوق مشروع قائم (IF NOT EXISTS / OR REPLACE / DROP...IF EXISTS)
-- ============================================================

-- 1) جدول الملفات الشخصية (يمتد جدول auth.users المدمج في Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists account_type text not null default 'seeker';
alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check check (account_type in ('seeker','provider'));

-- بيانات الدفع — تُملأ فقط لمقدمي الخدمة. ملاحظة أمنية: تخزين مباشر مناسب
-- لمرحلة MVP؛ عند معالجة مدفوعات حقيقية الأفضل عالميًا بوابة دفع (Payouts)
-- بدل تخزين رقم الحساب البنكي مباشرة.
alter table public.profiles add column if not exists bank_account_number text;
alter table public.profiles add column if not exists payment_method text;
alter table public.profiles add column if not exists provider_service_type text;

create index if not exists profiles_username_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "select_own_profile" on public.profiles;
create policy "select_own_profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin_select_all_profiles" on public.profiles;
create policy "admin_select_all_profiles" on public.profiles
  for select using (public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone, account_type, bank_account_number, payment_method, provider_service_type, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'account_type', 'seeker'),
    new.raw_user_meta_data->>'bank_account_number',
    new.raw_user_meta_data->>'payment_method',
    new.raw_user_meta_data->>'provider_service_type',
    false
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- تسجيل الدخول باسم المستخدم بدل البريد الإلكتروني.
-- ملاحظة أمنية مهمة: هذه الدالة تُرجع البريد الإلكتروني لأي اسم مستخدم صحيح،
-- وهي بالضرورة قابلة للاستدعاء من أي زائر (anon) لأنها تُستخدم قبل تسجيل
-- الدخول. هذا يعني أن أي شخص يعرف (أو يخمّن) اسم مستخدم يقدر يعرف بريده
-- الإلكتروني المرتبط به. هذا قيد معماري متأصل في أي نظام "دخول باسم مستخدم"
-- مبني فوق مصادقة Supabase الأصلية (المبنية على البريد). البديل الوحيد
-- لإغلاقه بالكامل هو التحويل لتسجيل الدخول بالبريد الإلكتروني مباشرة بدل
-- اسم المستخدم — إذا رغبتِ بهذا التبديل مستقبلاً أخبريني.
create or replace function public.get_email_by_username(input_username text)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(input_username)
  limit 1;
$$;

grant execute on function public.get_email_by_username(text) to anon, authenticated;

drop function if exists public.get_all_registrants();
create or replace function public.get_all_registrants()
returns table (
  username text, email text, phone text, account_type text,
  provider_service_type text,
  bank_account_number text, payment_method text,
  is_admin boolean, created_at timestamptz
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select p.username, u.email, p.phone, p.account_type, p.provider_service_type,
         p.bank_account_number, p.payment_method,
         p.is_admin, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;

grant execute on function public.get_all_registrants() to authenticated;

-- ============================================================
-- طلبات الخدمة
-- ============================================================
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  seeker_id uuid not null references auth.users(id) on delete cascade,
  academic_level text,
  specialization text,
  service_type text not null,
  title text,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists service_requests_seeker_idx on public.service_requests (seeker_id);

alter table public.service_requests enable row level security;

drop policy if exists "select_own_or_admin_requests" on public.service_requests;
create policy "select_own_or_admin_requests" on public.service_requests
  for select using (seeker_id = auth.uid() or public.is_admin());

drop policy if exists "insert_own_requests" on public.service_requests;
create policy "insert_own_requests" on public.service_requests
  for insert with check (seeker_id = auth.uid());

create table if not exists public.service_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists service_request_files_request_idx on public.service_request_files (request_id);

alter table public.service_request_files enable row level security;

drop policy if exists "select_own_or_admin_request_files" on public.service_request_files;
create policy "select_own_or_admin_request_files" on public.service_request_files
  for select using (
    exists (select 1 from public.service_requests r where r.id = request_id and r.seeker_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "insert_own_request_files" on public.service_request_files;
create policy "insert_own_request_files" on public.service_request_files
  for insert with check (
    exists (select 1 from public.service_requests r where r.id = request_id and r.seeker_id = auth.uid())
  );

drop function if exists public.get_all_service_requests();
create or replace function public.get_all_service_requests()
returns table (
  id uuid, seeker_username text, academic_level text, specialization text,
  service_type text, title text, details text, status text, created_at timestamptz
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select r.id, p.username, r.academic_level, r.specialization,
         r.service_type, r.title, r.details, r.status, r.created_at
  from public.service_requests r
  join public.profiles p on p.id = r.seeker_id
  where public.is_admin()
  order by r.created_at desc;
$$;

grant execute on function public.get_all_service_requests() to authenticated;

-- عرض الطلبات المفتوحة لمقدمي الخدمة (لتصفّحها واختيار ما يناسب تخصصهم).
-- لا تُرجع الملفات المرفقة عمدًا — تبقى خاصة بالطالب والمشرف فقط حتى تُفتح
-- محادثة فعلية؛ فقط ملخص الطلب (الخدمة والمرحلة والتخصص والتفاصيل).
drop function if exists public.get_open_requests_for_providers();
create or replace function public.get_open_requests_for_providers()
returns table (
  id uuid, seeker_id uuid, seeker_username text,
  academic_level text, specialization text, service_type text,
  title text, details text, created_at timestamptz
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select r.id, r.seeker_id, p.username,
         r.academic_level, r.specialization, r.service_type,
         r.title, r.details, r.created_at
  from public.service_requests r
  join public.profiles p on p.id = r.seeker_id
  where r.status = 'open'
  order by r.created_at desc;
$$;

grant execute on function public.get_open_requests_for_providers() to authenticated;

-- ============================================================
-- تخزين ملفات الطلبات (Supabase Storage) — bucket خاص، الوصول محكوم بالسياسات فقط
-- ============================================================
insert into storage.buckets (id, name, public)
values ('request-files', 'request-files', false)
on conflict (id) do nothing;

-- مسار كل ملف: {معرّف_المستخدم}/{معرّف_الطلب}/{اسم_الملف}
drop policy if exists "upload own request files" on storage.objects;
create policy "upload own request files" on storage.objects
  for insert
  with check (
    bucket_id = 'request-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "read own or admin request files" on storage.objects;
create policy "read own or admin request files" on storage.objects
  for select
  using (
    bucket_id = 'request-files'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

-- ============================================================
-- المحادثات والرسائل بين طالب الخدمة ومقدم الخدمة
-- ============================================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.service_requests(id) on delete set null,
  seeker_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists conversations_seeker_idx on public.conversations (seeker_id);
create index if not exists conversations_provider_idx on public.conversations (provider_id);

alter table public.conversations enable row level security;

drop policy if exists "select_own_conversations" on public.conversations;
create policy "select_own_conversations" on public.conversations
  for select using (seeker_id = auth.uid() or provider_id = auth.uid() or public.is_admin());

drop policy if exists "seeker_creates_conversation" on public.conversations;
create policy "seeker_creates_conversation" on public.conversations
  for insert with check (seeker_id = auth.uid());

-- يسمح لمقدم الخدمة ببدء محادثة أيضًا، لكن فقط إذا كانت مرتبطة بطلب خدمة
-- حقيقي وقائم فعلاً لنفس الطالب المحدَّد — يمنع مراسلة أي طالب عشوائيًا
-- دون طلب خدمة فعلي يربطهما
drop policy if exists "provider_creates_conversation_from_request" on public.conversations;
create policy "provider_creates_conversation_from_request" on public.conversations
  for insert with check (
    provider_id = auth.uid()
    and request_id is not null
    and exists (
      select 1 from public.service_requests r
      where r.id = request_id and r.seeker_id = conversations.seeker_id
    )
  );

-- عند بدء محادثة مرتبطة بطلب، يتحول الطلب تلقائيًا لحالة "قيد المعالجة"
-- حتى لا يستمر ظهوره كمفتوح لبقية مقدمي الخدمة
create or replace function public.mark_request_in_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_id is not null then
    update public.service_requests
    set status = 'in_progress'
    where id = new.request_id and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists on_conversation_created_mark_request on public.conversations;
create trigger on_conversation_created_mark_request
  after insert on public.conversations
  for each row execute function public.mark_request_in_progress();

-- علامة استلام الخدمة — يضبطها الطالب فقط، عبر الدالة أدناه فقط (لا توجد
-- سياسة UPDATE عامة على هذا الجدول، متعمّد: لمنع أي طرف من تعديل أي عمود
-- آخر في محادثته، مثل تحويلها لمقدم خدمة مختلف)
alter table public.conversations add column if not exists completed_at timestamptz;

create or replace function public.mark_conversation_completed(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set completed_at = now()
  where id = p_conversation_id and seeker_id = auth.uid() and completed_at is null;
end;
$$;

grant execute on function public.mark_conversation_completed(uuid) to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "select_messages_in_own_conversations" on public.messages;
create policy "select_messages_in_own_conversations" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
      and (c.seeker_id = auth.uid() or c.provider_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "send_messages_in_own_conversations" on public.messages;
create policy "send_messages_in_own_conversations" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
      and (c.seeker_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

-- علامة "آخر قراءة" لكل مستخدم بكل محادثة — منفصلة عن جدول الرسائل نفسه
-- عمدًا، حتى لا يحتاج أي طرف صلاحية تعديل على رسائل الطرف الآخر
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;

drop policy if exists "manage_own_read_markers" on public.conversation_reads;
create policy "manage_own_read_markers" on public.conversation_reads
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- تقييمات مقدمي الخدمة — يضعها الطالب بعد تأكيد استلام الخدمة فقط
-- ============================================================
create table if not exists public.provider_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  seeker_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (conversation_id)
);

create index if not exists provider_reviews_provider_idx on public.provider_reviews (provider_id);

alter table public.provider_reviews enable row level security;

-- التقييمات مرئية للجميع (حتى الزوار) حتى يستفيد طالبو الخدمة منها قبل التسجيل
drop policy if exists "reviews_public_read" on public.provider_reviews;
create policy "reviews_public_read" on public.provider_reviews
  for select using (true);

-- لا يمكن التقييم إلا من الطالب صاحب المحادثة، وفقط بعد أن يؤكد استلام
-- الخدمة (completed_at غير فارغ)، ومقدم الخدمة بالتقييم يجب أن يطابق
-- مقدم الخدمة الفعلي في تلك المحادثة تحديدًا
drop policy if exists "seeker_reviews_completed_conversation" on public.provider_reviews;
create policy "seeker_reviews_completed_conversation" on public.provider_reviews
  for insert with check (
    seeker_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
      and c.seeker_id = auth.uid()
      and c.provider_id = provider_reviews.provider_id
      and c.completed_at is not null
    )
  );

-- دالة عامة: قائمة مقدمي الخدمة (لتصفّح طالبي الخدمة قبل مراسلتهم).
-- تُرجع الاسم ونوع الخدمة وعدد الخدمات المكتملة ومتوسط التقييم وعددها —
-- لا تكشف البريد أو الهاتف أو بيانات الدفع.
drop function if exists public.get_providers();
create or replace function public.get_providers()
returns table (
  id uuid, username text, provider_service_type text,
  completed_count bigint, avg_rating numeric, review_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id, p.username, p.provider_service_type,
    coalesce(cc.completed_count, 0),
    round(coalesce(rv.avg_rating, 0)::numeric, 1),
    coalesce(rv.review_count, 0)
  from public.profiles p
  left join lateral (
    select count(*) as completed_count
    from public.conversations c
    where c.provider_id = p.id and c.completed_at is not null
  ) cc on true
  left join lateral (
    select avg(rating) as avg_rating, count(*) as review_count
    from public.provider_reviews r
    where r.provider_id = p.id
  ) rv on true
  where p.account_type = 'provider';
$$;

grant execute on function public.get_providers() to anon, authenticated;

-- دالة: تقييمات مقدم خدمة محدد (للعرض التفصيلي)
drop function if exists public.get_provider_reviews(uuid);
create or replace function public.get_provider_reviews(p_provider_id uuid)
returns table (seeker_username text, rating smallint, comment text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p.username, r.rating, r.comment, r.created_at
  from public.provider_reviews r
  join public.profiles p on p.id = r.seeker_id
  where r.provider_id = p_provider_id
  order by r.created_at desc;
$$;

grant execute on function public.get_provider_reviews(uuid) to anon, authenticated;

-- تفعيل التحديث اللحظي (Realtime) على جدول الرسائل — بشكل آمن لإعادة التنفيذ
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- دالة: محادثاتي الخاصة (بغض النظر إن كنت طالب أو مقدم خدمة فيها)
drop function if exists public.get_my_conversations();
create or replace function public.get_my_conversations()
returns table (
  id uuid, other_username text, other_id uuid, my_role text,
  last_message text, last_message_at timestamptz, created_at timestamptz,
  unread boolean, completed_at timestamptz, reviewed boolean
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select
    c.id,
    case when c.seeker_id = auth.uid() then pp.username else ps.username end,
    case when c.seeker_id = auth.uid() then c.provider_id else c.seeker_id end,
    case when c.seeker_id = auth.uid() then 'seeker' else 'provider' end,
    lm.content,
    lm.created_at,
    c.created_at,
    coalesce(lm.created_at, c.created_at) > coalesce(cr.last_read_at, 'epoch'::timestamptz)
      and coalesce(lm.sender_id, auth.uid()) != auth.uid(),
    c.completed_at,
    exists (select 1 from public.provider_reviews r where r.conversation_id = c.id)
  from public.conversations c
  join public.profiles ps on ps.id = c.seeker_id
  join public.profiles pp on pp.id = c.provider_id
  left join lateral (
    select content, created_at, sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  left join public.conversation_reads cr on cr.conversation_id = c.id and cr.user_id = auth.uid()
  where c.seeker_id = auth.uid() or c.provider_id = auth.uid()
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

grant execute on function public.get_my_conversations() to authenticated;

-- دالة: كل المحادثات مع أسماء الطرفين — للمشرف فقط
drop function if exists public.get_all_conversations_admin();
create or replace function public.get_all_conversations_admin()
returns table (
  id uuid, seeker_username text, provider_username text,
  request_title text, last_message text, last_message_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select c.id, ps.username, pp.username, r.title,
         (select m.content from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select m.created_at from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
         c.created_at
  from public.conversations c
  join public.profiles ps on ps.id = c.seeker_id
  join public.profiles pp on pp.id = c.provider_id
  left join public.service_requests r on r.id = c.request_id
  where public.is_admin()
  order by coalesce(
    (select m.created_at from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1),
    c.created_at
  ) desc;
$$;

grant execute on function public.get_all_conversations_admin() to authenticated;

-- ============================================================
-- بعد تنفيذ هذا الملف بنجاح، أكمل هذه الخطوات:
--
-- 1. أوقف تأكيد البريد الإلكتروني حتى يعمل الدخول فور التسجيل مباشرة:
--    Authentication → Providers → Email → أطفئ "Confirm email"
--
-- 2. أنشئ حساب المشرف بشكل طبيعي من صفحة register.html في المتصفح:
--    اسم المستخدم: فهد اليحيائي
--    كلمة المرور:   F96680303M
--
-- 3. ارجع إلى SQL Editor هنا ونفّذ السطر التالي لترقية هذا الحساب إلى مشرف:
--
--    update public.profiles set is_admin = true where username = 'فهد اليحيائي';
--
-- لا حاجة لأي إعداد يدوي إضافي — الـ bucket وسياساته والتحديث اللحظي كلها
-- تُفعَّل تلقائيًا ضمن هذا الملف.
-- ============================================================
