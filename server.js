/**
 * تشغيل: npm install && npm start  →  http://localhost:3000
 *
 * بوابة Paymob (اختياري):
 *   PAYMOB_API_KEY
 *   PAYMOB_INTEGRATION_ID   (من Payment Integrations في لوحة Paymob Accept)
 *   PAYMOB_IFRAME_ID        (رقم الـ iframe عند Hosted Payment Page)
 *   PAYMOB_BASE             (اختياري، افتراضي https://accept.paymob.com إن لم يعمل جرّب https://accept.paymobsolutions.com)
 *
 * ربط الحجوزات بتأكيد الدفع مع Firestore للويب هوك:
 *   نزِّل Service Account من Firebase Console → احفظه كـ firebase-service-account.json في جذر المشروع,
 *   أو عرّف FIREBASE_SERVICE_ACCOUNT_JSON (محتوى JSON كاملًا في متغير بيئة على السيرفر).
 *
 * في لوحة Paymob عيِّن «Processed / Transaction» callback URL إلى:
 *   https://YOUR-DOMAIN/api/paymob/callback
 * وصفحة عودة العميل (اختياري) → payment-done.html
 */
require('dotenv').config();
const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const paymobGateway = require("./paymob-gateway");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.join(__dirname, "data", "bookings.json");

let firestoreAdmin = null;

function initFirebaseAdmin() {
  try {
    if (admin.apps.length > 0) {
      firestoreAdmin = admin.firestore();
      return;
    }

    const saPath = path.join(__dirname, "firebase-service-account.json");
    let serviceAccount;

    if (fsSync.existsSync(saPath)) {
      serviceAccount = JSON.parse(fsSync.readFileSync(saPath, "utf8"));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      firestoreAdmin = admin.firestore();
      console.log("Firebase Admin: OK (firebase-service-account.json).");
      return;
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      firestoreAdmin = admin.firestore();
      console.log("Firebase Admin: OK (FIREBASE_SERVICE_ACCOUNT_JSON).");
    }
  } catch (error) {
    console.warn("Firebase Admin غير مفعّل — بوابة Paymob ستفشل في التحقق من الحجوزات:", error.message);
  }
}

initFirebaseAdmin();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/payment/config", (_req, res) => {
  res.json({
    paymob: paymobGateway.isPaymobConfigured() && !!firestoreAdmin,
    qnbWebhookEnabled: !!process.env.QNB_WEBHOOK_SECRET
  });
});

app.get("/api/bookings/:bookingId/payment-status", async (req, res) => {
  try {
    const bookingId = String(req.params.bookingId || "").trim();
    if (!bookingId) return res.status(400).json({ error: "bookingId مطلوب" });
    if (!firestoreAdmin) return res.status(503).json({ error: "firebase-admin غير مفعّل" });

    const snap = await firestoreAdmin.collection("bookings").doc(bookingId).get();
    if (!snap.exists) return res.status(404).json({ error: "booking not found" });

    const data = snap.data() || {};
    let holdExpiresAtMs = null;
    if (data.holdExpiresAt && typeof data.holdExpiresAt.toMillis === "function") {
      holdExpiresAtMs = data.holdExpiresAt.toMillis();
    }

    const isPaid = data.paymentStatus === "paid" || data.seatsPaid === true || data.paymentConfirmed === true;
    const nowMs = Date.now();
    const holdActive = isPaid ? true : Number.isFinite(holdExpiresAtMs) && nowMs < holdExpiresAtMs;

    return res.json({
      bookingId,
      paymentStatus: data.paymentStatus || "pending_payment",
      paid: isPaid,
      holdActive,
      holdExpiresAtMs
    });
  } catch (error) {
    console.error("[bookings/payment-status]", error);
    return res.status(500).json({ error: "internal-error" });
  }
});

app.post("/api/paymob/session", async (req, res) => {
  try {
    const bookingId = String(req.body.bookingId || "").trim();
    if (!bookingId) {
      return res.status(400).json({ error: "bookingId مطلوب" });
    }
    if (!firestoreAdmin) {
      return res.status(503).json({
        error:
          "أضف حساب الخدمة: ملف firebase-service-account.json أو FIREBASE_SERVICE_ACCOUNT_JSON لقراءة حجوزات Firebase من السيرفر."
      });
    }
    if (!paymobGateway.isPaymobConfigured()) {
      return res.status(503).json({
        error: "فعِّل PAYMOB_API_KEY و PAYMOB_INTEGRATION_ID و PAYMOB_IFRAME_ID في متغيرات البيئة."
      });
    }

    const snap = await firestoreAdmin.collection("bookings").doc(bookingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "الحجز غير موجود في Firestore." });
    }

    const booking = snap.data();

    if (booking.paymentStatus === "paid" || booking.seatsPaid === true) {
      return res.status(400).json({ error: "تم تسديد هذا الحجز مسبقًا." });
    }

    const totalPrice = Number(booking.totalPrice);
    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      return res.status(400).json({ error: "قيمة totalPrice غير صالحة في مستند الحجز." });
    }

    const amountPiasters = Math.round(totalPrice * 100);

    const { iframeUrl } = await paymobGateway.createPaymobIframeSession({
      merchantOrderId: bookingId,
      amountPiasters,
      customerName: booking.customerName || "عميل",
      customerPhone: booking.customerPhone || "01111111111",
      customerEmailFallback: `${String(booking.customerPhone || "guest").replace(/\D/g, "")}@guest.karawan.local`
    });

    return res.json({ url: iframeUrl });
  } catch (error) {
    console.error("[paymob/session]", error);
    return res.status(500).json({ error: error.message || "فشل إنشاء الدفع." });
  }
});

