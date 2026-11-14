// Pokretanje: node --test nadzor/test/*.test.mjs (iz korijena repozitorija)
import { test } from "node:test";
import assert from "node:assert/strict";
import { sastaviUpozorenja } from "../src/upozorenja.js";

const sada = Date.parse("2026-11-16T09:00:00Z");

test("prazno stanje ne daje upozorenja", () => {
  assert.deepEqual(sastaviUpozorenja({}, null, "2026-11-16", sada), []);
});

test("račun bez JIR-a, odbijen račun i neusklađen izvod", () => {
  const u = sastaviUpozorenja({
    ceka_jir: [{ id: "a1", oznaka: "5/WEB/1", izdan: "2026-11-16T05:00:00Z", okolina: "produkcija" }],
    odbijeni: [{ id: "b2", oznaka: "6/WEB/1", izdan: "2026-11-15T10:00:00Z", okolina: "test" }],
    neuskladeni: [{ id: 7, iban: "HR12", oznaka: "214", datum: "2026-11-12" }],
  }, null, "2026-11-16", sada);
  assert.deepEqual(u.map((x) => x.kljuc), ["ceka-jir:a1", "odbijen:b2", "izvod-neuskladen:7"]);
  assert.match(u[0].tekst, /čeka JIR već 4 h/);
  assert.match(u[1].tekst, /\(test\)/);
});

test("izvod kasni tek nakon tri radna dana", () => {
  // Petak 13. 11. → ponedjeljak 16. 11. je jedan radni dan.
  assert.equal(sastaviUpozorenja({ zadnji_izvodi: [{ iban: "HR12", datum: "2026-11-13" }] }, null, "2026-11-16", sada).length, 0);
  const u = sastaviUpozorenja({ zadnji_izvodi: [{ iban: "HR12", datum: "2026-11-10" }] }, null, "2026-11-16", sada);
  assert.equal(u[0].kljuc, "izvod-kasni:HR12:2026-11-10");
  assert.match(u[0].tekst, /4 radna dana/);
});

test("certifikat: upozorenje na 30 i 7 dana, s ključem po pragu", () => {
  const za = (dana) => sastaviUpozorenja({}, { okolina: "produkcija", certifikatVrijediDo: new Date(sada + dana * 864e5 + 3600e3).toISOString() }, "2026-11-16", sada);
  assert.equal(za(60).length, 0);
  assert.match(za(20)[0].kljuc, /:30$/);
  assert.match(za(5)[0].kljuc, /:7$/);
  assert.match(za(-2)[0].tekst, /je istekao/);
});

test("servis fisk-racun ne odgovara: jedno upozorenje po danu", () => {
  const u = sastaviUpozorenja({}, { greska: "HTTP 500" }, "2026-11-16", sada);
  assert.equal(u[0].kljuc, "fisk-nedostupan:2026-11-16");
});

test("razred paušala: upozorenje tek iznad prvog razreda, jednom po razredu", () => {
  const za = (eura) => sastaviUpozorenja({ primici: { godina: 2026, centi: eura * 100 } }, null, "2026-11-16", sada);
  assert.equal(za(11300).length, 0);
  const u = za(11450);
  assert.deepEqual(u.map((x) => x.kljuc), ["razred:2026:2"]);
  assert.match(u[0].tekst, /2\. razred/);
  assert.deepEqual(za(31000).map((x) => x.kljuc), ["razred:2026:5"]);
});

test("limit paušala: blizu na 54.000 €, prijeđen iznad 60.000 €", () => {
  const za = (eura) => sastaviUpozorenja({ primici: { godina: 2026, centi: eura * 100 } }, null, "2026-11-16", sada).map((x) => x.kljuc);
  assert.deepEqual(za(55000), ["razred:2026:7", "limit-blizu:2026"]);
  assert.deepEqual(za(61000), ["limit:2026"]);
});
