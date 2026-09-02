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
    const roleBadge = currentUserRole === 'provider'
      ? '<span class="badge-provider">مقدم خدمة</span>'
      : '<span class="badge-seeker">طالب خدمة</span>';
    document.getElementById('headerActions').insertAdjacentHTML('afterbegin', roleBadge);

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

  // تجميع المحادثات حسب الطرف الآخر — بطاقة واحدة لكل شخص بدل بطاقة لكل طلب،
  // حتى لو تعدّدت الطلبات معه بمرور الوقت (كل طلب يبقى محادثة منفصلة في
  // قاعدة البيانات، لكن تُعرض هنا كخيط واحد مستمر)
  const groups = new Map();
  conversationsCache.forEach(c => {
    if (!groups.has(c.other_id)) groups.set(c.other_id, []);
    groups.get(c.other_id).push(c);
  });

  const groupList = [...groups.values()].map(list => {
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const primary = list[list.length - 1]; // الأحدث — يمثّل العنوان والحالة الحالية
    const anyUnread = list.some(c => c.unread);
    const lastWithMessage = [...list].reverse().find(c => c.last_message);
    const lastActivity = list.reduce((max, c) => {
      const t = new Date(c.last_message_at || c.created_at).getTime();
      return t > max ? t : max;
    }, 0);
    return { primary, all: list, unread: anyUnread, lastMessage: lastWithMessage ? lastWithMessage.last_message : null, lastActivity };
  });

  groupList.sort((a, b) => b.lastActivity - a.lastActivity);

  container.innerHTML = groupList.map(g => {
    const c = g.primary;
    const subject = c.request_title || c.service_type;
    const title = subject ? `${c.other_username} · ${subject}` : c.other_username;
    return `
    <div class="conv-item ${c.id === currentConversationId ? 'active' : ''}" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.other_username)}">
      <div class="ci-text">
        <b>${escapeHtml(title)}${c.completed_at ? ' <span style="color:var(--muted);font-weight:400;font-size:11px">(مؤرشفة)</span>' : ''}</b>
        <span>${escapeHtml(g.lastMessage || 'ابدأ المحادثة')}</span>
      </div>
      ${g.unread ? '<span class="unread-dot"></span>' : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.conv-item').forEach(el => {
    el.addEventListener('click', () => openConversation(el.dataset.id, el.dataset.name));
  });
}

async function openOrCreateConversation(otherId, requestId){
  const existing = requestId
    ? conversationsCache.find(c => c.request_id === requestId)
    : conversationsCache.find(c => c.other_id === otherId && !c.completed_at);
  if (existing) {
    await openConversation(existing.id, existing.other_username);
    return;
  }

  // نحتاج اسم الطرف الآخر لعرضه فورًا؛ نجلبه مباشرة من الملف الشخصي (يعمل
  // بغض النظر عن حالة الطلب، بخلاف الاعتماد على قوائم "المفتوح فقط")
  let otherName = 'مستخدم';
  const { data: fetchedName } = await supabaseClient.rpc('get_username', { p_user_id: otherId });
  if (fetchedName) otherName = fetchedName;

  let newConvId, error;

  if (requestId) {
    // الخادم نفسه يحدد الأطراف من الطلب — لا اعتماد على تخمين العميل لدوره
    const res = await supabaseClient.rpc('create_conversation_for_request', { p_request_id: requestId });
    newConvId = res.data;
    error = res.error;
  } else {
    const res = await supabaseClient
      .from('conversations')
      .insert({ seeker_id: currentUserId, provider_id: otherId, request_id: null })
      .select()
      .single();
    newConvId = res.data?.id;
    error = res.error;
  }

  if (error) {
    document.getElementById('chatEmpty').textContent = 'تعذر بدء المحادثة: ' + error.message;
    return;
  }

  await loadConversations();
  await openConversation(newConvId, otherName);
}

async function openConversation(conversationId, otherName){
  currentConversationId = conversationId;

  document.getElementById('chatEmpty').style.display = 'none';
  document.getElementById('chatThread').style.display = 'flex';
  document.getElementById('chatThread').style.flexDirection = 'column';
  document.getElementById('chatThread').style.height = '100%';
  const convForTitle = conversationsCache.find(c => c.id === conversationId);
  const titleSubject = convForTitle && (convForTitle.request_title || convForTitle.service_type);
  const headerTitle = titleSubject ? `${otherName} · ${titleSubject}` : otherName;
  document.getElementById('chatOtherName').textContent = headerTitle;

  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === conversationId);
  });

  showThreadMobile();
  renderCompletionArea(conversationId);
  const conv = conversationsCache.find(c => c.id === conversationId);
  const msgInput = document.getElementById('messageInput');
  msgInput.disabled = !!(conv && conv.completed_at);
  msgInput.placeholder = (conv && conv.completed_at) ? 'محادثة مؤرشفة — لا يمكن الإرسال' : 'اكتب رسالتك...';
  document.getElementById('filesPanel').style.display = 'none';

  // كل الطلبات السابقة مع نفس الشخص تُعرض كخيط واحد مستمر؛ نجمعها هنا
  const group = conv
    ? conversationsCache.filter(c => c.other_id === conv.other_id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    : [conv].filter(Boolean);

  await loadMessages(group);
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
  if (error) { showToast('تعذر التأكيد: ' + error.message, 'error'); return; }
  await loadConversations();
  renderCompletionArea(currentConversationId);
  showToast('تم تأكيد الاستلام — شكرًا لتقييمك القادم', 'success');
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

  if (error) { showToast('تعذر إرسال التقييم: ' + error.message, 'error'); return; }
  await loadConversations();
  renderCompletionArea(currentConversationId);
  showToast('شكرًا لتقييمك!', 'success');
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
    if (currentUserRole === 'provider') {
      box.innerHTML = `
        <input type="number" step="0.001" min="0.001" id="paymentAmount" class="amount-input" placeholder="المبلغ (ر.ع)">
        <button class="status-pill action" onclick="requestPayment()">تسليم العمل وطلب الدفع</button>`;
    } else {
      box.innerHTML = `<span style="color:var(--muted);font-size:13px">لم يطلب مقدم الخدمة الدفع بعد — يظهر هنا عند اكتمال العمل</span>`;
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

async function requestPayment(){
  const input = document.getElementById('paymentAmount');
  const amount = parseFloat(input.value);
  if (!amount || amount <= 0) { showToast('أدخل مبلغًا صحيحًا.', 'error'); return; }

  const conv = conversationsCache.find(c => c.id === currentConversationId);
  if (!conv) return;

  const { error } = await supabaseClient.from('payments').insert({
    conversation_id: currentConversationId,
    seeker_id: conv.other_id,
    provider_id: currentUserId,
    amount_omr: amount,
    status: 'pending'
  });

  if (error) { showToast('تعذر إرسال طلب الدفع: ' + error.message, 'error'); return; }
  await loadPaymentStatus(currentConversationId);
  showToast('تم إرسال طلب الدفع للطالب', 'success');
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
    const { data: originalFiles, error: originalError } = await supabaseClient
      .from('service_request_files')
      .select('*')
      .eq('request_id', conv.request_id);
    if (originalError) {
      originalHtml = `<h4>ملفات الطلب الأصلية</h4><p style="color:var(--red);font-size:13px">تعذر التحميل: ${escapeHtml(originalError.message)}</p>`;
    } else if (originalFiles && originalFiles.length) {
      const links = await Promise.all(originalFiles.map(renderFileLink));
      originalHtml = `<h4>ملفات الطلب الأصلية</h4>${links.join('')}`;
    }
  }

  const { data: deliveredFiles, error: deliveredError } = await supabaseClient
    .from('conversation_files')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  let deliveredHtml = '<h4 style="margin-top:12px">الملفات المتبادلة</h4><p style="color:var(--muted);font-size:13px">لا يوجد ملفات مسلَّمة بعد.</p>';
  if (deliveredError) {
    deliveredHtml = `<h4 style="margin-top:12px">الملفات المتبادلة</h4><p style="color:var(--red);font-size:13px">تعذر التحميل: ${escapeHtml(deliveredError.message)}</p>`;
  } else if (deliveredFiles && deliveredFiles.length) {
    const names = await Promise.all(deliveredFiles.map(f => supabaseClient.rpc('get_username', { p_user_id: f.uploaded_by })));
    const links = await Promise.all(deliveredFiles.map((f, i) => renderFileLink(f, names[i].data)));
    deliveredHtml = `<h4 style="margin-top:12px">الملفات المتبادلة</h4>${links.join('')}`;
  }

  panel.innerHTML = `
    ${originalHtml}
    ${deliveredHtml}
    <div style="margin-top:12px;font-size:12px;font-weight:700;color:var(--muted)">طريقة التسليم</div>
    <div style="display:flex;gap:14px;margin:6px 0 4px;font-size:13px">
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="deliveryMethod" value="platform" checked onchange="onDeliveryMethodChange()"> رفع عبر المنصة</label>
      <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="deliveryMethod" value="email" onchange="onDeliveryMethodChange()"> بريد إلكتروني</label>
    </div>
    <div id="emailDeliveryBox" style="display:none;font-size:13px;background:var(--gold-tint);border-radius:8px;padding:8px 12px;margin-bottom:8px"></div>
    <div class="file-upload-row" id="platformUploadRow">
      <input type="file" id="deliveryFileInput" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.jpg,.jpeg,.png" onchange="checkFileSizeImmediately(this)">
      <button class="status-pill action" onclick="uploadDeliveryFile()">تسليم ملف</button>
    </div>`;
}

async function onDeliveryMethodChange(){
  const method = document.querySelector('input[name="deliveryMethod"]:checked').value;
  const emailBox = document.getElementById('emailDeliveryBox');
  const uploadRow = document.getElementById('platformUploadRow');

  if (method === 'email') {
    uploadRow.style.display = 'none';
    emailBox.style.display = 'block';
    emailBox.textContent = 'جارٍ التحميل...';
    const { data: email, error } = await supabaseClient.rpc('get_conversation_partner_email', { p_conversation_id: currentConversationId });
    emailBox.textContent = (email && !error)
      ? `أرسل الملف مباشرة إلى: ${email}`
      : 'تعذر جلب البريد الإلكتروني.';
  } else {
    uploadRow.style.display = 'flex';
    emailBox.style.display = 'none';
  }
}

async function renderFileLink(f, uploaderName){
  const { data, error } = await supabaseClient.storage.from('request-files').createSignedUrl(f.file_path, 3600);
  const who = uploaderName ? `<small>من ${escapeHtml(uploaderName)}</small>` : '';

  if (!data || error) {
    return `<div class="file-row"><span>${escapeHtml(f.file_name)} (تعذّر فتح الرابط)</span>${who}</div>`;
  }

  const isImage = /\.(jpe?g|png|gif|webp)$/i.test(f.file_name);
  if (isImage) {
    return `<div class="file-row" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div style="display:flex;width:100%;justify-content:space-between;align-items:center">
        <span style="font-weight:700">${escapeHtml(f.file_name)}</span>${who}
      </div>
      <img src="${data.signedUrl}" alt="${escapeHtml(f.file_name)}" style="max-width:100%;max-height:220px;border-radius:8px;border:1px solid var(--line)">
    </div>`;
  }

  const link = `<a href="${data.signedUrl}" target="_blank" rel="noopener">${escapeHtml(f.file_name)}</a>`;
  return `<div class="file-row">${link}${who}</div>`;
}

function checkFileSizeImmediately(input){
  const file = input.files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    showToast(`الملف "${file.name}" حجمه ${(file.size/1024/1024).toFixed(1)} ميغا — الحد الأقصى 20 ميغابايت. اختر ملفًا أصغر.`, 'error');
    input.value = '';
  }
}

async function uploadDeliveryFile(){
  const input = document.getElementById('deliveryFileInput');
  const file = input.files[0];
  if (!file) { showToast('اختر ملفًا أولاً.', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { showToast('الحجم الأقصى 20 ميغابايت.', 'error'); return; }

  const path = `${currentUserId}/conv-${currentConversationId}/${file.name}`;
  const { error: uploadError } = await supabaseClient.storage.from('request-files').upload(path, file, { upsert: true });
  if (uploadError) { showToast('تعذر رفع الملف: ' + uploadError.message, 'error'); return; }

  const { error: insertError } = await supabaseClient.from('conversation_files').insert({
    conversation_id: currentConversationId,
    uploaded_by: currentUserId,
    file_path: path,
    file_name: file.name
  });
  if (insertError) { showToast('تعذر تسجيل الملف: ' + insertError.message, 'error'); return; }

  showToast('تم تسليم الملف بنجاح', 'success');
  input.value = '';
  await loadFilesPanel(currentConversationId);
}

async function loadMessages(group){
  const convIds = group.map(c => c.id);
  const { data: messages, error } = await supabaseClient
    .from('messages')
    .select('*')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: true });

  const box = document.getElementById('chatMessages');
  if (error) {
    box.innerHTML = `<p style="color:var(--red)">تعذر تحميل الرسائل: ${escapeHtml(error.message)}</p>`;
    return;
  }

  let html = '';
  let lastConvId = null;
  (messages || []).forEach(m => {
    if (m.conversation_id !== lastConvId) {
      const segment = group.find(c => c.id === m.conversation_id);
      const segTitle = segment && (segment.request_title || segment.service_type);
      if (segTitle) html += `<div class="msg-divider">${escapeHtml(segTitle)}</div>`;
      lastConvId = m.conversation_id;
    }
    html += renderMessage(m);
  });

  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
  box.classList.remove('pane-fade');
  void box.offsetWidth; // إعادة تشغيل الأنيميشن حتى لو نفس العنصر
  box.classList.add('pane-fade');
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
  const conv = conversationsCache.find(c => c.id === currentConversationId);
  if (conv && conv.completed_at) { alert('هذه المحادثة مؤرشفة (اكتملت الخدمة) ولا يمكن إرسال رسائل جديدة فيها.'); return; }
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
