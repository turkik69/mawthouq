// send-push-notification
// يُستدعى تلقائيًا (عبر pg_net trigger) عند: رسالة جديدة، طلب دفع من مقدم
// الخدمة، أو تأكيد دفع من طالب الخدمة. يجد المستلم المناسب ويرسل له
// إشعار Web Push حقيقي عبر كل اشتراكات المتصفح المسجّلة له.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

webpush.setVapidDetails("mailto:admin@byyassmin.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function restHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

async function restGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders() });
  if (!res.ok) throw new Error(`REST GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteDeadSubscriptions(endpoints: string[]) {
  if (!endpoints.length) return;
  const list = endpoints.map((e) => `"${e}"`).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=in.(${list})`, {
    method: "DELETE",
    headers: { ...restHeaders(), Prefer: "return=minimal" },
  }).catch((e) => console.error("cleanup failed:", e));
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const payload = await req.json();
    const notifType = payload.type as string | undefined; // غير موجود = الشكل القديم (رسالة جديدة)

    let recipientId: string | undefined;
    let title: string;
    let notifBody: string;

    if (notifType === "payment_requested") {
      const payment = payload.record;
      recipientId = payment?.seeker_id;
      title = "طلب دفع من مقدم الخدمة";
      notifBody = `يطلب مقدم الخدمة دفع ${payment?.amount_omr} ر.ع لاستلام عملك المكتمل.`;
    } else if (notifType === "payment_confirmed") {
      const payment = payload.record;
      recipientId = payment?.provider_id;
      title = "تم تأكيد الدفع";
      notifBody = `أكّد الطالب دفع ${payment?.amount_omr} ر.ع — يمكنك تسليم العمل الآن.`;
    } else {
      // الشكل الأصلي — بدون أي تغيير عن المنطق السابق
      const message = payload.record;
      if (!message?.conversation_id || !message?.sender_id) {
        return new Response("ignored: malformed payload", { status: 200 });
      }
      const conversations = await restGet(
        `conversations?id=eq.${message.conversation_id}&select=seeker_id,provider_id`
      );
      const conv = conversations[0];
      if (!conv) return new Response("ok: no conversation", { status: 200 });
      recipientId = conv.seeker_id === message.sender_id ? conv.provider_id : conv.seeker_id;
      title = "رسالة جديدة على منصة موثوق";
      notifBody = "لديك رسالة جديدة. افتح منصة موثوق لقراءتها.";
    }

    if (!recipientId) return new Response("ok: no recipient", { status: 200 });

    const subs = await restGet(`push_subscriptions?user_id=eq.${recipientId}`);
    if (!subs.length) return new Response("ok: no subscriptions", { status: 200 });

    const pushPayload = JSON.stringify({ title, body: notifBody, url: "messages.html" });

    const results = await Promise.allSettled(
      subs.map((sub: { endpoint: string; p256dh: string; auth_key: string }) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          pushPayload
        )
      )
    );

    const deadEndpoints: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const statusCode = (r.reason && (r.reason.statusCode || r.reason.status)) || 0;
        if (statusCode === 404 || statusCode === 410) deadEndpoints.push(subs[i].endpoint);
        else console.error("push failed for", subs[i].endpoint, r.reason);
      }
    });
    await deleteDeadSubscriptions(deadEndpoints);

    return new Response(JSON.stringify({ sent: subs.length, cleaned: deadEndpoints.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push-notification error:", err);
    return new Response(String(err), { status: 500 });
  }
});
