// assets/messages.js
// منطق صفحة الرسائل — منصة موثوق

let currentUserId = null;
let currentUserRole = 'seeker';
let currentConversationId = null;
let realtimeChannel = null;
let conversationsCache = [];

(async function initMessagesPage(){
  try {
    const session = await requireAuth();
    if (!session) return;
    currentUserId = session.user.id;

    const profile = await getCurrentProfile();
    if (profile && profile.account_type === 'provider') currentUserRole = 'provider';

    await loadConversations();

    const params = new URLSearchParams(window.location.search);
    const otherId = params.get('with');
    const requestId = params.get('request');
    if (otherId) {
      await openOrCreateConversation(otherId, requestId);
    }

    document.getElementById('sendForm').addEventListener('submit', sendMessage);
    initMessageNotifications();
  } catch (err) {
    document.getElementById('convItems').innerHTML =
      `<p style="color:var(--red);padding:0 4px">حدث خطأ أثناء التحميل: ${escapeHtml(err.message || String(err))}</p>`;
    console.error('messages init error:', err);
  }
})();

async function loadConversations(){
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة الاتصال بالخادم — تحقق من الشبكة وحاول مجددًا')), 10000));
  const { data, error } = await Promise.race([supabaseClient.rpc('get_my_conversations'), timeout]);
  const container = document.getElementById('convItems');

  if (error) {
    container.innerHTML = `<p style="color:var(--red);padding:0 4px">تعذر تحميل المحادثات: ${escapeHtml(error.message)}</p>`;
    return;
  }

  conversationsCache = data || [];

  if (conversationsCache.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);padding:0 4px">لا توجد محادثات بعد. راسل خبيرًا من صفحة الخبراء لتبدأ.</p>';
    return;
  }

  container.innerHTML = conversationsCache.map(c => `
    <div class="conv-item ${c.id === currentConversationId ? 'active' : ''}" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.other_username)}">
      <div class="ci-text">
        <b>${escapeHtml(c.other_username)}</b>
        <span>${escapeHtml(c.last_message || 'ابدأ المحادثة')}</span>
      </div>
      ${c.unread ? '<span class="unread-dot"></span>' : ''}
    </div>
  `).join('');

  container.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', () => openConversation(el.dataset.id, el.dataset.name));
  });
}

async function openOrCreateConversation(otherId, requestId){
  const existing = conversationsCache.find(c => c.other_id === otherId);
  if (existing) {
    await openConversation(existing.id, existing.other_username);
    return;
  }

  // نحتاج اسم الطرف الآخر لعرضه فورًا؛ نجلبه من مصدره المناسب حسب دوري
  let otherName = 'مستخدم';
  if (currentUserRole === 'seeker') {
    const { data: providers } = await supabaseClient.rpc('get_providers');
    const match = (providers || []).find(p => p.id === otherId);
    if (match) otherName = match.username;
  } else {
    const { data: requests } = await supabaseClient.rpc('get_open_requests_for_providers');
    const match = (requests || []).find(r => r.seeker_id === otherId);
    if (match) otherName = match.seeker_username;
  }

  const payload = currentUserRole === 'provider'
    ? { seeker_id: otherId, provider_id: currentUserId, request_id: requestId || null }
    : { seeker_id: currentUserId, provider_id: otherId, request_id: requestId || null };

  const { data: newConv, error } = await supabaseClient
    .from('conversations')
    .insert(payload)
    .select()
    .single();

  if (error) {
    document.getElementById('chatEmpty').textContent = 'تعذر بدء المحادثة: ' + error.message;
    return;
  }

  await loadConversations();
  await openConversation(newConv.id, otherName);
}

