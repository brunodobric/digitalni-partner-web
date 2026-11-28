# Nadzor poslovanja (dp-nadzor)

Dashboard cijelog obrta: usluge, aplikacije i Kuverta na jednom mjestu. Faza 0 iz prijedloga.

- Adresa: https://nadzor.digitalnipartner.hr (rezervna: https://dp-nadzor.bruno-dobric32.workers.dev) (prijava jednokratnim kodom na Brunin mail, Cloudflare Access)
- Objava: Cloudflare Workers Builds, korijenska mapa `nadzor/`, naredba `npx wrangler deploy`
- Baza: Supabase projekt `dp-nadzor` (Frankfurt). Kuverta se čita iz projekta `MyWeddingInvite`.

## Kako radi

| Dio | Datoteka |
| --- | --- |
| Worker: stranica, API, prijem upita, dnevni prikupljači | `src/index.js` |
| Stranica dashboarda | `src/stranica.html` |
| Ikona za oznaku i početni zaslon (180 × 180, znak „dp” manji, ispod natpis „nadzor”) | `src/apple-touch-icon.png` |
| Logo na ekranu za prijavu (Cloudflare Access), javno na webu jer se prijava otvara prije Workera | `../slike/nadzor-prijava.png` |
| Shema baze dashboarda | `sql/01-nadzor-shema.sql` |
| Funkcija za brojeve iz Kuverte | `sql/02-kuverta-statistika.sql` |
| Popis računa iz fiskalizacije (ekran Računi) | `sql/04-racuni.sql` |
| Prihod Kuverte (linija Kuverta na Pregledu i ekranu Kuverta): pravi fiskalizirani računi Kuverte, sa stornima, bez testnih | `sql/13-prihod-kuverte.sql` |
| Posjete, registracije i kupnje po grupi (npr. Facebook grupe, utm_medium=grupa), pokreće se u projektu MyWeddingInvite nakon migracije `029_posjete_oglas.sql` | `sql/18-kuverta-grupe.sql` |
| Posjete, registracije i kupnje po oznaci poveznice: tablice Po grupi i Pinterest (po pinu), pokreće se u projektu MyWeddingInvite nakon migracije `029_posjete_oglas.sql`; zamjenjuje `18` | `sql/19-kuverta-oznake.sql` |
| Sve oznake poveznica ispod izvora u „Otkud dolaze kupci” (grupe, pinovi, oglasi, kampanje, s registracijama i kupnjama), pokreće se u projektu MyWeddingInvite; zamjenjuje `19` | `sql/20-kuverta-oznake-sve.sql` |
| RLS na tablici `nadzor.kljuc` (upozorenje Security Advisora), pokreće se u projektu MyWeddingInvite | `sql/21-kuverta-kljuc-rls.sql` |
| Registrirani korisnici Kuverte (ekran Kuverta), pokreće se u projektu MyWeddingInvite | `sql/06-kuverta-korisnici.sql` |
| Zadnja aktivnost korisnika (iz osvježavanja sesije, ne samo zadnja prijava), registracije po danu u grafu i pregled jednog dana (klik na stupac ili polje Dan), pokreće se u projektu MyWeddingInvite nakon `12` i `20`; zamjenjuje `nadzor_korisnici` i `nadzor_izvori` iz `12` i `nadzor_oznake` iz `20` | `sql/22-kuverta-aktivnost-i-dani.sql` |
| Brisanje korisničkog računa Kuverte (gumb Obriši uz korisnika), pokreće se u projektu MyWeddingInvite | migracija `023_nadzor_brisanje_korisnika.sql` u repozitoriju MyWeddingInvite; Worker zove `KUVERTA_WEB/interno/obrisi-korisnika` |
| Ekran **Mailovi**: automatski mailovi Kuverte (pravila: koji mail, kada, kome; kome ide idućih 14 dana; zadnje poslano; uređivanje teksta, nova pravila, pregled i proba). Pravila su u bazi Kuverte, migracija `033_mail_pravila.sql` u repozitoriju MyWeddingInvite (ima i funkcije `nadzor_mail*`); pregled i probu slaže Worker Kuverte na `KUVERTA_WEB/interno/mail-pregled` | `src/stranica.html` (Mailovi), `src/index.js` (`mailovi`) |
| Ekran **Čestitka** (bozicna.kuverta.hr): posjete po izvoru i oznaci poveznice (utm), kupnje, komadi, prihod, napravljene i otvorene čestitke. Čita funkciju `nadzor_cestitka` iz Supabase projekta `bozicna-cestitka` (migracija `009_posjete_i_nadzor.sql` u repozitoriju bozicna-cestitka; u njegov `nadzor.kljuc` ide isti sažetak ključa kao u Kuverti). Adresa je `CESTITKA_URL` u `wrangler.jsonc`, javni ključ tajna `CESTITKA_KEY` | `src/stranica.html` (`cestitkaEkran`), `src/index.js` (`/api/cestitka`) |
| Ekrani **Kuverta** i **Čestitka** imaju po dva taba. Kuverta: *Pozivnice i korisnici* (registracije, platili, prihod, aktivni, što korisnici rade, zadnji računi, iduća vjenčanja, korisnici) i *Oglasi i izvori*. Čestitka: *Prodaja* (brojke i put do kupnje) i *Oglasi i izvori*. Na tabu Oglasi i izvori su Metini brojevi (potrošnja, prikazi, klikovi, CPM, CTR, frekvencija) i naši (posjete, registracije, kupnje, prihod s oznaka utm_medium paid/paid_social/cpc) u jednom nizu i u tablici po oglasu; u tablici izvora oglasi su jedan redak. Za registracije i kupnje vrijedi naš broj, Metin je samo usporedba | `src/stranica.html` (`vjencanja`, `izvoriKuverte`, `nizOglasa`, `poOglasu`, `cestitkaEkran`), `src/index.js` (`metaOglasi`) |
| **Vođenje oglasa** (zamjena za Crush): u 6:00 upiše Metine brojke po danu i oglasu za zadnjih 7 dana (`meta_oglasi_dan`), ocijeni aktivne oglase po našim registracijama (`meta_oglasi_stanje`: dobar do 3 €/reg., pod nadzorom do 5 €, prijedlog pauze iznad 5 €, 6 € bez registracije ili frekvencija iznad 3) i pošalje mail. Uz svaki prijedlog je poveznica `/meta/odobri?id=…` s gumbima Pauziraj i Ostavi; bez klika se ništa ne pauzira, a budžeti se nikad ne mijenjaju. Čestitka (kampanje s „čestitka” ili „Božić” u nazivu) zasad samo u izvještaju. `/meta/provjera` pokaže dozvole tokena, `/meta/osvjezi` pokrene posao odmah. Pragovi su varijable `META_PRAG_*`, `META_BEZ_REG`, `META_FREKV`, `META_BUDZET_*` u `wrangler.jsonc` | `src/oglasi.js`, `sql/23-meta-oglasi.sql`, `test/oglasi.test.mjs` |
| Čitač bankovnih izvoda CAMT.053 | `src/camt.js` |
| Izvodi, stavke i stanje računa (ekran Banka) | `sql/05-izvodi.sql` |
| Brisanje troška (olovka uz Dodaj trošak, pa minus uz trošak i potvrda) | `sql/07-brisanje-troska.sql` |
| Privici iz maila (MIME) i XML iz ZIP-a | `src/mail.js` |
| Upozorenja mailom (sastavljanje) i njihove funkcije u bazi | `src/upozorenja.js`, `sql/08-upozorenja.sql` |
| Knjiga prometa (KPR) i PO-SD (ekran Knjige) | `sql/09-knjige.sql` |
| Izvor upita s weba (UTM oznake ili stranica s koje je posjetitelj došao), u mailu i u stupcu Izvor | `../js/izvor.js`, `sql/11-izvor-upita.sql` |
| Otkud dolaze kupci Kuverte (posjete, registracije i kupnje po izvoru, ekran Kuverta) i stupac Izvor uz korisnike, pokreće se u projektu MyWeddingInvite nakon njegove migracije 024 | `sql/12-kuverta-izvori.sql`, ruta `/api/izvori` |
| Testovi s izmišljenim izvodima | `test/` (`node --test nadzor/test/*.test.mjs`) |

