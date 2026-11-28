import test from "node:test";
import assert from "node:assert/strict";
import { ocijeni, ocijeniOglas, postavke, sastaviMail, jeCestitka } from "../src/oglasi.js";

const p = postavke({});

test("zadani pragovi", () => {
  assert.deepEqual(p, { dobar: 3, slab: 5, bezRegistracije: 6, frekvencija: 3, budzetKuverta: 30, budzetCestitka: 20 });
  assert.equal(postavke({ META_PRAG_DOBAR: "2.5", META_BUDZET_KUVERTA: "" }).dobar, 2.5);
  assert.equal(postavke({ META_BUDZET_KUVERTA: "" }).budzetKuverta, 30);
});

test("ocjena oglasa", () => {
  assert.equal(ocijeniOglas({ potrosnja: 6, registracije: 3, frekvencija: 1.2 }, p).stanje, "dobar");
  assert.equal(ocijeniOglas({ potrosnja: 12, registracije: 3, frekvencija: 1.2 }, p).stanje, "slab");
  assert.equal(ocijeniOglas({ potrosnja: 16, registracije: 3, frekvencija: 1.2 }, p).stanje, "prijedlog_pauza");
  assert.equal(ocijeniOglas({ potrosnja: 5.99, registracije: 0, frekvencija: 1.2 }, p).stanje, "malo_podataka");
  assert.equal(ocijeniOglas({ potrosnja: 6, registracije: 0, frekvencija: 1.2 }, p).stanje, "prijedlog_pauza");
  const f = ocijeniOglas({ potrosnja: 3, registracije: 5, frekvencija: 3.4 }, p);
  assert.equal(f.stanje, "prijedlog_pauza");
  assert.match(f.razlog, /Frekvencija 3\.4/);
});

test("samo aktivni oglasi, čestitka bez pravila", () => {
  const redovi = [
    { ad_id: "1", ad_name: "A", campaign_name: "Kuverta", proizvod: "kuverta", spend: 20, frequency: 1.5 },
    { ad_id: "2", ad_name: "B", campaign_name: "Božićna čestitka", proizvod: "cestitka", spend: 20, frequency: 1.5 },
    { ad_id: "3", ad_name: "C", campaign_name: "Kuverta", proizvod: "kuverta", spend: 20, frequency: 1.5 },
  ];
  const s = ocijeni(redovi, new Set(["1", "2"]), { 1: { registracije: 10 } }, p, "2026-11-28");
  assert.equal(s.length, 2);
  assert.equal(s[0].stanje, "dobar");
  assert.equal(s[0].registracije_7, 10);
  assert.equal(s[1].stanje, "samo_izvjestaj");
});

test("prepoznaje čestitku", () => {
  assert.ok(jeCestitka({}, "Božićna čestitka"));
  assert.ok(!jeCestitka({}, "Kuverta Black Week"));
});

test("mail s poveznicom i upozorenjem o budžetu", () => {
  const stanja = [
    { ad_id: "1", ad_name: "Reel QR", proizvod: "kuverta", potrosnja_7: 9, registracije_7: 0, stanje: "prijedlog_pauza", razlog: "Potrošeno 9,00 € bez ijedne registracije." },
    { ad_id: "2", ad_name: "Čestitka 1", proizvod: "cestitka", potrosnja_7: 40, registracije_7: 0, stanje: "samo_izvjestaj", razlog: "x" },
  ];
  const m = sastaviMail({ stanja, jucer: { kuverta: 35, cestitka: 19 }, p, prijedlozi: [{ id: "abc", ad_id: "1" }], domena: "https://n", datumJucer: "27. 11. 2026." });
  assert.match(m.naslov, /1 prijedlog za pauzu/);
  assert.match(m.tekst, /https:\/\/n\/meta\/odobri\?id=abc/);
  assert.match(m.tekst, /UPOZORENJE: Kuverta je potrošila 35,00 €/);
  assert.doesNotMatch(m.tekst, /Čestitka je potrošila/);
});

import { dnevniBudzet, spojiNase } from "../src/oglasi.js";

test("dnevni budžet: CBO kampanja ili zbroj aktivnih skupova", () => {
  const k = [{ id: "1", proizvod: "kuverta", status: "ACTIVE", daily_budget: "2000" }, { id: "2", proizvod: "kuverta", status: "PAUSED" }, { id: "3", proizvod: "cestitka", status: "ACTIVE" }];
  const s = [{ id: "21", campaign_id: "2", status: "ACTIVE", daily_budget: "1000" }, { id: "31", campaign_id: "3", status: "ACTIVE", daily_budget: "2000" }];
  assert.equal(dnevniBudzet(k, s, "kuverta"), 20);
  assert.equal(dnevniBudzet(k, s, "kuverta", { 2: "ACTIVE" }), 30);
  assert.equal(dnevniBudzet(k, s, "cestitka"), 20);
});

test("naše oznake po ID-u oglasa i po imenu (oglas1 = Oglas 1 - Paket)", () => {
  const oglasi = [{ id: "100", ime: "Oglas 1" }, { id: "120", ime: "Oglas 1 - Paket" }, { id: "130", ime: "Reel" }];
  const po = spojiNase(oglasi, [
    { medij: "paid", oglas: "130", posjete: 5, registracije: 1 },
    { medij: "paid_social", oglas: "oglas1", posjete: 3, registracije: 2 },
    { medij: "grupa", oglas: "130", posjete: 9 },
  ]);
  assert.equal(po["130"].posjete, 5);
  // Točno ime ima prednost pred imenom bez verzije.
  assert.equal(po["100"].registracije, 2);
  assert.equal(po["120"], undefined);
  const po2 = spojiNase([{ id: "120", ime: "Oglas 1 - Paket" }], [{ medij: "paid", oglas: "oglas1", registracije: 1 }]);
  assert.equal(po2["120"].registracije, 1);
});

test("Crush oznake: ime oglasa u utm_content, prednost istoj kampanji", () => {
  const oglasi = [
    { id: "200", ime: "kuverta-9x16.mp4 - 004 - video", kampanja: "Crush kuverta.hr - 2026-11-21 13:26" },
    { id: "300", ime: "kuverta-9x16.mp4 - 004 - video", kampanja: "Crush kuverta.hr - 2026-11-22 22:24" },
  ];
  const po = spojiNase(oglasi, [{ medij: "paid", oglas: "kuverta-9x16.mp4-004---video", kampanja: "crush-kuverta-hr---2026-11-21-13-26", posjete: 4, registracije: 1 }]);
  assert.equal(po["200"].registracije, 1);
  assert.equal(po["300"], undefined);
});
