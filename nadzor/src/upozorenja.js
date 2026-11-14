// Upozorenja mailom: od stanja u bazi i servisa fisk-racun sastavlja popis upozorenja.
// Šalje ih provjeriUpozorenja u index.js; ovdje nema mreže, pa se lako testira.

export const DOMENA_NADZORA = "https://nadzor.digitalnipartner.hr";
const DAN = 864e5;

function hrDatum(d) {
  const [g, m, dan] = String(d).slice(0, 10).split("-");
  return Number(dan) + ". " + Number(m) + ". " + g + ".";
}

function hrVrijeme(t) {
  return new Date(t).toLocaleString("hr-HR", { timeZone: "Europe/Zagreb", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Radni dani između dva datuma (bez vikenda), za provjeru kasni li izvod iz banke.
function radnihDana(od, doDatuma) {
  let n = 0;
  for (let t = new Date(od + "T12:00:00Z").getTime() + DAN; t <= new Date(doDatuma + "T12:00:00Z").getTime(); t += DAN) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// Pretvara stanje iz baze i servisa fisk-racun u popis upozorenja { kljuc, tekst }.
// Ključ je jedinstven po događaju, pa isto upozorenje stiže samo jednom.
export function sastaviUpozorenja(stanje, zdravlje, danas, sada = Date.now()) {
  const u = [];
  for (const r of stanje.ceka_jir || []) {
    const sati = Math.round((sada - new Date(r.izdan).getTime()) / 36e5);
    u.push({ kljuc: "ceka-jir:" + r.id, tekst: "Račun " + r.oznaka + (r.okolina === "test" ? " (test)" : "") + " čeka JIR već " + sati + " h. Ponovno slanje ide samo, ali provjeri ekran Računi.", ekran: "racuni" });
  }
  for (const r of stanje.odbijeni || []) {
    u.push({ kljuc: "odbijen:" + r.id, tekst: "Porezna je odbila račun " + r.oznaka + (r.okolina === "test" ? " (test)" : "") + ", izdan " + hrVrijeme(r.izdan) + ". Treba ga pogledati ručno.", ekran: "racuni" });
  }
  for (const i of stanje.neuskladeni || []) {
    u.push({ kljuc: "izvod-neuskladen:" + i.id, tekst: "Izvod " + i.oznaka + " za " + i.iban + " (" + hrDatum(i.datum) + ") se ne slaže: početno stanje i promet ne daju završno.", ekran: "banka" });
  }
  for (const z of stanje.zadnji_izvodi || []) {
    const kasni = radnihDana(z.datum, danas);
    if (kasni >= 3) u.push({ kljuc: "izvod-kasni:" + z.iban + ":" + z.datum, tekst: "Za račun " + z.iban + " zadnji izvod je od " + hrDatum(z.datum) + " (" + kasni + " radna dana bez novog). Provjeri stiže li mail iz banke.", ekran: "banka" });
  }
  for (const g of stanje.greske_prikupljanja || []) {
    u.push({ kljuc: "prikupljanje:" + g.izvor + ":" + g.vrijeme, tekst: "Prikupljanje „" + g.izvor + "” nije uspjelo (" + hrVrijeme(g.vrijeme) + "): " + String(g.poruka || "").slice(0, 300), ekran: "pregled" });
  }
  if (zdravlje && zdravlje.greska) {
    u.push({ kljuc: "fisk-nedostupan:" + danas, tekst: "Servis za račune (fisk-racun) ne odgovara: " + zdravlje.greska, ekran: "racuni" });
  } else if (zdravlje && zdravlje.certifikatVrijediDo) {
    const dana = Math.floor((new Date(zdravlje.certifikatVrijediDo).getTime() - sada) / DAN);
    const prag = [0, 7, 30].find((p) => dana <= p);
    if (prag !== undefined) {
      const kada = dana < 0 ? "je istekao " : "istječe za " + dana + (dana === 1 ? " dan, " : " dana, ");
      u.push({ kljuc: "certifikat:" + zdravlje.certifikatVrijediDo.slice(0, 10) + ":" + prag, tekst: "FINA certifikat za fiskalizaciju (" + zdravlje.okolina + ") " + kada + hrDatum(zdravlje.certifikatVrijediDo) + ". Novi se traži kod FINA-e, a onda mijenja u tajnama funkcije fisk-racun.", ekran: "racuni" });
    }
  }
  return u;
}
