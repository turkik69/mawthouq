// assets/admin.js
// منطق لوحة تحكم المشرف — منصة موثوق

let adminProfile = null;

(async function initAdminPage(){
  adminProfile = await requireAdmin();
  if (!adminProfile) return; // requireAdmin يتكفّل بإعادة التوجيه إن لم يكن مشرفًا

  document.getElementById('whoAmI').textContent = 'مرحبًا، ' + adminProfile.username;

  await loadRegistrants();
  await loadServiceRequests();
  await loadConversationsAdmin();
  await loadPaymentsAdmin();
  await loadServiceTypesAdmin();
})();

function switchAdminTab(name){
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tabBtn' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
}

/* ============ تبويب: المسجّلون ============ */
async function loadRegistrants(){
  const { data: rows, error } = await supabaseClient.rpc('get_all_registrants');

  const tbody = document.getElementById('usersBody');
  const emptyState = document.getElementById('emptyState');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--red)">تعذر تحميل البيانات: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    setStats(0, 0, 0, 0);
    return;
  }

  tbody.innerHTML = rows.map(u => `
    <tr>
      <td>${escapeHtml(u.username)}${u.suspended ? ' <span class="badge-admin" style="background:#fdecec;color:var(--red)">موقوف</span>' : ''}</td>
      <td>${u.account_type === 'provider' ? '<span class="badge-provider">مقدم خدمة</span>' : '<span class="badge-seeker">طالب خدمة</span>'}</td>
      <td>${escapeHtml(u.provider_service_type || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${escapeHtml(u.phone || '—')}</td>
      <td>${paymentInfo(u)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>${u.is_admin ? '<span class="badge-admin">مشرف</span>' : 'مستخدم'}</td>
      <td>${u.account_type === 'provider' ? suspendButton(u) : '—'}</td>
    </tr>
  `).join('');

  const now = new Date();
  const today = rows.filter(u => isSameDay(new Date(u.created_at), now)).length;
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week = rows.filter(u => new Date(u.created_at) >= weekAgo).length;
  const providers = rows.filter(u => u.account_type === 'provider').length;

  setStats(rows.length, providers, today, week);
}

function suspendButton(u){
  return u.suspended
    ? `<button class="link" onclick="toggleSuspend('${u.id}', false)">إلغاء الإيقاف</button>`
    : `<button class="link" style="color:var(--red)" onclick="toggleSuspend('${u.id}', true)">إيقاف الحساب</button>`;
}

async function toggleSuspend(providerId, suspend){
  const msg = suspend
    ? 'إيقاف هذا الحساب يمنعه من الدخول والظهور للطلاب. يبقى سجل معاملاته السابقة كما هو. متابعة؟'
    : 'إلغاء إيقاف هذا الحساب وإعادته للعمل؟';
  if (!confirm(msg)) return;
  const { error } = await supabaseClient.rpc('admin_set_provider_suspended', { p_provider_id: providerId, p_suspended: suspend });
  if (error) { alert('تعذر التنفيذ: ' + error.message); return; }
  await loadRegistrants();
}

function paymentInfo(u) {
  if (u.account_type !== 'provider') return '—';
  const method = paymentMethodLabel(u.payment_method);
  const account = u.bank_account_number ? escapeHtml(u.bank_account_number) : '—';
  return `${method}<br><span style="color:var(--muted);font-size:12px">${account}</span>`;
}

function paymentMethodLabel(method) {
  const labels = { bank_transfer: 'تحويل بنكي', mobile_wallet: 'محفظة إلكترونية', other: 'أخرى' };
  return labels[method] || '—';
}

function setStats(total, providers, today, week) {
  document.getElementById('totalCount').textContent = total;
  document.getElementById('providerCount').textContent = providers;
  document.getElementById('todayCount').textContent = today;
  document.getElementById('weekCount').textContent = week;
}

