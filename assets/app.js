      const KAABA = { lat: 21.422487, lon: 39.826206 };

      function toDMS(decimal, posLabel, negLabel) {
        const hemi = decimal >= 0 ? posLabel : negLabel;
        const abs = Math.abs(decimal);
        let d = Math.floor(abs);
        let mFloat = (abs - d) * 60;
        let m = Math.floor(mFloat);
        let s = (mFloat - m) * 60;
        s = Math.round(s * 100) / 100;
        if (s >= 60) { s -= 60; m += 1; }
        if (m >= 60) { m -= 60; d += 1; }
        const dStr = d < 10 ? "0" + d : String(d);
        const mStr = m < 10 ? "0" + m : String(m);
        const sStr = s < 10 ? "0" + s.toFixed(2) : s.toFixed(2);
        return dStr + "\u00b0 " + mStr + "' " + sStr + '" ' + hemi;
      }

      function toDMSWhole(decimal, posLabel, negLabel) {
        const hemi = decimal >= 0 ? posLabel : negLabel;
        const abs = Math.abs(decimal);
        let d = Math.floor(abs);
        let mFloat = (abs - d) * 60;
        let m = Math.floor(mFloat);
        let s = Math.round((mFloat - m) * 60);
        if (s >= 60) { s -= 60; m += 1; }
        if (m >= 60) { m -= 60; d += 1; }
        const dStr = d < 10 ? "0" + d : String(d);
        const mStr = m < 10 ? "0" + m : String(m);
        const sStr = s < 10 ? "0" + s : String(s);
        return dStr + "\u00b0 " + mStr + "' " + sStr + '" ' + hemi;
      }

      /* Upload + OCR Process */
      const dropzone = document.getElementById("dropzone"),
        fileInput = document.getElementById("fileInput");
      const preview = document.getElementById("preview"),
        previewImg = document.getElementById("previewImg");
      const ocrStatus = document.getElementById("ocrStatus"),
        ocrResultBox = document.getElementById("ocrResultBox");

      ["dragover", "dragenter"].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.add("drag");
        }),
      );
      ["dragleave", "drop"].forEach((ev) =>
        dropzone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropzone.classList.remove("drag");
        }),
      );
      dropzone.addEventListener("drop", (e) => {
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener("change", (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
      });
      document.getElementById("clearBtn").addEventListener("click", (e) => {
        e.preventDefault();
        preview.classList.remove("show");
        fileInput.value = "";
        ocrResultBox.classList.add("hidden");
      });

      const ocrChoiceModal = document.getElementById("ocrChoiceModal"),
        chooseNormalBtn = document.getElementById("chooseNormalBtn"),
        chooseAiBtn = document.getElementById("chooseAiBtn"),
        modalAiKeyWrap = document.getElementById("modalAiKeyWrap"),
        modalAnthropicKey = document.getElementById("modalAnthropicKey"),
        confirmAiBtn = document.getElementById("confirmAiBtn"),
        cancelOcrModalBtn = document.getElementById("cancelOcrModalBtn");

      let sessionApiKey = "";

      function askOcrMethod() {
        return new Promise((resolve) => {
          modalAiKeyWrap.classList.add("hidden");
          modalAnthropicKey.value = sessionApiKey;
          ocrChoiceModal.classList.remove("hidden");

          function cleanup() {
            ocrChoiceModal.classList.add("hidden");
            chooseNormalBtn.onclick = null;
            chooseAiBtn.onclick = null;
            confirmAiBtn.onclick = null;
            cancelOcrModalBtn.onclick = null;
          }

          chooseNormalBtn.onclick = () => {
            cleanup();
            resolve({ method: "normal" });
          };
          chooseAiBtn.onclick = () => {
            modalAiKeyWrap.classList.remove("hidden");
          };
          confirmAiBtn.onclick = () => {
            const key = modalAnthropicKey.value.trim();
            if (!key) {
              modalAnthropicKey.focus();
              return;
            }
            sessionApiKey = key;
            cleanup();
            resolve({ method: "ai", apiKey: key });
          };
          cancelOcrModalBtn.onclick = () => {
            cleanup();
            resolve(null);
          };
        });
      }

      function countValidPairs(text) {
        const ee = [...text.matchAll(/\b([3-8]\d{5}[.,]\d{1,3})\b/g)];
        const nn = [...text.matchAll(/\b(2\d{6}[.,]\d{1,3})\b/g)];
        return Math.min(ee.length, nn.length);
      }

      function tryAutoFillPoints(text) {
        let centroidFallback = null;
        text = text.replace(
          /^.*CENT\w*D[^0-9]*([3-8]\d{5}[.,]\d{1,3})[,\s]+(\d{7}[.,]\d{1,3}).*$/gim,
          (_, e, n) => {
            const ef = parseFloat(e.replace(",", ".")),
              nf = parseFloat(n.replace(",", "."));
            if (!isNaN(ef) && !isNaN(nf)) centroidFallback = { e: ef, n: nf };
            return "";
          },
        );

        let pre = text
          .replace(/\b(\d{4,7}),(\d{2,3})\b/g, "$1.$2")
          .replace(/\b([3-8]\d{5})\s(\d{2})\b/g, "$1.$2")
          .replace(/\b(2\d{6})\s(\d{2})\b/g, "$1.$2")
          .replace(/\b(\d{3,7})\s(\d{3,6})\b/g, (m, a, b) => {
            const joined = a + b, n = parseInt(joined);
            if (joined.length === 8 && n >= 40000000 && n <= 79999999) return joined;
            if (joined.length === 9 && n >= 200000000 && n <= 299999999) return joined;
            return m;
          })
          .replace(/\b([3-8]\d{5})\b(?![.\d])/g, "$1.00")
          .replace(/\b(2\d{6})\b(?![.\d])/g, "$1.00");

        let normalized = pre.replace(/\b(\d{8,9})\b/g, (match) => {
          const len = match.length, n = parseInt(match);
          if (len === 9 && n >= 200000000 && n <= 299999999)
            return match.slice(0, 7) + "." + match.slice(7);
          if (len === 8 && n >= 40000000 && n <= 79999999)
            return match.slice(0, 6) + "." + match.slice(6);
          return match;
        });

        normalized = normalized.replace(/\b(\d{7,10})\.(\d{1,3})\b/g, (m, intPart, dec) => {
          const len = intPart.length;
          if (len === 7 && intPart[0] === "2") {
            const asIs = parseFloat(intPart + "." + dec);
            if (asIs > 1500000 && asIs < 3500000) return m;
          }
          if (len > 7) {
            const tail7 = intPart.slice(-7);
            if (tail7[0] === "2") {
              const val = parseFloat(tail7 + "." + dec);
              if (val > 1500000 && val < 3500000) return tail7 + "." + dec;
            }
          }
          const tail6 = intPart.slice(-6);
          if (/[3-8]/.test(tail6[0])) {
            const val = parseFloat(tail6 + "." + dec);
            if (val > 300000 && val < 900000) return tail6 + "." + dec;
          }
          return m;
        });

        const allEastings = [...normalized.matchAll(/\b([3-8]\d{5}\.\d{1,3})\b/g)]
          .map((m) => parseFloat(m[1]))
          .filter((v) => v > 300000 && v < 900000);
        const allNorthings = [...normalized.matchAll(/\b(2\d{6}\.\d{1,3})\b/g)]
          .map((m) => parseFloat(m[1]))
          .filter((v) => v > 1500000 && v < 3500000);

        const pairs = [];
        const seenCoords = [];
        const DEDUP_M = 1.0;

        const addPair = (e, n) => {
          if (e > 300000 && e < 900000 && n > 1500000 && n < 3500000) {
            const dup = seenCoords.some(
              (p) => Math.abs(p.e - e) < DEDUP_M && Math.abs(p.n - n) < DEDUP_M,
            );
            if (!dup) {
              seenCoords.push({ e, n });
              pairs.push(e.toFixed(2) + ", " + n.toFixed(2));
            }
          }
        };

        for (const row of normalized.split("\n")) {
          const ems = [...row.matchAll(/\b([3-8]\d{5}\.\d{1,3})\b/g)]
            .map((m) => parseFloat(m[1]))
            .filter((v) => v > 300000 && v < 900000);
          const nms = [...row.matchAll(/\b(2\d{6}\.\d{1,3})\b/g)]
            .map((m) => parseFloat(m[1]))
            .filter((v) => v > 1500000 && v < 3500000);
          if (!ems.length || !nms.length) continue;
          const count = Math.min(ems.length, nms.length);
          for (let i = 0; i < count; i++) addPair(ems[i], nms[i]);
        }

        let bestPairs = [...pairs];
        let bestCount = pairs.length;

        pairs.length = 0;
        seenCoords.length = 0;
        for (const row of normalized.split("\n")) {
          const nms = [...row.matchAll(/\b(2\d{6}\.\d{1,3})\b/g)]
            .map((m) => parseFloat(m[1]))
            .filter((v) => v > 1500000 && v < 3500000);
          const ems = [...row.matchAll(/\b([3-8]\d{5}\.\d{1,3})\b/g)]
            .map((m) => parseFloat(m[1]))
            .filter((v) => v > 300000 && v < 900000);
          if (!ems.length || !nms.length) continue;
          const count = Math.min(ems.length, nms.length);
          for (let i = 0; i < count; i++) addPair(ems[i], nms[i]);
        }
        if (pairs.length > bestCount) {
          bestPairs = [...pairs];
          bestCount = pairs.length;
        }

        if (allEastings.length >= 2 && allNorthings.length >= 2) {
          pairs.length = 0;
          seenCoords.length = 0;
          const count = Math.min(allEastings.length, allNorthings.length);
          for (let i = 0; i < count; i++) addPair(allEastings[i], allNorthings[i]);
          if (pairs.length > bestCount) {
            bestPairs = [...pairs];
            bestCount = pairs.length;
          }
        }

        if (allEastings.length >= 2 && allNorthings.length >= 2) {
          pairs.length = 0;
          seenCoords.length = 0;
          const count = Math.min(allEastings.length, allNorthings.length);
          for (let i = 0; i < count; i++) addPair(allNorthings[i], allEastings[i]);
          const validReversed = pairs.filter(p => {
            const [e, n] = p.split(',').map(s => parseFloat(s.trim()));
            return e > 300000 && e < 900000 && n > 1500000 && n < 3500000;
          });
          if (validReversed.length > bestCount) {
            bestPairs = [...validReversed];
            bestCount = validReversed.length;
          }
        }

        pairs.length = 0;
        seenCoords.length = 0;
        bestPairs.forEach(p => {
          const [e, n] = p.split(',').map(s => parseFloat(s.trim()));
          addPair(e, n);
        });

        if (pairs.length >= 3) {
          const coords = pairs.map(p => { const [e, n] = p.split(',').map(s => parseFloat(s.trim())); return { e, n }; });
          const sortedE = [...coords.map(c => c.e)].sort((a, b) => a - b);
          const sortedN = [...coords.map(c => c.n)].sort((a, b) => a - b);
          const medE = sortedE[Math.floor(sortedE.length / 2)];
          const medN = sortedN[Math.floor(sortedN.length / 2)];
          const THRESH = 60;

          const confusionPairs = [['0','9'], ['5','6'], ['1','7'], ['3','8'], ['5','9'], ['6','8']];

          for (let i = 0; i < pairs.length; i++) {
            const { e, n } = coords[i];
            const dist = Math.abs(e - medE) + Math.abs(n - medN);
            if (dist <= THRESH) continue;

            const chars = pairs[i].split('');
            let best = pairs[i], bestDist = dist;

            for (let j = 0; j < chars.length; j++) {
              for (const [a, b] of confusionPairs) {
                if (chars[j] !== a && chars[j] !== b) continue;
                const sw = [...chars]; 
                sw[j] = chars[j] === a ? b : a;
                const s = sw.join('');
                const [ce, cn] = s.split(',').map(v => parseFloat(v.trim()));
                if (isNaN(ce) || isNaN(cn)) continue;
                if (ce < 300000 || ce > 900000 || cn < 1500000 || cn > 3500000) continue;
                const d = Math.abs(ce - medE) + Math.abs(cn - medN);
                if (d < bestDist) { bestDist = d; best = s; }
              }
            }
            if (best !== pairs[i] && bestDist < dist * 0.7 && bestDist <= THRESH * 1.5) {
              pairs[i] = best;
            }
          }
        }

        if (pairs.length === 0 && centroidFallback) {
          addPair(centroidFallback.e, centroidFallback.n);
        }

        if (pairs.length > 0)
          document.getElementById("pointsInput").value = pairs.join("\n");

        const zoneM = text.match(/\b(\d{1,2})\s*N\b/i);
        if (zoneM) {
          const z = parseInt(zoneM[1]);
          if (z >= 1 && z <= 60) document.getElementById("zone").value = z;
        }

        // محاولة اكتشاف نظام الإسناد (Datum) تلقائياً من نص الكروكي.
        // معظم كروكيات وزارة الإسكان في عُمان تستخدم PSD93/Clarke 1880، لذا هو الافتراضي
        // ما لم يُذكر صراحة أن الإحداثيات بنظام WGS84.
        const mentionsPSD93 = /PSD\s*[-_]?\s*93|Clarke\s*1880/i.test(text);
        const mentionsWGS84 = /WGS\s*[-_]?\s*84/i.test(text);
        const datumSelectEl = document.getElementById("datum");
        if (mentionsPSD93 && !mentionsWGS84) {
          datumSelectEl.value = "psd93";
        } else if (mentionsWGS84 && !mentionsPSD93) {
          datumSelectEl.value = "wgs84utm";
        } else {
          datumSelectEl.value = "psd93";
        }
      }

      function preprocessImage(dataUrl) {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            // حد آمن لمساحة/أبعاد الـ canvas يعمل عبر كل المتصفحات (سفاري لديه حدود أصغر بكثير من كروم).
            const MAX_CANVAS_AREA = 16000000; // ~16 ميجابكسل
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
              // فشل قراءة بيانات الصورة (مثلاً بسبب حدود المتصفح) — نكمل بالصورة كما هي بدون تحسين التباين.
            }

            document.getElementById("previewImg").src = canvas.toDataURL("image/png");
            resolve(canvas.toDataURL("image/png"));
          };
          img.src = dataUrl;
        });
      }

      async function extractWithClaudeVision(dataUrl, mediaType, apiKey) {
        if (!apiKey) throw new Error("يرجى إدخال مفتاح Anthropic API أولاً.");
        const base64Data = dataUrl.split(",")[1];

        const prompt =
          "اقرأ جدول إحداثيات قطعة الأرض من هذه الصورة (كروكي مساحي عُماني). " +
          "أعد الإجابة بصيغة JSON فقط بدون أي نص إضافي أو علامات markdown، بالشكل التالي بالضبط:\n" +
          '{"points": [[easting, northing], ...], "area": <رقم المساحة الإجمالية بالمتر المربع كما هي مكتوبة بالوثيقة أو null>, "zone": <رقم نطاق UTM إن وجد أو null>, "datum": "psd93" أو "wgs84utm" أو null}\n' +
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
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error("فشل الاتصال بـ Anthropic API (" + response.status + "). " + errText.slice(0, 200));
        }

        const data = await response.json();
        const textOut = (data.content || [])
          .map((c) => (c.type === "text" ? c.text : ""))
          .filter(Boolean)
          .join("\n");

        const cleaned = textOut.replace(/```json|```/g, "").trim();
        try {
          return JSON.parse(cleaned);
        } catch (e) {
          throw new Error("تعذّر تفسير استجابة الذكاء الاصطناعي.");
        }
      }

      async function handleFile(file) {
        const reader = new FileReader();
        reader.onload = async () => {
          previewImg.src = reader.result;
          document.getElementById("fileName").textContent = file.name;
          preview.classList.add("show");
          ocrResultBox.classList.add("hidden");

          const choice = await askOcrMethod();
          if (!choice) return;

          ocrStatus.classList.add("show");

          if (choice.method === "ai") {
            document.getElementById("ocrStatusText").textContent = "جاري القراءة بدقة عالية بواسطة Claude AI…";
            try {
              const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
              const parsed = await extractWithClaudeVision(reader.result, mediaType, choice.apiKey);

              const points = Array.isArray(parsed.points) ? parsed.points : [];
              const pointsLines = points
                .filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]))
                .map((p) => p[0] + ", " + p[1]);
              if (pointsLines.length > 0) {
                document.getElementById("pointsInput").value = pointsLines.join("\n");
              }
              if (parsed.zone && parsed.zone >= 1 && parsed.zone <= 60) {
                document.getElementById("zone").value = parsed.zone;
              }
              if (parsed.datum === "psd93" || parsed.datum === "wgs84utm") {
                document.getElementById("datum").value = parsed.datum;
              }

              const summaryLines = [
                "✓ تمت القراءة بواسطة Claude AI",
                "عدد النقاط المستخرجة: " + pointsLines.length,
              ];
              if (parsed.area) summaryLines.push("المساحة المذكورة بالكروكي: " + parsed.area + " م²");
              document.getElementById("ocrText").value =
                summaryLines.join("\n") + (parsed.area ? "\nAREA = " + parsed.area + " SQ M" : "");
              ocrResultBox.classList.remove("hidden");
            } catch (err) {
              document.getElementById("ocrText").value =
                "تعذّرت القراءة بالذكاء الاصطناعي: " +
                (err.message || "خطأ غير معروف") +
                "\nيمكنك إعادة رفع الصورة واختيار القراءة العادية بدلاً من ذلك.";
              ocrResultBox.classList.remove("hidden");
            }
            ocrStatus.classList.remove("show");
            return;
          }

          document.getElementById("ocrStatusText").textContent = "جاري قراءة واستخراج البيانات الأوتوماتيكية…";
          try {
            const processedDataUrl = await preprocessImage(reader.result);
            const worker = await Tesseract.createWorker("eng");
            await worker.setParameters({
              tessedit_pageseg_mode: "6",
              preserve_interword_spaces: "1",
            });
            const { data: { text } } = await worker.recognize(processedDataUrl);
            await worker.terminate();

            document.getElementById("ocrText").value = text;
            ocrResultBox.classList.remove("hidden");
            tryAutoFillPoints(text);
          } catch (err) {
            document.getElementById("ocrText").value = "تعذّرت القراءة الآلية: " + (err.message || "خطأ غير معروف");
            ocrResultBox.classList.remove("hidden");
          }
          ocrStatus.classList.remove("show");
        };
        reader.readAsDataURL(file);
      }

      /* Coordinate Validation & Auto-Correction */
      function polygonArea(pts) {
        if (pts.length < 3) return 0;
        let area = 0;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          area += pts[i][0] * pts[j][1];
          area -= pts[j][0] * pts[i][1];
        }
        return Math.abs(area) / 2;
      }

      function extractAreaFromOCR(text) {
        const patterns = [
          /AREA\s*[=:]\s*(\d[\d.,]*)\s*SQ\.?\s*M?/i,
          /TOTAL\s*AREA\s*[=:]?\s*(\d[\d.,]*)/i,
          /\u0627\u0644\u0645\u0633\u0627\u062d\u0629(?:\s*\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a\u0629)?\s*[:=]?\s*(\d[\d.,]*)\s*(?:\u0645\u00b2|\u06452|m2|SQ)?/i,
          /\u0645\u0633\u0627\u062d\u0629\s*[:=]?\s*(\d[\d.,]*)/i,
          /AREA\s*(\d[\d.,]*)/i,
        ];
        for (const p of patterns) {
          const m = text.match(p);
          if (m) {
            let raw = m[1];
            if (raw.includes(",") && raw.includes(".")) {
              raw = raw.replace(/,/g, "");
            } else if (raw.includes(",")) {
              raw = /,\d{3}$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
            }
            const val = parseFloat(raw);
            if (!isNaN(val) && val > 0) return val;
          }
        }
        return null;
      }

      function segmentsIntersect(p1, p2, p3, p4) {
        const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2);
        const d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
               ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
      }

      function isSelfIntersecting(pts) {
        const n = pts.length;
        if (n < 4) return false;
        for (let i = 0; i < n; i++) {
          const a1 = pts[i], a2 = pts[(i + 1) % n];
          for (let j = i + 1; j < n; j++) {
            if (Math.abs(j - i) <= 1 || (i === 0 && j === n - 1)) continue;
            const b1 = pts[j], b2 = pts[(j + 1) % n];
            if (segmentsIntersect(a1, a2, b1, b2)) return true;
          }
        }
        return false;
      }

      function angleAt(pts, i) {
        const n = pts.length;
        const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
        const v1 = [prev[0] - cur[0], prev[1] - cur[1]];
        const v2 = [next[0] - cur[0], next[1] - cur[1]];
        const dot = v1[0] * v2[0] + v1[1] * v2[1];
        const mag1 = Math.hypot(v1[0], v1[1]), mag2 = Math.hypot(v2[0], v2[1]);
        if (mag1 === 0 || mag2 === 0) return 180;
        const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
        return (Math.acos(cos) * 180) / Math.PI;
      }

      function findWrongPoint(pts) {
        const n = pts.length;
        if (n < 4) return -1;
        const distances = pts.map((p, i) => {
          const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
          const d1 = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
          const d2 = Math.hypot(p[0] - next[0], p[1] - next[1]);
          return (d1 + d2) / 2;
        });
        const avgDist = distances.reduce((a, b) => a + b, 0) / n;

        let worstIdx = -1, worstScore = 0;
        for (let i = 0; i < n; i++) {
          const angle = angleAt(pts, i);
          const angleDev = angle < 20 || angle > 340 ? 80 : (angle < 45 || angle > 300 ? 40 : 0);
          const distDev = avgDist > 0 ? Math.max(0, distances[i] / avgDist - 1.5) : 0;
          const score = angleDev + distDev * 40;
          if (score > worstScore) { worstScore = score; worstIdx = i; }
        }
        return worstScore > 25 ? worstIdx : -1;
      }

      const DIGIT_CONFUSION = [
        ['3', '8'], ['9', '0'], ['5', '6'], ['1', '7'], ['2', '5'],
        ['6', '8'], ['0', '8'],
      ];

      function tryFixCoordinate(points, expectedArea) {
        const originalIntersect = isSelfIntersecting(points);
        const hasExpectedArea = expectedArea && expectedArea > 0;

        let bestFix = null;
        let bestScore = Infinity;

        for (let pointIdx = 0; pointIdx < points.length; pointIdx++) {
          for (let coordIdx = 0; coordIdx < 2; coordIdx++) {
            const original = points[pointIdx][coordIdx];
            const str = original.toFixed(2);

            for (let i = 0; i < str.length; i++) {
              const ch = str[i];
              for (let pairIdx = 0; pairIdx < DIGIT_CONFUSION.length; pairIdx++) {
                const pair = DIGIT_CONFUSION[pairIdx];
                if (pair[0] !== ch && pair[1] !== ch) continue;
                const swapTo = pair[0] === ch ? pair[1] : pair[0];
                const flipped = str.slice(0, i) + swapTo + str.slice(i + 1);
                const newVal = parseFloat(flipped);
                if (isNaN(newVal)) continue;
                if (coordIdx === 0 && (newVal < 300000 || newVal > 900000)) continue;
                if (coordIdx === 1 && (newVal < 1500000 || newVal > 3500000)) continue;

                let tooClose = false;
                for (let j = 0; j < points.length; j++) {
                  if (j === pointIdx) continue;
                  if (Math.abs(newVal - points[j][coordIdx]) < 1.0) { tooClose = true; break; }
                }
                if (tooClose) continue;

                const testPoints = points.map((p, idx) =>
                  idx === pointIdx ? (coordIdx === 0 ? [newVal, p[1]] : [p[0], newVal]) : p
                );
                const testArea = polygonArea(testPoints);
                const testIntersect = isSelfIntersecting(testPoints);

                let score = 0;
                if (testIntersect) score += 100;
                else if (originalIntersect) score -= 50;

                if (hasExpectedArea) {
                  score += (Math.abs(testArea - expectedArea) / expectedArea) * 50;
                } else {
                  const angles = testPoints.map((_, k) => angleAt(testPoints, k));
                  const variance = angles.reduce((s, a) => s + Math.pow(a - 90, 2), 0) / angles.length;
                  score += variance / 150;
                }
                score += pairIdx * 0.5;

                if (score < bestScore) {
                  bestScore = score;
                  bestFix = {
                    pointIdx, coordIdx,
                    from: str, to: flipped,
                    value: newVal, area: testArea,
                    isIntersect: testIntersect, score,
                  };
                }
              }
            }
          }
        }

        if (bestFix && bestFix.score < 50 && !bestFix.isIntersect) return bestFix;
        return null;
      }

      function findAllCorrections(points, expectedArea, maxFixes = 3) {
        const AREA_OK_TOL = 0.03;
        let working = points.map((p) => p.slice());
        const fixes = [];
        for (let i = 0; i < maxFixes; i++) {
          const intersecting = isSelfIntersecting(working);
          const area = polygonArea(working);
          const areaOk =
            !expectedArea || expectedArea <= 0 ||
            Math.abs(area - expectedArea) / expectedArea <= AREA_OK_TOL;
          if (!intersecting && areaOk) break;
          const fix = tryFixCoordinate(working, expectedArea);
          if (!fix) break;
          working[fix.pointIdx] =
            fix.coordIdx === 0
              ? [fix.value, working[fix.pointIdx][1]]
              : [working[fix.pointIdx][0], fix.value];
          fixes.push(fix);
        }
        return { points: working, fixes };
      }

      function validateAndCorrect(points, ocrText) {
        const result = {
          computedArea: polygonArea(points),
          expectedArea: extractAreaFromOCR(ocrText),
          isSelfIntersecting: isSelfIntersecting(points),
          wrongPoint: findWrongPoint(points),
          corrections: [],
          warnings: [],
          isValid: true,
        };

        if (result.isSelfIntersecting) {
          result.isValid = false;
          result.warnings.push('الشكل متقاطع مع نفسه — دليل على وجود رقم مقروء خطأ في إحدى النقاط');
        } else if (result.wrongPoint >= 0) {
          result.isValid = false;
          result.warnings.push(`النقطة ${result.wrongPoint + 1} تبدو شاذة عن النمط الهندسي للموقع`);
        }

        if (result.expectedArea && result.expectedArea > 0) {
          const ratio = result.computedArea / result.expectedArea;
          const deviation = Math.abs(ratio - 1);
          if (deviation > 0.03) {
            result.isValid = false;
            result.warnings.push(`المساحة المحسوبة (${Math.round(result.computedArea).toLocaleString("ar", { numberingSystem: "latn" })} م²) تختلف عن المساحة المذكورة بالكروكي (${Math.round(result.expectedArea).toLocaleString("ar", { numberingSystem: "latn" })} م²)`);
          } else if (deviation > 0.01) {
            result.warnings.push(`فرق طفيف جداً في المساحة: المحسوبة ${Math.round(result.computedArea).toLocaleString("ar", { numberingSystem: "latn" })} م² مقابل ${Math.round(result.expectedArea).toLocaleString("ar", { numberingSystem: "latn" })} م² بالكروكي`);
          }
        }

        if (!result.isValid) {
          const target = (result.expectedArea && result.expectedArea > 0) ? result.expectedArea : null;
          const { fixes } = findAllCorrections(points, target);
          result.corrections = fixes;

          if (result.expectedArea && result.expectedArea > 0) {
            let workingArea = result.computedArea;
            if (fixes.length > 0) {
              const last = fixes[fixes.length - 1];
              workingArea = last.area;
            }
            const stillOff = Math.abs(workingArea / result.expectedArea - 1) > 0.03;
            if (stillOff || (fixes.length === 0 && result.isSelfIntersecting === false)) {
              result.warnings.push('تأكد من إدخال كافة النقاط بدون إسقاط أي زاوية من جدول الكروكي');
            }
          }
        }

        return result;
      }

      function utmInverse(E, N, zone, a, invF) {
        const f = 1 / invF,
          e2 = 2 * f - f * f,
          k0 = 0.9996;
        const lon0 = ((zone * 6 - 183) * Math.PI) / 180;
        const x = E - 500000,
          y = N;
        const M = y / k0;
        const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
        const mu =
          M /
          (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * Math.pow(e2, 3)) / 256));
        const phi1 =
          mu +
          ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
          ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) *
            Math.sin(4 * mu) +
          ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
          ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);
        const ep2 = e2 / (1 - e2);
        const C1 = ep2 * Math.pow(Math.cos(phi1), 2);
        const T1 = Math.pow(Math.tan(phi1), 2);
        const N1 = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(phi1), 2));
        const R1 =
          (a * (1 - e2)) / Math.pow(1 - e2 * Math.pow(Math.sin(phi1), 2), 1.5);
        const D = x / (N1 * k0);
        const lat =
          phi1 -
          ((N1 * Math.tan(phi1)) / R1) *
            ((D * D) / 2 -
              ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) *
                Math.pow(D, 4)) /
                24 +
              ((61 +
                90 * T1 +
                298 * C1 +
                45 * T1 * T1 -
                252 * ep2 -
                3 * C1 * C1) *
                Math.pow(D, 6)) /
                720);
        const lon =
          lon0 +
          (D -
            ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
            ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) *
              Math.pow(D, 5)) /
              120) /
            Math.cos(phi1);
        return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
      }

      function geodeticToGeocentric(lat, lon, a, e2) {
        const phi = (lat * Math.PI) / 180,
          lambda = (lon * Math.PI) / 180;
        const Nn = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(phi), 2));
        return [
          Nn * Math.cos(phi) * Math.cos(lambda),
          Nn * Math.cos(phi) * Math.sin(lambda),
          Nn * (1 - e2) * Math.sin(phi),
        ];
      }

      function geocentricToGeodetic(X, Y, Z, a, e2) {
        const lon = Math.atan2(Y, X);
        const p = Math.sqrt(X * X + Y * Y);
        let phi = Math.atan2(Z, p * (1 - e2));
        for (let i = 0; i < 5; i++) {
          const Nn = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(phi), 2));
          const h = p / Math.cos(phi) - Nn;
          phi = Math.atan2(Z, p * (1 - (e2 * Nn) / (Nn + h)));
        }
        return [(phi * 180) / Math.PI, (lon * 180) / Math.PI];
      }

      function helmert(X, Y, Z, dx, dy, dz, rx, ry, rz, ds) {
        const rxr = (rx * Math.PI) / (180 * 3600),
          ryr = (ry * Math.PI) / (180 * 3600),
          rzr = (rz * Math.PI) / (180 * 3600);
        const s = ds * 1e-6;
        return [
          dx + (1 + s) * (X - rzr * Y + ryr * Z),
          dy + (1 + s) * (rzr * X + Y - rxr * Z),
          dz + (1 + s) * (-ryr * X + rxr * Y + Z),
        ];
      }

      function convertToWGS84(E, N, zone, datum) {
        const CLARKE_A = 6378249.145,
          CLARKE_INVF = 293.465;
        const WGS_A = 6378137,
          WGS_F = 1 / 298.257223563,
          WGS_E2 = 2 * WGS_F - WGS_F * WGS_F;
        if (datum === "wgs84utm") {
          return utmInverse(E, N, zone, WGS_A, 298.257223563);
        }
        const geo = utmInverse(E, N, zone, CLARKE_A, CLARKE_INVF);
        const f = 1 / CLARKE_INVF,
          e2 = 2 * f - f * f;
        const xyz = geodeticToGeocentric(geo.lat, geo.lon, CLARKE_A, e2);
        const shifted = helmert(
          xyz[0],
          xyz[1],
          xyz[2],
          -180.624,
          -225.516,
          173.919,
          -0.81,
          -1.898,
          8.336,
          16.71006,
        );
        const out = geocentricToGeodetic(
          shifted[0],
          shifted[1],
          shifted[2],
          WGS_A,
          WGS_E2,
        );
        return { lat: out[0], lon: out[1] };
      }

      function qiblaVincenty(lat1, lon1, lat2, lon2) {
        const a = 6378137,
          f = 1 / 298.257223563,
          b = (1 - f) * a;
        const L = ((lon2 - lon1) * Math.PI) / 180;
        const U1 = Math.atan((1 - f) * Math.tan((lat1 * Math.PI) / 180));
        const U2 = Math.atan((1 - f) * Math.tan((lat2 * Math.PI) / 180));
        const sinU1 = Math.sin(U1),
          cosU1 = Math.cos(U1);
        const sinU2 = Math.sin(U2),
          cosU2 = Math.cos(U2);
        let lambda = L,
          lambdaP,
          iter = 100;
        let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
        do {
          const sinLambda = Math.sin(lambda),
            cosLambda = Math.cos(lambda);
          sinSigma = Math.sqrt(
            Math.pow(cosU2 * sinLambda, 2) +
              Math.pow(cosU1 * sinU2 - sinU1 * cosU2 * cosLambda, 2),
          );
          if (sinSigma === 0) return { bearing: 0, distanceKm: 0 };
          cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
          sigma = Math.atan2(sinSigma, cosSigma);
          sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
          cosSqAlpha = 1 - sinAlpha * sinAlpha;
          cos2SigmaM = cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
          if (isNaN(cos2SigmaM)) cos2SigmaM = 0;
          const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
          lambdaP = lambda;
          lambda =
            L +
            (1 - C) *
              f *
              sinAlpha *
              (sigma +
                C *
                  sinSigma *
                  (cos2SigmaM +
                    C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
        } while (Math.abs(lambda - lambdaP) > 1e-12 && --iter > 0);

        const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
        const A =
          1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
        const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
        const deltaSigma =
          B *
          sinSigma *
          (cos2SigmaM +
            (B / 4) *
              (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                (B / 6) *
                  cos2SigmaM *
                  (-3 + 4 * sinSigma * sinSigma) *
                  (-3 + 4 * cos2SigmaM * cos2SigmaM)));
        const dist = b * A * (sigma - deltaSigma);

        const alpha1 = Math.atan2(
          cosU2 * Math.sin(lambda),
          cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda),
        );
        const bearing = ((alpha1 * 180) / Math.PI + 360) % 360;
        return { bearing, distanceKm: dist / 1000 };
      }

      const errorBox = document.getElementById("errorBox");
      let mapInstance = null,
        markerInstance = null,
        lineInstance = null,
        satLayer = null,
        streetLayer = null,
        lastBearing = 0;

      (function buildTicks() {
        const g = document.getElementById("ticks");
        for (let deg = 0; deg < 360; deg += 30) {
          const rad = (deg * Math.PI) / 180;
          const x1 = 120 + 80 * Math.sin(rad),
            y1 = 120 - 80 * Math.cos(rad);
          const x2 = 120 + 90 * Math.sin(rad),
            y2 = 120 - 90 * Math.cos(rad);
          const line = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line",
          );
          line.setAttribute("x1", x1);
          line.setAttribute("y1", y1);
          line.setAttribute("x2", x2);
          line.setAttribute("y2", y2);
          line.setAttribute("stroke", "#dfb668");
          line.setAttribute("stroke-width", "1.5");
          line.setAttribute("opacity", "0.6");
          g.appendChild(line);
        }
      })();

      function updateCompassField() {
        const decl = parseFloat(document.getElementById("declination").value);
        const el = document.getElementById("compassBearing");
        if (isNaN(decl)) {
          el.value = "—";
          return;
        }
        const corrected = (lastBearing - decl + 360) % 360;
        el.value = corrected.toFixed(2) + "°";
      }
      document
        .getElementById("declination")
        .addEventListener("input", updateCompassField);

      function compassIcon() {
        const svg = `
  <svg width="110" height="110" viewBox="0 0 250 250" xmlns="http://www.w3.org/2000/svg">
    <circle cx="125" cy="125" r="95" fill="none" stroke="#1f3a8a" stroke-width="1" opacity="0.35"/>
    <circle cx="125" cy="125" r="13" fill="#0d1a42" stroke="#6c86e8" stroke-width="1.5"/>
    <circle cx="125.0" cy="35.0" r="2.2" fill="#1f3a8a"/><circle cx="142.56" cy="36.73" r="2.2" fill="#1f3a8a"/><circle cx="159.44" cy="41.85" r="2.2" fill="#1f3a8a"/><circle cx="175.0" cy="50.17" r="2.2" fill="#1f3a8a"/><circle cx="188.64" cy="61.36" r="2.2" fill="#1f3a8a"/><circle cx="199.83" cy="75.0" r="2.2" fill="#1f3a8a"/><circle cx="208.15" cy="90.56" r="2.2" fill="#1f3a8a"/><circle cx="213.27" cy="107.44" r="2.2" fill="#1f3a8a"/><circle cx="215.0" cy="125.0" r="2.2" fill="#1f3a8a"/><circle cx="213.27" cy="142.56" r="2.2" fill="#1f3a8a"/><circle cx="208.15" cy="159.44" r="2.2" fill="#1f3a8a"/><circle cx="199.83" cy="175.0" r="2.2" fill="#1f3a8a"/><circle cx="188.64" cy="188.64" r="2.2" fill="#1f3a8a"/><circle cx="175.0" cy="199.83" r="2.2" fill="#1f3a8a"/><circle cx="159.44" cy="208.15" r="2.2" fill="#1f3a8a"/><circle cx="142.56" cy="213.27" r="2.2" fill="#1f3a8a"/><circle cx="125.0" cy="215.0" r="2.2" fill="#1f3a8a"/><circle cx="107.44" cy="213.27" r="2.2" fill="#1f3a8a"/><circle cx="90.56" cy="208.15" r="2.2" fill="#1f3a8a"/><circle cx="75.0" cy="199.83" r="2.2" fill="#1f3a8a"/><circle cx="61.36" cy="188.64" r="2.2" fill="#1f3a8a"/><circle cx="50.17" cy="175.0" r="2.2" fill="#1f3a8a"/><circle cx="41.85" cy="159.44" r="2.2" fill="#1f3a8a"/><circle cx="36.73" cy="142.56" r="2.2" fill="#1f3a8a"/><circle cx="35.0" cy="125.0" r="2.2" fill="#1f3a8a"/><circle cx="36.73" cy="107.44" r="2.2" fill="#1f3a8a"/><circle cx="41.85" cy="90.56" r="2.2" fill="#1f3a8a"/><circle cx="50.17" cy="75.0" r="2.2" fill="#1f3a8a"/><circle cx="61.36" cy="61.36" r="2.2" fill="#1f3a8a"/><circle cx="75.0" cy="50.17" r="2.2" fill="#1f3a8a"/><circle cx="90.56" cy="41.85" r="2.2" fill="#1f3a8a"/><circle cx="107.44" cy="36.73" r="2.2" fill="#1f3a8a"/>
    <polygon points="125,125 120.03,112.99 125.0,45.0" fill="#14225c"/><polygon points="125,125 125.0,45.0 129.97,112.99" fill="#1f3a8a"/><polygon points="125,125 129.97,112.99 161.77,88.23" fill="#3f5fce"/><polygon points="125,125 161.77,88.23 137.01,120.03" fill="#6c86e8"/><polygon points="125,125 137.01,120.03 205.0,125.0" fill="#14225c"/><polygon points="125,125 205.0,125.0 137.01,129.97" fill="#1f3a8a"/><polygon points="125,125 137.01,129.97 161.77,161.77" fill="#3f5fce"/><polygon points="125,125 161.77,161.77 129.97,137.01" fill="#6c86e8"/><polygon points="125,125 129.97,137.01 125.0,205.0" fill="#14225c"/><polygon points="125,125 125.0,205.0 120.03,137.01" fill="#1f3a8a"/><polygon points="125,125 120.03,137.01 88.23,161.77" fill="#3f5fce"/><polygon points="125,125 88.23,161.77 112.99,129.97" fill="#6c86e8"/><polygon points="125,125 112.99,129.97 45.0,125.0" fill="#14225c"/><polygon points="125,125 45.0,125.0 112.99,120.03" fill="#1f3a8a"/><polygon points="125,125 112.99,120.03 88.23,88.23" fill="#3f5fce"/><polygon points="125,125 88.23,88.23 120.03,112.99" fill="#6c86e8"/>
    <line x1="35.0" y1="125.0" x2="215.0" y2="125.0" stroke="#2f5fe0" stroke-width="2.4" opacity="0.9"/>
    <polygon points="209.0,120.0 222.0,125.0 209.0,130.0" fill="#2f5fe0"/>
    <circle cx="125" cy="125" r="6" fill="#dfb668"/>
    <text x="125.0" y="19.0" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="700" fill="#101828" font-family="Arial, sans-serif">N</text>
    <text x="231.0" y="125.0" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="700" fill="#101828" font-family="Arial, sans-serif">E</text>
    <text x="125.0" y="231.0" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="700" fill="#101828" font-family="Arial, sans-serif">S</text>
    <text x="19.0" y="125.0" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="700" fill="#101828" font-family="Arial, sans-serif">W</text>
  </svg>`;
        return L.divIcon({
          html: svg,
          className: "",
          iconSize: [110, 110],
          iconAnchor: [55, 55],
        });
      }

      function kaabaIcon() {
        const svg = `
  <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="kaabaBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#20242b"/>
        <stop offset="100%" stop-color="#0a0c0f"/>
      </linearGradient>
      <filter id="kaabaGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="#dfb668" flood-opacity="0.55"/>
      </filter>
    </defs>
    <circle cx="14" cy="14" r="13" fill="#0b0d12" fill-opacity="0.35"/>
    <g filter="url(#kaabaGlow)">
      <rect x="7" y="8" width="14" height="14" rx="1" fill="url(#kaabaBody)" stroke="#dfb668" stroke-width="1"/>
      <rect x="7" y="12.5" width="14" height="3.2" fill="#dfb668"/>
      <rect x="7" y="12.5" width="14" height="3.2" fill="none" stroke="#8a6a2d" stroke-width="0.4"/>
      <line x1="13.2" y1="8" x2="13.2" y2="22" stroke="#dfb668" stroke-width="0.5" opacity="0.6"/>
    </g>
  </svg>`;
        return L.divIcon({
          html: svg,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
      }

      function greatCirclePoints(lat1, lon1, lat2, lon2, n) {
        const toRad = (d) => (d * Math.PI) / 180,
          toDeg = (r) => (r * 180) / Math.PI;
        const p1 = [
          Math.cos(toRad(lat1)) * Math.cos(toRad(lon1)),
          Math.cos(toRad(lat1)) * Math.sin(toRad(lon1)),
          Math.sin(toRad(lat1)),
        ];
        const p2 = [
          Math.cos(toRad(lat2)) * Math.cos(toRad(lon2)),
          Math.cos(toRad(lat2)) * Math.sin(toRad(lon2)),
          Math.sin(toRad(lat2)),
        ];
        const dot = Math.max(
          -1,
          Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2]),
        );
        const omega = Math.acos(dot);
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          let A, B;
          if (omega === 0) {
            A = 1 - t;
            B = t;
          } else {
            A = Math.sin((1 - t) * omega) / Math.sin(omega);
            B = Math.sin(t * omega) / Math.sin(omega);
          }
          const x = A * p1[0] + B * p2[0],
            y = A * p1[1] + B * p2[1],
            z = A * p1[2] + B * p2[2];
          pts.push([
            toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
            toDeg(Math.atan2(y, x)),
          ]);
        }
        return pts;
      }

      function updateQibla(lat, lon) {
        const q = qiblaVincenty(lat, lon, KAABA.lat, KAABA.lon);
        lastBearing = q.bearing;
        document.getElementById("outLat").textContent = lat.toFixed(5) + "°";
        document.getElementById("outLon").textContent = lon.toFixed(5) + "°";
        document.getElementById("outBearing").textContent =
          q.bearing.toFixed(2) + "°";
        document.getElementById("outDist").textContent =
          Math.round(q.distanceKm).toLocaleString("ar", { numberingSystem: "latn" }) + " كم";
        document.getElementById("tagBearing").textContent =
          q.bearing.toFixed(2) + "° من الشمال";
        const heroBearingEl = document.getElementById("heroBearing");
        if (heroBearingEl) heroBearingEl.textContent = q.bearing.toFixed(2) + "° من الشمال";

        const siteDMS = document.getElementById("siteCoordsDMS");
        if (siteDMS) {
          siteDMS.textContent =
            toDMS(lat, "N", "S") + ",  " + toDMS(lon, "E", "W");
        }

        const bearingDMSEl = document.getElementById("bearingDMS");
        if (bearingDMSEl) {
          const bearingRounded = parseFloat(q.bearing.toFixed(2));
          const bearingDMSStr = toDMSWhole(bearingRounded, "N", "N").replace(/ [NS]$/, "");
          const ccw = (360 - q.bearing) % 360;
          bearingDMSEl.textContent =
            bearingDMSStr + " N CW = " + ccw.toFixed(2) + "°";
        }
        document
          .getElementById("needle")
          .setAttribute(
            "transform",
            "rotate(" + q.bearing.toFixed(2) + ",120,120)",
          );
        updateCompassField();

        const path = greatCirclePoints(lat, lon, KAABA.lat, KAABA.lon, 150);
        if (lineInstance) {
          mapInstance.removeLayer(lineInstance);
        }
        lineInstance = L.polyline(path, {
          color: "#f45b5b",
          weight: 4,
          opacity: 0.9,
        }).addTo(mapInstance);
      }

      let governorateAutoFillEnabled = true;
      document.getElementById("governorateInput").addEventListener("input", () => {
        governorateAutoFillEnabled = false;
      });

      // يستدل على المحافظة والولاية من إحداثيات الموقع عبر خدمة Nominatim (OpenStreetMap)
      // ويملأ الحقل تلقائياً، دون الكتابة فوق أي تعديل يدوي أدخله المستخدم على الحقل.
      async function reverseGeocodeGovernorate(lat, lon) {
        if (!governorateAutoFillEnabled) return;
        const input = document.getElementById("governorateInput");
        if (!input) return;
        try {
          const url =
            "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" +
            lat +
            "&lon=" +
            lon +
            "&accept-language=ar&addressdetails=1";
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) return;
          const data = await res.json();
          const addr = data.address || {};
          const governorateName = addr.state || "";
          const wilayatName =
            addr.state_district ||
            addr.county ||
            addr.municipality ||
            addr.city ||
            addr.town ||
            addr.district ||
            addr.village ||
            addr.suburb ||
            addr.region ||
            "";
          const combined = [governorateName, wilayatName].filter(Boolean).join(" - ");
          let finalValue = combined;
          if (!wilayatName && governorateName && data.display_name) {
            const parts = data.display_name.split(",").map((s) => s.trim()).filter(Boolean);
            const idx = parts.findIndex((p) => p.includes(governorateName));
            if (idx > 0) finalValue = governorateName + " - " + parts[idx - 1];
          }
          if (finalValue && governorateAutoFillEnabled) {
            input.value = finalValue;
          }
        } catch (e) {
          // نتجاهل بصمت أي خطأ في الشبكة أو الاستعلام؛ يبقى الحقل قابلاً للتعبئة يدوياً
        }
      }

      function parsePoints() {
        const raw = document.getElementById("pointsInput").value.trim();
        if (!raw) return [];
        return raw
          .split("\n")
          .map((line) => {
            let parts = line.split(",").map((s) => parseFloat(s.trim()));
            if (!(parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]))) {
              parts = line.trim().split(/\s+/).map(Number);
            }
            return parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])
              ? [parts[0], parts[1]]
              : null;
          })
          .filter(Boolean);
      }

      let polygonInstance = null;

      document.getElementById("computeBtn").addEventListener("click", () => {
        errorBox.classList.remove("show");
        const rawPoints = parsePoints();
        const zone = parseInt(document.getElementById("zone").value) || 40;
        const datum = document.getElementById("datum").value;
        if (rawPoints.length === 0) {
          alert("يرجى إدخال نقطة واحدة على الأقل بصيغة Easting, Northing");
          return;
        }

        const wgsPoints = rawPoints.map(([E, N]) =>
          convertToWGS84(E, N, zone, datum),
        );
        const centroid = {
          lat: wgsPoints.reduce((s, p) => s + p.lat, 0) / wgsPoints.length,
          lon: wgsPoints.reduce((s, p) => s + p.lon, 0) / wgsPoints.length,
        };

        const [firstE, firstN] = rawPoints[0];
        document.getElementById("surveyCoords").textContent =
          "Easting " + firstE.toFixed(2) + "   Northing " + firstN.toFixed(2);

        const ocrText = document.getElementById("ocrText").value || "";
        const validation = validateAndCorrect(rawPoints, ocrText);
        const valPanel = document.getElementById("validationPanel");
        const valSuccess = document.getElementById("validationSuccess");
        const valWarnings = document.getElementById("validationWarnings");
        const valCorrections = document.getElementById("validationCorrections");

        document.getElementById("computedArea").textContent = Math.round(validation.computedArea).toLocaleString("ar", { numberingSystem: "latn" });
        document.getElementById("expectedArea").textContent = validation.expectedArea ? Math.round(validation.expectedArea).toLocaleString("ar", { numberingSystem: "latn" }) : "—";

        const outAreaEl = document.getElementById("outArea");
        if (outAreaEl) {
          if (rawPoints.length >= 3) {
            outAreaEl.textContent =
              Math.round(validation.computedArea).toLocaleString("ar", { numberingSystem: "latn" }) + " م²";
          } else {
            outAreaEl.textContent = "— (يلزم 3 نقاط على الأقل)";
          }
        }

        if (validation.warnings.length > 0) {
          valPanel.classList.remove("hidden");
          valSuccess.classList.add("hidden");
          valWarnings.innerHTML = validation.warnings.map(w => "• " + w).join("<br>");

          if (validation.corrections && validation.corrections.length > 0) {
            const rows = validation.corrections.map((c) => {
              const coordName = c.coordIdx === 0 ? "Easting" : "Northing";
              return `
                <div style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; margin-bottom: 8px;">
                  النقطة ${c.pointIdx + 1} — ${coordName}:
                  <span style="color: var(--red); text-decoration: line-through;">${c.from}</span>
                  →
                  <span style="color: var(--green); font-weight: 600;">${c.to}</span>
                </div>`;
            }).join("");
            const lastFix = validation.corrections[validation.corrections.length - 1];
            valCorrections.innerHTML = `
              <div style="margin-top: 10px; padding: 12px; background: rgba(10, 17, 30, 0.7); border-radius: 8px; border: 1px solid var(--card-border);">
                <div style="font-size: 13px; color: var(--gold-light); margin-bottom: 8px; font-weight: 600;">
                  🎯 ${validation.corrections.length > 1 ? "التصحيحات المقترحة" : "التصحيح المقترح"}:
                </div>
                ${rows}
                <div style="font-size: 12.5px; color: var(--muted); margin-top: 6px;">
                  المساحة بعد التصحيح: ${Math.round(lastFix.area).toLocaleString("ar", { numberingSystem: "latn" })} م²
                  ${lastFix.isIntersect ? '<br><span style="color: var(--red);">⚠️ الشكل لا يزال متقاطعاً</span>' : '<br><span style="color: var(--green);">✓ الشكل صحيح تماماً</span>'}
                </div>
                <button id="applyCorrection" class="primary" style="margin-top: 12px; font-size: 13px; padding: 10px 20px; width: auto;">
                  ${validation.corrections.length > 1 ? "تطبيق كل التصحيحات وإعادة الحساب" : "تطبيق التصحيح وإعادة الحساب"}
                </button>
              </div>
            `;
            document.getElementById("applyCorrection").onclick = () => {
              const lines = document.getElementById("pointsInput").value.trim().split("\n");
              for (const c of validation.corrections) {
                if (!lines[c.pointIdx]) continue;
                const parts = lines[c.pointIdx].split(",").map(s => s.trim());
                parts[c.coordIdx] = c.value.toFixed(2);
                lines[c.pointIdx] = parts.join(", ");
              }
              document.getElementById("pointsInput").value = lines.join("\n");
              document.getElementById("computeBtn").click();
            };
          } else {
            valCorrections.innerHTML = '';
          }
        } else if (validation.expectedArea) {
          valPanel.classList.add("hidden");
          valSuccess.classList.remove("hidden");
        } else {
          valPanel.classList.add("hidden");
          valSuccess.classList.add("hidden");
        }

        const resultPanelEl = document.getElementById("resultPanel");
        resultPanelEl.classList.remove("hidden");
        resultPanelEl.classList.remove("in");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resultPanelEl.classList.add("in"));
        });
        resultPanelEl.scrollIntoView({ behavior: "smooth" });

        try {
          if (mapInstance) {
            mapInstance.remove();
            mapInstance = null;
          }

          const HARD_MAX_ZOOM = 19;
          let satMaxUsableZoom = HARD_MAX_ZOOM;
          let autoAdjusting = false;
          // نسمح لدالة تصدير الصورة (تقرير Word) بمعرفة أقصى تكبير صالح للأقمار الصناعية
          window.__qiblaMaxUsableZoom = satMaxUsableZoom;

          function tileLooksLikePlaceholder(imgEl) {
            try {
              const c = document.createElement("canvas");
              c.width = 8; c.height = 8;
              const ctx = c.getContext("2d");
              ctx.drawImage(imgEl, 0, 0, 8, 8);
              const data = ctx.getImageData(0, 0, 8, 8).data;
              let grayish = 0;
              const samples = data.length / 4;
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
                const isNeutral = (maxC - minC) < 12;
                const isLightish = r > 150 && r < 245;
                if (isNeutral && isLightish) grayish++;
              }
              return grayish / samples > 0.8;
            } catch (e) {
              return false;
            }
          }

          mapInstance = L.map("map", {
            zoomControl: true,
            maxZoom: HARD_MAX_ZOOM,
            minZoom: 3,
            preferCanvas: true,
          }).setView(
            [centroid.lat, centroid.lon],
            18,
          );

          const satellite = L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
              attribution: "Esri World Imagery",
              maxZoom: HARD_MAX_ZOOM,
              minZoom: 3,
              crossOrigin: true,
            },
          );
          satellite.on("tileload", (e) => {
            if (autoAdjusting) return;
            const z = mapInstance.getZoom();
            if (z <= satMaxUsableZoom - 1) return;
            if (tileLooksLikePlaceholder(e.tile)) {
              satMaxUsableZoom = Math.min(satMaxUsableZoom, z - 1);
              if (satMaxUsableZoom < 3) satMaxUsableZoom = 3;
              window.__qiblaMaxUsableZoom = satMaxUsableZoom;
              autoAdjusting = true;
              mapInstance.setZoom(satMaxUsableZoom);
              const note = document.getElementById("zoomNote");
              if (note) {
                note.textContent = "تم ضبط مستوى التكبير تلقائياً للحفاظ على وضوح الدقة المتاحة للموقع.";
                note.style.display = "block";
                clearTimeout(note._t);
                note._t = setTimeout(() => { note.style.display = "none"; }, 4000);
              }
              setTimeout(() => { autoAdjusting = false; }, 300);
            }
          });
          mapInstance.on("zoomend", () => {
            const z = mapInstance.getZoom();
            if (!autoAdjusting && z > satMaxUsableZoom && mapInstance.hasLayer(satellite)) {
              autoAdjusting = true;
              mapInstance.setZoom(satMaxUsableZoom);
              setTimeout(() => { autoAdjusting = false; }, 300);
            }
          });

          const streets = L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
              attribution: "OpenStreetMap contributors",
              maxZoom: HARD_MAX_ZOOM,
              minZoom: 3,
            },
          );
          satLayer = satellite;
          streetLayer = streets;
          satellite.addTo(mapInstance);

          L.marker([KAABA.lat, KAABA.lon], {
            icon: kaabaIcon(),
          })
            .addTo(mapInstance)
            .bindTooltip("الكعبة المشرفة", {
              permanent: false,
              direction: "top",
            });

          if (wgsPoints.length >= 3) {
            polygonInstance = L.polygon(
              wgsPoints.map((p) => [p.lat, p.lon]),
              {
                color: "#dfb668",
                weight: 2,
                fillColor: "#dfb668",
                fillOpacity: 0.2,
              },
            ).addTo(mapInstance);
          }

          markerInstance = L.marker([centroid.lat, centroid.lon], {
            icon: compassIcon(),
            draggable: true,
          }).addTo(mapInstance);
          markerInstance.on("drag", (e) => {
            const p = e.target.getLatLng();
            updateQibla(p.lat, p.lng);
          });
          markerInstance.on("dragend", (e) => {
            const p = e.target.getLatLng();
            updateQibla(p.lat, p.lng);
            reverseGeocodeGovernorate(p.lat, p.lng);
          });

          updateQibla(centroid.lat, centroid.lon);
          reverseGeocodeGovernorate(centroid.lat, centroid.lon);
          setTimeout(() => {
            if (mapInstance) mapInstance.invalidateSize();
          }, 150);

          document.getElementById("fitBtn").onclick = () => {
            if (lineInstance)
              mapInstance.fitBounds(lineInstance.getBounds(), {
                padding: [30, 30],
              });
          };
          document.getElementById("closeBtn").onclick = () => {
            const p = markerInstance.getLatLng();
            mapInstance.setView([p.lat, p.lng], Math.min(18, satMaxUsableZoom));
          };
          document.getElementById("satBtn").onclick = () => {
            if (!mapInstance.hasLayer(satLayer)) satLayer.addTo(mapInstance);
            if (mapInstance.hasLayer(streetLayer))
              mapInstance.removeLayer(streetLayer);
            document.getElementById("satBtn").classList.add("active");
            document.getElementById("mapBtn").classList.remove("active");
          };
          document.getElementById("mapBtn").onclick = () => {
            if (!mapInstance.hasLayer(streetLayer))
              streetLayer.addTo(mapInstance);
            if (mapInstance.hasLayer(satLayer))
              mapInstance.removeLayer(satLayer);
            document.getElementById("mapBtn").classList.add("active");
            document.getElementById("satBtn").classList.remove("active");
          };

        } catch (mapErr) {
          errorBox.textContent =
            "تعذّر تحميل الخريطة. يرجى التحقق من الاتصال بالإنترنت، مع العلم أن نتائج الحساب الرقمية تظل صحيحة كلياً.";
          errorBox.classList.add("show");
        }
      });