Worker zove bazu samo preko funkcija koje traže tajni ključ `NADZOR_KLJUC`. U bazama je spremljen samo njegov SHA-256 sažetak. Tablice imaju uključen RLS bez pravila, pa ih javni ključ ne može čitati izravno.

## Tajne Workera

| Tajna | Čemu služi | Obavezno |
| --- | --- | --- |
| `NADZOR_KLJUC` | Pristup funkcijama u obje baze | da (postavljeno) |
| `CF_API_TOKEN` | Broj zahtjeva na web i Kuvertu (Cloudflare GraphQL, dozvola Account Analytics: Read) | ne |
| `RESEND_KEY`, `OBAVIJEST_NA` | Mail o svakom novom upitu s weba i upozorenja | ne |
| `IZVODI_IBAN` | IBAN-i (odvojeni zarezom) za koje se primaju izvodi mailom. Bez nje se mail ne uvozi | za uvoz mailom |
| `IZVODI_POSILJATELJI` | Adrese ili domene pošiljatelja izvoda, npr. `@pbz.hr`. Prazno pušta svakoga | preporučeno |
| `IZVODI_ADRESA` | Adrese (odvojene zarezom) čija se pošta uvozi kao izvod. Prazno znači svaka adresa `izvodi@…` | ne |
| `IZVODI_PROSLIJEDI` | Adresa na koju se mail s izvodom proslijedi nakon uvoza (mora biti potvrđena u Email Routingu) | ne |
| `CESTITKA_KEY` | Javni (publishable) ključ Supabase projekta bozicna-cestitka, za ekran Čestitka | ne, bez nje ekran Čestitka javi da ključ nije postavljen |
| `META_ADS_TOKEN` | Meta oglasi na ekranima Kuverta i Čestitka (tab Oglasi i izvori): token sistemskog korisnika s dozvolama ads_read i ads_management (ads_management treba samo za gumb Pauziraj u vođenju oglasa). Uz njega `META_OGLASNI_RACUN` u `wrangler.jsonc` i po želji `META_KAMPANJE` (regularni izraz za imena kampanja, zadano čestitka ili Božić) | ne |
| `FISK_CITANJE_TOKEN` | PDF računa na ekranu Računi i provjera isteka certifikata. Ista vrijednost kao tajna `FISK_CITANJE_TOKEN` funkcije fisk-racun (smije samo čitati, ne može izdati račun). Stari naziv `FISK_TOKEN` radi kao rezerva | ne, bez nje popis radi, a PDF ne |