/* ============ تبويب: طلبات الخدمة ============ */
async function loadServiceRequests(){
  const tbody = document.getElementById('requestsBody');
  const emptyState = document.getElementById('requestsEmptyState');

  const { data: requests, error } = await supabaseClient.rpc('get_all_service_requests');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red)">تعذر تحميل الطلبات: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!requests || requests.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  const { data: allFiles } = await supabaseClient.from('service_request_files').select('*');
  const filesByRequest = {};
  (allFiles || []).forEach(f => {
    if (!filesByRequest[f.request_id]) filesByRequest[f.request_id] = [];
    filesByRequest[f.request_id].push(f);
  });

  const rowsHtml = await Promise.all(requests.map(r => renderRequestRow(r, filesByRequest[r.id] || [])));
  tbody.innerHTML = rowsHtml.join('');
}

async function renderRequestRow(r, files){
  let filesHtml = '—';
  if (files.length) {
    const links = await Promise.all(files.map(async f => {
      const { data, error } = await supabaseClient.storage.from('request-files').createSignedUrl(f.file_path, 3600);
      return (data && !error)
        ? `<a href="${data.signedUrl}" target="_blank" rel="noopener">${escapeHtml(f.file_name)}</a>`
        : escapeHtml(f.file_name) + ' (تعذّر فتح الرابط)';
    }));
    filesHtml = links.join('<br>');
  }

  return `<tr>
    <td>${escapeHtml(r.seeker_username)}</td>
    <td>${escapeHtml(r.service_type)}</td>
    <td>${escapeHtml(r.academic_level || '—')}<br><span style="color:var(--muted);font-size:12px">${escapeHtml(r.specialization || '—')}</span></td>
    <td><b>${escapeHtml(r.title || '—')}</b><br><span style="color:var(--muted);font-size:12px">${escapeHtml(r.details || '—')}</span></td>
    <td>${filesHtml}</td>
    <td>${formatDate(r.created_at)}</td>
  </tr>`;
}

/* ============ تبويب: المحادثات (اطّلاع للمشرف فقط) ============ */
async function loadConversationsAdmin(){
  const tbody = document.getElementById('conversationsBody');
  const emptyState = document.getElementById('conversationsEmptyState');

  const { data: conversations, error } = await supabaseClient.rpc('get_all_conversations_admin');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red)">تعذر تحميل المحادثات: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!conversations || conversations.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  tbody.innerHTML = conversations.map(c => `
    <tr style="cursor:pointer" data-conv-id="${escapeHtml(c.id)}" data-conv-title="${escapeHtml(c.seeker_username)} ↔ ${escapeHtml(c.provider_username)}">
      <td>${escapeHtml(c.seeker_username)}</td>
      <td>${escapeHtml(c.provider_username)}</td>
      <td>${escapeHtml(c.request_title || '—')}</td>
      <td>${escapeHtml(c.last_message || '— بدون رسائل —')}</td>
      <td>${c.last_message_at ? formatDate(c.last_message_at) : '—'}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-conv-id]').forEach(row => {
    row.addEventListener('click', () => viewThread(row.dataset.convId, row.dataset.convTitle));
  });
}

