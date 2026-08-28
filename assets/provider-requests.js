// assets/provider-requests.js
// صفحة تصفّح طلبات الخدمة لمقدمي الخدمة — منصة موثوق

let allRequests = [];

(async function initProviderRequestsPage(){
  const session = await requireAuth();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (!profile || profile.account_type !== 'provider') {
    // هذه الصفحة مخصصة لمقدمي الخدمة فقط
    window.location.href = 'index.html';
    return;
  }

  document.getElementById('myServiceType').textContent = profile.provider_service_type
    ? `تخصصك: ${profile.provider_service_type}`
    : '';
  if (profile.provider_service_type) {
    document.getElementById('serviceFilter').value = profile.provider_service_type;
  }

  await loadRequests();
  applyFilters();
})();

async function loadRequests(){
  const { data, error } = await supabaseClient.rpc('get_open_requests_for_providers');
  const list = document.getElementById('requestsList');

  if (error) {
    list.innerHTML = `<p style="color:var(--red)">تعذر تحميل الطلبات: ${escapeHtml(error.message)}</p>`;
    return;
  }

  allRequests = data || [];
}

function applyFilters(){
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const service = document.getElementById('serviceFilter').value;
  const spec = document.getElementById('specFilter').value;

  const filtered = allRequests.filter(r => {
    if (service && r.service_type !== service) return false;
    if (spec && r.specialization !== spec) return false;
    if (q) {
      const haystack = `${r.title||''} ${r.details||''} ${r.specialization||''} ${r.service_type||''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  renderRequests(filtered);
}

function renderRequests(requests){
  const list = document.getElementById('requestsList');
  const empty = document.getElementById('emptyState');

  if (requests.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = requests.map(r => `
    <article class="service">
      <h3>${escapeHtml(r.title || r.service_type)}</h3>
      <p style="margin-bottom:6px"><b>${escapeHtml(r.service_type)}</b> · ${escapeHtml(r.academic_level||'—')} · ${escapeHtml(r.specialization||'—')}</p>
      <p>${escapeHtml(r.details || 'بدون تفاصيل إضافية')}</p>
      <p style="color:var(--muted);font-size:12px;margin-top:8px">بواسطة ${escapeHtml(r.seeker_username)} · ${formatDate(r.created_at)}</p>
      <div style="margin-top:12px">
        <button onclick="contactSeeker('${r.seeker_id}', '${r.id}')">تواصل مع الطالب</button>
      </div>
    </article>
  `).join('');
}

async function contactSeeker(seekerId, requestId){
  window.location.href = `messages.html?with=${encodeURIComponent(seekerId)}&request=${encodeURIComponent(requestId)}`;
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('ar-OM', { year: 'numeric', month: 'short', day: 'numeric' });
}
