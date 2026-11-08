# Skrivene usluge

Od studenog 2026. web nudi samo izradu web stranica, mobilne aplikacije, održavanje (domena, hosting), Google poslovni profil te SEO i GEO optimizaciju. Oglasi (Google i Meta) i AI usluge (asistenti, agenti) su skriveni, ali sav njihov tekst i vizuali ostali su u kodu.

## Kako je označeno

- `hidden data-skriveno="oglasi"` ili `hidden data-skriveno="ai"`: sadržaj koji čeka povratak. Atribut `hidden` ga skriva, a `data-skriveno` kaže kojoj usluzi pripada. D premium ima `data-skriveno="oglasi ai"` jer sadrži obje.
- `data-privremeno="oglasi"` (ili `"oglasi ai"`): privremeni tekst koji stoji umjesto skrivenog dok usluga nije u ponudi. Kad se usluga vrati, taj element se briše.
- Meta opisi (`description`, `og:description`) ne mogu se sakriti atributom, pa je izvorni opis zapisan u komentaru `<!-- SKRIVENE USLUGE: ... -->` iznad njih.

Pregled svega: `grep -n "data-skriveno\|data-privremeno\|SKRIVENE USLUGE" *.html`

## Kako vratiti uslugu

Primjer za oglase (za AI isto, samo s `ai`):

1. U svim `.html` datotekama ukloniti `hidden` s elemenata koji imaju `data-skriveno="oglasi"` (i `data-skriveno` se može obrisati).
2. Obrisati elemente s `data-privremeno="oglasi"`.
3. Kad su vraćeni i oglasi i AI: ukloniti `hidden` s paketa D premium (`data-skriveno="oglasi ai"`), obrisati `data-paketa="2"` s `.plans` na naslovnici i u cjeniku (vraća tri stupca), obrisati `data-privremeno="oglasi ai"` u `o-nama.html` te vratiti meta opise iz komentara na `index.html`, `usluge.html` i `cjenik.html`.
4. Provjeriti cijenu i stavke paketa D plus: Meta oglasi su u njemu bili uključeni.

Karusel na naslovnici sam broji vidljive slajdove (`js/naslovnica.js`), pa se nakon vraćanja AI slajdova brojač i oznake "1 od 6" ažuriraju bez izmjena u skripti. Na stranici Usluge skrivene usluge stoje na kraju popisa (VII. do IX.), pa se brojevi ne mijenjaju.