async function openConversation(conversationId, otherName){
  currentConversationId = conversationId;

  document.getElementById('chatEmpty').style.display = 'none';
  document.getElementById('chatThread').style.display = 'flex';
  document.getElementById('chatThread').style.flexDirection = 'column';
  document.getElementById('chatThread').style.height = '100%';
  document.getElementById('chatOtherName').textContent = otherName;

  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === conversationId);
  });

  showThreadMobile();
  renderCompletionArea(conversationId);
  document.getElementById('filesPanel').style.display = 'none';

  await loadMessages(conversationId);
  await markAsRead(conversationId);
  await loadPaymentStatus(conversationId);
  subscribeToConversation(conversationId);
}

function renderCompletionArea(conversationId){
  const conv = conversationsCache.find(c => c.id === conversationId);
  const area = document.getElementById('completionArea');
  document.getElementById('ratingForm').style.display = 'none';
  document.getElementById('ratingForm').innerHTML = '';

  if (!conv) { area.innerHTML = ''; return; }

  if (conv.my_role !== 'seeker') {
    area.innerHTML = conv.completed_at
      ? '<span class="status-pill done">✓ العميل أكد الاستلام</span>'
      : '';
    return;
  }

  if (!conv.completed_at) {
    area.innerHTML = '<button class="status-pill action" onclick="markReceived()">تم استلام الخدمة ✓</button>';
  } else if (!conv.reviewed) {
    area.innerHTML = '<span class="status-pill done">✓ تم الاستلام</span>';
    showRatingForm();
  } else {
    area.innerHTML = '<span class="status-pill done">✓ تم الاستلام والتقييم</span>';
  }
}

async function markReceived(){
  const { data: files } = await supabaseClient.from('conversation_files').select('id').eq('conversation_id', currentConversationId);
  const fileNote = files && files.length ? `تم تسليم ${files.length} ملف/ملفات ضمن هذه المحادثة. ` : 'لم يُسلَّم أي ملف ضمن هذه المحادثة بعد. ';
  if (!confirm(fileNote + 'هل تؤكد استلام العمل واكتماله؟ لا يمكن التراجع عن هذا لاحقًا.')) return;
  const { error } = await supabaseClient.rpc('mark_conversation_completed', { p_conversation_id: currentConversationId });
  if (error) { alert('تعذر التأكيد: ' + error.message); return; }
  await loadConversations();
  renderCompletionArea(currentConversationId);
}

function showRatingForm(){
  const box = document.getElementById('ratingForm');
  box.innerHTML = `
    <div class="rating-form-box">
      <b style="font-size:14px">قيّم مقدم الخدمة</b>
      <div class="star-picker" id="starPicker">
        <span data-v="1">★</span><span data-v="2">★</span><span data-v="3">★</span><span data-v="4">★</span><span data-v="5">★</span>
      </div>
      <textarea id="reviewComment" placeholder="تعليق اختياري..." maxlength="500"></textarea>
      <button class="status-pill action" onclick="submitReview()">إرسال التقييم</button>
    </div>`;
  box.style.display = 'block';

  const stars = box.querySelectorAll('#starPicker span');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      const v = parseInt(star.dataset.v, 10);
      stars.forEach(s => s.classList.toggle('filled', parseInt(s.dataset.v, 10) <= v));
    });
  });
}

async function submitReview(){
  const rating = document.querySelectorAll('#starPicker span.filled').length;
  if (!rating) { alert('اختر عدد النجوم أولاً.'); return; }
  const comment = document.getElementById('reviewComment').value.trim();
  const conv = conversationsCache.find(c => c.id === currentConversationId);
  if (!conv) return;

  const { error } = await supabaseClient.from('provider_reviews').insert({
    conversation_id: currentConversationId,
    seeker_id: currentUserId,
    provider_id: conv.other_id,
    rating,
    comment: comment || null
  });

  if (error) { alert('تعذر إرسال التقييم: ' + error.message); return; }
  await loadConversations();
  renderCompletionArea(currentConversationId);
}

