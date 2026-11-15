-- Izvor upita s weba: obrazac šalje odakle je posjetitelj došao (UTM oznake, domena prethodne stranice ili "izravno"),
-- a funkcija ga sprema u stupac upiti.izvor koji već postoji (zadano 'web').
-- Stara funkcija s pet parametara zamjenjuje se novom sa šest. p_izvor ima zadanu vrijednost, pa radi i Worker koji izvor još ne šalje.
begin;

drop function if exists public.nadzor_upit(text,text,text,text,text);

create or replace function public.nadzor_upit(p_kljuc text, p_ime text, p_kontakt text, p_djelatnost text, p_poruka text, p_izvor text default 'web')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.upiti (ime, kontakt, djelatnost, poruka, izvor)
  values (left(coalesce(p_ime,''),120), left(coalesce(p_kontakt,''),200), left(coalesce(p_djelatnost,''),120), left(coalesce(p_poruka,''),4000),
          coalesce(nullif(left(trim(coalesce(p_izvor,'')),200),''), 'web'))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.nadzor_upit(text,text,text,text,text,text) from public;
grant execute on function public.nadzor_upit(text,text,text,text,text,text) to anon;

commit;
