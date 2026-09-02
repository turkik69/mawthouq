// assets/dashboard.js
// لوحة "أهلًا بك" لطالب الخدمة — منصة موثوق

(async function initDashboard(){
  const session = await requireAuth();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (profile && profile.account_type === 'provider') {
    window.location.href = 'provider-requests.html';
    return;
  }
  if (profile && profile.username) {
    document.getElementById('dashName').textContent = '، ' + profile.username;
  }

  await Promise.all([loadDashProjects(), loadDashActivity()]);
  initInstallPrompt();
})();

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
  open: { progress: 0.12, ring: 'var(--muted)' },
  in_progress: { progress: 0.6, ring: 'var(--accent-blue)' },
  completed: { progress: 1, ring: 'var(--green)' }
};
const STATUS_LABELS = {
  open: '<span class="payment-status pending">مفتوح</span>',
  in_progress: '<span class="payment-status held">قيد المعالجة</span>',
  completed: '<span class="payment-status released">مكتمل</span>'
};

function renderRing(status){
  const meta = STATUS_META[status] || STATUS_META.open;
  const isDone = status === 'completed';
  const r = 22, c = 2 * Math.PI * r;
  const offset = c * (1 - meta.progress);
  const iconPath = isDone ? '<path d="M6 12l4 4 8-9"/>' : SERVICE_ICONS._default;
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

async function loadDashProjects(){
  const { data, error } = await supabaseClient.rpc('get_my_service_requests');
  const grid = document.getElementById('dashProjects');
  const empty = document.getElementById('dashProjectsEmpty');

  if (error) {
    grid.innerHTML = `<p style="color:var(--red)">تعذر التحميل: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  const recent = data.slice(0, 4);
  grid.innerHTML = recent.map(r => {
    const openAction = r.conversation_id
      ? `<button class="rt-open-btn" onclick="window.location.href='messages.html?conversation=${r.conversation_id}'">فتح المشروع ←</button>`
      : `<span class="rt-waiting">بانتظار قبول مقدم خدمة</span>`;
    return `
    <article class="request-tile">
      ${renderRing(r.status)}
      <div class="request-tile-body">
        <h3>${escapeHtml(r.title || r.service_type)}</h3>
        <div class="rt-foot">${STATUS_LABELS[r.status] || escapeHtml(r.status)}</div>
        <div class="rt-action">${openAction}</div>
      </div>
    </article>`;
  }).join('');
}

const ACTIVITY_ICONS = {
  message: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5a8.38 8.38 0 0 1-1-4A8.38 8.38 0 0 1 11.5 2a8.5 8.5 0 0 1 8.5 8.5z"/>',
  file: '<path d="M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13.5h8"/>',
  completed: '<path d="M4 12l5 5L20 6"/>'
};

async function loadDashActivity(){
  const { data, error } = await supabaseClient.rpc('get_my_recent_activity', { p_limit: 8 });
  const list = document.getElementById('dashActivity');
  const empty = document.getElementById('dashActivityEmpty');

  if (error) {
    list.innerHTML = `<p style="color:var(--red)">تعذر التحميل: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  list.innerHTML = data.map(a => `
    <div class="dash-activity-row">
      <span class="dash-activity-ico"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ACTIVITY_ICONS[a.event_type] || ACTIVITY_ICONS.file}</svg></span>
      <span class="dash-activity-text">${escapeHtml(a.event_text)}</span>
      <span class="dash-activity-time">${formatRelative(a.event_at)}</span>
    </div>
  `).join('');
}

function formatRelative(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString('ar-OM', { month: 'short', day: 'numeric' });
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
