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

// أيقونات الخدمات (نفس عائلة أيقونات الرئيسية) — تُختار حسب اسم الخدمة،
// مع أيقونة عامة احتياطية لأي خدمة غير مطابقة
const SERVICE_ICONS = {
  'الاستشارات البحثية': '<circle cx="12" cy="9" r="6.5"/><path d="M12 5.5v3.5l2.5 1.5"/>',
  'الدراسات السابقة': '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9.5h16M9 5v14"/>',
  'الإطار النظري': '<path d="M4 5.5c2.5-1 5-1 8 0v13c-3-1-5.5-1-8 0z"/><path d="M20 5.5c-2.5-1-5-1-8 0v13c3-1 5.5-1 8 0z"/>',
  'منهجية البحث': '<path d="M10 3h4M11 3v5l-5.5 9a2 2 0 0 0 1.7 3h9.6a2 2 0 0 0 1.7-3L13 8V3"/>',
  'التحليل الإحصائي': '<path d="M4 20V10M10 20V4M16 20v-7M20 20H4"/>',
  'التدقيق الأكاديمي': '<path d="M16.5 3.5a2 2 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  'الترجمة الأكاديمية': '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z"/>',
  'التنسيق والمراجع': '<path d="M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13.5h8M8 17h5"/>',
  'عروض المناقشة': '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8.5 20.5h7M12 17v3.5"/>',
  _default: '<path d="M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13.5h8"/>'
};

const STATUS_META = {
  open: { label: 'مفتوح', progress: 0.12, ring: 'var(--muted)' },
  in_progress: { label: 'قيد المعالجة', progress: 0.6, ring: 'var(--accent-blue)' },
  completed: { label: 'مكتمل', progress: 1, ring: 'var(--green)' }
};

function renderRing(status){
  const meta = STATUS_META[status] || STATUS_META.open;
  const isDone = status === 'completed';
  const r = 22, c = 2 * Math.PI * r;
  const offset = c * (1 - meta.progress);
  const iconPath = isDone
    ? '<path d="M6 12l4 4 8-9"/>'
    : (SERVICE_ICONS._default);

  return `
    <div class="request-ring${isDone ? ' is-done' : ''}">
      <svg viewBox="0 0 52 52" width="56" height="56">
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--line)" stroke-width="4"/>
        <circle cx="26" cy="26" r="${r}" fill="none" stroke="${meta.ring}" stroke-width="4"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <span class="rt-ico"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg></span>
    </div>`;
}

function renderServiceIcon(serviceType){
  const path = SERVICE_ICONS[serviceType] || SERVICE_ICONS._default;
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;color:var(--gold-deep)">${path}</svg>`;
}

async function loadMyRequests(){
  const { data, error } = await supabaseClient.rpc('get_my_service_requests');
  const body = document.getElementById('myRequestsBody');
  const empty = document.getElementById('myRequestsEmpty');
  const summary = document.getElementById('myRequestsSummary');

  if (error) {
    body.innerHTML = `<p style="color:var(--red);grid-column:1/-1">تعذر التحميل: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    body.innerHTML = '';
    summary.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  const activeCount = data.filter(r => r.status !== 'completed').length;
  const doneCount = data.filter(r => r.status === 'completed').length;

  summary.innerHTML = `
    <div class="rt-stat active">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--accent-blue-deep)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <div><div class="rt-stat-num">${activeCount}</div><div class="rt-stat-label">طلبات نشطة</div></div>
    </div>
    <div class="rt-stat done">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--green)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>
      <div><div class="rt-stat-num">${doneCount}</div><div class="rt-stat-label">مكتملة</div></div>
    </div>`;

  const statusLabels = {
    open: '<span class="payment-status pending">مفتوح</span>',
    in_progress: '<span class="payment-status held">قيد المعالجة</span>',
    completed: '<span class="payment-status released">مكتمل</span>'
  };

  body.innerHTML = data.map(r => `
    <article class="request-tile">
      ${renderRing(r.status)}
      <div class="request-tile-body">
        <h3>${escapeHtml(r.title || r.service_type)}</h3>
        <div class="rt-meta">${renderServiceIcon(r.service_type)} ${escapeHtml(r.service_type)} · ${escapeHtml(r.academic_level || '—')}</div>
        <div class="rt-foot">${statusLabels[r.status] || escapeHtml(r.status)}<span class="rt-date">${formatDate(r.created_at)}</span></div>
      </div>
    </article>
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
