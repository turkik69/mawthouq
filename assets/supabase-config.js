// assets/supabase-config.js
// إعدادات الاتصال بمشروع Supabase الخاص بمنصة موثوق
//
// بيانات الاتصال بمشروعك على Supabase — مكتملة، لا حاجة لتعديل شي هنا.
//
// ملاحظة أمنية: هذا المفتاح آمن للنشر العلني (في مستودع عام مثلاً)، لأن
// الوصول الفعلي للبيانات محكوم بسياسات RLS في قاعدة البيانات (schema.sql).
// المفتاح الذي يجب ألا يظهر أبدًا في كود الواجهة الأمامية هو secret/service_role key.

const SUPABASE_URL = 'https://ffsufvvqhhnmjuowibjl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_e_vV9a7DCCE5BrneeiCmDg_9w6Bkczz';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
