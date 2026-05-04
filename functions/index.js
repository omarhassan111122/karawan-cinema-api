const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🔥 Firebase Admin (لازم ملف JSON في نفس الفولدر)
var serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* =========================
   🔵 PAYMOB WEBHOOK
========================= */
app.post("/paymob-webhook", async (req, res) => {
  try {
    const body = req.body;

    const success =
      body?.obj?.success === true ||
      body?.obj?.success === "true";

    const bookingId = body?.obj?.merchant_order_id;

    if (!bookingId) return res.send("NO BOOKING ID");

    const ref = db.collection("bookings").doc(bookingId);

    await ref.update({
      paymentStatus: success ? "paid" : "failed"
    });

    console.log("Payment updated:", bookingId, success);

    res.send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("ERROR");
  }
});

/* =========================
   ⏱️ EXPIRE BOOKINGS (5 min)
========================= */
app.get("/expire-check", async (req, res) => {
  try {
    const now = Date.now();

    const snap = await db.collection("bookings")
      .where("paymentStatus", "==", "pending_hold")
      .get();

    await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        const exp = data.holdExpiresAt?.toMillis?.();

        if (exp && exp < now) {
          await doc.ref.update({
            paymentStatus: "expired"
          });
        }
      })
    );

    res.send("expired check done");
  } catch (err) {
    console.error(err);
    res.status(500).send("ERROR");
  }
});

/* =========================
   🚀 SERVER START
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});