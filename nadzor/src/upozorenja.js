// Upozorenja mailom: od stanja u bazi i servisa fisk-racun sastavlja popis upozorenja.
// Šalje ih provjeriUpozorenja u index.js; ovdje nema mreže, pa se lako testira.

export const DOMENA_NADZORA = "https://nadzor.digitalnipartner.hr";
const DAN = 864e5;

// Razredi paušalnog oporezivanja od 2024.: [gornja granica primitaka, godišnji paušalni dohodak], u eurima.
// Isti su na ekranu Knjige (stranica.html).
export const RAZREDI = [[11300, 1695], [15300, 2295], [19900, 2985], [30600, 4590], [40000, 6000], [50000, 7500], [60000, 9000]];
export const LIMIT_PAUSALA = 60000;
const BLIZU_LIMITA = 54000;

function eur(n) {
  return Math.round(n).toLocaleString("hr-HR") + " €";
}

// Sve obavijesti koje nadzor šalje mailom, za ekran Obavijesti. Redoslijed je redoslijed prikaza.
// kljuc je početak ključa u tablici obavijesti (satna upozorenja); upit i izvod šalju se odmah i ne bilježe.
// uvjet: što mora biti postavljeno da obavijest radi (mail, iban, fisk).
export const POPIS_OBAVIJESTI = [
  { naziv: "Novi upit s weba", kada: "Odmah kad netko pošalje obrazac na digitalnipartner.hr.", ucestalost: "Za svaki upit", uvjet: "mail" },
  { naziv: "Izvod iz banke nije uvezen", kada: "Odmah kad stigne mail s izvodom koji se ne može uvesti (nema XML privitka, tuđi IBAN, neispravna datoteka).", ucestalost: "Za svaki takav mail", uvjet: "mail" },
  { naziv: "Račun čeka JIR", kljuc: "ceka-jir", kada: "Fiskalizirani račun nema JIR dulje od 2 sata.", ucestalost: "Jednom po računu", uvjet: "mail" },
  { naziv: "Porezna odbila račun", kljuc: "odbijen", kada: "Porezna je vratila grešku za račun (zadnjih 14 dana).", ucestalost: "Jednom po računu", uvjet: "mail" },
  { naziv: "Izvod se ne slaže", kljuc: "izvod-neuskladen", kada: "Ručno uvezen izvod u kojem početno stanje i promet ne daju završno (zadnja 3 dana).", ucestalost: "Jednom po izvodu", uvjet: "mail" },
  { naziv: "Izvod kasni", kljuc: "izvod-kasni", kada: "Za račun nema novog izvoda 3 radna dana.", ucestalost: "Jednom po zadnjem izvodu", uvjet: "iban" },
  { naziv: "Prikupljanje nije uspjelo", kljuc: "prikupljanje", kada: "Jutarnje prikupljanje podataka (6:00) završilo je greškom.", ucestalost: "Jednom po grešci", uvjet: "mail" },
  { naziv: "Servis za račune ne odgovara", kljuc: "fisk-nedostupan", kada: "fisk-racun ne odgovara na satnu provjeru.", ucestalost: "Najviše jednom dnevno", uvjet: "fisk" },
  { naziv: "FINA certifikat istječe", kljuc: "certifikat", kada: "30 dana i 7 dana prije isteka, te na dan isteka.", ucestalost: "Jednom po pragu", uvjet: "fisk" },
  { naziv: "Novi razred paušala", kljuc: "razred", kada: "Primici ove godine prijeđu granicu razreda (11.300 €, 15.300 €, 19.900 €, 30.600 €, 40.000 €, 50.000 €).", ucestalost: "Jednom po razredu u godini", uvjet: "mail" },
  { naziv: "Blizu limita paušala", kljuc: "limit-blizu", kada: "Primici ove godine prijeđu 54.000 € (90 % limita od 60.000 €).", ucestalost: "Jednom u godini", uvjet: "mail" },
  { naziv: "Limit paušala prijeđen", kljuc: "limit", kada: "Primici ove godine prijeđu 60.000 €.", ucestalost: "Jednom u godini", uvjet: "mail" },
];

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
  const p = stanje.primici;
  if (p && p.godina && Number(p.centi) > 0) {
    const eura = Number(p.centi) / 100;
    const i = RAZREDI.findIndex(([granica]) => eura <= granica);
    if (i > 0) {
      const [granica, dohodak] = RAZREDI[i];
      u.push({ kljuc: "razred:" + p.godina + ":" + (i + 1), tekst: "Primici u " + p.godina + ". su " + eur(eura) + ", više od " + eur(RAZREDI[i - 1][0]) + ". To je " + (i + 1) + ". razred paušala (primici do " + eur(granica) + ", godišnji paušalni dohodak " + eur(dohodak) + "). Ako je prijavljen niži razred, kod PO-SD-a bit će razlike poreza za doplatu.", ekran: "knjige" });
    }
    if (eura > LIMIT_PAUSALA) {
      u.push({ kljuc: "limit:" + p.godina, tekst: "Primici u " + p.godina + ". su " + eur(eura) + ", više od limita paušalnog obrta (" + eur(LIMIT_PAUSALA) + "). Javi se knjigovođi zbog prelaska na drugi način oporezivanja.", ekran: "knjige" });
    } else if (eura > BLIZU_LIMITA) {
      u.push({ kljuc: "limit-blizu:" + p.godina, tekst: "Primici u " + p.godina + ". su " + eur(eura) + ". Do limita paušalnog obrta (" + eur(LIMIT_PAUSALA) + ") ostalo je " + eur(LIMIT_PAUSALA - eura) + ".", ekran: "knjige" });
    }
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
