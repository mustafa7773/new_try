// ============================================================================
// أداة حساب وقت العمل
//
// المطلوب: الانطلاق من الخوض السابعة، زيارة كل المساجد المُدخلة، والعودة.
// الوقت = زمن الذهاب + مدة العمل داخل كل مسجد + زمن التنقل بينها + زمن العودة.
// عند وجود أكثر من مسجد يُحسب أقصر مسار يمر بها جميعاً.
//
// حساب المسار يتم عبر خدمة OSRM المفتوحة (بلا مفتاح ولا تسجيل)، وتحديداً
// خدمة trip التي تحل مسألة "البائع المتجول" فتُعيد الترتيب الأمثل للمحطات
// مع أزمنة التنقل على الطرق الحقيقية.
// عند تعذّر الوصول للخدمة يُستخدم تقدير احتياطي بمسافة الخط المستقيم.
// ============================================================================

(function () {
  "use strict";

  const OSRM_BASE = "https://router.project-osrm.org/trip/v1/driving/";

  // معامل تقريبي لتحويل مسافة الخط المستقيم إلى مسافة طريق فعلية،
  // ومتوسط سرعة للتقدير الاحتياطي فقط عند تعذّر الوصول لخدمة المسارات.
  const FALLBACK_ROAD_FACTOR = 1.35;
  const FALLBACK_SPEED_KMH = 70;

  let mapInstance = null;
  let routeLayerGroup = null;
  let lastRoute = null;

  // ---------- أدوات مساعدة ----------

  function el(id) {
    return document.getElementById(id);
  }

  function showError(message) {
    const box = el("errorBox");
    box.textContent = message;
    box.style.display = "block";
  }

  function clearError() {
    const box = el("errorBox");
    box.textContent = "";
    box.style.display = "none";
  }

  function formatDuration(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + " دقيقة";
    if (m === 0) return h + " ساعة";
    return h + " ساعة و" + m + " دقيقة";
  }

  function formatClock(dateObj) {
    return dateObj.toLocaleTimeString("ar-OM", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---------- قراءة المدخلات ----------

  function parseMosques() {
    const raw = el("mosquesInput").value.trim();
    if (!raw) throw new Error("أدخل موقع مسجد واحد على الأقل.");

    const datum = el("datum").value;
    const zone = parseInt(el("zone").value, 10);

    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const mosques = [];

    lines.forEach((line, idx) => {
      // نقبل الفاصلة العربية والإنجليزية والمسافات كفواصل
      const parts = line
        .split(/[,،;\t]+|\s{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

      // نبحث عن آخر رقمين صالحين في السطر (Easting ثم Northing)
      const numeric = [];
      const nameParts = [];
      parts.forEach((p) => {
        const cleaned = p.replace(/[^\d.\-]/g, "");
        if (cleaned && !isNaN(parseFloat(cleaned)) && /\d/.test(p)) {
          numeric.push(parseFloat(cleaned));
        } else {
          nameParts.push(p);
        }
      });

      if (numeric.length < 2) {
        throw new Error(
          "السطر رقم " + (idx + 1) + " لا يحتوي على إحداثيتين صالحتين (Easting و Northing).",
        );
      }

      const easting = numeric[numeric.length - 2];
      const northing = numeric[numeric.length - 1];
      const name = nameParts.join(" ").trim() || "مسجد " + (idx + 1);

      const wgs = convertToWGS84(easting, northing, zone, datum);
      if (!isFinite(wgs.lat) || !isFinite(wgs.lon)) {
        throw new Error("تعذّر تحويل إحداثيات السطر رقم " + (idx + 1) + ".");
      }

      mosques.push({ name, easting, northing, lat: wgs.lat, lon: wgs.lon });
    });

    return mosques;
  }

  function parseOrigin() {
    const lat = parseFloat(el("originLat").value);
    const lon = parseFloat(el("originLon").value);
    if (!isFinite(lat) || !isFinite(lon)) {
      throw new Error("إحداثيات نقطة الانطلاق غير صالحة.");
    }
    return { name: "الخوض السابعة", lat, lon, isBase: true };
  }

  // ---------- حساب المسار ----------

  // يطلب من OSRM أقصر مسار يمر بكل النقاط بدءاً من نقطة الانطلاق وعودةً إليها
  async function solveRouteViaOsrm(stops) {
    const coords = stops.map((s) => s.lon + "," + s.lat).join(";");
    const url =
      OSRM_BASE +
      coords +
      "?source=first&roundtrip=true&geometries=geojson&overview=full";

    const res = await fetch(url);
    if (!res.ok) throw new Error("خدمة المسارات ردّت بحالة " + res.status);

    const data = await res.json();
    if (data.code !== "Ok" || !data.trips || !data.trips.length) {
      throw new Error("تعذّر إيجاد مسار بين المواقع المُدخلة.");
    }

    const trip = data.trips[0];

    // ترتيب المحطات حسب الترتيب الأمثل الذي أعادته الخدمة
    const ordered = stops
      .map((stop, i) => ({ stop, order: data.waypoints[i].waypoint_index }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.stop);

    // legs[i] = الانتقال من المحطة i إلى المحطة i+1 (وآخر ساق هي العودة للانطلاق)
    const legs = trip.legs.map((leg) => ({
      minutes: leg.duration / 60,
      km: leg.distance / 1000,
    }));

    return {
      ordered,
      legs,
      geometry: trip.geometry ? trip.geometry.coordinates : null,
      source: "osrm",
    };
  }

  // تقدير احتياطي: ترتيب بالجار الأقرب + مسافة خط مستقيم معدَّلة
  function solveRouteFallback(stops) {
    const origin = stops[0];
    const remaining = stops.slice(1);
    const ordered = [origin];

    let current = origin;
    while (remaining.length) {
      let bestIdx = 0;
      let bestKm = Infinity;
      remaining.forEach((cand, i) => {
        const km = haversineKm(current.lat, current.lon, cand.lat, cand.lon);
        if (km < bestKm) {
          bestKm = km;
          bestIdx = i;
        }
      });
      current = remaining.splice(bestIdx, 1)[0];
      ordered.push(current);
    }

    const legs = [];
    for (let i = 0; i < ordered.length; i++) {
      const from = ordered[i];
      const to = ordered[(i + 1) % ordered.length];
      const km = haversineKm(from.lat, from.lon, to.lat, to.lon) * FALLBACK_ROAD_FACTOR;
      legs.push({ km, minutes: (km / FALLBACK_SPEED_KMH) * 60 });
    }

    return { ordered, legs, geometry: null, source: "fallback" };
  }

  // ---------- بناء الجدول الزمني ----------

  function buildSchedule(route, stopMinutes, startTime) {
    const [sh, sm] = startTime.split(":").map((v) => parseInt(v, 10));
    const clock = new Date();
    clock.setHours(isFinite(sh) ? sh : 8, isFinite(sm) ? sm : 0, 0, 0);

    const schedule = [];
    let drivingMinutes = 0;

    // الانطلاق
    schedule.push({
      name: route.ordered[0].name,
      isBase: true,
      departure: new Date(clock),
      label: "الانطلاق",
    });

    for (let i = 1; i < route.ordered.length; i++) {
      const leg = route.legs[i - 1];
      drivingMinutes += leg.minutes;

      clock.setMinutes(clock.getMinutes() + leg.minutes);
      const arrival = new Date(clock);

      clock.setMinutes(clock.getMinutes() + stopMinutes);
      const departure = new Date(clock);

      schedule.push({
        name: route.ordered[i].name,
        isBase: false,
        arrival,
        departure,
        legMinutes: leg.minutes,
        legKm: leg.km,
        label: "مسجد",
      });
    }

    // العودة لنقطة الانطلاق
    const lastLeg = route.legs[route.legs.length - 1];
    drivingMinutes += lastLeg.minutes;
    clock.setMinutes(clock.getMinutes() + lastLeg.minutes);

    schedule.push({
      name: route.ordered[0].name,
      isBase: true,
      arrival: new Date(clock),
      legMinutes: lastLeg.minutes,
      legKm: lastLeg.km,
      label: "العودة",
    });

    const totalKm = route.legs.reduce((sum, l) => sum + l.km, 0);
    const mosqueCount = route.ordered.length - 1;
    const workMinutes = mosqueCount * stopMinutes;

    return {
      schedule,
      drivingMinutes,
      workMinutes,
      totalMinutes: drivingMinutes + workMinutes,
      totalKm,
      mosqueCount,
    };
  }

  // ---------- عرض النتيجة ----------

  function renderSummary(result) {
    el("summaryGrid").innerHTML = [
      card("عدد المساجد", result.mosqueCount),
      card("زمن التنقل", formatDuration(result.drivingMinutes)),
      card("وقت العمل بالمواقع", formatDuration(result.workMinutes)),
      card("إجمالي اليوم", formatDuration(result.totalMinutes)),
      card("مسافة المسار", result.totalKm.toFixed(1) + " كم"),
    ].join("");

    function card(label, value) {
      return (
        '<div class="summary-card"><span class="label">' +
        label +
        '</span><span class="value">' +
        value +
        "</span></div>"
      );
    }
  }

  function renderTimeline(result) {
    const html = result.schedule
      .map((stop, i) => {
        const isBase = stop.isBase;
        const dotLabel = isBase ? "⌂" : String(i);

        let meta = "";
        if (stop.arrival && stop.departure) {
          meta =
            'الوصول <span class="clock">' +
            formatClock(stop.arrival) +
            '</span> · المغادرة <span class="clock">' +
            formatClock(stop.departure) +
            "</span>";
        } else if (stop.arrival) {
          meta = 'الوصول <span class="clock">' + formatClock(stop.arrival) + "</span>";
        } else if (stop.departure) {
          meta = 'المغادرة <span class="clock">' + formatClock(stop.departure) + "</span>";
        }

        const legNote =
          stop.legMinutes != null
            ? '<p class="leg-note">تنقّل ' +
              formatDuration(stop.legMinutes) +
              " · " +
              stop.legKm.toFixed(1) +
              " كم</p>"
            : "";

        return (
          '<li class="stop' +
          (isBase ? " is-base" : "") +
          '"><div class="stop-rail"><span class="stop-dot">' +
          dotLabel +
          '</span></div><div class="stop-body"><p class="stop-name">' +
          escapeHtml(stop.name) +
          '</p><p class="stop-meta">' +
          meta +
          "</p>" +
          legNote +
          "</div></li>"
        );
      })
      .join("");

    el("timeline").innerHTML = '<ul class="timeline">' + html + "</ul>";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderMap(route) {
    if (typeof L === "undefined") {
      throw new Error("مكتبة الخرائط غير متاحة");
    }
    if (!mapInstance) {
      mapInstance = L.map("map");
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(mapInstance);
      routeLayerGroup = L.layerGroup().addTo(mapInstance);
    }

    routeLayerGroup.clearLayers();

    const points = [];
    route.ordered.forEach((stop, i) => {
      points.push([stop.lat, stop.lon]);
      L.marker([stop.lat, stop.lon])
        .bindPopup((i === 0 ? "الانطلاق: " : i + ". ") + stop.name)
        .addTo(routeLayerGroup);
    });

    if (route.geometry) {
      const line = route.geometry.map((c) => [c[1], c[0]]);
      L.polyline(line, { color: "#dfb668", weight: 4, opacity: 0.9 }).addTo(routeLayerGroup);
      mapInstance.fitBounds(L.latLngBounds(line).pad(0.15));
    } else {
      const loop = points.concat([points[0]]);
      L.polyline(loop, {
        color: "#dfb668",
        weight: 3,
        opacity: 0.8,
        dashArray: "6,8",
      }).addTo(routeLayerGroup);
      mapInstance.fitBounds(L.latLngBounds(loop).pad(0.15));
    }

    setTimeout(() => mapInstance.invalidateSize(), 200);
  }

  function buildGoogleMapsUrl(route) {
    const origin = route.ordered[0];
    const stops = route.ordered.slice(1);
    const base = "https://www.google.com/maps/dir/?api=1";
    const originParam = "&origin=" + origin.lat + "," + origin.lon;
    const destParam = "&destination=" + origin.lat + "," + origin.lon;
    const waypoints = stops.map((s) => s.lat + "," + s.lon).join("|");
    return (
      base + originParam + destParam + (waypoints ? "&waypoints=" + encodeURIComponent(waypoints) : "")
    );
  }

  // ---------- التشغيل ----------

  async function compute() {
    clearError();
    const btn = el("computeBtn");

    let origin, mosques;
    try {
      origin = parseOrigin();
      mosques = parseMosques();
    } catch (err) {
      showError(err.message);
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.textContent = "جاري حساب المسار...";

    try {
      const stops = [origin].concat(mosques);
      let route;
      let noteText = "";

      try {
        route = await solveRouteViaOsrm(stops);
        noteText =
          "🛣️ الأزمنة والمسافات محسوبة على الطرق الفعلية عبر خدمة OSRM المفتوحة، ولا تشمل الازدحام المروري.";
      } catch (osrmErr) {
        route = solveRouteFallback(stops);
        noteText =
          "⚠️ تعذّر الوصول لخدمة المسارات، فاستُخدم تقدير تقريبي بمسافة الخط المستقيم بمتوسط سرعة " +
          FALLBACK_SPEED_KMH +
          " كم/س. الأرقام إرشادية فقط.";
      }

      const stopMinutes = Math.max(0, parseFloat(el("stopMinutes").value) || 0);
      const startTime = el("startTime").value || "08:00";

      const result = buildSchedule(route, stopMinutes, startTime);
      lastRoute = route;

      renderSummary(result);
      renderTimeline(result);
      el("resultPanel").classList.remove("hidden");
      el("routeSourceNote").textContent = noteText;

      // الخريطة إضافة توضيحية: لو تعذّر تحميل مكتبتها لا نُسقِط النتيجة كلها
      try {
        renderMap(route);
      } catch (mapErr) {
        el("routeSourceNote").textContent =
          noteText + " (تعذّر عرض الخريطة، والنتائج أعلاه صحيحة.)";
      }

      el("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      showError("حدث خطأ أثناء الحساب: " + (err && err.message ? err.message : err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }

  el("computeBtn").addEventListener("click", compute);

  el("openMapsBtn").addEventListener("click", function () {
    if (!lastRoute) return;
    window.open(buildGoogleMapsUrl(lastRoute), "_blank", "noopener");
  });
})();
