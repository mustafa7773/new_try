      // ===== تحميل تقرير Word (يعتمد على القالب الأصلي 100% + استبدال الحقول المتغيرة فقط) =====
      function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      // ----- تحميل قالب Word الأصلي من assets/qibla-template.docx (بدل تضمينه Base64
      // داخل الصفحة). يُخزَّن مؤقتاً بعد أول تحميل لتفادي طلب الشبكة أكثر من مرة. -----
      let cachedTemplateBytesPromise = null;
      function getQiblaTemplateBytes() {
        if (!cachedTemplateBytesPromise) {
          cachedTemplateBytesPromise = fetch("assets/qibla-template.docx")
            .then((r) => r.arrayBuffer())
            .then((buf) => new Uint8Array(buf));
        }
        return cachedTemplateBytesPromise;
      }

      // نسبة أبعاد صورة الموقع كما هي في القالب الأصلي تماماً (العرض/الارتفاع بوحدة EMU)
      const TEMPLATE_IMAGE_EMU_W = 4072255;
      const TEMPLATE_IMAGE_EMU_H = 1999615;
      const TEMPLATE_IMAGE_RATIO = TEMPLATE_IMAGE_EMU_W / TEMPLATE_IMAGE_EMU_H;

      // ============================================================================
      // معالجة الفجوات المعروفة بين عرض docx-preview وWord الحقيقي (خاصة بمسار PDF فقط،
      // ملف Word نفسه سليم 100% ولا يُمس هنا إطلاقاً):
      //
      // 1) الشعار (أعلى) والختم (أسفل) في القالب الأصلي هما صورتان "عائمة/مثبّتة"
      //    (wp:anchor وليس wp:inline)، والختم إضافة لذلك مُدوَّر بزاوية وله تأثير فني
      //    (Artistic Effect) خاص بـ Word فقط. هذا النوع من الصور غير مدعوم بشكل موثوق
      //    في محرّكات عرض Word خارج Word نفسه (تحقّقنا أن حتى LibreOffice لا يعرض
      //    الختم رغم عرضه للشعار). لذلك نرسم هاتين الصورتين يدوياً فوق كل صفحة PDF
      //    بعد التقاطها، بموضع وحجم ثابتين (مقاسان فعلياً من القالب/من تقرير Word حقيقي)
      //    بما أنهما عنصرا ترويسة ثابتان لا يتغيران أبداً بين التقارير.
      //
      // 2) قيم الإحداثيات (أرقام/حروف لاتينية) تقع داخل فقرات Word معرَّفة كـ RTL
      //    (bidi)، فتُعاد خوارزمية Unicode BiDi في المتصفح ترتيب أجزائها بصرياً بشكل
      //    خاطئ عند التقاطها كصورة. نعزل كل قيمة من هذه القيم داخل عنصر <bdi dir="ltr">
      //    بعد العرض مباشرة كي تُقرأ بترتيبها الصحيح دائماً.
      //
      // 3) رمزا المربع (☑/☐) في القالب يعتمدان على خط Wingdings 2 غير المُضمَّن داخل
      //    الملف (تحقّقنا من fontTable.xml)، وهو غير متوفر تقريباً في أي متصفح. نستبدل
      //    هذين الرمزين بعد العرض برمزي يونيكود قياسيين (☑ / ☐) يعملان في أي نظام.
      // ============================================================================

      // ---- هندسة المواضع منقولة حرفياً من wp:anchor داخل القالب (بوحدة نقطة pt) ----
      // مشتقة من: هامش أيسر 1134 twips = 56.70pt، مسافة الترويسة 709 twips = 35.45pt.
      const A4_WIDTH_PT = 595.3;

      // الشعار (header1.xml): يُوضع بالنسبة لحافة الصفحة، ويتكرر في كل صفحة.
      const LOGO_PT = { left: 244.8, top: 16.8, width: 129.8, height: 114.6 };

      // الختم (document.xml): في Word مربوط بالفقرة التي تحتوي "تاريخ الاصدار"
      // (positionV relativeFrom="paragraph")، ولذلك نربطه بنفس الفقرة في DOM بدل
      // ربطه بموضع ثابت من الصفحة — فيبقى صحيحاً مهما تغيّر توزيع الصفحات.
      const STAMP_PT = {
        left: 242.35,
        topBelowParagraph: 22.58,
        width: 108.6,
        height: 90.55,
        rotationDeg: 31.77,
      };
      const STAMP_ANCHOR_TEXT = "تاريخ الاصدار";

      // يحقن الشعار والختم كعناصر <img> حقيقية داخل صفحة المستند المعروضة، قبل التقاطها
      // بواسطة html2canvas — فيلتقطهما مثل أي صورة عادية في الصفحة.
      function injectLetterheadImagesIntoPage(pageEl, logoSrc, stampSrc) {
        const cs = window.getComputedStyle(pageEl);
        if (cs.position === "static") {
          pageEl.style.position = "relative";
        }

        // مقياس التحويل: عرض الصفحة المعروضة مقابل عرض A4 الحقيقي
        const pageRect = pageEl.getBoundingClientRect();
        const pxPerPt = pageRect.width / A4_WIDTH_PT;

        const logo = document.createElement("img");
        logo.src = logoSrc;
        logo.setAttribute("data-qibla-overlay", "logo");
        logo.style.position = "absolute";
        logo.style.left = LOGO_PT.left * pxPerPt + "px";
        logo.style.top = LOGO_PT.top * pxPerPt + "px";
        logo.style.width = LOGO_PT.width * pxPerPt + "px";
        logo.style.height = LOGO_PT.height * pxPerPt + "px";
        logo.style.zIndex = "50";
        logo.style.pointerEvents = "none";
        pageEl.appendChild(logo);

        // البحث عن فقرة الإرساء الخاصة بالختم داخل هذه الصفحة تحديداً
        let anchorEl = null;
        const candidates = pageEl.querySelectorAll("p, div, span, td");
        for (let i = 0; i < candidates.length; i++) {
          const el = candidates[i];
          if (el.textContent && el.textContent.indexOf(STAMP_ANCHOR_TEXT) !== -1) {
            anchorEl = el; // نُبقي الأعمق (الأخير) لأنه الأدق
          }
        }
        if (!anchorEl) return;

        const anchorRect = anchorEl.getBoundingClientRect();
        const anchorTopWithinPage = anchorRect.top - pageRect.top;

        const stamp = document.createElement("img");
        stamp.src = stampSrc;
        stamp.setAttribute("data-qibla-overlay", "stamp");
        stamp.style.position = "absolute";
        stamp.style.left = STAMP_PT.left * pxPerPt + "px";
        stamp.style.top =
          anchorTopWithinPage + STAMP_PT.topBelowParagraph * pxPerPt + "px";
        stamp.style.width = STAMP_PT.width * pxPerPt + "px";
        stamp.style.height = STAMP_PT.height * pxPerPt + "px";
        stamp.style.transform = "rotate(" + STAMP_PT.rotationDeg + "deg)";
        stamp.style.transformOrigin = "center center";
        stamp.style.zIndex = "50";
        stamp.style.pointerEvents = "none";
        pageEl.appendChild(stamp);
      }

      // يستبدل رمزي Wingdings 2 الخاصين (غير المدعومين في المتصفح) برمزي يونيكود
      // قياسيين يعملان في كل مكان، دون أي مساس بملف Word نفسه.
      function replaceCheckboxGlyphsForPdf(container) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        nodes.forEach((n) => {
          if (n.nodeValue.indexOf("\uF052") !== -1 || n.nodeValue.indexOf("\uF0A3") !== -1) {
            n.nodeValue = n.nodeValue.replace(/\uF052/g, "☑").replace(/\uF0A3/g, "☐");
          }
        });
      }

      // يعزل كل قيمة حقل رقمية/لاتينية (إحداثيات، زوايا، أرقام طلبات) داخل عنصر
      // <bdi dir="ltr"> كي تُعرض بترتيبها الصحيح دوماً بصرف النظر عن اتجاه الفقرة
      // المحيطة بها (RTL)، دون أي مساس بالنص العربي المجاور لها.
      function isolateLtrFieldValuesForPdf(container, fields) {
        const targets = [
          fields.survey_coords,
          fields.site_coords,
          fields.bearing_dms,
          fields.map_angle,
          fields.mosque_request_no,
          fields.company_request_no,
        ]
          .map((v) => (v || "").trim())
          .filter(Boolean);
        if (!targets.length) return;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);

        nodes.forEach((textNode) => {
          const trimmed = textNode.nodeValue.trim();
          if (!trimmed || targets.indexOf(trimmed) === -1) return;
          const bdi = document.createElement("bdi");
          bdi.setAttribute("dir", "ltr");
          bdi.style.unicodeBidi = "isolate";
          bdi.textContent = textNode.nodeValue;
          textNode.parentNode.replaceChild(bdi, textNode);
        });
      }

      function cropCanvasToRatio(sourceCanvas, ratio) {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        const curRatio = w / h;
        let sx = 0, sy = 0, sw = w, sh = h;
        if (curRatio > ratio) {
          sw = Math.round(h * ratio);
          sx = Math.round((w - sw) / 2);
        } else if (curRatio < ratio) {
          sh = Math.round(w / ratio);
          sy = Math.round((h - sh) / 2);
        }
        const out = document.createElement("canvas");
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext("2d");
        ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return out;
      }

      // يقصّ الصورة الملتقطة حول نقطة الدبوس مباشرة بمساحة أصغر بكثير من كامل الخريطة،
      // فكلما صغرت مساحة الاقتصاص حول البوصلة، بدت التفاصيل حولها أوضح وأكبر في التقرير،
      // بصرف النظر عن مستوى تكبير الخريطة نفسه.
      function cropCanvasAroundPoint(sourceCanvas, centerX, centerY, ratio, zoomInFraction) {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;

        let cropW = Math.round(Math.min(w, h) * zoomInFraction);
        let cropH = Math.round(cropW / ratio);
        if (cropH > h) {
          cropH = h;
          cropW = Math.round(cropH * ratio);
        }
        if (cropW > w) {
          cropW = w;
          cropH = Math.round(cropW / ratio);
        }

        let sx = Math.round(centerX - cropW / 2);
        let sy = Math.round(centerY - cropH / 2);
        sx = Math.max(0, Math.min(sx, w - cropW));
        sy = Math.max(0, Math.min(sy, h - cropH));

        const out = document.createElement("canvas");
        out.width = cropW;
        out.height = cropH;
        const ctx = out.getContext("2d");
        ctx.drawImage(sourceCanvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
        return out;
      }

      // ينتظر انتهاء تحميل بلاطات طبقة الأقمار الصناعية/الخريطة الحالية باستخدام واجهة Leaflet
      // العامة isLoading() بدل التحقق من خصائص داخلية غير موثوقة، مع سقف زمني للأمان.
      function waitForActiveTilesToLoad(maxWaitMs) {
        return new Promise((resolve) => {
          const activeLayer =
            mapInstance && satLayer && mapInstance.hasLayer(satLayer)
              ? satLayer
              : streetLayer;

          if (!activeLayer || typeof activeLayer.isLoading !== "function") {
            resolve();
            return;
          }

          if (!activeLayer.isLoading()) {
            resolve();
            return;
          }

          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          activeLayer.once("load", finish);
          setTimeout(finish, maxWaitMs);
        });
      }

      function getArabicGregorianDateString(date) {
        const months = [
          "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
          "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
        ];
        return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear() + "م";
      }

      function getHijriDateString(date) {
        try {
          const parts = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).formatToParts(date);
          const day = parts.find((p) => p.type === "day").value;
          const month = parts.find((p) => p.type === "month").value;
          const year = parts.find((p) => p.type === "year").value;
          return day + " " + month + " " + year;
        } catch (e) {
          return "";
        }
      }

      // ============================================================================
      // مصدر واحد للتصميم (Single Source of Truth):
      // قالب Word الأصلي (assets/qibla-template.docx) هو التصميم المعتمد الوحيد للتقرير:
      // نفس الخطوط، الألوان، الجداول، الشعار، الختم، الصورة، الهوامش والمحاذاة.
      //
      // - زر "تحميل تقرير Word" يُنزّل هذا الملف كما هو بعد تعبئة الحقول المتغيرة فقط.
      // - زر "تحميل تقرير PDF" لا يعتمد على أي تصميم HTML منفصل مطلقاً؛ بل يقوم بـ:
      //     1) بناء نفس ملف Word المعبّأ (نفس الدالة buildQiblaReportDocx بالأسفل).
      //     2) عرض هذا الملف Word نفسه داخل المتصفح عبر مكتبة docx-preview
      //        (وهي تُحاكي تخطيط Word الحقيقي: صفحات A4، هوامش، جداول، صور، خطوط).
      //     3) تصوير كل صفحة مُعروضة والتقاطها في ملف PDF، صفحة بصفحة.
      // بهذا الشكل يكون ملف PDF مطابقاً بصرياً لملف Word بنسبة 100% لأنه فعلياً نفس
      // المستند، وليس تصميماً مبنياً يدوياً بلغة HTML/CSS كما كان سابقاً (وهذا بالتحديد
      // كان سبب اختلاف الشكل بين الملفين).
      // ============================================================================

      // ----- جمع بيانات الحقول المشتركة (مصدر واحد لكل من Word وPDF) -----
      function collectQiblaReportFields() {
        const nowForDates = new Date();
        return {
          survey_coords: document.getElementById("surveyCoords").textContent.trim(),
          site_coords: document.getElementById("siteCoordsDMS").textContent.trim(),
          bearing_dms: document.getElementById("bearingDMS").textContent.trim(),
          greg_date: getArabicGregorianDateString(nowForDates),
          hijri_date: getHijriDateString(nowForDates),
          mosque_request_no: document.getElementById("mosqueRequestNo").value.trim(),
          company_request_no: document.getElementById("companyRequestNo").value.trim(),
          agent_info: document.getElementById("agentInfo").value.trim(),
          governorate: document.getElementById("governorateInput").value.trim(),
          village_plot: document.getElementById("villagePlotInput").value.trim(),
          map_angle: document.getElementById("mapAngleInput").value.trim(),
          request_status: document.getElementById("requestStatusInput").value.trim(),
          notes: document.getElementById("notesInput").value.trim(),
        };
      }

      // ----- التقاط صورة الموقع من الخريطة (مشتركة بين Word وPDF، بلا أي تغيير في
      // منطق الموقع أو حساب الإحداثيات أو زاوية القبلة) -----
      async function captureQiblaMapCanvas() {
        if (!mapInstance) return null;
        try {
          // لا نغيّر زوم الخريطة إطلاقاً؛ نلتقط الصورة بمستوى التكبير الحالي كما هو
          await waitForActiveTilesToLoad(1500);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const mapEl = document.getElementById("map");
          const scale = 2;
          const rawCanvas = await html2canvas(mapEl, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: "#ffffff",
            scale,
          });

          if (markerInstance) {
            const containerPoint = mapInstance.latLngToContainerPoint(
              markerInstance.getLatLng(),
            );
            return cropCanvasAroundPoint(
              rawCanvas,
              containerPoint.x * scale,
              containerPoint.y * scale,
              TEMPLATE_IMAGE_RATIO,
              1,
            );
          }
          return cropCanvasToRatio(rawCanvas, TEMPLATE_IMAGE_RATIO);
        } catch (imgErr) {
          return null;
        }
      }

      // ----- المصدر الوحيد لإنشاء المستند: يملأ القالب الأصلي بالحقول والصورة،
      // ويُعيد كلاً من الـ Blob (لتنزيله كـ Word) والـ ArrayBuffer (لعرضه وتحويله PDF) -----
      async function buildQiblaReportDocx(mapCanvas) {
        const fields = collectQiblaReportFields();

        // نستخدم نفس رمزي المربع من خط Wingdings 2 الأصليين في القالب (مربع معلَّم/فارغ)
        // حتى يكون الشكل مطابقاً تماماً لما كان عليه سابقاً، بدل رموز يونيكود عامة
        const CHECKED_BOX = "\uF052";
        const UNCHECKED_BOX = "\uF0A3";

        const templateBytes = await getQiblaTemplateBytes();
        const zip = new PizZip(templateBytes);

        const docTemplate = new window.docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
        });

        docTemplate.render({
          ...fields,
          status_box_awali: fields.request_status === "أولي" ? CHECKED_BOX : UNCHECKED_BOX,
          status_box_jahiz: fields.request_status === "جاهز" ? CHECKED_BOX : UNCHECKED_BOX,
          status_box_muktamil: fields.request_status === "مكتمل" ? CHECKED_BOX : UNCHECKED_BOX,
        });

        const outZip = docTemplate.getZip();

        // استبدال بايتات صورة الموقع مباشرة داخل الملف دون لمس أي تنسيق أو تخطيط
        if (mapCanvas) {
          const dataUrl = mapCanvas.toDataURL("image/png");
          const imagePngBytes = base64ToUint8Array(dataUrl.split(",")[1]);
          outZip.file("word/media/image1.png", imagePngBytes);
        }

        const blob = outZip.generate({
          type: "blob",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const arrayBuffer = await blob.arrayBuffer();

        return { blob, arrayBuffer };
      }

      function qiblaReportFileStamp() {
        const today = new Date();
        return (
          today.getFullYear() + "-" +
          String(today.getMonth() + 1).padStart(2, "0") + "-" +
          String(today.getDate()).padStart(2, "0")
        );
      }

      function downloadBlobAs(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      // ===== تحميل تقرير Word (من القالب الأصلي 100% + استبدال الحقول المتغيرة فقط) =====
      async function generateWordReport() {
        const btn = document.getElementById("downloadWordBtn");
        const status = document.getElementById("wordStatus");
        if (!mapInstance || document.getElementById("resultPanel").classList.contains("hidden")) {
          alert("يرجى حساب اتجاه القبلة أولاً قبل تحميل التقرير.");
          return;
        }
        status.style.display = "block";
        status.textContent = "جاري تجهيز صورة الخريطة...";
        btn.disabled = true;

        try {
          const mapCanvas = await captureQiblaMapCanvas();

          status.textContent = "جاري إنشاء ملف Word من القالب الأصلي...";
          const { blob } = await buildQiblaReportDocx(mapCanvas);

          downloadBlobAs(blob, "طلب_تحديد_اتجاه_القبلة_" + qiblaReportFileStamp() + ".docx");

          status.textContent = "تم إنشاء الملف وتحميله بنجاح.";
          setTimeout(() => {
            status.style.display = "none";
          }, 4000);
        } catch (err) {
          status.textContent = "حدث خطأ أثناء إنشاء ملف Word: " + (err && err.message ? err.message : err);
        } finally {
          btn.disabled = false;
        }
      }

      // ===== تحميل تقرير PDF: يُبنى من نفس مستند Word أعلاه بالضبط (نفس القالب،
      // نفس الحقول، نفس الصورة)، ثم يُعرض بمحرك docx-preview ويُصوَّر صفحة بصفحة،
      // بحيث يكون مطابقاً بصرياً لملف Word دون أي اختلاف في التصميم =====
      async function generatePDFReport() {
        const btn = document.getElementById("downloadPdfBtn");
        const status = document.getElementById("wordStatus");
        if (!mapInstance || document.getElementById("resultPanel").classList.contains("hidden")) {
          alert("يرجى حساب اتجاه القبلة أولاً قبل تحميل التقرير.");
          return;
        }
        status.style.display = "block";
        status.textContent = "جاري تجهيز صورة الخريطة...";
        btn.disabled = true;

        let hiddenContainer = null;
        try {
          const mapCanvas = await captureQiblaMapCanvas();

          status.textContent = "جاري إنشاء نفس مستند Word الأساسي...";
          const { arrayBuffer } = await buildQiblaReportDocx(mapCanvas);

          status.textContent = "جاري عرض المستند بنفس تصميم Word تحضيراً لتحويله PDF...";

          // حاوية مخفية خارج حدود الشاشة (وليست منبثقة) لعرض مستند Word فيها فعلياً
          // عبر docx-preview، دون أي تصميم HTML بديل مكتوب يدوياً
          hiddenContainer = document.createElement("div");
          hiddenContainer.style.position = "fixed";
          hiddenContainer.style.top = "0";
          hiddenContainer.style.left = "-99999px";
          document.body.appendChild(hiddenContainer);

          await window.docx.renderAsync(arrayBuffer, hiddenContainer, undefined, {
            className: "docx-report",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            experimental: true,
            renderHeaders: true,
            renderFooters: true,
            renderChanges: false,
          });

          // إصلاحا ما بعد العرض (قبل أي التقاط): استبدال رمزي المربع بيونيكود قياسي،
          // وعزل قيم الإحداثيات/الأرقام اللاتينية كي لا تُعاد خوارزمية BiDi ترتيبها
          const fieldsForPdfFixups = collectQiblaReportFields();
          replaceCheckboxGlyphsForPdf(hiddenContainer);
          isolateLtrFieldValuesForPdf(hiddenContainer, fieldsForPdfFixups);

          status.textContent = "جاري تحويل صفحات المستند إلى PDF...";

          const wrapperEl = hiddenContainer.querySelector(".docx-wrapper");
          const pageEls = wrapperEl
            ? Array.from(wrapperEl.children).filter((el) => el.classList.contains("docx"))
            : [];
          const pagesToRender = pageEls.length ? pageEls : [hiddenContainer];

          // حقن الشعار (في كل صفحة) والختم (في الصفحة التي تحتوي فقرة إرسائه)
          pagesToRender.forEach((pageEl) => {
            injectLetterheadImagesIntoPage(
              pageEl,
              "assets/qibla-logo.png",
              "assets/qibla-stamp.png",
            );
          });

          // انتظار اكتمال تحميل كل الصور (بما فيها الشعار والختم المحقونان للتو)
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const pendingImages = Array.from(hiddenContainer.querySelectorAll("img")).filter(
            (img) => !img.complete,
          );
          if (pendingImages.length) {
            await Promise.all(
              pendingImages.map(
                (img) =>
                  new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                  }),
              ),
            );
          }

          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({ unit: "pt", format: "a4" });
          const pageWidthPt = pdf.internal.pageSize.getWidth();
          const pageHeightPt = pdf.internal.pageSize.getHeight();

          let isFirstPdfPage = true;

          for (let i = 0; i < pagesToRender.length; i++) {
            const pageCanvas = await html2canvas(pagesToRender[i], {
              useCORS: true,
              backgroundColor: "#ffffff",
              scale: 2,
            });

            // عرض الصفحة يُطابَق مع عرض A4، والارتفاع يُحسب بنفس النسبة حفاظاً على
            // التناسب الحقيقي — بلا أي سحب أو ضغط يشوّه الجداول والخطوط والصور.
            const pxPerPt = pageCanvas.width / pageWidthPt;
            const fullHeightPt = pageCanvas.height / pxPerPt;

            if (fullHeightPt <= pageHeightPt + 1) {
              // الصفحة تسع داخل A4 كما هي
              if (!isFirstPdfPage) pdf.addPage();
              isFirstPdfPage = false;
              pdf.addImage(
                pageCanvas.toDataURL("image/png"),
                "PNG",
                0,
                0,
                pageWidthPt,
                fullHeightPt,
              );
            } else {
              // الصفحة أطول من A4 (لاختلاف مقاييس الخطوط بين المتصفح وWord):
              // تُقسَّم رأسياً إلى صفحات A4 متتابعة بدل حشرها في صفحة واحدة مشوّهة.
              const sliceHeightPx = Math.floor(pageHeightPt * pxPerPt);
              let offsetPx = 0;

              while (offsetPx < pageCanvas.height) {
                const currentSlicePx = Math.min(
                  sliceHeightPx,
                  pageCanvas.height - offsetPx,
                );

                const sliceCanvas = document.createElement("canvas");
                sliceCanvas.width = pageCanvas.width;
                sliceCanvas.height = currentSlicePx;
                const sliceCtx = sliceCanvas.getContext("2d");
                sliceCtx.fillStyle = "#ffffff";
                sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                sliceCtx.drawImage(
                  pageCanvas,
                  0,
                  offsetPx,
                  pageCanvas.width,
                  currentSlicePx,
                  0,
                  0,
                  pageCanvas.width,
                  currentSlicePx,
                );

                if (!isFirstPdfPage) pdf.addPage();
                isFirstPdfPage = false;
                pdf.addImage(
                  sliceCanvas.toDataURL("image/png"),
                  "PNG",
                  0,
                  0,
                  pageWidthPt,
                  currentSlicePx / pxPerPt,
                );

                offsetPx += currentSlicePx;
              }
            }
          }

          pdf.save("طلب_تحديد_اتجاه_القبلة_" + qiblaReportFileStamp() + ".pdf");

          status.textContent = "تم إنشاء ملف PDF وتحميله بنجاح.";
          setTimeout(() => {
            status.style.display = "none";
          }, 4000);
        } catch (err) {
          status.textContent = "حدث خطأ أثناء إنشاء تقرير PDF: " + (err && err.message ? err.message : err);
        } finally {
          if (hiddenContainer && hiddenContainer.parentNode) {
            hiddenContainer.parentNode.removeChild(hiddenContainer);
          }
          btn.disabled = false;
        }
      }

      document.getElementById("downloadWordBtn").addEventListener("click", generateWordReport);
      document.getElementById("downloadPdfBtn").addEventListener("click", generatePDFReport);
