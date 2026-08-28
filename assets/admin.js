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
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red)">تعذر تحميل البيانات: ${escapeHtml(error.message)}</td></tr>`;
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
      <td>${escapeHtml(u.username)}</td>
      <td>${u.account_type === 'provider' ? '<span class="badge-provider">مقدم خدمة</span>' : '<span class="badge-seeker">طالب خدمة</span>'}</td>
      <td>${escapeHtml(u.provider_service_type || '—')}</td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td>${escapeHtml(u.phone || '—')}</td>
      <td>${paymentInfo(u)}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>${u.is_admin ? '<span class="badge-admin">مشرف</span>' : 'مستخدم'}</td>
    </tr>
  `).join('');

  const now = new Date();
  const today = rows.filter(u => isSameDay(new Date(u.created_at), now)).length;
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const week = rows.filter(u => new Date(u.created_at) >= weekAgo).length;
  const providers = rows.filter(u => u.account_type === 'provider').length;

  setStats(rows.length, providers, today, week);
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
