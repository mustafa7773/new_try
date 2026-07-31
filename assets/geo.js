// ============================================================================
// تحويل إحداثيات UTM إلى WGS84 (خطوط الطول والعرض)
// منسوخة حرفياً من assets/app.js الخاصة بأداة القبلة، لضمان أن الأداتين
// تستخدمان نفس منطق التحويل تماماً بلا أي اختلاف في النتائج.
// ============================================================================

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
