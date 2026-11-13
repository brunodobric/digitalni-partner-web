// Pokretanje: node --test nadzor/test/*.test.mjs (iz korijena repozitorija)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jeZip, posiljateljDopusten, privitci, xmlIzZipa } from "../src/mail.js";
import { citajCamt053 } from "../src/camt.js";

const procitaj = (ime) => readFileSync(new URL(ime, import.meta.url));
const b64 = (b) => Buffer.from(b).toString("base64").replace(/.{76}/g, "$&\r\n");

function mail() {
  const xml = procitaj("izvod-camt053-v02.xml");
  const zip = procitaj("izvodi.zip");
  return Buffer.from([
    "From: PBZ <izvodi@pbz.hr>",
    "Subject: =?UTF-8?B?" + Buffer.from("Dnevni izvod – račun").toString("base64") + "?=",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="vanjska"',
    "",
    "--vanjska",
    'Content-Type: multipart/alternative; boundary="unutarnja"',
    "",
    "--unutarnja",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Poštovani, u privitku je izvod.",
    "--unutarnja--",
    "--vanjska",
    'Content-Type: application/xml; name="izvod.xml"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="izvod.xml"',
    "",
    b64(xml),
    "--vanjska",
    "Content-Type: application/zip",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: attachment;",
    " filename*=utf-8''izvodi%20%C4%8Detvrtak.zip",
    "",
    b64(zip),
    "--vanjska",
    "Content-Type: message/rfc822",
    "",
    'Content-Type: text/xml; name="=?utf-8?Q?proslijeđen=5Fizvod.xml?="',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    '<?xml version=3D"1.0"?><Document/>',
    "--vanjska--",
    "",
  ].join("\r\n"));
}

test("privici iz MIME poruke: base64, RFC 2231 ime, ugniježđena poruka", () => {
  const p = privitci(new Uint8Array(mail()));
  assert.deepEqual(p.map((x) => x.naziv), ["izvod.xml", "izvodi četvrtak.zip", "proslijeđen_izvod.xml"]);
  assert.equal(citajCamt053(new TextDecoder().decode(p[0].bajtovi))[0].iban, "HR1210010051863000160");
  assert.ok(jeZip(p[1].bajtovi));
  assert.deepEqual(Buffer.from(p[1].bajtovi), procitaj("izvodi.zip"));
  assert.equal(new TextDecoder().decode(p[2].bajtovi), '<?xml version="1.0"?><Document/>');
});

test("ZIP: XML datoteke s deflate i bez sažimanja, ostalo se preskače", async () => {
  const x = await xmlIzZipa(new Uint8Array(procitaj("izvodi.zip")));
  assert.deepEqual(x.map((f) => f.naziv), ["izvod-221.xml", "bez-sazimanja.xml"]);
  assert.equal(citajCamt053(new TextDecoder().decode(x[0].bajtovi))[0].zavrsno.centi, 138615);
  assert.equal(citajCamt053(new TextDecoder().decode(x[1].bajtovi))[0].iban, "HR9824020061100000001");
  await assert.rejects(xmlIzZipa(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), /oštećen/);
});

test("pošiljatelj: adresa ili domena", () => {
  assert.ok(posiljateljDopusten("Izvodi@PBZ.hr", ["@pbz.hr"]));
  assert.ok(posiljateljDopusten("a@b.hr", []));
  assert.ok(!posiljateljDopusten("x@evilpbz.hr", ["@pbz.hr"]));
  assert.ok(posiljateljDopusten("izvodi@pbz.hr", ["izvodi@pbz.hr"]));
  assert.ok(!posiljateljDopusten("drugi@pbz.hr", ["izvodi@pbz.hr"]));
});
