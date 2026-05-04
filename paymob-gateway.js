/**
 * Paymob Accept — خط سير أساسي: auth → طلب شراء → payment_key → iframe
 * متغيرات البيئة (انظر أسفل ملف server.js لتعليقات الإعداد):
 *   PAYMOB_API_KEY          — Secret API Key من لوحة Paymob Accept
 *   PAYMOB_INTEGRATION_ID  — Integration ID لتجربة الدفع من Payment Integrations
 *   PAYMOB_IFRAME_ID       — IFrame identifier (يبدو في رابط لوحة iframe)
 *
 * عنوان Paymob الغالب للإنتاج: https://accept.paymob.com (قد يستخدم البعض subdomain آخر بعد التسجيل)
 *
 * إرجاع العميل بعد الدفع / 3DS:
 *   PUBLIC_SITE_URL → يُبنى منها payment-done.html?ref=<merchant_order_id>
 *   أو PAYMOB_RETURN_URL كاملًا مع {{merchant_order_id}}
 *   PAYMOB_DUPLICATE_REDIRECT_FIELD=1 → يُرسل أيضًا redirect_url (بعض إعدادات Accept)
 */
const PAYMOB_BASE = process.env.PAYMOB_BASE || "https://accept.paymob.com";

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Paymob بدون JSON: ${res.status} ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    const detail = typeof json.detail === "string" ? json.detail : JSON.stringify(json);
    throw new Error(`Paymob ${res.status}: ${detail}`);
  }
  return json;
}

function isPaymobConfigured() {
  const k = process.env.PAYMOB_API_KEY || "";
  const integration = Number(process.env.PAYMOB_INTEGRATION_ID);
  const iframe = Number(process.env.PAYMOB_IFRAME_ID);
  return k.length > 10 && integration > 0 && iframe > 0;
}

/** بيانات فوترة بسيطة — Paymob غالبًا يشتري الحقول بشكل أساسي */
function buildBilling(customerName, customerPhone, customerEmailFallback) {
  const nameStr = String(customerName || "").trim() || "عميل";
  const parts = nameStr.split(/\s+/).filter(Boolean);
  const first_name = parts[0] || "عميل";
  const last_name = parts.slice(1).join(" ") || ".";

  return {
    apartment: "na",
    email: customerEmailFallback || "guest@karawan-cinema.local",
    floor: "na",
    first_name,
    street: "na",
    building: "na",
    phone_number: String(customerPhone || "").replace(/\s/g, "") || "01111111111",
    shipping_method: "PKG",
    postal_code: "11511",
    city: "Cairo",
    country: "EG",
    last_name,
    state: "Cairo"
  };
}

/**
 * ترجع { iframeUrl }
 * amountPiasters إجمالي بالقرش (جنيه × 100)
 */
async function createPaymobIframeSession({
  merchantOrderId,
  amountPiasters,
  customerName,
  customerPhone,
  customerEmailFallback
}) {
  if (!isPaymobConfigured()) {
    throw new Error("بوابة Paymob غير مُفعّلة (متغيرات البيئة).");
  }

  const apiKey = process.env.PAYMOB_API_KEY;
  const integrationId = Number(process.env.PAYMOB_INTEGRATION_ID);
  const iframeId = Number(process.env.PAYMOB_IFRAME_ID);

  const authPayload = await postJson(`${PAYMOB_BASE}/api/auth/tokens`, { api_key: apiKey });

  const authToken = authPayload.token;
  if (!authToken) throw new Error("لم يصل auth_token من Paymob");

  const orderPayload = {
    auth_token: authToken,
    delivery_needed: "false",
    amount_cents: amountPiasters,
    currency: "EGP",
    merchant_order_id: String(merchantOrderId).slice(0, 240)
  };

  const orderRes = await postJson(`${PAYMOB_BASE}/api/ecommerce/orders`, orderPayload);
  const orderId = orderRes.id;
  if (!orderId) throw new Error("لم يصل order id من Paymob");

  const keyPayload = {
    auth_token: authToken,
    amount_cents: amountPiasters,
    expiration: 3600,
    order_id: orderId,
    billing_data: buildBilling(customerName, customerPhone, customerEmailFallback),
    currency: "EGP",
    integration_id: integrationId,
    lock_order_when_paid: "false"
  };

  const customReturn = String(process.env.PAYMOB_RETURN_URL || "").trim();
  const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

  let receiptUrl = "";
  if (customReturn) {
    receiptUrl = customReturn
      .split("{{merchant_order_id}}")
      .join(String(merchantOrderId))
      .split("{merchant_order_id}")
      .join(String(merchantOrderId));
  } else if (publicSiteUrl) {
    receiptUrl = `${publicSiteUrl}/payment-done.html?ref=${encodeURIComponent(String(merchantOrderId))}`;
  }

  if (receiptUrl) {
    keyPayload.redirection_url = receiptUrl;
    // Different Paymob/Accept setups may expect different field names.
    // We set the common variants to maximize successful return-to-site after 3DS.
    keyPayload.redirect_url = receiptUrl;
    keyPayload.return_url = receiptUrl;
    // Keep optional flag for backwards compatibility (no-op now, but left intentionally).
    void String(process.env.PAYMOB_DUPLICATE_REDIRECT_FIELD || "").trim();
  }

  const keyRes = await postJson(`${PAYMOB_BASE}/api/acceptance/payment_keys`, keyPayload);
  const paymentToken = keyRes.token;
  if (!paymentToken) throw new Error("لم يصل payment token من Paymob");

  const iframeUrl = `${PAYMOB_BASE}/api/acceptance/iframes/${iframeId}?payment_token=${encodeURIComponent(paymentToken)}`;

  return { iframeUrl };
}

module.exports = { isPaymobConfigured, createPaymobIframeSession };
