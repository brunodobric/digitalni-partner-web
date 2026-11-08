# Nadzor poslovanja (dp-nadzor)

Dashboard cijelog obrta: usluge, aplikacije i Kuverta na jednom mjestu. Faza 0 iz prijedloga.

- Adresa: https://dp-nadzor.bruno-dobric32.workers.dev (prijava jednokratnim kodom na Brunin mail, Cloudflare Access)
- Objava: Cloudflare Workers Builds, korijenska mapa `nadzor/`, naredba `npx wrangler deploy`
- Baza: Supabase projekt `dp-nadzor` (Frankfurt). Kuverta se čita iz projekta `MyWeddingInvite`.

## Kako radi

| Dio | Datoteka |
| --- | --- |
| Worker: stranica, API, prijem upita, dnevni prikupljači | `src/index.js` |
| Stranica dashboarda | `src/stranica.html` |
| Shema baze dashboarda | `sql/01-nadzor-shema.sql` |
| Funkcija za brojeve iz Kuverte | `sql/02-kuverta-statistika.sql` |
| Ogledni podaci | `sql/03-ogledni-podaci.sql` |

Worker zove bazu samo preko funkcija koje traže tajni ključ `NADZOR_KLJUC`. U bazama je spremljen samo njegov SHA-256 sažetak. Tablice imaju uključen RLS bez pravila, pa ih javni ključ ne može čitati izravno.

## Tajne Workera

| Tajna | Čemu služi | Obavezno |
| --- | --- | --- |
| `NADZOR_KLJUC` | Pristup funkcijama u obje baze | da (postavljeno) |
| `CF_API_TOKEN` | Broj zahtjeva na web i Kuvertu (Cloudflare GraphQL, dozvola Account Analytics: Read) | ne |
| `RESEND_KEY`, `OBAVIJEST_NA` | Mail o svakom novom upitu s weba | ne |

Postavljanje: `npx wrangler secret put IME` iz mape `nadzor/`.

## Ogledni podaci

Svi ogledni redovi imaju `ogledno = true` i na dashboardu nose oznaku OGLEDNO. Kad se spoji pravi izvor, brišu se po liniji:

```sql
select public.nadzor_obrisi_ogledno('<NADZOR_KLJUC>', 'usluge');  -- ili 'aplikacije', 'vjencanja', 'obrt', 'sve'
```
