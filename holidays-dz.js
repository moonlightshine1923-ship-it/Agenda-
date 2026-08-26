/* =========================================================
   Jours fériés officiels en Algérie
   - Fêtes civiles : dates fixes du calendrier grégorien
   - Fêtes religieuses : calculées via le calendrier hégirien
     (algorithme tabulaire — précision ±1 jour, sous réserve
     de l'observation de la lune / annonce officielle)
   ========================================================= */

/* ---- Conversion Hégirien -> Grégorien (calendrier tabulaire) ---- */
function hijriToJulianDay(hy, hm, hd) {
  return Math.floor((11 * hy + 3) / 30) + 354 * hy + 30 * hm -
    Math.floor((hm - 1) / 2) + hd + 1948440 - 385;
}

function julianDayToGregorian(jd) {
  let a = jd + 32044;
  let b = Math.floor((4 * a + 3) / 146097);
  let c = a - Math.floor((146097 * b) / 4);
  let d = Math.floor((4 * c + 3) / 1461);
  let e = c - Math.floor((1461 * d) / 4);
  let m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

function hijriToGregorian(hy, hm, hd) {
  return julianDayToGregorian(hijriToJulianDay(hy, hm, hd));
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (g) => `${g.year}-${pad(g.month)}-${pad(g.day)}`;

/* ---- Fêtes religieuses (mois/jour hégiriens) ---- */
const RELIGIOUS = [
  { hm: 1,  hd: 1,  name: 'Awal Mouharram (Nouvel an hégirien)' },
  { hm: 1,  hd: 10, name: 'Achoura' },
  { hm: 3,  hd: 12, name: 'Mawlid Ennabaoui' },
  { hm: 10, hd: 1,  name: 'Aïd el-Fitr (1er jour)' },
  { hm: 10, hd: 2,  name: 'Aïd el-Fitr (2e jour)' },
  { hm: 12, hd: 10, name: 'Aïd el-Adha (1er jour)' },
  { hm: 12, hd: 11, name: 'Aïd el-Adha (2e jour)' }
];

/* ---- Fêtes civiles (dates fixes) ---- */
const CIVIL = [
  { m: 1,  d: 1,  name: 'Nouvel an' },
  { m: 1,  d: 12, name: 'Yennayer (Nouvel an amazigh)' },
  { m: 5,  d: 1,  name: 'Fête du Travail' },
  { m: 7,  d: 5,  name: "Fête de l'Indépendance" },
  { m: 11, d: 1,  name: 'Fête de la Révolution' }
];

/**
 * Retourne tous les jours fériés algériens d'une année grégorienne.
 * [{ date:'YYYY-MM-DD', name, type:'civil'|'religieux' }]
 */
function getAlgerianHolidays(year) {
  const list = [];

  // Fêtes civiles
  for (const f of CIVIL) {
    list.push({ date: `${year}-${pad(f.m)}-${pad(f.d)}`, name: f.name, type: 'civil' });
  }

  // Fêtes religieuses : les années hégiriennes pouvant chevaucher l'année grégorienne
  const approxHy = Math.floor((year - 622) * (33 / 32));
  for (let hy = approxHy - 1; hy <= approxHy + 2; hy++) {
    for (const f of RELIGIOUS) {
      const g = hijriToGregorian(hy, f.hm, f.hd);
      if (g.year === year) {
        list.push({ date: iso(g), name: f.name, type: 'religieux' });
      }
    }
  }

  list.sort((a, b) => a.date.localeCompare(b.date));
  return list;
}

module.exports = { getAlgerianHolidays };