Ekran Računi čita tablicu `fisk.racuni` (isti Supabase projekt) preko funkcije `nadzor_racuni`, a PDF traži od Edge funkcije `fisk-racun` (repozitorij financijski-softver). Adresa funkcije je `SUPABASE_URL/functions/v1/fisk-racun`, a može se promijeniti varijablom `FISK_URL`.

## Ekran Banka (izvodi CAMT.053)

Izvod u formatu CAMT.053 (ISO 20022, XML) preuzme se iz internetskog bankarstva i uveze na ekranu Banka. Worker ga pročita (`src/camt.js`, verzije .001.02 do .001.13), a baza spremi izvornu datoteku, izvod i stavke (`sql/05-izvodi.sql`). Isti izvod (IBAN + oznaka izvoda) uvezen dvaput se preskače.

- Stanje računa je završno stanje (CLBD) najnovijeg izvoda za taj IBAN; raspoloživo stanje (CLAV) se pokaže ako ga banka pošalje.
- Svaki izvod se provjeri: početno stanje (OPBD, inače PRCD) + knjiženi promet mora dati završno. Ako se ne slaže, izvod je označen.
- Stavke na čekanju (PDNG) se prikazuju, ali ne ulaze u zbroj. Isplate sa Stripea dobiju oznaku STRIPE.
- CAMT.052 i CAMT.054 se odbijaju s porukom. ZIP se raspakira i uvezu se XML datoteke iz njega.
- PBZ šalje izvod kao potpisanu omotnicu `.xml.sgn` (FileUpload s base64 ZIP-om u kojem je CAMT.053). Omotnica se otvori i uveze, a potpis banke se ne provjerava.

### Izvodi mailom

