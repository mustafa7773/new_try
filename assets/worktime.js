// ============================================================================
// أداة حساب وقت العمل
//
// المطلوب: الانطلاق من جامع المهيمن (السيب)، زيارة كل المساجد المُدخلة، والعودة.
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

  // اسم نقطة الانطلاق الافتراضية (يظهر في خطة اليوم)
  const ORIGIN_NAME = "جامع المهيمن";

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

  // صياغة عربية صحيحة للمفرد والمثنى والجمع
  function arabicUnit(count, single, dual, plural, many) {
    if (count === 1) return single;
    if (count === 2) return dual;
    if (count >= 3 && count <= 10) return count + " " + plural;
    return count + " " + many;
  }

  function formatDuration(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;

    const hourText = arabicUnit(h, "ساعة واحدة", "ساعتان", "ساعات", "ساعة");
    const minText = arabicUnit(m, "دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة");

    if (h === 0) return minText;
    if (m === 0) return hourText;
    return hourText + " و" + minText;
  }

  // صيغة مختصرة للبطاقات كي لا يلتف النص على عدة أسطر
  function formatDurationShort(totalMinutes) {
    const mins = Math.round(totalMinutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return m + " د";
    if (m === 0) return h + " س";
    return h + " س " + m + " د";
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
      // الحقول مفصولة بفاصلة (عربية أو إنجليزية) أو فاصلة منقوطة أو Tab.
      // آخر حقلين هما Easting ثم Northing، وما قبلهما هو الاسم — بهذا الترتيب
      // يبقى الاسم سليماً حتى لو احتوى أرقاماً مثل "ص-24-103".
      let parts = line.split(/[,،;\t]+/).map((p) => p.trim()).filter(Boolean);

      // سطر بلا فواصل: نقبل الفصل بالمسافات (إحداثيتان فقط)
      if (parts.length < 2) {
        parts = line.split(/\s+/).map((p) => p.trim()).filter(Boolean);
      }

      if (parts.length < 2) {
        throw new Error(
          "السطر رقم " + (idx + 1) + " لا يحتوي على إحداثيتين صالحتين (Easting و Northing).",
        );
      }

      const northing = parseFloat(parts[parts.length - 1].replace(/[^\d.\-]/g, ""));
      const easting = parseFloat(parts[parts.length - 2].replace(/[^\d.\-]/g, ""));

      if (!isFinite(easting) || !isFinite(northing)) {
        throw new Error(
          "السطر رقم " + (idx + 1) + " لا يحتوي على إحداثيتين صالحتين (Easting و Northing).",
        );
      }

      const name = parts.slice(0, -2).join(", ").trim() || "مسجد " + (idx + 1);

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
    return { name: ORIGIN_NAME, lat, lon, isBase: true };
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
        order: i,
        arrival,
        departure,
        workMinutes: stopMinutes,
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
    // جملة تلخيصية واضحة أعلى البطاقات
    const endTime = result.schedule[result.schedule.length - 1].arrival;
    el("summaryHeadline").innerHTML =
      "تبدأ ٨:٠٠ صباحاً وتزور <b>" +
      arabicUnit(result.mosqueCount, "مسجداً واحداً", "مسجدين", "مساجد", "مسجداً") +
      "</b>، وتعود إلى " + ORIGIN_NAME + " الساعة <b>" +
      formatClock(endTime) +
      "</b> — أي <b>" +
      formatDuration(result.totalMinutes) +
      "</b> من وقت العمل.";

    el("summaryGrid").innerHTML = [
      card("عدد المساجد", String(result.mosqueCount), "في المسار"),
      card("زمن التنقل", formatDurationShort(result.drivingMinutes), "في الطريق"),
      card("العمل بالمواقع", formatDurationShort(result.workMinutes), "داخل المساجد"),
      card("إجمالي اليوم", formatDurationShort(result.totalMinutes), "من الخروج للعودة"),
      card("مسافة المسار", result.totalKm.toFixed(0) + " كم", "ذهاباً وإياباً"),
    ].join("");

    function card(label, value, note) {
      return (
        '<div class="summary-card"><span class="label">' +
        label +
        '</span><span class="value">' +
        value +
        "</span>" +
        (note ? '<span class="note">' + note + "</span>" : "") +
        "</div>"
      );
    }
  }

  function renderTimeline(result) {
    const rows = [];

    result.schedule.forEach((stop, i) => {
      // ساق التنقل تُعرض بين المحطتين لتكون العلاقة واضحة
      if (stop.legMinutes != null) {
        rows.push(
          '<li class="leg"><span class="leg-icon">🚗</span>' +
            '<span class="leg-text">تنقّل ' +
            formatDuration(stop.legMinutes) +
            " · " +
            stop.legKm.toFixed(1) +
            " كم</span></li>",
        );
      }

      const isBase = stop.isBase;
      const dotLabel = isBase ? "⌂" : String(stop.order);

      // الاسم قد يجمع رقم الطلب والقرية والولاية مفصولة بـ " — "،
      // نعرض الجزء الأول كعنوان والباقي كسطر فرعي أوضح للقراءة
      const segments = String(stop.name).split(" — ");
      const title = segments[0];
      const subtitle = segments.slice(1).join(" · ");

      let tag = "";
      let meta = "";

      if (stop.label === "الانطلاق") {
        tag = '<span class="stop-tag">الانطلاق</span>';
        meta = 'تخرج الساعة <span class="clock">' + formatClock(stop.departure) + "</span>";
      } else if (stop.label === "العودة") {
        tag = '<span class="stop-tag">نهاية اليوم</span>';
        meta = 'تصل الساعة <span class="clock">' + formatClock(stop.arrival) + "</span>";
      } else {
        meta =
          'وصول <span class="clock">' +
          formatClock(stop.arrival) +
          '</span> ← عمل ' +
          formatDuration(stop.workMinutes) +
          ' ← مغادرة <span class="clock">' +
          formatClock(stop.departure) +
          "</span>";
      }

      rows.push(
        '<li class="stop' +
          (isBase ? " is-base" : "") +
          '"><div class="stop-rail"><span class="stop-dot">' +
          dotLabel +
          '</span></div><div class="stop-body"><p class="stop-name">' +
          escapeHtml(title) +
          tag +
          "</p>" +
          (subtitle ? '<p class="stop-sub">' + escapeHtml(subtitle) + "</p>" : "") +
          '<p class="stop-meta">' +
          meta +
          "</p></div></li>",
      );
    });

    el("timeline").innerHTML = '<ul class="timeline-list">' + rows.join("") + "</ul>";
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

  // ---------- المساجد المحفوظة من أداة القبلة ----------

  function renderSavedMosques() {
    const store = window.MosqueStore;
    const block = el("savedBlock");
    const empty = el("savedEmpty");
    const list = el("savedList");

    const saved = store ? store.loadAll() : [];

    if (!saved.length) {
      block.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }

    block.classList.remove("hidden");
    empty.classList.add("hidden");

    list.innerHTML = saved
      .map((m) => {
        const segments = String(m.name).split(" — ");
        const title = segments[0];

        // بقية أجزاء الاسم (الولاية والتاريخ) تُعرض كسطر فرعي،
        // مع تفادي تكرار أي جزء يطابق العنوان نفسه
        const subParts = segments
          .slice(1)
          .filter((seg) => seg && seg !== title);
        if (!subParts.length && m.governorate && m.governorate !== title) {
          subParts.push(m.governorate);
        }
        const dateStr = window.MosqueStore.formatShortDate(m.savedAt);
        if (dateStr && subParts.indexOf(dateStr) === -1) subParts.push(dateStr);

        const hasGov = !!(m.governorate || segments.length > 2);
        if (!hasGov) subParts.push("بلا ولاية — اضغط ✎");
        const subtitle = subParts.join(" · ");

        return (
          '<div class="saved-item" data-id="' +
          m.id +
          '"><label class="saved-pick"><input type="checkbox" value="' +
          m.id +
          '" /><span class="saved-text"><span class="saved-name">' +
          escapeHtml(title) +
          '</span><span class="saved-sub' +
          (hasGov ? "" : " is-missing") +
          '">' +
          escapeHtml(subtitle) +
          '</span></span></label><span class="saved-coords">' +
          m.easting.toFixed(0) +
          " · " +
          m.northing.toFixed(0) +
          '</span><button type="button" class="icon-btn" data-edit="' +
          m.id +
          '" title="تعديل الاسم والولاية">✎</button>' +
          '<button type="button" class="icon-btn danger" data-delete="' +
          m.id +
          '" title="حذف هذا المسجد">🗑</button></div>'
        );
      })
      .join("");
  }

  // تحويل صف المسجد إلى وضع التحرير لتعديل الاسم والولاية
  function startEditSaved(id) {
    const store = window.MosqueStore;
    if (!store) return;

    const item = store.loadAll().find((m) => m.id === id);
    if (!item) return;

    const row = el("savedList").querySelector('[data-id="' + id + '"]');
    if (!row) return;

    const segments = String(item.name).split(" — ");
    const dateStr = window.MosqueStore.formatShortDate(item.savedAt);
    // نستبعد الولاية والتاريخ من خانة الاسم لأن لكل منهما مكانه الخاص
    const baseName =
      segments.filter(
        (seg) => seg && seg !== item.governorate && seg !== dateStr,
      )[0] || "";

    row.classList.add("is-editing");
    row.innerHTML =
      '<div class="saved-edit">' +
      '<input type="text" class="edit-name" placeholder="اسم المسجد أو رقم الطلب" value="' +
      escapeHtml(baseName) +
      '" />' +
      '<input type="text" class="edit-gov" placeholder="المحافظة والولاية" value="' +
      escapeHtml(item.governorate || "") +
      '" />' +
      '<div class="edit-actions">' +
      '<button type="button" class="primary subtle edit-save">حفظ</button>' +
      '<button type="button" class="link-btn edit-cancel">إلغاء</button>' +
      "</div></div>";

    row.querySelector(".edit-save").addEventListener("click", () => {
      const name = row.querySelector(".edit-name").value.trim();
      const gov = row.querySelector(".edit-gov").value.trim();
      // الاسم الكامل = الاسم — الولاية — التاريخ (ليظهر صحيحاً في خطة اليوم أيضاً)
      const fullName =
        [name, gov, dateStr].filter(Boolean).join(" — ") || item.name;
      store.updateMeta(id, { name: fullName, governorate: gov });
      renderSavedMosques();
    });

    row.querySelector(".edit-cancel").addEventListener("click", renderSavedMosques);
    row.querySelector(".edit-name").focus();
  }

  function addSelectedSaved() {
    const store = window.MosqueStore;
    if (!store) return;

    const chosenIds = Array.from(
      el("savedList").querySelectorAll('input[type="checkbox"]:checked'),
    ).map((cb) => cb.value);

    if (!chosenIds.length) {
      showError("حدّد مسجداً واحداً على الأقل من القائمة المحفوظة.");
      return;
    }

    clearError();
    const saved = store.loadAll();
    const ta = el("mosquesInput");
    const existing = ta.value.trim();
    const lines = [];

    chosenIds.forEach((id) => {
      const m = saved.find((x) => x.id === id);
      if (!m) return;
      // نتجنّب التكرار إن كان المسجد مضافاً بالفعل
      if (existing.indexOf(m.easting.toFixed(2)) !== -1) return;
      lines.push(m.name + ", " + m.easting.toFixed(2) + ", " + m.northing.toFixed(2));

      // مزامنة نظام الإسناد والنطاق مع أول مسجد محفوظ يحملهما
      if (m.zone && m.zone >= 1 && m.zone <= 60) el("zone").value = String(m.zone);
      if (m.datum === "psd93" || m.datum === "wgs84utm") el("datum").value = m.datum;
    });

    if (!lines.length) return;

    ta.value = existing ? existing + "\n" + lines.join("\n") : lines.join("\n");

    el("savedList")
      .querySelectorAll('input[type="checkbox"]:checked')
      .forEach((cb) => (cb.checked = false));
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

  // ----- المساجد المحفوظة -----
  renderSavedMosques();

  el("addSelectedBtn").addEventListener("click", addSelectedSaved);

  // أزرار التعديل (✎) والحذف (🗑) داخل كل صف
  el("savedList").addEventListener("click", function (e) {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      e.preventDefault();
      startEditSaved(editBtn.getAttribute("data-edit"));
      return;
    }

    const delBtn = e.target.closest("[data-delete]");
    if (delBtn) {
      e.preventDefault();
      const id = delBtn.getAttribute("data-delete");
      const store = window.MosqueStore;
      if (!store) return;
      const item = store.loadAll().find((m) => m.id === id);
      const label = item ? String(item.name).split(" — ")[0] : "هذا المسجد";
      if (!confirm("حذف «" + label + "» من القائمة؟")) return;
      store.removeById(id);
      renderSavedMosques();
    }
  });

  el("selectAllSaved").addEventListener("click", function () {
    const boxes = el("savedList").querySelectorAll('input[type="checkbox"]');
    const allChecked = Array.from(boxes).every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !allChecked));
  });

  el("clearSaved").addEventListener("click", function () {
    if (!window.MosqueStore) return;
    if (!confirm("سيتم مسح كل المساجد المحفوظة. هل تريد المتابعة؟")) return;
    window.MosqueStore.clearAll();
    renderSavedMosques();
  });

  el("openMapsBtn").addEventListener("click", function () {
    if (!lastRoute) return;
    window.open(buildGoogleMapsUrl(lastRoute), "_blank", "noopener");
  });
})();
