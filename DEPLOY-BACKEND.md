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
   - `QNB_WEBHOOK_SECRET`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string) or attach service-account file in your host method.

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
