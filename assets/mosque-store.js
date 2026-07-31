// ============================================================================
// مخزن المساجد المشترك بين الأدوات
//
// كل مسجد يُحسب اتجاه قبلته في "أداة تحديد اتجاه القبلة" يُحفظ تلقائياً في
// متصفح المستخدم، ليظهر بعدها كخيار جاهز في "أداة حساب وقت العمل" دون الحاجة
// لإعادة إدخال إحداثياته أو رفع كروكيه مرة أخرى.
//
// الحفظ محلي بالكامل داخل المتصفح (localStorage) — لا يُرسل شيء لأي خادم.
// ============================================================================

(function () {
  "use strict";

  const STORAGE_KEY = "sky_tools_mosques_v1";
  const MAX_SAVED = 200;

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function persist(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
      return true;
    } catch (e) {
      return false;
    }
  }

  // نعتبر مسجدين متطابقين إذا تقاربت إحداثياتهما لأقل من متر واحد
  function isSameLocation(a, b) {
    return Math.abs(a.easting - b.easting) < 1 && Math.abs(a.northing - b.northing) < 1;
  }

  function upsert(entry) {
    if (!entry || !isFinite(entry.easting) || !isFinite(entry.northing)) return null;

    const list = loadAll();
    const existingIndex = list.findIndex((m) => isSameLocation(m, entry));

    const record = {
      id: existingIndex >= 0 ? list[existingIndex].id : "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name: entry.name || "مسجد بدون اسم",
      easting: entry.easting,
      northing: entry.northing,
      datum: entry.datum || null,
      zone: entry.zone || null,
      lat: isFinite(entry.lat) ? entry.lat : null,
      lon: isFinite(entry.lon) ? entry.lon : null,
      savedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // نحدّث السجل الموجود ونرفعه لأعلى القائمة
      list.splice(existingIndex, 1);
    }
    list.unshift(record);
    persist(list);
    return record;
  }

  function removeById(id) {
    const list = loadAll().filter((m) => m.id !== id);
    persist(list);
    return list;
  }

  function clearAll() {
    persist([]);
  }

  window.MosqueStore = { loadAll, upsert, removeById, clearAll };

  // ==========================================================================
  // جانب أداة القبلة: الحفظ التلقائي بعد كل عملية حساب ناجحة
  // (نتعرّف على صفحة القبلة بوجود حقول نتائجها الخاصة)
  // ==========================================================================

  const surveyCoordsEl = document.getElementById("surveyCoords");
  const bearingEl = document.getElementById("bearingDMS");
  const isQiblaPage = !!(surveyCoordsEl && bearingEl);

  if (!isQiblaPage) return;

  function readValue(id) {
    const node = document.getElementById(id);
    return node && node.value ? node.value.trim() : "";
  }

  // "Easting 554636.62   Northing 2532743.15" -> { easting, northing }
  function parseSurveyCoords() {
    const text = surveyCoordsEl.textContent || "";
    const nums = text.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) return null;
    const easting = parseFloat(nums[0]);
    const northing = parseFloat(nums[1]);
    if (!isFinite(easting) || !isFinite(northing)) return null;
    return { easting, northing };
  }

  function buildMosqueName() {
    const requestNo = readValue("mosqueRequestNo");
    const village = readValue("villagePlotInput");
    const governorate = readValue("governorateInput");

    if (requestNo && village) return requestNo + " — " + village;
    if (requestNo) return requestNo;
    if (village && governorate) return village + " — " + governorate;
    if (village) return village;
    if (governorate) return governorate;

    const d = new Date();
    return (
      "مسجد " +
      d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function saveCurrentMosque() {
    const coords = parseSurveyCoords();
    if (!coords) return null;

    const datumEl = document.getElementById("datum");
    const zoneEl = document.getElementById("zone");
    const datum = datumEl ? datumEl.value : null;
    const zone = zoneEl ? parseInt(zoneEl.value, 10) : null;

    let lat = null;
    let lon = null;
    try {
      if (typeof convertToWGS84 === "function" && zone) {
        const wgs = convertToWGS84(coords.easting, coords.northing, zone, datum);
        if (isFinite(wgs.lat) && isFinite(wgs.lon)) {
          lat = wgs.lat;
          lon = wgs.lon;
        }
      }
    } catch (e) {
      // نحفظ بالإحداثيات المترية فقط إن تعذّر التحويل
    }

    return upsert({
      name: buildMosqueName(),
      easting: coords.easting,
      northing: coords.northing,
      datum,
      zone,
      lat,
      lon,
    });
  }

  // بعد الضغط على "احسب" ننتظر ظهور النتيجة ثم نحفظ
  function scheduleSaveAfterCompute() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const resultPanel = document.getElementById("resultPanel");
      const ready =
        resultPanel &&
        !resultPanel.classList.contains("hidden") &&
        parseSurveyCoords();

      if (ready) {
        clearInterval(timer);
        saveCurrentMosque();
      } else if (attempts > 40) {
        clearInterval(timer);
      }
    }, 250);
  }

  const computeBtn = document.getElementById("computeBtn");
  if (computeBtn) {
    computeBtn.addEventListener("click", scheduleSaveAfterCompute);
  }

  // نحفظ/نحدّث الاسم أيضاً عند تنزيل تقرير Word، لأن بيانات المسجد
  // (رقم الطلب، القرية) تُدخَل عادةً بعد الحساب لا قبله
  const wordBtn = document.getElementById("downloadWordBtn");
  if (wordBtn) {
    wordBtn.addEventListener("click", () => setTimeout(saveCurrentMosque, 300));
  }
})();
