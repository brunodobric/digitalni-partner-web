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
| Shema baze dashboarda | `sql/01-nadzor-shema.sql` |
| Funkcija za brojeve iz Kuverte | `sql/02-kuverta-statistika.sql` |
| Ogledni podaci | `sql/03-ogledni-podaci.sql` |
| Popis računa iz fiskalizacije (ekran Računi) | `sql/04-racuni.sql` |
| Čitač bankovnih izvoda CAMT.053 | `src/camt.js` |
| Izvodi, stavke i stanje računa (ekran Banka) | `sql/05-izvodi.sql` |
| Testovi čitača s izmišljenim izvodima | `test/` (`node --test nadzor/test/camt.test.mjs`) |

Worker zove bazu samo preko funkcija koje traže tajni ključ `NADZOR_KLJUC`. U bazama je spremljen samo njegov SHA-256 sažetak. Tablice imaju uključen RLS bez pravila, pa ih javni ključ ne može čitati izravno.

## Tajne Workera

| Tajna | Čemu služi | Obavezno |
| --- | --- | --- |
| `NADZOR_KLJUC` | Pristup funkcijama u obje baze | da (postavljeno) |
| `CF_API_TOKEN` | Broj zahtjeva na web i Kuvertu (Cloudflare GraphQL, dozvola Account Analytics: Read) | ne |
| `RESEND_KEY`, `OBAVIJEST_NA` | Mail o svakom novom upitu s weba | ne |
| `FISK_TOKEN` | PDF računa na ekranu Računi. Ista vrijednost kao tajna `FISK_CITANJE_TOKEN` funkcije fisk-racun (smije samo čitati, ne može izdati račun) | ne, bez nje popis radi, a PDF ne |

Ekran Računi čita tablicu `fisk.racuni` (isti Supabase projekt) preko funkcije `nadzor_racuni`, a PDF traži od Edge funkcije `fisk-racun` (repozitorij financijski-softver). Adresa funkcije je `SUPABASE_URL/functions/v1/fisk-racun`, a može se promijeniti varijablom `FISK_URL`.

## Ekran Banka (izvodi CAMT.053)

Izvod u formatu CAMT.053 (ISO 20022, XML) preuzme se iz internetskog bankarstva i uveze na ekranu Banka. Worker ga pročita (`src/camt.js`, verzije .001.02 do .001.13), a baza spremi izvornu datoteku, izvod i stavke (`sql/05-izvodi.sql`). Isti izvod (IBAN + oznaka izvoda) uvezen dvaput se preskače.

- Stanje računa je završno stanje (CLBD) najnovijeg izvoda za taj IBAN; raspoloživo stanje (CLAV) se pokaže ako ga banka pošalje.
- Svaki izvod se provjeri: početno stanje (OPBD, inače PRCD) + knjiženi promet mora dati završno. Ako se ne slaže, izvod je označen.
- Stavke na čekanju (PDNG) se prikazuju, ali ne ulaze u zbroj. Isplate sa Stripea dobiju oznaku STRIPE.
- CAMT.052 i CAMT.054 se odbijaju s porukom, kao i ZIP (treba ga raspakirati).

Postavljanje: `npx wrangler secret put IME` iz mape `nadzor/`.

## Ogledni podaci

Svi ogledni redovi imaju `ogledno = true` i na dashboardu nose oznaku OGLEDNO. Kad se spoji pravi izvor, brišu se po liniji:

```sql
select public.nadzor_obrisi_ogledno('<NADZOR_KLJUC>', 'usluge');  -- ili 'aplikacije', 'vjencanja', 'obrt', 'sve'
```