async function viewThread(conversationId, title){
  document.getElementById('conversationThreadView').style.display = 'block';
  document.getElementById('threadTitle').textContent = title;
  const box = document.getElementById('threadMessages');
  box.innerHTML = '<div class="skeleton" style="width:100%"></div>';

  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    box.innerHTML = `<p style="color:var(--red)">تعذر تحميل الرسائل: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!messages || messages.length === 0) {
    box.innerHTML = '<p style="color:var(--muted)">لا توجد رسائل في هذه المحادثة بعد.</p>';
    return;
  }

  box.innerHTML = messages.map(m => `
    <div style="border:1px solid var(--line);border-radius:10px;padding:10px 14px">
      <div>${escapeHtml(m.content)}</div>
      <small style="color:var(--muted);font-size:11px">${formatDate(m.created_at)}</small>
    </div>
  `).join('');
}

function closeThreadView(){
  document.getElementById('conversationThreadView').style.display = 'none';
}

/* ============ تبويب: المدفوعات ============ */
async function loadPaymentsAdmin(){
  const tbody = document.getElementById('paymentsBody');
  const emptyState = document.getElementById('paymentsEmptyState');

  const { data: payments, error } = await supabaseClient.rpc('get_all_payments_admin');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red)">تعذر تحميل المدفوعات: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!payments || payments.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    setPaymentStats(0, 0, 0);
    return;
  }

  const statusLabels = {
    pending: 'بانتظار بوابة الدفع',
    held: 'محجوز',
    released: 'محرَّر — يحتاج تحويل',
    refunded: 'مسترجَع',
    failed: 'فشل'
  };

  tbody.innerHTML = payments.map(p => {
    const paidOut = p.status === 'released';
    const transferInfo = p.status === 'released'
      ? `${escapeHtml(paymentMethodLabel(p.payment_method))}<br><span style="color:var(--muted);font-size:12px">${escapeHtml(p.bank_account_number || '—')}</span>`
      : '—';
    const action = p.status === 'released'
      ? `<button class="link" onclick="markPaidOut('${p.id}')">تعليم كمدفوع ✓</button>`
      : '—';
    return `<tr>
      <td>${escapeHtml(p.seeker_username)}</td>
      <td>${escapeHtml(p.provider_username)}</td>
      <td>${p.amount_omr} ر.ع</td>
      <td><span class="payment-status ${p.status}">${escapeHtml(statusLabels[p.status] || p.status)}</span></td>
      <td>${transferInfo}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  const held = payments.filter(p => p.status === 'held').reduce((s, p) => s + Number(p.amount_omr), 0);
  const owed = payments.filter(p => p.status === 'released').reduce((s, p) => s + Number(p.provider_payout_omr || 0), 0);
  const fees = payments.filter(p => p.status === 'released').reduce((s, p) => s + Number(p.platform_fee_omr || 0), 0);
  setPaymentStats(held, owed, fees);
}

function setPaymentStats(held, owed, fees){
  document.getElementById('heldTotal').textContent = held.toFixed(3);
  document.getElementById('owedTotal').textContent = owed.toFixed(3);
  document.getElementById('feeTotal').textContent = fees.toFixed(3);
}

async function markPaidOut(paymentId){
  if (!confirm('تأكيد إرسال التحويل البنكي لمقدم الخدمة؟ هذا للتسجيل فقط ولا يرسل تحويلًا فعليًا.')) return;
  const { error } = await supabaseClient.rpc('mark_payment_paid_out', { p_payment_id: paymentId });
  if (error) { alert('تعذر التحديث: ' + error.message); return; }
  await loadPaymentsAdmin();
}

/* ============ تبويب: الخدمات ============ */
async function loadServiceTypesAdmin(){
  const tbody = document.getElementById('serviceTypesBody');
  const { data, error } = await supabaseClient.from('service_types').select('*').order('name');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="2" style="color:var(--red)">تعذر التحميل: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="color:var(--muted)">لا يوجد خدمات بعد.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td><button class="link" style="color:var(--red)" data-service-id="${escapeHtml(s.id)}" data-service-name="${escapeHtml(s.name)}">حذف</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-service-id]').forEach(btn => {
    btn.addEventListener('click', () => removeServiceType(btn.dataset.serviceId, btn.dataset.serviceName));
  });
}

async function addServiceType(){
  const input = document.getElementById('newServiceName');
  const name = input.value.trim();
  if (!name) { alert('اكتب اسم الخدمة.'); return; }

  const { error } = await supabaseClient.rpc('admin_add_service_type', { p_name: name });
  if (error) { alert('تعذرت الإضافة: ' + error.message); return; }

  input.value = '';
  await loadServiceTypesAdmin();
}

async function removeServiceType(id, name){
  if (!confirm(`حذف "${name}" من قائمة الخدمات؟ لن يؤثر على الطلبات السابقة، لكن لن يعود يظهر كخيار جديد.`)) return;
  const { error } = await supabaseClient.rpc('admin_remove_service_type', { p_id: id });
  if (error) { alert('تعذر الحذف: ' + error.message); return; }
  await loadServiceTypesAdmin();
}

/* ============ أدوات مشتركة ============ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ar-OM', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