app.post("/api/paymob/callback", async (req, res) => {
  try {
    if (!firestoreAdmin) {
      return res.status(503).send("no-firebase-admin");
    }

    const body = req.body;
    const obj = body.obj || body.transaction || {};

    const success = Boolean(obj.success) === true;

    let merchantOrderId = "";
    if (typeof obj.order === "object" && obj.order !== null && obj.order.merchant_order_id != null) {
      merchantOrderId = String(obj.order.merchant_order_id).trim();
    }
    if (!merchantOrderId && obj.merchant_order_id != null) {
      merchantOrderId = String(obj.merchant_order_id).trim();
    }
    if (!merchantOrderId && body.merchant_order_id != null) {
      merchantOrderId = String(body.merchant_order_id).trim();
    }

    if (!merchantOrderId) {
      console.warn("[paymob/callback] body keys:", typeof body === "object" && body !== null ? Object.keys(body).slice(0, 24) : body);
      return res.status(400).send("no-merchant-order");
    }

    if (success) {
      await firestoreAdmin.collection("bookings").doc(merchantOrderId).update({
        paymentStatus: "paid",
        seatsPaid: true,
        paymentMethod: "paymob_accept",
        paymentGateway: "paymob",
        paymobTransactionId: obj.id != null ? String(obj.id) : "",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        holdExpiresAt: admin.firestore.FieldValue.delete()
      });
      console.log("[paymob/callback] paid:", merchantOrderId);
    }

    return res.send("OK");
  } catch (error) {
    console.error("[paymob/callback]", error);
    return res.status(500).send("error");
  }
});

/**
 * QNB webhook callback:
 * - ضع QNB_WEBHOOK_SECRET في متغيرات البيئة
 * - أرسلها في header: x-qnb-signature أو query: ?token=
 * - body يتضمن bookingId (أو ref/merchant_order_id/order_id) + نتيجة العملية
 */
app.post("/api/qnb/callback", async (req, res) => {
  try {
    if (!firestoreAdmin) {
      return res.status(503).send("no-firebase-admin");
    }

    const expectedSecret = String(process.env.QNB_WEBHOOK_SECRET || "").trim();
    if (!expectedSecret) {
      return res.status(503).send("qnb-webhook-secret-missing");
    }

    const providedSecret =
      String(req.headers["x-qnb-signature"] || "").trim() ||
      String(req.query.token || "").trim();

    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(401).send("unauthorized");
    }

    const body = req.body || {};
    const bookingId = String(
      body.bookingId || body.ref || body.merchant_order_id || body.order_id || ""
    ).trim();

    if (!bookingId) {
      return res.status(400).send("missing-booking-id");
    }

    const rawStatus = String(body.status || body.payment_status || body.result || "").toLowerCase().trim();
    const approvedStates = new Set(["paid", "success", "succeeded", "approved", "captured", "authorized"]);
    const failedStates = new Set(["failed", "declined", "cancelled", "canceled", "expired", "voided"]);
    const explicitSuccess = body.success === true || body.success === "true" || body.approved === true;
    const explicitFailure = body.success === false || body.success === "false";
    const isSuccess = explicitSuccess || approvedStates.has(rawStatus);
    const isFailed = explicitFailure || failedStates.has(rawStatus);

    if (!isSuccess && !isFailed) {
      return res.status(202).send("ignored-status");
    }

    const bookingRef = firestoreAdmin.collection("bookings").doc(bookingId);
    const update = isSuccess
      ? {
          paymentStatus: "paid",
          seatsPaid: true,
          paymentMethod: "visa_qnb",
          paymentGateway: "qnb",
          qnbTransactionId: body.transactionId != null ? String(body.transactionId) : "",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          holdExpiresAt: admin.firestore.FieldValue.delete()
        }
      : {
          paymentStatus: "failed",
          paymentGateway: "qnb",
          paymentReleased: true,
          holdExpiresAt: admin.firestore.FieldValue.delete(),
          paymentFailedAt: admin.firestore.FieldValue.serverTimestamp()
        };

    await bookingRef.update(update);
    return res.send("OK");
  } catch (error) {
    console.error("[qnb/callback]", error);
    return res.status(500).send("error");
  }
});

