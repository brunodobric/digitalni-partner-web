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
3. Kad su vraćeni i oglasi i AI: odlučiti koji D premium ostaje (vidi zadnji odlomak) i drugi obrisati, obrisati `data-privremeno="oglasi ai"` u `o-nama.html` te vratiti meta opise iz komentara na `index.html`, `usluge.html` i `cjenik.html`.
4. Provjeriti cijenu i stavke paketa D plus: Meta oglasi su u njemu bili uključeni.

Karusel na naslovnici (`js/naslovnica.js`) sam broji vidljive slajdove i preskače elemente s atributom `hidden`. Od redizajna naslovnice (studeni 2026., „Izlog”) hero prikazuje primjere stranica za pet vrsta posla i više nema AI slajdova. Stari AI slajdovi (agent i asistent) sačuvani su u arhivi projekta, `arhiva/web/stari/index-prije-redizajna-izlog.html`; ako se AI vrati u hero, treba im napraviti slajd u novom obliku (fotografija, laptop, mobitel). Na stranici Usluge skrivene usluge stoje na kraju popisa (VII. do IX.), pa se brojevi ne mijenjaju. Na naslovnici su u popisu usluga skriveni oglasi (VI.) i AI asistent (VII.).

## D premium s mobilnom aplikacijom (studeni 2026.)

U cjeniku i na naslovnici je vidljiv novi D premium (899 € mjesečno, ugovor najmanje 6 mjeseci, sve iz D plus, dvije podstranice, održavanje mobilne aplikacije i izrada aplikacije od 2.999 € jednokratno umjesto od 4.999 €). Stari D premium s oglasima i AI-em ostao je skriven odmah ispod njega. Kad se vrate oglasi i AI, treba odlučiti koji sastav paketa ostaje, a drugi obrisati.
