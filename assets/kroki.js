// ============================================================================
// قراءة كروكي المسجد واستخراج موقعه تلقائياً
//
// لكل كروكي يُرفع: تُقرأ إحداثيات قطعة الأرض (Easting/Northing)، ثم يُحسب
// مركز القطعة (Centroid) ليمثّل موقع المسجد في حساب المسار.
// منطق القراءة والتحقق مطابق لما تستخدمه أداة القبلة.
// ============================================================================

(function () {
  "use strict";

  // ---------- تحسين الصورة قبل القراءة (نفس معالجة أداة القبلة) ----------
  function preprocessImageForOcr(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_CANVAS_AREA = 16000000;
        const MAX_DIMENSION = 4000;

        let scale = 2;
        let targetW = img.width * scale;
        let targetH = img.height * scale;

        if (
          targetW > MAX_DIMENSION ||
          targetH > MAX_DIMENSION ||
          targetW * targetH > MAX_CANVAS_AREA
        ) {
          const areaScale = Math.sqrt(MAX_CANVAS_AREA / (img.width * img.height));
          const dimScale = Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height);
          scale = Math.min(scale, areaScale, dimScale);
          if (!isFinite(scale) || scale <= 0) scale = 1;
          targetW = Math.max(1, Math.round(img.width * scale));
          targetH = Math.max(1, Math.round(img.height * scale));
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const g = Math.min(255, Math.max(0, (gray - 100) * 1.3 + 100));
            data[i] = data[i + 1] = data[i + 2] = g;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {
          // نكمل بالصورة كما هي إن تعذّر تحسين التباين
        }

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ---------- استخراج أزواج الإحداثيات من نص القراءة ----------
  // نفس أنماط الأرقام المستخدمة في أداة القبلة:
  // Easting يبدأ بـ 3-8 وطوله 6 أرقام، وNorthing يبدأ بـ 2 وطوله 7 أرقام.
  function extractPairsFromText(text) {
    // مركز القطعة إن كان مذكوراً صراحة بالكروكي (CENTROID) — الأدق إن وُجد
    let statedCentroid = null;
    const centroidMatch = text.match(
      /CENT\w*D[^0-9]*([3-8]\d{5}[.,]\d{1,3})[,\s]+(\d{7}[.,]\d{1,3})/i,
    );
    if (centroidMatch) {
      const e = parseFloat(centroidMatch[1].replace(",", "."));
      const n = parseFloat(centroidMatch[2].replace(",", "."));
      if (isFinite(e) && isFinite(n)) statedCentroid = { e, n };
    }

    // توحيد صيغة الأرقام (فاصلة عشرية / مسافة بدل النقطة)
    const pre = text
      .replace(/\b(\d{4,7}),(\d{2,3})\b/g, "$1.$2")
      .replace(/\b([3-8]\d{5})\s(\d{2})\b/g, "$1.$2");

    const eastings = [...pre.matchAll(/\b([3-8]\d{5}[.,]\d{1,3})\b/g)].map((m) =>
      parseFloat(m[1].replace(",", ".")),
    );
    const northings = [...pre.matchAll(/\b(2\d{6}[.,]\d{1,3})\b/g)].map((m) =>
      parseFloat(m[1].replace(",", ".")),
    );

    const count = Math.min(eastings.length, northings.length);
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push([eastings[i], northings[i]]);
    }

    return { points, statedCentroid };
  }

  // ---------- مركز القطعة ----------
  function polygonCentroid(points) {
    if (!points.length) return null;
    if (points.length < 3) {
      // نقطة أو نقطتان: المتوسط الحسابي
      const e = points.reduce((s, p) => s + p[0], 0) / points.length;
      const n = points.reduce((s, p) => s + p[1], 0) / points.length;
      return { e, n };
    }

    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      const cross = x1 * y2 - x2 * y1;
      area += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    area /= 2;

    // مضلع منحل أو مساحته صفر: نرجع للمتوسط الحسابي
    if (!isFinite(area) || Math.abs(area) < 1e-9) {
      const e = points.reduce((s, p) => s + p[0], 0) / points.length;
      const n = points.reduce((s, p) => s + p[1], 0) / points.length;
      return { e, n };
    }

    return { e: cx / (6 * area), n: cy / (6 * area) };
  }

  // ---------- القراءة بواسطة Claude (اختيارية، أدق) ----------
  async function extractWithClaude(dataUrl, mediaType, apiKey) {
    if (!apiKey) throw new Error("أدخل مفتاح Anthropic API أولاً.");
    const base64Data = dataUrl.split(",")[1];

    const prompt =
      "اقرأ جدول إحداثيات قطعة الأرض من هذه الصورة (كروكي مساحي عُماني). " +
      "أعد الإجابة بصيغة JSON فقط بدون أي نص إضافي أو علامات markdown، بالشكل التالي بالضبط:\n" +
      '{"points": [[easting, northing], ...], "zone": <رقم نطاق UTM إن وجد أو null>, "datum": "psd93" أو "wgs84utm" أو null, "name": "<اسم المسجد أو القطعة إن وُجد بالوثيقة أو null>"}\n' +
      "ملاحظات مهمة:\n" +
      "- بعض الجداول تكتب عمود Northing قبل عمود Easting — تأكد من إخراج كل نقطة بترتيب [Easting, Northing] دائماً بغض النظر عن ترتيب الأعمدة كما تظهر في الصورة.\n" +
      "- انسخ الأرقام كما هي بالضبط دون أي تقريب أو تعديل.\n" +
      "- إذا لم تجد قيمة لأي حقل ضعه null.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64Data },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("الخدمة ردّت بحالة " + response.status);
    }

    const data = await response.json();
    const textOut = (data.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    return JSON.parse(textOut);
  }

  // ---------- القراءة العادية بواسطة Tesseract ----------
  async function extractWithTesseract(dataUrl) {
    if (typeof Tesseract === "undefined") {
      throw new Error("مكتبة القراءة غير متاحة.");
    }
    const processed = await preprocessImageForOcr(dataUrl);
    const worker = await Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
    });
    const {
      data: { text },
    } = await worker.recognize(processed);
    await worker.terminate();
    return text;
  }

  // ---------- الواجهة المعروضة للأداة ----------
  // تُعيد { name, easting, northing, pointCount, source }
  async function readKroki(file, options) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("تعذّرت قراءة الملف."));
      reader.readAsDataURL(file);
    });

    const baseName = file.name.replace(/\.[^.]+$/, "").trim();

    if (options.method === "ai") {
      const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
      const parsed = await extractWithClaude(dataUrl, mediaType, options.apiKey);
      const points = (Array.isArray(parsed.points) ? parsed.points : []).filter(
        (p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]),
      );
      if (!points.length) throw new Error("لم يُعثر على إحداثيات في الكروكي.");

      const c = polygonCentroid(points);
      return {
        name: (parsed.name && String(parsed.name).trim()) || baseName,
        easting: c.e,
        northing: c.n,
        pointCount: points.length,
        zone: parsed.zone,
        datum: parsed.datum,
        source: "ai",
      };
    }

    const text = await extractWithTesseract(dataUrl);
    const { points, statedCentroid } = extractPairsFromText(text);

    if (statedCentroid) {
      return {
        name: baseName,
        easting: statedCentroid.e,
        northing: statedCentroid.n,
        pointCount: points.length,
        source: "centroid",
      };
    }

    if (!points.length) {
      throw new Error("لم يُعثر على إحداثيات واضحة — جرّب القراءة عالية الدقة.");
    }

    const c = polygonCentroid(points);
    return {
      name: baseName,
      easting: c.e,
      northing: c.n,
      pointCount: points.length,
      source: "ocr",
    };
  }

  window.KrokiReader = { readKroki };
})();
