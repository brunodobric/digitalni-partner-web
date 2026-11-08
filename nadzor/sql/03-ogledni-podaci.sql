-- Ogledni podaci za dashboard (svi redovi imaju ogledno = true).
-- Datumi se računaju od dana upisa, da "ovaj mjesec" uvijek ima smisla.
-- Brišu se po liniji funkcijom nadzor_obrisi_ogledno kad se spoji pravi izvor.

insert into public.prihodi (datum, linija, opis, iznos, izvor, ogledno)
select case when o = 0 then current_date else (date_trunc('month', current_date) - make_interval(months => o) + interval '14 days')::date end,
       l.linija, 'ogledni mjesečni zbroj', l.iznosi[6 - o], 'ogledno', true
from generate_series(0, 5) o
cross join (values
  ('usluge',     array[3500, 3700, 3900, 4100, 4400, 4718]::numeric[]),
  ('aplikacije', array[ 900,  950, 1010, 1080, 1150, 1225]::numeric[]),
  ('vjencanja',  array[ 250,  300,  520,  780, 1050, 1260]::numeric[])
) l(linija, iznosi);

insert into public.klijenti (oznaka, djelatnost, paket, mjesecno, pocetak, obveza_do, stanje, ogledno) values
  ('Klijent 01', 'Frizerski salon',  'D plus',               499, current_date - 160, current_date - 70, 'aktivan', true),
  ('Klijent 02', 'Osobni trener',    'D start',              249, current_date - 146, current_date - 56, 'aktivan', true),
  ('Klijent 03', 'Kozmetički salon', 'D premium',            899, current_date - 130, current_date - 40, 'aktivan', true),
  ('Klijent 04', 'Salon za masažu',  'D plus',               499, current_date - 86,  current_date + 6,  'aktivan', true),
  ('Klijent 05', 'Apartmani',        'D start',              249, current_date - 71,  current_date + 21, 'aktivan', true),
  ('Klijent 06', 'Restoran',         'Google i Meta oglasi', 349, current_date - 64,  current_date + 28, 'aktivan', true),
  ('Klijent 07', 'Frizerski salon',  'D start',              249, current_date - 43,  current_date + 49, 'neuspjela naplata', true),
  ('Klijent 08', 'Fotograf',         'D plus',               499, current_date - 26,  current_date + 66, 'aktivan', true),
  ('Klijent 09', 'Kozmetički salon', 'D start',              249, current_date - 5,   current_date + 87, 'novi', true);

insert into public.upiti (stvoreno, ime, kontakt, djelatnost, poruka, status, ogledno)
select greatest(date_trunc('month', now()), now() - make_interval(hours => 6 + i * 11)),
       'Ogledni upit ' || i, 'ogledno@primjer.hr', '', 'Ogledna poruka, nije stvarni upit.',
       case when i <= 3 then 'ugovor' when i <= 6 then 'ponuda' when i <= 9 then 'razgovor' else 'novi' end, true
from generate_series(1, 14) i;
-- jedan novi upit star više od dana, da se vidi upozorenje
update public.upiti set stvoreno = greatest(date_trunc('month', now()), now() - interval '26 hours') where ime = 'Ogledni upit 14';

insert into public.troskovi (datum, opis, iznos, linija, ogledno) values
  (current_date, 'Naknade Stripea', 118, 'obrt', true),
  (current_date, 'Claude', 90, 'obrt', true),
  (current_date, 'Oglasi za Digitalnog partnera', 90, 'usluge', true),
  (current_date, 'Apple Developer, 99 USD godišnje', 8, 'aplikacije', true),
  (current_date, 'Domene', 6, 'obrt', true);

insert into public.metrike (datum, linija, metrika, vrijednost, izvor, ogledno) values
  (current_date, 'aplikacije', 'aktivni_mjesecno', 2140, 'ogledno', true),
  (current_date, 'aplikacije', 'pretplatnici', 186, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.preuzimanja_30d', 1420, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.prihod_mjesec', 820, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.pretplatnici', 128, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.aktivni_mjesecno', 1310, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.ocjena', 4.7, 'ogledno', true),
  (current_date, 'aplikacije', 'app1.rusenja_7d', 3, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.preuzimanja_30d', 610, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.prihod_mjesec', 310, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.pretplatnici', 46, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.aktivni_mjesecno', 640, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.ocjena', 4.1, 'ogledno', true),
  (current_date, 'aplikacije', 'app2.rusenja_7d', 12, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.preuzimanja_30d', 240, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.prihod_mjesec', 95, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.pretplatnici', 12, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.aktivni_mjesecno', 190, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.ocjena', 4.5, 'ogledno', true),
  (current_date, 'aplikacije', 'app3.rusenja_7d', 0, 'ogledno', true);
