# Karawan Cinema - Payment Setup

## 0) Firebase (Firestore)

1. افتح **Firebase Console** → مشروعك → **Firestore** → **Rules**.
2. انسخ محتوى الملف `firestore.rules` من المشروع والصقه هناك ثم **Publish**.
3. تأكد أن **Firebase Admin** على السيرفر شغال (`firebase-service-account.json` أو `FIREBASE_SERVICE_ACCOUNT_JSON`) حتى يعمل Paymob session والـ webhook.

## 1) Configure environment

Copy `.env.example` to `.env` and fill real values:

- `PAYMOB_API_KEY`
- `PAYMOB_INTEGRATION_ID`
- `PAYMOB_IFRAME_ID`
- `QNB_WEBHOOK_SECRET`

For Firebase Admin:

- either keep `firebase-service-account.json` in project root
- or set `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env`

## 2) Run server

```bash
npm start
```

Server starts on:

- `http://localhost:3000`

## 3) Set callback URLs in gateway dashboard

- Paymob callback: `https://YOUR_DOMAIN/api/paymob/callback`
- QNB callback: `https://YOUR_DOMAIN/api/qnb/callback`
  - add header: `x-qnb-signature: <QNB_WEBHOOK_SECRET>`
  - include booking reference in payload as one of:
    - `bookingId`
    - `ref`
    - `merchant_order_id`
    - `order_id`

## 4) Booking behavior

- after pressing booking confirm, user is redirected to electronic payment
- if payment succeeds: booking is marked paid automatically
- if no payment within 5 minutes: seats are released automatically
