// assets/admin.js
// منطق لوحة تحكم المشرف — عرض المستخدمين المسجّلين في منصة موثوق

(async function initAdminPage(){
  const profile = await requireAdmin();
  if (!profile) return; // requireAdmin يتكفّل بإعادة التوجيه إن لم يكن مشرفًا

  document.getElementById('whoAmI').textContent = 'مرحبًا، ' + profile.username;

  // get_all_registrants تُرجع بيانات فقط إذا كان المستخدم الحالي مشرفًا
  // (محكومة من قاعدة البيانات نفسها، وليس فقط من واجهة الصفحة)
  const { data: rows, error } = await supabaseClient.rpc('get_all_registrants');

  const tbody = document.getElementById('usersBody');
  const emptyState = document.getElementById('emptyState');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red)">تعذر تحميل البيانات: ${escapeHtml(error.message)}</td></tr>`;
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
})();

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
