// assets/my-requests.js
// صفحة "طلباتي" لطالب الخدمة — منصة موثوق

(async function initMyRequestsPage(){
  const session = await requireAuth();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (profile && profile.account_type === 'provider') {
    window.location.href = 'provider-requests.html';
    return;
  }

  await loadMyRequests();
  initInstallPrompt();
})();

async function loadMyRequests(){
  const { data, error } = await supabaseClient.rpc('get_my_service_requests');
  const tbody = document.getElementById('myRequestsBody');
  const empty = document.getElementById('myRequestsEmpty');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red)">تعذر التحميل: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  const statusLabels = {
    open: '<span class="payment-status pending">مفتوح</span>',
    in_progress: '<span class="payment-status held">قيد المعالجة</span>',
    completed: '<span class="payment-status released">مكتمل</span>'
  };

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${escapeHtml(r.title || '—')}</td>
      <td>${escapeHtml(r.service_type)}</td>
      <td>${escapeHtml(r.academic_level || '—')} / ${escapeHtml(r.specialization || '—')}</td>
      <td>${statusLabels[r.status] || escapeHtml(r.status)}</td>
      <td>${formatDate(r.created_at)}</td>
    </tr>
  `).join('');
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('ar-OM', { year: 'numeric', month: 'short', day: 'numeric' });
}
