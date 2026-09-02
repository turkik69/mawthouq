// assets/provider-requests.js
// صفحة تصفّح طلبات الخدمة لمقدمي الخدمة — منصة موثوق

let allRequests = [];

(async function initProviderRequestsPage(){
  const session = await requireAuth();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (!profile || profile.account_type !== 'provider') {
    // هذه الصفحة مخصصة لمقدمي الخدمة فقط
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('myServiceType').textContent = profile.provider_service_type
    ? `تخصصك: ${profile.provider_service_type}`
    : '';

  await populateServiceFilter();
  if (profile.provider_service_type) {
    document.getElementById('serviceFilter').value = profile.provider_service_type;
  }

  await loadRequests();
  applyFilters();
  initMessageNotifications();
})();

async function populateServiceFilter(){
  const { data } = await supabaseClient.from('service_types').select('name').order('name');
  if (!data) return;
  const select = document.getElementById('serviceFilter');
  select.innerHTML = '<option value="">كل الخدمات</option>' + data.map(s => `<option>${escapeHtml(s.name)}</option>`).join('');
}

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
        <button onclick="viewRequestDetails('${r.id}')">عرض التفاصيل</button>
      </div>
    </article>
  `).join('');
}

function viewRequestDetails(requestId){
  const r = allRequests.find(x => x.id === requestId);
  if (!r) return;

  const modal = document.getElementById('modal');
  document.getElementById('modalBody').innerHTML = `
    <h2>${escapeHtml(r.title || r.service_type)}</h2>
    <div class="notice">راجع الطلب كاملاً. إذا وافقت على العمل عليه اضغط "قبول والتواصل" وتنتقل لمراسلة الطالب مباشرة. إذا تعذّر عليك، أغلق هذه النافذة والطلب يبقى ظاهرًا لبقية مقدمي الخدمة.</div>
    <div class="form">
      <div class="field"><label>الخدمة</label><span>${escapeHtml(r.service_type)}</span></div>
      <div class="field"><label>المرحلة العلمية</label><span>${escapeHtml(r.academic_level || '—')}</span></div>
      <div class="field"><label>التخصص</label><span>${escapeHtml(r.specialization || '—')}</span></div>
      <div class="field"><label>الطالب</label><span>${escapeHtml(r.seeker_username)}</span></div>
      <div class="field full"><label>تفاصيل الطلب</label><span>${escapeHtml(r.details || 'بدون تفاصيل إضافية')}</span></div>
    </div>
    <div class="form-actions">
      <button onclick="contactSeeker('${r.seeker_id}', '${r.id}')">قبول والتواصل مع الطالب</button>
      <button class="outline" onclick="closeModal()">رجوع</button>
    </div>`;
  modal.classList.add('show');
}

function closeModal(){
  document.getElementById('modal').classList.remove('show');
}

let archiveLoaded = false;

function switchRequestsTab(name){
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tabBtn' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
  if (name === 'archive' && !archiveLoaded) loadArchive();
}

async function loadArchive(){
  archiveLoaded = true;
  const { data, error } = await supabaseClient.rpc('get_my_accepted_requests');
  const tbody = document.getElementById('archiveBody');
  const empty = document.getElementById('archiveEmpty');

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
    in_progress: '<span class="payment-status held">قيد المعالجة</span>',
    completed: '<span class="payment-status released">مكتمل</span>',
    open: '<span class="payment-status pending">مفتوح</span>'
  };

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${escapeHtml(r.title || '—')}</td>
      <td>${escapeHtml(r.service_type)}</td>
      <td>${escapeHtml(r.seeker_username)}</td>
      <td>${statusLabels[r.status] || escapeHtml(r.status)}</td>
      <td>${formatDate(r.created_at)}</td>
    </tr>
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
