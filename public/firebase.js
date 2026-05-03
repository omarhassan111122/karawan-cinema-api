const firebaseConfig = {
  apiKey: "AIzaSyDcoHGH8FwtaUa3qL2XXSsFjBuwRcdTvto",
  authDomain: "karawan-cinema.firebaseapp.com",
  projectId: "karawan-cinema",
  storageBucket: "karawan-cinema.firebasestorage.app",
  messagingSenderId: "279453120513",
  appId: "1:279453120513:web:3f351a92b2e6302e09e800"
};

window.isFirebaseConfigured = !Object.values(firebaseConfig).some((v) => v.startsWith("PUT_YOUR_"));

// Local: leave empty string (same origin). Hosting: set to deployed backend URL.
window.API_BASE_URL = "https://karawan-cinema-api.onrender.com";

if (window.isFirebaseConfigured) {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  window.db = firebase.firestore();
} else {
  window.db = null;
}

(function () {
  function coerceNumber(value) {
    if (value == null || value === "") return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value).replace(/,/g, "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function extractCoordsFromMapsUrl(url) {
    if (!url || typeof url !== "string") return null;
    const at = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
    const q = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)(?:\b|&)/);
    if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
    const ll = url.match(/(?:\?|&)ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (ll) return { lat: parseFloat(ll[1]), lng: parseFloat(ll[2]) };
    return null;
  }

  function readGeoPoint(val) {
    if (!val || typeof val !== "object") return null;
    if (typeof firebase !== "undefined" && firebase.firestore && val instanceof firebase.firestore.GeoPoint) {
      return { lat: val.latitude, lng: val.longitude };
    }
    const lat = coerceNumber(val.latitude ?? val.lat);
    const lng = coerceNumber(val.longitude ?? val.lng ?? val.lon);
    if (lat !== undefined && lng !== undefined) return { lat, lng };
    return null;
  }

  function resolveLatLng(data, depth) {
    const d = depth || 0;
    if (!data || typeof data !== "object" || d > 3) return null;

    const direct = readGeoPoint(data);
    if (direct) return direct;

    const topLat = coerceNumber(data.lat ?? data.latitude ?? data.Lat ?? data.Latitude);
    const topLng = coerceNumber(data.lng ?? data.longitude ?? data.lon ?? data.Lng ?? data.Longitude);
    if (topLat !== undefined && topLng !== undefined) return { lat: topLat, lng: topLng };

    const nestedKeys = ["coordinates", "coords", "geo", "geolocation", "position", "mapCenter", "map"];
    for (let i = 0; i < nestedKeys.length; i++) {
      const sub = data[nestedKeys[i]];
      if (sub) {
        const c = readGeoPoint(sub) || resolveLatLng(sub, d + 1);
        if (c) return c;
      }
    }

    if (data.location && typeof data.location === "object") {
      const c = resolveLatLng(data.location, d + 1);
      if (c) return c;
    }

    const urlFields = ["mapEmbedUrl", "mapUrl", "locationMapUrl", "googleMapsUrl", "mapsUrl"];
    for (let j = 0; j < urlFields.length; j++) {
      const u = data[urlFields[j]];
      if (typeof u === "string") {
        const fromUrl = extractCoordsFromMapsUrl(u);
        if (fromUrl) return fromUrl;
      }
    }

    return null;
  }

  async function getDocSnapshotPreferServer(docRef) {
    try {
      return await docRef.get({ source: "server" });
    } catch (e) {
      return docRef.get();
    }
  }

  window.fetchMergedSiteLocationData = async function () {
    const db = window.db;
    if (!db) return null;

    const locationRef = db.collection("siteContent").doc("location");
    const aboutRef = db.collection("siteContent").doc("about");

    const [locationSnap, aboutSnap] = await Promise.all([
      getDocSnapshotPreferServer(locationRef),
      getDocSnapshotPreferServer(aboutRef)
    ]);

    const aboutData = aboutSnap.exists ? aboutSnap.data() : {};
    const nested = aboutData.location && typeof aboutData.location === "object" ? aboutData.location : {};
    const locData = locationSnap.exists ? locationSnap.data() : null;

    const merged = locData ? { ...aboutData, ...nested, ...locData } : { ...aboutData, ...nested };
    const coords = locationSnap.exists && locData ? resolveLatLng(locData) : resolveLatLng(merged);
    return { merged, coords, locationDoc: locData };
  };

  window.resolveSiteLocationCoords = function (data) {
    return resolveLatLng(data);
  };
})();
