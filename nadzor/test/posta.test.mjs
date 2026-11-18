// Pokretanje: node --test nadzor/test/*.test.mjs (iz korijena repozitorija)
import { test } from "node:test";
import assert from "node:assert/strict";
import { adrese, privitci, procitajMail, tekstIzHtmla } from "../src/mail.js";

const b64 = (b) => Buffer.from(b).toString("base64").replace(/.{76}/g, "$&\r\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function mail() {
  return Buffer.from([
    'From: "Ana Anić" <ana@primjer.hr>',
    "To: info@banka.digitalnipartner.hr",
    "Cc: Marko <marko@primjer.hr>, ivo@primjer.hr",
    "Reply-To: odgovori@primjer.hr",
    "Subject: =?UTF-8?Q?Upit_za_izradu_weba_=E2=80=93_=C4=8Dakovec?=",
    "Date: Tue, 17 Nov 2026 21:15:03 +0100",
    "Message-ID: <abc@primjer.hr>",
    "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=primjer.hr; dmarc=pass; spf=pass smtp.mailfrom=primjer.hr",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="a"',
    "",
    "--a",
    'Content-Type: multipart/related; boundary="r"',
    "",
    "--r",
    'Content-Type: multipart/alternative; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=iso-8859-2",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Po=B9tovani, =BEelim web za obrt u =C8akovcu.=",
    "",
    "Lijep pozdrav",
    "--b",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Poštovani,</p><p><img src="cid:logo@primjer"><script>alert(1)</script></p>',
    "--b--",
    "--r",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo@primjer>",
    "",
    b64(PNG),
    "--r--",
    "--a",
    'Content-Type: application/pdf; name="ponuda.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="ponuda.pdf"',
    "",
    b64(Buffer.from("%PDF-1.4 probni")),
    "--a--",
    "",
  ].join("\r\n"));
}

test("procitajMail: zaglavlja, tekst u iso-8859-2, HTML i privici", () => {
  const m = procitajMail(new Uint8Array(mail()));
  assert.equal(m.od, '"Ana Anić" <ana@primjer.hr>');
  assert.equal(m.naslov, "Upit za izradu weba – čakovec");
  assert.equal(m.kopija, "Marko <marko@primjer.hr>, ivo@primjer.hr");
  assert.equal(m.odgovor_na, "odgovori@primjer.hr");
  assert.equal(m.poslano, "2026-11-17T20:15:03.000Z");
  assert.equal(m.message_id, "<abc@primjer.hr>");
  assert.equal(m.provjera, "spf=pass dkim=pass dmarc=pass");
  assert.equal(m.tekst, "Poštovani, želim web za obrt u Čakovcu.\nLijep pozdrav");
  assert.match(m.html, /cid:logo@primjer/);
  assert.equal(m.privitci.length, 2);
  assert.equal(m.privitci[0].cid, "logo@primjer");
  assert.equal(m.privitci[0].naziv, "slika-1.png");
  assert.deepEqual(Buffer.from(m.privitci[0].bajtovi()), PNG);
  assert.equal(m.privitci[1].naziv, "ponuda.pdf");
  assert.equal(Buffer.from(m.privitci[1].bajtovi()).toString(), "%PDF-1.4 probni");
});

test("procitajMail: mail samo s HTML-om dobije tekst iz HTML-a", () => {
  const raw = Buffer.from(["Subject: Bok", "Content-Type: text/html; charset=utf-8", "", "<style>p{}</style><p>Prvi&nbsp;red &amp; još</p><p>Drugi</p>"].join("\r\n"));
  const m = procitajMail(new Uint8Array(raw));
  assert.equal(m.tekst, "Prvi red & još\n\nDrugi");
  assert.equal(m.privitci.length, 0);
});

test("procitajMail: običan mail bez MIME zaglavlja", () => {
  const m = procitajMail(new Uint8Array(Buffer.from("From: a@b.hr\r\nSubject: Proba\r\n\r\nSamo tekst.\r\n")));
  assert.equal(m.naslov, "Proba");
  assert.equal(m.tekst, "Samo tekst.\n");
  assert.equal(m.html, null);
});

test("privitci i dalje vraća samo dijelove s imenom datoteke", () => {
  const p = privitci(new Uint8Array(mail()));
  assert.deepEqual(p.map((x) => x.naziv), ["ponuda.pdf"]);
});

test("tekstIzHtmla i adrese", () => {
  assert.equal(tekstIzHtmla("<div>a<br>b</div>&#269;&#x107;"), "a\n\nb\n\nčć");
  assert.deepEqual(adrese('"Ana" <Ana@Primjer.hr>, ivo@primjer.hr'), ["ana@primjer.hr", "ivo@primjer.hr"]);
});
