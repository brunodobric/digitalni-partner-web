// Pokretanje: node --test nadzor/test (iz korijena repozitorija)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { citajCamt053, parsirajXml, uCente } from "../src/camt.js";

const procitaj = (ime) => readFileSync(new URL(ime, import.meta.url), "utf8");

test("izvod .001.02: salda, stavke i usklađenost", () => {
  const [iz, ...visak] = citajCamt053(procitaj("izvod-camt053-v02.xml"));
  assert.equal(visak.length, 0);
  assert.equal(iz.iban, "HR1210010051863000160");
  assert.equal(iz.oznaka, "HR1210010051863000160-2026-221");
  assert.equal(iz.redniBroj, "221");
  assert.equal(iz.valuta, "EUR");
  assert.equal(iz.vlasnik, "PRIMJER OBRT, VL. IVO IVIĆ");
  assert.equal(iz.banka, "TESTHR2X");
  assert.deepEqual(iz.pocetno, { centi: 125040, datum: "2026-11-12" });
  assert.deepEqual(iz.zavrsno, { centi: 138615, datum: "2026-11-12" });
  assert.deepEqual(iz.raspolozivo, { centi: 138615, datum: "2026-11-12" });
  assert.equal(iz.od, "2026-11-12");
  assert.equal(iz.do, "2026-11-12");
  // 1250,40 + 171,35 - 35,60 = 1386,15; stavka na čekanju (PDNG) ne ulazi u zbroj
  assert.equal(iz.uskladeno, true);
  assert.equal(iz.stavke.length, 3);
  const [stripe, hzmo, ceka] = iz.stavke;
  assert.equal(stripe.iznosCenti, 17135);
  assert.equal(stripe.protustrana, "STRIPE TECHNOLOGY EUROPE LTD");
  assert.equal(stripe.protustranaIban, "IE00TEST00000000000000");
  assert.equal(stripe.opis, "STRIPE PAYOUT");
  assert.equal(stripe.e2e, "po_1QxTest");
  assert.equal(stripe.referenca, "2026111200001");
  assert.equal(hzmo.iznosCenti, -3560);
  assert.equal(hzmo.protustrana, "HRVATSKI ZAVOD ZA MIROVINSKO & OSIGURANJE");
  assert.equal(hzmo.pozivNaBroj, "HR68 8133-12345678901");
  assert.equal(ceka.status, "PDNG");
  assert.equal(ceka.opis, "Rezervacija <kartica>");
  assert.equal(ceka.datumValute, null);
});

test("izvod .001.08 s prefiksom: PRCD kao početno, Pty/Nm, skupna stavka", () => {
  const [iz] = citajCamt053(procitaj("izvod-camt053-v08.xml"));
  assert.equal(iz.iban, "HR9824020061100000001");
  assert.equal(iz.banka, "TESTHR22");
  assert.deepEqual(iz.pocetno, { centi: -2000, datum: "2026-10-31" });
  assert.deepEqual(iz.zavrsno, { centi: 8000, datum: "2026-11-01" });
  assert.equal(iz.uskladeno, true);
  assert.equal(iz.stavke[0].status, "BOOK");
  assert.equal(iz.stavke[0].protustrana, "Ana Anić");
  assert.equal(iz.stavke[0].brojTransakcija, 2);
  assert.equal(iz.stavke[0].opis, "Račun 7/WEB/1");
});

test("neusklađen izvod se označi", () => {
  const xml = procitaj("izvod-camt053-v02.xml").replace("<Amt Ccy=\"EUR\">171.35</Amt>", "<Amt Ccy=\"EUR\">171.36</Amt>");
  assert.equal(citajCamt053(xml)[0].uskladeno, false);
});

test("druge poruke i neispravan XML daju jasnu grešku", () => {
  assert.throws(() => citajCamt053('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02"><BkToCstmrAcctRpt/></Document>'), /CAMT\.052/);
  assert.throws(() => citajCamt053("<a><b></a>"), /Neispravan XML/);
  assert.throws(() => citajCamt053('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'), /DOCTYPE/);
  assert.throws(() => citajCamt053("nije xml"), /Tekst izvan|nema XML/);
  assert.throws(() => citajCamt053("<Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>HR1</IBAN></Id></Acct></Stmt></BkToCstmrStmt></Document>"), /CLBD/);
});

test("iznosi u cente bez pogreške zaokruživanja", () => {
  assert.equal(uCente("0.1"), 10);
  assert.equal(uCente("1234567.89"), 123456789);
  assert.equal(uCente("5.10000"), 510);
  assert.throws(() => uCente("1.234"));
  assert.throws(() => uCente("-1.00"));
});

test("parser: atributi s > u navodnicima, entiteti i prazni elementi", () => {
  const d = parsirajXml('<?xml version="1.0"?><a x="1>2" y=\'&amp;&#65;\'><b/>t&#x10D;</a>');
  assert.equal(d.a.x, "1>2");
  assert.equal(d.a.y, "&A");
  assert.equal(d.c[0].n, "b");
  assert.equal(d.t, "tč");
});
