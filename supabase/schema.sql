-- ============================================================
-- منصة موثوق — قاعدة بيانات Supabase (PostgreSQL)
-- نفّذ هذا الملف بالكامل في: Supabase Dashboard → SQL Editor → New query → Run
-- إذا كنت نفّذت نسخة سابقة من هذا الملف من قبل، تنفيذ هذه النسخة آمن ويحدّثها
-- (كل الأوامر تستخدم IF NOT EXISTS / OR REPLACE / DROP...IF EXISTS)
-- ============================================================

-- 1) جدول الملفات الشخصية (يمتد جدول auth.users المدمج في Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- نوع الحساب: طالب خدمة أو مقدم خدمة (يُحدَّد عند التسجيل)
alter table public.profiles add column if not exists account_type text not null default 'seeker';
alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles add constraint profiles_account_type_check check (account_type in ('seeker','provider'));

-- بيانات الدفع — تُملأ فقط لمقدمي الخدمة (account_type = 'provider')
-- ملاحظة أمنية: هذا تخزين مباشر مناسب لمرحلة MVP. عند الانتقال لمعالجة
-- مدفوعات حقيقية، الأفضل عالميًا استخدام بوابة دفع/مزود Payouts (مثل Stripe
-- Connect أو ما يعادله محليًا) بدل تخزين رقم الحساب البنكي مباشرة في القاعدة.
alter table public.profiles add column if not exists bank_account_number text;
alter table public.profiles add column if not exists payment_method text;

create index if not exists profiles_username_idx on public.profiles (lower(username));

-- 2) تفعيل الحماية على مستوى الصفوف (Row Level Security)
alter table public.profiles enable row level security;

-- 3) دالة مساعدة: هل المستخدم الحالي مشرف؟
--    SECURITY DEFINER لتفادي التكرار اللانهائي عند فحص الصلاحية داخل سياسة على نفس الجدول
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 4) سياسات الوصول (RLS Policies)
drop policy if exists "select_own_profile" on public.profiles;
create policy "select_own_profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin_select_all_profiles" on public.profiles;
create policy "admin_select_all_profiles" on public.profiles
  for select using (public.is_admin());

-- 5) إنشاء صف الملف الشخصي تلقائيًا عند تسجيل مستخدم جديد
--    يقرأ البيانات من options.data المُرسلة من الواجهة عند signUp
--    التنفيذ داخل نفس معاملة إنشاء المستخدم: إما ينجح التسجيل كاملاً أو يفشل كاملاً
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, phone, account_type, bank_account_number, payment_method, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'account_type', 'seeker'),
    new.raw_user_meta_data->>'bank_account_number',
    new.raw_user_meta_data->>'payment_method',
    false
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) دالة: البحث عن البريد الإلكتروني المرتبط باسم مستخدم
--    تُستخدم في صفحة الدخول (تسجيل الدخول باسم المستخدم بدل البريد الإلكتروني)
--    تُرجع البريد فقط عند تطابق تام لاسم المستخدم، ولا تكشف أي بيانات أخرى
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

-- 7) دالة: جلب كل المسجّلين — للمشرف فقط
--    الفحص داخل الدالة نفسها (وليس فقط في الواجهة الأمامية): أي مستخدم غير
--    مشرف يستدعيها يحصل على نتيجة فارغة، لا على خطأ ولا على بيانات غيره
--    تشمل بيانات الدفع لأن المشرف يحتاجها عمليًا لصرف مستحقات مقدمي الخدمة
--    (ناقص عمولة المنصة ١٠٪) — راجع الملاحظة الأمنية عند تعريف الأعمدة أعلاه
create or replace function public.get_all_registrants()
returns table (
  username text, email text, phone text, account_type text,
  bank_account_number text, payment_method text,
  is_admin boolean, created_at timestamptz
)
language sql
security definer
set search_path = public, auth
stable
as $$
  select p.username, u.email, p.phone, p.account_type,
         p.bank_account_number, p.payment_method,
         p.is_admin, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;

grant execute on function public.get_all_registrants() to authenticated;

-- ============================================================
-- بعد تنفيذ هذا الملف بنجاح، أكمل هذه الخطوات:
--
-- 1. أوقف تأكيد البريد الإلكتروني حتى يعمل الدخول فور التسجيل مباشرة:
--    Authentication → Providers → Email → أطفئ "Confirm email"
--
-- 2. أنشئ حساب المشرف بشكل طبيعي من صفحة register.html في المتصفح:
--    اسم المستخدم: فهد اليحيائي
--    كلمة المرور:   F96680303M
--    نوع الحساب: أي نوع تختارينه (لا يمنع صلاحية المشرف)
--
-- 3. ارجع إلى SQL Editor هنا ونفّذ السطر التالي لترقية هذا الحساب إلى مشرف:
--
--    update public.profiles set is_admin = true where username = 'فهد اليحيائي';
--
-- بهذا يمتلك الحساب صلاحية الدخول على admin.html لرؤية كل المسجّلين وبيانات الدفع.
-- ============================================================
