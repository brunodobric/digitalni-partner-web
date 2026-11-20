-- Kuverta (Supabase projekt MyWeddingInvite): uključuje RLS na tablici nadzor.kljuc.
--
-- Supabase Security Advisor javlja da tablica nema RLS. Tablica nije bila dostupna izvana
-- (shema nadzor je zatvorena za anon i authenticated, vidi 02), ali RLS je druga zaštita ako se
-- ta prava ikad greškom vrate. Pravila (policy) namjerno nema: anon i authenticated ne smiju ništa.
--
-- Funkcije nadzor_* (statistika, korisnici, izvori, grupe, oznake, brisanje korisnika) rade i dalje:
-- security definer su i vlasnik im je postgres, isti kao vlasnik tablice, a vlasnik prolazi RLS
-- (FORCE ROW LEVEL SECURITY se namjerno ne uključuje).
--
-- Vraćanje: alter table nadzor.kljuc disable row level security;

alter table nadzor.kljuc enable row level security;
revoke all on table nadzor.kljuc from public, anon, authenticated;
