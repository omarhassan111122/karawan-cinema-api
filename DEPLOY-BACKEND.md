# Deploy Backend (Required for Payment APIs)

Hosting on Firebase serves static files only. Payment endpoints under `/api/*` need this Node server deployed separately.

## 1) Deploy server.js to Render (quick path)

1. Push project to GitHub.
2. Create a new **Web Service** on [Render](https://render.com/).
3. Connect the repo and set:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables (same as local `.env`):
   - `PAYMOB_API_KEY`
   - `PAYMOB_INTEGRATION_ID`
   - `PAYMOB_IFRAME_ID`
   - `PAYMOB_BASE` (optional)
   - `PUBLIC_SITE_URL` (ضروري لرجوع العميل بعد الدفع إلى `payment-done.html`)
   - `PAYMOB_RETURN_URL` (اختياري بديل لـ `PUBLIC_SITE_URL` مع `{{merchant_order_id}}`)
   - `QNB_WEBHOOK_SECRET`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string) or attach service-account file in your host method.
   - `CASHIER_SYNC_URL` (endpoint الخاص بنظام الكاشير الخارجي)
   - `CASHIER_SYNC_TOKEN` (اختياري Bearer token)
   - `CASHIER_SYNC_TIMEOUT_MS` (اختياري، الافتراضي 12000)
   - `CASHIER_SYNC_ON` (`paid` أو `all`)

After deploy, copy backend URL, e.g.:
`https://karawan-cinema-api.onrender.com`

## 2) Point frontend to backend URL

Edit `firebase.js`:

```js
window.API_BASE_URL = "https://karawan-cinema-api.onrender.com";
```

Then deploy hosting again:

```bash
firebase deploy --only hosting
```

## 3) Configure payment callbacks

- Paymob callback:
  `https://<your-backend-domain>/api/paymob/callback`
- QNB callback:
  `https://<your-backend-domain>/api/qnb/callback`
  with `x-qnb-signature` matching `QNB_WEBHOOK_SECRET`.

## 4) Sync booking to cashier system (external DB)

بعد تفعيل المتغيرات أعلاه:

- أي حجز يتم تأكيد دفعه (Paymob/QNB) سيتم إرساله تلقائيًا إلى `CASHIER_SYNC_URL`.
- حالة المزامنة تُحفظ داخل مستند الحجز في Firestore تحت الحقل `cashierSync`.
- لإعادة المحاولة يدويًا:

```bash
POST https://<your-backend-domain>/api/bookings/<BOOKING_ID>/sync-cashier
Content-Type: application/json

{ "event": "manual" }
```
