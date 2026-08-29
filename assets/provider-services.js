// assets/provider-services.js
// صفحة "خدماتي وأسعاري" لمقدم الخدمة — منصة موثوق

let allServiceTypes = [];
let myServices = [];

(async function initProviderServicesPage(){
  const session = await requireAuth();
  if (!session) return;

  const profile = await getCurrentProfile();
  if (!profile || profile.account_type !== 'provider') {
    window.location.href = 'index.html';
    return;
  }

  await loadServiceTypes();
  await loadMyServices(session.user.id);
})();

async function loadServiceTypes(){
  const { data, error } = await supabaseClient.from('service_types').select('*').order('name');
  allServiceTypes = (!error && data) ? data : [];
  const select = document.getElementById('serviceTypeSelect');
  select.innerHTML = allServiceTypes.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

async function loadMyServices(providerId){
  const { data, error } = await supabaseClient.rpc('get_provider_services', { p_provider_id: providerId });
  const tbody = document.getElementById('myServicesBody');
  const empty = document.getElementById('myServicesEmpty');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--red)">تعذر التحميل: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  myServices = data || [];

  if (myServices.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = myServices.map(s => `
    <tr>
      <td>${escapeHtml(s.service_name)}</td>
      <td>يبدأ من ${s.price_omr}</td>
      <td><button class="link" onclick="removeProviderService('${s.id}')">حذف</button></td>
    </tr>
  `).join('');
}

async function addProviderService(){
  const serviceTypeId = document.getElementById('serviceTypeSelect').value;
  const price = parseFloat(document.getElementById('priceInput').value);
  if (!serviceTypeId) { alert('اختر خدمة أولاً.'); return; }
  if (!price || price <= 0) { alert('أدخل سعرًا صحيحًا.'); return; }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return;

  const { error } = await supabaseClient.from('provider_services').upsert({
    provider_id: session.user.id,
    service_type_id: serviceTypeId,
    price_omr: price
  }, { onConflict: 'provider_id,service_type_id' });

  if (error) { showToast('تعذر الإضافة: ' + error.message, 'error'); return; }

  document.getElementById('priceInput').value = '';
  await loadMyServices(session.user.id);
  showToast('تمت إضافة الخدمة بنجاح', 'success');
}

async function removeProviderService(id){
  if (!confirm('حذف هذه الخدمة من قائمتك؟')) return;
  const { error } = await supabaseClient.from('provider_services').delete().eq('id', id);
  if (error) { showToast('تعذر الحذف: ' + error.message, 'error'); return; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  await loadMyServices(session.user.id);
  showToast('تم حذف الخدمة', 'success');
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
