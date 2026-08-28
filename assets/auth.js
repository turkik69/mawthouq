// assets/auth.js
// وظائف المصادقة المشتركة لمنصة موثوق
// تُستخدم في: login.html, register.html, admin.html, index.html

// تسجيل مستخدم جديد. اسم المستخدم والهاتف يُمرَّران كبيانات وصفية (metadata)
// ويقوم مُشغّل (trigger) في قاعدة البيانات بإنشاء صف الملف الشخصي تلقائيًا
// (انظر handle_new_user في supabase/schema.sql) — بذلك تبقى العملية ذرّية
// (تنجح كاملة أو تفشل كاملة، دون حسابات ناقصة).
async function registerUser({ username, password, email, phone, accountType, bankAccountNumber, paymentMethod }) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        username, phone,
        account_type: accountType || 'seeker',
        bank_account_number: bankAccountNumber || null,
        payment_method: paymentMethod || null
      }
    }
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }

  return data;
}

// تسجيل الدخول باسم المستخدم: نبحث أولاً عن البريد المرتبط به عبر دالة
// get_email_by_username ثم نسجّل الدخول عبر Supabase Auth بالبريد وكلمة المرور.
async function loginUser({ username, password }) {
  const { data: email, error: lookupError } = await supabaseClient
    .rpc('get_email_by_username', { input_username: username });

  if (lookupError || !email) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  }
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

// يُعيد التوجيه لصفحة الدخول إن لم توجد جلسة نشطة. يُستخدم لحماية الصفحات.
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// مثل requireAuth لكنه يتحقق أيضًا من صلاحية المشرف، وإلا يُعيد التوجيه للرئيسية.
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;

  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('is_admin, username')
    .eq('id', session.user.id)
    .single();

  if (error || !profile?.is_admin) {
    window.location.href = 'index.html';
    return null;
  }
  return profile;
}

// يُعيد بيانات المستخدم الحالي دون إعادة توجيه (لاستخدامه في ترويسة الصفحة الرئيسية).
async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('username, is_admin')
    .eq('id', session.user.id)
    .single();
  return profile;
}

function translateAuthError(message) {
  if (/profiles_username_key|duplicate key.*username/i.test(message)) {
    return 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر.';
  }
  if (/already registered|already exists|User already registered/i.test(message)) {
    return 'هذا البريد الإلكتروني مسجل مسبقًا.';
  }
  if (/Password should be at least|password.*6 characters/i.test(message)) {
    return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
  }
  if (/valid email/i.test(message)) {
    return 'يرجى إدخال بريد إلكتروني صحيح.';
  }
  if (/Database error saving new user/i.test(message)) {
    return 'اسم المستخدم مستخدم بالفعل أو حدث خطأ في الحفظ، جرّب اسم مستخدم مختلفًا.';
  }
  return 'حدث خطأ: ' + message;
}