/* ============ الدفع ============ */
async function loadPaymentStatus(conversationId){
  const box = document.getElementById('paymentArea');
  const conv = conversationsCache.find(c => c.id === conversationId);
  if (!conv) { box.style.display = 'none'; return; }

  const { data: payments, error } = await supabaseClient
    .from('payments')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1);

  const payment = (!error && payments && payments.length) ? payments[0] : null;
  box.style.display = 'flex';
  box.className = 'payment-box';

  if (!payment) {
    if (currentUserRole === 'seeker') {
      box.innerHTML = `
        <input type="number" step="0.001" min="0.001" id="paymentAmount" class="amount-input" placeholder="المبلغ (ر.ع)">
        <button class="status-pill action" onclick="startPayment()">بدء الدفع</button>`;
    } else {
      box.innerHTML = `<span style="color:var(--muted);font-size:13px">لم يبدأ الطالب الدفع بعد</span>`;
    }
    return;
  }

  const labels = {
    pending: 'بانتظار تفعيل بوابة الدفع الإلكترونية',
    held: 'تم الدفع — المبلغ محجوز لحين تأكيد استلام الخدمة',
    released: `تم تحرير المبلغ لمقدم الخدمة (${payment.provider_payout_omr ?? '—'} ر.ع بعد عمولة المنصة)`,
    refunded: 'تم استرجاع المبلغ',
    failed: 'فشلت عملية الدفع'
  };

  box.innerHTML = `
    <span class="payment-status ${payment.status}">${escapeHtml(labels[payment.status] || payment.status)}</span>
    <span style="color:var(--muted);font-size:13px">المبلغ: ${payment.amount_omr} ر.ع</span>`;
}

async function startPayment(){
  const input = document.getElementById('paymentAmount');
  const amount = parseFloat(input.value);
  if (!amount || amount <= 0) { alert('أدخل مبلغًا صحيحًا.'); return; }

  const conv = conversationsCache.find(c => c.id === currentConversationId);
  if (!conv) return;

  const { error } = await supabaseClient.from('payments').insert({
    conversation_id: currentConversationId,
    seeker_id: currentUserId,
    provider_id: conv.other_id,
    amount_omr: amount,
    status: 'pending'
  });

  if (error) { alert('تعذر بدء الدفع: ' + error.message); return; }
  await loadPaymentStatus(currentConversationId);
}

