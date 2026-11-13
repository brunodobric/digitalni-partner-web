-- Brisanje jednog troška s ekrana Pregled (tipka Makni uz trošak, uz potvrdu).
-- Pokreće se nakon 01-nadzor-shema.sql. Troškovi se upisuju samo ručno (nadzor_trosak) ili kao
-- ogledni podaci, pa se obrisani trošak ne vraća sam od sebe. Vraća true ako je redak obrisan.
create or replace function public.nadzor_trosak_obrisi(p_kljuc text, p_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  delete from public.troskovi where id = p_id;
  return found;
end $$;

revoke all on function public.nadzor_trosak_obrisi(text,bigint) from public, authenticated;
grant execute on function public.nadzor_trosak_obrisi(text,bigint) to anon;
