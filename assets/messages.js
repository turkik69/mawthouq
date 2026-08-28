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

  await loadMessages(conversationId);
  await markAsRead(conversationId);
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
  if (!confirm('تأكيد استلام الخدمة؟ لا يمكن التراجع عن هذا لاحقًا.')) return;
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
