// assets/auth.js
// وظائف المصادقة المشتركة لمنصة موثوق
// تُستخدم في: login.html, register.html, admin.html, index.html

// تسجيل مستخدم جديد. اسم المستخدم والهاتف يُمرَّران كبيانات وصفية (metadata)
// ويقوم مُشغّل (trigger) في قاعدة البيانات بإنشاء صف الملف الشخصي تلقائيًا
// (انظر handle_new_user في supabase/schema.sql) — بذلك تبقى العملية ذرّية
// (تنجح كاملة أو تفشل كاملة، دون حسابات ناقصة).
async function registerUser({ username, password, email, phone, accountType, bankAccountNumber, paymentMethod, providerServiceType }) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        username, phone,
        account_type: accountType || 'seeker',
        bank_account_number: bankAccountNumber || null,
        payment_method: paymentMethod || null,
        provider_service_type: providerServiceType || null
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
    .select('username, is_admin, account_type')
    .eq('id', session.user.id)
    .single();
  return profile;
}

// يوجّه كل دور لصفحته الصحيحة بعد الدخول أو التسجيل: مقدم الخدمة إلى تصفّح
// طلبات الخدمة، وطالب الخدمة (أو أي حالة أخرى) إلى الصفحة الرئيسية.
async function redirectAfterAuth() {
  const profile = await getCurrentProfile();
  if (profile && profile.account_type === 'provider') {
    window.location.href = 'provider-requests.html';
  } else {
    window.location.href = 'index.html';
  }
}

// إشعارات الرسائل الجديدة — نظام حقيقي (Web Push) عبر service worker.
// تصل حتى لو كان الموقع غير مفتوح، طالما المتصفح مثبّت (وعلى آيفون: فقط إذا
// كان الموقع مضافًا لـ"الشاشة الرئيسية" — قيد من آبل نفسها، لا علاقة للكود به).
const VAPID_PUBLIC_KEY = 'BD6ITIJ6l8uTqjVblDfTz4ysQsQvGSdQubEFChrW4C_rpQi6Bj2tG1oF2JjuhlCx5RKzLWP56ACznvYCYgSq9MY';

let __notificationChannel = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initMessageNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;
  const userId = session.user.id;

  // نشترك أيضًا بتحديث حي للرسائل — يحدّث البادج وينبّه فورًا أثناء التصفح
  subscribeToRealtimeMessages(userId);

  if (Notification.permission === 'granted') {
    await subscribeToPush(userId);
  } else if (Notification.permission === 'default' && !localStorage.getItem('notifyPromptDismissed')) {
    showNotificationPrompt(userId);
  }
}

function showNotificationPrompt(userId) {
  if (document.getElementById('notifyPrompt')) return;
  const banner = document.createElement('div');
  banner.id = 'notifyPrompt';
  banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;max-width:420px;margin:0 auto;background:var(--navy,#14213d);color:#fff;padding:14px 18px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:200;box-shadow:0 10px 30px #0004;font-family:Cairo,Arial,sans-serif';
  banner.innerHTML = `
    <span style="font-size:13px">فعّل الإشعارات عشان توصلك الرسائل الجديدة</span>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button id="notifyEnableBtn" style="background:#fff;color:#14213d;border:0;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer">تفعيل</button>
      <button id="notifyDismissBtn" style="background:transparent;color:#fff;border:0;padding:6px;cursor:pointer;font-size:14px">✕</button>
    </div>`;
  document.body.appendChild(banner);

  document.getElementById('notifyEnableBtn').addEventListener('click', async () => {
    const permission = await Notification.requestPermission();
    banner.remove();
    if (permission === 'granted') await subscribeToPush(userId);
  });
  document.getElementById('notifyDismissBtn').addEventListener('click', () => {
    localStorage.setItem('notifyPromptDismissed', '1');
    banner.remove();
  });
}

async function subscribeToPush(userId) {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const sub = subscription.toJSON();
    await supabaseClient.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth_key: sub.keys.auth
    }, { onConflict: 'endpoint' });
  } catch (err) {
    console.error('push subscription failed:', err);
  }
}

// تحديث حي أثناء التصفح (بادج + نافذة Notification داخل المتصفح نفسه إن كان
// التبويب غير ظاهر حاليًا) — منفصل عن Push الحقيقي، ويعمل فورًا بدون انتظار
function subscribeToRealtimeMessages(userId) {
  if (__notificationChannel) return;
  __notificationChannel = supabaseClient
    .channel('global-message-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      const msg = payload.new;
      if (msg.sender_id === userId) return;
      bumpUnreadBadge();
      if (document.visibilityState === 'visible') return;
      if (Notification.permission === 'granted') {
        new Notification('رسالة جديدة على منصة موثوق', { body: (msg.content || '').slice(0, 100) });
      }
    })
    .subscribe();
}

function bumpUnreadBadge(){
  const link = document.querySelector('a[href="messages.html"]');
  if (!link) return;
  let badge = link.querySelector('.unread-badge');
  if (badge) {
    badge.textContent = (parseInt(badge.textContent, 10) || 0) + 1;
  } else {
    badge = document.createElement('span');
    badge.className = 'unread-badge';
    badge.textContent = '1';
    link.prepend(badge);
  }
}

function translateAuthError(message) {
  if (/profiles_username_key|duplicate key.*username/i.test(message)) {
    return 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر.';
  }
  if (/already registered|already exists|User already registered/i.test(message)) {
    return 'هذا البريد الإلكتروني مسجل مسبقًا.';
  }
  if (/Password should be at least|password.*6 characters/i.test(message)) {
    return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
  }
  if (/valid email/i.test(message)) {
    return 'يرجى إدخال بريد إلكتروني صحيح.';
  }
  if (/Database error saving new user/i.test(message)) {
    return 'اسم المستخدم مستخدم بالفعل أو حدث خطأ في الحفظ، جرّب اسم مستخدم مختلفًا.';
  }
  return 'حدث خطأ: ' + message;
}