const MOVIES = ["Devil Wears Prada", "The Mummy", "Action Movie"];
const SHOWTIMES = ["01:00 PM", "04:00 PM", "07:00 PM", "10:00 PM"];
const PHONE_REGEX = /^01\d{9}$/;

function buildRange(row, start, end, step = 2) {
  const seats = [];
  for (let n = start; n <= end; n += step) {
    seats.push(`${row}${n}`);
  }
  return seats;
}

function buildRangeReverse(row, start, end, step = 2) {
  const seats = [];
  for (let n = end; n >= start; n -= step) {
    seats.push(`${row}${n}`);
  }
  return seats;
}

function getAllSeatCodes() {
  const sideEvenRanges = {
    E: [10, 20], F: [10, 20], G: [10, 18], H: [10, 18], I: [10, 20],
    J: [10, 20], K: [10, 20], L: [10, 18], M: [10, 20], N: [10, 20], O: [10, 20], P: null
  };
  const sideOddRanges = {
    E: [11, 21], F: [11, 21], G: [11, 21], H: [11, 19], I: [11, 21],
    J: [11, 21], K: [11, 21], L: [11, 19], M: [11, 21], N: [11, 21], O: [11, 21], P: [11, 21]
  };

  const seats = new Set([
    ...buildRange("B", 6, 20),
    ...buildRange("C", 6, 20),
    ...buildRange("D", 6, 20),
    ...buildRange("C", 5, 19),
    ...buildRange("D", 5, 19)
  ]);

  const frontRows = ["E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
  const middleOrder = [9, 7, 5, 3, 1, 2, 4, 6, 8];

  for (const row of frontRows) {
    const oddRange = sideOddRanges[row];
    const evenRange = sideEvenRanges[row];
    buildRangeReverse(row, oddRange[0], oddRange[1]).forEach((seat) => seats.add(seat));
    middleOrder.forEach((n) => seats.add(`${row}${n}`));
    if (evenRange) {
      buildRange(row, evenRange[0], evenRange[1]).forEach((seat) => seats.add(seat));
    }
  }

  return seats;
}

const ALL_SEATS = getAllSeatCodes();

function showKey(movie, showtime) {
  return `${movie}__${showtime}`;
}

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      const empty = { bookings: [] };
      await fs.writeFile(DB_PATH, JSON.stringify(empty, null, 2));
      return empty;
    }
    throw error;
  }
}

async function writeDb(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

app.get("/api/shows", (_req, res) => {
  res.json({ movies: MOVIES, showtimes: SHOWTIMES });
});

app.get("/api/seats", async (req, res) => {
  const { movie, showtime } = req.query;

  if (!movie || !showtime) {
    return res.status(400).json({ message: "movie and showtime are required." });
  }

  const db = await readDb();
  const key = showKey(movie, showtime);
  const reserved = db.bookings
    .filter((booking) => booking.showKey === key)
    .flatMap((booking) => booking.seats);

  res.json({ reservedSeats: [...new Set(reserved)] });
});

app.post("/api/bookings", async (req, res) => {
  const { movie, showtime, name, phone, seats } = req.body;

  if (!movie || !showtime || !name || !phone || !Array.isArray(seats) || !seats.length) {
    return res.status(400).json({ message: "Missing required booking fields." });
  }

  if (!PHONE_REGEX.test(phone)) {
    return res.status(400).json({ message: "Phone must be 11 digits and start with 01." });
  }

  if (!MOVIES.includes(movie) || !SHOWTIMES.includes(showtime)) {
    return res.status(400).json({ message: "Invalid movie or showtime." });
  }

  const normalizedSeats = [...new Set(seats.map((seat) => String(seat).toUpperCase()))];
  if (normalizedSeats.some((seat) => !ALL_SEATS.has(seat))) {
    return res.status(400).json({ message: "One or more seats are invalid." });
  }

  const db = await readDb();
  const key = showKey(movie, showtime);
  const reserved = new Set(
    db.bookings
      .filter((booking) => booking.showKey === key)
      .flatMap((booking) => booking.seats)
  );

  const conflict = normalizedSeats.find((seat) => reserved.has(seat));
  if (conflict) {
    return res.status(409).json({ message: `Seat ${conflict} is already booked.` });
  }

  const booking = {
    id: Date.now(),
    showKey: key,
    movie,
    showtime,
    name,
    phone,
    seats: normalizedSeats,
    createdAt: new Date().toISOString()
  };

  db.bookings.push(booking);
  await writeDb(db);

  return res.status(201).json({ message: "Booking confirmed.", booking });
});

app.listen(PORT, () => {
  console.log(`Karawan booking API running on http://localhost:${PORT}`);
});
