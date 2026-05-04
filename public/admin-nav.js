(function () {
  function ownerEmailConfigured() {
    const raw = window.KARAWAN_OWNER_ADMIN_EMAIL;
    const e = String(raw == null ? "" : raw).trim().toLowerCase();
    return e.length > 0 && e.includes("@");
  }

  function init() {
    if (typeof firebase === "undefined" || !firebase.auth) return;
    if (!firebase.apps || !firebase.apps.length) return;
    if (!ownerEmailConfigured()) return;

    const ownerEmail = String(window.KARAWAN_OWNER_ADMIN_EMAIL).trim().toLowerCase();

    function syncAdminNavLinks(user) {
      const show =
        !!user &&
        String(user.email || "")
          .trim()
          .toLowerCase() === ownerEmail;

      document.querySelectorAll(".admin-nav-item").forEach(function (el) {
        if (show) el.removeAttribute("hidden");
        else el.setAttribute("hidden", "");
      });
    }

    firebase.auth().onAuthStateChanged(syncAdminNavLinks);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