/* ============ الملفات (استلام وتسليم) ============ */
function toggleFilesPanel(){
  const panel = document.getElementById('filesPanel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  panel.className = 'files-panel';
  if (isHidden) loadFilesPanel(currentConversationId);
}

async function loadFilesPanel(conversationId){
  const panel = document.getElementById('filesPanel');
  panel.innerHTML = '<div class="skeleton" style="width:100%"></div>';

  const conv = conversationsCache.find(c => c.id === conversationId);

  let originalHtml = '';
  if (conv && conv.request_id) {
    const { data: originalFiles } = await supabaseClient
      .from('service_request_files')
      .select('*')
      .eq('request_id', conv.request_id);
    if (originalFiles && originalFiles.length) {
      const links = await Promise.all(originalFiles.map(renderFileLink));
      originalHtml = `<h4>ملفات الطلب الأصلية</h4>${links.join('')}`;
    }
  }

  const { data: deliveredFiles } = await supabaseClient
    .from('conversation_files')
    .select('*, profiles:uploaded_by(username)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  let deliveredHtml = '<h4 style="margin-top:12px">الملفات المتبادلة</h4><p style="color:var(--muted);font-size:13px">لا يوجد ملفات مسلَّمة بعد.</p>';
  if (deliveredFiles && deliveredFiles.length) {
    const links = await Promise.all(deliveredFiles.map(f => renderFileLink(f, f.profiles?.username)));
    deliveredHtml = `<h4 style="margin-top:12px">الملفات المتبادلة</h4>${links.join('')}`;
  }

  panel.innerHTML = `
    ${originalHtml}
    ${deliveredHtml}
    <div class="file-upload-row">
      <input type="file" id="deliveryFileInput" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.jpg,.jpeg,.png">
      <button class="status-pill action" onclick="uploadDeliveryFile()">تسليم ملف</button>
    </div>`;
}

async function renderFileLink(f, uploaderName){
  const { data, error } = await supabaseClient.storage.from('request-files').createSignedUrl(f.file_path, 3600);
  const link = (data && !error)
    ? `<a href="${data.signedUrl}" target="_blank" rel="noopener">${escapeHtml(f.file_name)}</a>`
    : `<span>${escapeHtml(f.file_name)} (تعذّر فتح الرابط)</span>`;
  const who = uploaderName ? `<small>من ${escapeHtml(uploaderName)}</small>` : '';
  return `<div class="file-row">${link}${who}</div>`;
}

async function uploadDeliveryFile(){
  const input = document.getElementById('deliveryFileInput');
  const file = input.files[0];
  if (!file) { alert('اختر ملفًا أولاً.'); return; }
  if (file.size > 20 * 1024 * 1024) { alert('الحجم الأقصى 20 ميغابايت.'); return; }

  const path = `${currentUserId}/conv-${currentConversationId}/${file.name}`;
  const { error: uploadError } = await supabaseClient.storage.from('request-files').upload(path, file, { upsert: true });
  if (uploadError) { alert('تعذر رفع الملف: ' + uploadError.message); return; }

  const { error: insertError } = await supabaseClient.from('conversation_files').insert({
    conversation_id: currentConversationId,
    uploaded_by: currentUserId,
    file_path: path,
    file_name: file.name
  });
  if (insertError) { alert('تعذر تسجيل الملف: ' + insertError.message); return; }

  input.value = '';
  await loadFilesPanel(currentConversationId);
}

async function loadMessages(conversationId){
  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  const box = document.getElementById('chatMessages');
  if (error) {
    box.innerHTML = `<p style="color:var(--red)">تعذر تحميل الرسائل: ${escapeHtml(error.message)}</p>`;
    return;
  }

  box.innerHTML = (messages || []).map(renderMessage).join('');
  box.scrollTop = box.scrollHeight;
}

function renderMessage(m){
  const mine = m.sender_id === currentUserId;
  const time = new Date(m.created_at).toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' });
  return `<div class="msg ${mine ? 'mine' : 'theirs'}">${escapeHtml(m.content)}<small>${time}</small></div>`;
}

async function markAsRead(conversationId){
  await supabaseClient.from('conversation_reads').upsert({
    conversation_id: conversationId,
    user_id: currentUserId,
    last_read_at: new Date().toISOString()
  });
  const item = document.querySelector(`.conv-item[data-id="${conversationId}"] .unread-dot`);
  if (item) item.remove();
}

function subscribeToConversation(conversationId){
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeChannel = supabaseClient
    .channel('messages-' + conversationId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`
    }, (payload) => {
      const box = document.getElementById('chatMessages');
      box.insertAdjacentHTML('beforeend', renderMessage(payload.new));
      box.scrollTop = box.scrollHeight;
      if (payload.new.sender_id !== currentUserId) markAsRead(conversationId);
    })
    .subscribe();
}

async function sendMessage(e){
  e.preventDefault();
  if (!currentConversationId) return;
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content) return;

  input.value = '';
  const { error } = await supabaseClient.from('messages').insert({
    conversation_id: currentConversationId,
    sender_id: currentUserId,
    content
  });

  if (error) {
    input.value = content;
    alert('تعذر إرسال الرسالة: ' + error.message);
  } else {
    await loadConversations();
  }
}

function showThreadMobile(){
  document.getElementById('convList').classList.add('mobile-hide');
  document.getElementById('chatPanel').classList.remove('mobile-hide');
}

function showListMobile(){
  document.getElementById('convList').classList.remove('mobile-hide');
  document.getElementById('chatPanel').classList.add('mobile-hide');
}

function escapeHtml(str){
  return (str ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
