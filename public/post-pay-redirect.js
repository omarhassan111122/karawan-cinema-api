/**
 * بعد الدفع من Paymob/3DS غالبًا المتصفّح يرجعك لموقعك بدون ?ref= في الرابط.
 * قبل التوجيه لبوابة الدفع نضع sessionStorage + localStorage؛ هنا نعيد توجيه صامت لصفحة الإيصال.
 */
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var refInQuery = (
      params.get("ref") ||
      params.get("bookingId") ||
      params.get("merchant_order_id") ||
      params.get("order_id") ||
      params.get("id") ||
      ""
    ).trim();

    if (refInQuery && !/payment-done\.html/i.test(window.location.pathname)) {
      var u2 = new URL("payment-done.html", window.location.href);
      u2.searchParams.set("ref", refInQuery);
      window.location.replace(u2.pathname + u2.search + u2.hash);
      return;
    }

    var afterPaymob = false;
    try {
      afterPaymob = sessionStorage.getItem("karawan_after_paymob") === "1";
    } catch (e) {}
    if (!afterPaymob) {
      try {
        afterPaymob = localStorage.getItem("karawan_after_paymob") === "1";
      } catch (e) {}
    }
    if (!afterPaymob) return;

    var exp = parseInt(localStorage.getItem("karawan_receipt_ref_exp") || "0", 10);
    var ref = (localStorage.getItem("karawan_receipt_ref") || "").trim();

    if (!ref || !Number.isFinite(exp) || Date.now() > exp) {
      try {
        sessionStorage.removeItem("karawan_after_paymob");
      } catch (e) {}
      try {
        localStorage.removeItem("karawan_after_paymob");
        localStorage.removeItem("karawan_receipt_ref");
        localStorage.removeItem("karawan_receipt_ref_exp");
      } catch (e) {}
      return;
    }

    if (/payment-done\.html/i.test(window.location.pathname)) {
      return;
    }

    try {
      sessionStorage.removeItem("karawan_after_paymob");
    } catch (e) {}
    try {
      localStorage.removeItem("karawan_after_paymob");
    } catch (e) {}

    var u = new URL("payment-done.html", window.location.href);
    u.searchParams.set("ref", ref);
    window.location.replace(u.pathname + u.search + u.hash);
  } catch (e) {
    /* ignore */
  }
})();
