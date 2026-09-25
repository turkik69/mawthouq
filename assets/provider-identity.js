// A civil ID is optional. Uploading never grants the trusted-provider badge.
const ID_BUCKET = 'provider-identities';
const ID_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

async function submitProviderIdentity(file) {
  if (!file || !ID_TYPES[file.type] || file.size < 1 || file.size > 5 * 1024 * 1024) {
    throw new Error('اختر صورة JPG أو PNG أو ملف PDF بحجم لا يتجاوز 5 ميجابايت.');
  }
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) throw new Error('سجّل الدخول بعد تأكيد بريدك الإلكتروني ثم أرفق البطاقة.');
  const path = `${user.id}/${crypto.randomUUID()}.${ID_TYPES[file.type]}`;
  const { error: uploadError } = await supabaseClient.storage.from(ID_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error('تعذر رفع البطاقة. تأكد من عدم وجود طلب مراجعة سابق ثم حاول مجددًا.');
  const { error } = await supabaseClient.from('provider_identity_checks')
    .insert({ provider_id: user.id, file_path: path });
  if (error) {
    await supabaseClient.storage.from(ID_BUCKET).remove([path]);
    throw new Error('تعذر تقديم البطاقة للمراجعة. حاول مجددًا بعد تحديث الصفحة.');
  }
}