PBZ šalje dnevni izvod izravno na `izvodi@banka.digitalnipartner.hr`. Taj poddomen ima Cloudflare Email Routing (MX samo za `banka.`; mail glavne domene od 19. 11. 2026. ide na iCloud+), a pravilo ga šalje Workeru dp-nadzor. Worker (`email` u `src/index.js`) mail koji nije na adresu za izvode (`IZVODI_ADRESA`, inače svaka `izvodi@…`) odbaci, a za izvod:

1. po potrebi proslijedi mail na `IZVODI_PROSLIJEDI`, da izvod ostane i u pošti (adresa mora biti potvrđena u Email Routingu),
2. provjeri pošiljatelja (`IZVODI_POSILJATELJI`, u omotnici ili u zaglavlju From, jer prosljeđivanje mijenja omotnicu) i da je izvod za račun iz `IZVODI_IBAN`,
3. uveze svaki XML ili ZIP privitak, isto kao ručni uvoz,
4. upiše ishod kao „izvodi-mail” (vidi se u dnu dashboarda), a kad nešto ne uspije, pošalje obavijest na `OBAVIJEST_NA` (ako je postavljen `RESEND_KEY`).

Postavljanje: `npx wrangler secret put IME` iz mape `nadzor/`.

## Upozorenja mailom

Svaki sat (cron `15 * * * *`, i nakon jutarnjeg prikupljanja) Worker provjeri stanje i pošalje jedan mail na `OBAVIJEST_NA` za sve što je novo:

- račun čeka JIR dulje od 2 sata, ili ga je Porezna odbila,
- ručno uvezen izvod se ne slaže (za izvode iz maila to javlja već uvoz),
- za račun nema novog izvoda 3 radna dana,
- jutarnje prikupljanje nije uspjelo,
- FINA certifikat istječe za 30 dana, za 7 dana i kad istekne (radnja `zdravlje` servisa fisk-racun),
- servis fisk-racun ne odgovara (najviše jednom dnevno),
- primici ove godine (kao na ekranu Knjige) prijeđu granicu razreda paušala, 54.000 € ili limit od 60.000 € (`sql/10-obavijesti.sql`).

Ekran **Obavijesti** pokazuje sve obavijesti mailom, kada se šalju, jesu li uključene i što je zadnje poslano. Popis je u `src/upozorenja.js` (`POPIS_OBAVIJESTI`).

Svako upozorenje ima svoj ključ u tablici `obavijesti` i stiže samo jednom. Ključ se upiše tek kad Resend primi mail, pa se neposlano upozorenje pokuša ponovno idući sat.

## Ekran Knjige (KPR i PO-SD)

Knjiga prometa slaže se iz fiskaliziranih računa (gotovina, kartice) i priljeva s uvezenih izvoda (transakcijski račun). Isplate sa Stripea se po zadanom ne broje, jer su te uplate već u knjizi kao računi plaćeni karticom. Svaku uplatu s izvoda može se ručno uključiti ili isključiti (stupac `izvod_stavke.kpr`). Odbijeni računi nisu u zbroju.

PO-SD dio pokazuje primitke po vrsti, razred i godišnji paušalni dohodak prema razredima koji vrijede od 2024. (`RAZREDI` u `src/stranica.html`). Knjiga se preuzima kao CSV za Excel (točka-zarez, decimalni zarez). Iznose prije predaje potvrditi s knjigovođom.

## Ekran za prijavu

Prijavu prikazuje Cloudflare Access, ne Worker. Na besplatnom Zero Trust planu mijenjaju se samo logo, boje i tekst iznad i ispod obrasca (Zero Trust > Reusable components > Custom pages > Access login page, ili API `PUT /accounts/{id}/access/organizations`, polje `login_design`):

| Polje | Vrijednost |
| --- | --- |
| Logo | `https://digitalnipartner.hr/slike/nadzor-prijava.png` (isti znak kao ikona za oznaku) |
| Pozadina | `#E7E4DE` (kamen) |
| Boja teksta | `#0F3B33` (smaragd) |
| Naslov | Nadzor poslovanja |
| Podnožje | Kod za prijavu stiže mailom, samo na odobrene adrese. Ako ga nema, pogledaj i neželjenu poštu. |

Obrazac u sredini (font, gumb, tekst na engleskom) ostaje Cloudflareov. Potpuno vlastiti HTML prijave traži plan Pay-as-you-go.
