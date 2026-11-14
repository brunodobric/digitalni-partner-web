-- Knjiga prometa (KPR) i podaci za PO-SD za ekran Knjige u dashboardu.
-- Pokreće se nakon 01, 04 i 05. Promet se slaže iz dva izvora:
--   1. fiskalizirani računi (gotovina i kartice), shema fisk;
--   2. priljevi na transakcijski račun iz uvezenih izvoda.
-- Isplate sa Stripea se po zadanom ne broje, jer su te uplate već u KPR-u kao računi
-- plaćeni karticom. Svaku stavku izvoda može se ručno uključiti ili isključiti (stupac kpr).

alter table public.izvod_stavke add column if not exists kpr boolean;  -- null: odluči sam (sve osim Stripea)

create or replace function public.nadzor_knjige(p_kljuc text, p_godina int, p_okolina text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'godina', p_godina,
    'godine', (
      select coalesce(jsonb_agg(g order by g desc), '[]'::jsonb) from (
        select distinct godina as g from fisk.racuni
        union select distinct extract(year from knjizeno)::int from public.izvod_stavke where knjizeno is not null
        union select extract(year from now() at time zone 'Europe/Zagreb')::int
      ) x
    ),
    'racuni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'datum', (r.izdan at time zone 'Europe/Zagreb')::date,
        'izdan', r.izdan,
        'broj', r.broj || '/' || r.oznaka_prostora || '/' || r.oznaka_uredaja,
        'opis', case when jsonb_typeof(r.podaci) = 'object' then r.podaci->>'opis' end,
        'nacin', r.nacin_placanja,
        'iznos_centi', r.iznos_centi,
        'stanje', r.stanje,
        'okolina', r.okolina,
        'storno', r.storno_od is not null
      ) order by r.izdan, r.broj), '[]'::jsonb)
      from fisk.racuni r
      where r.godina = p_godina and r.stanje <> 'odbijen'
        and (p_okolina = 'sve' or r.okolina = p_okolina)
    ),
    'odbijeni', (
      select count(*) from fisk.racuni r
      where r.godina = p_godina and r.stanje = 'odbijen' and (p_okolina = 'sve' or r.okolina = p_okolina)
    ),
    'banka', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'datum', s.knjizeno,
        'protustrana', s.protustrana,
        'opis', s.opis,
        'poziv_na_broj', s.poziv_na_broj,
        'iznos_centi', s.iznos_centi,
        'iban', i.iban,
        'izvod', coalesce(i.redni_broj, i.oznaka),
        'stripe', (coalesce(s.protustrana, '') || ' ' || coalesce(s.opis, '')) ~* 'stripe',
        'kpr', s.kpr
      ) order by s.knjizeno, s.id), '[]'::jsonb)
      from public.izvod_stavke s join public.izvodi i on i.id = s.izvod_id
      where s.iznos_centi > 0 and s.status = 'BOOK' and not s.storno
        and extract(year from s.knjizeno) = p_godina
    )
  );
end $$;

-- Ručna odluka za jednu stavku izvoda: true u KPR, false izvan KPR-a, null vraća zadano.
create or replace function public.nadzor_kpr_stavka(p_kljuc text, p_id bigint, p_kpr boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  update public.izvod_stavke set kpr = p_kpr where id = p_id and iznos_centi > 0;
  return found;
end $$;

revoke all on function public.nadzor_knjige(text,int,text) from public, authenticated;
revoke all on function public.nadzor_kpr_stavka(text,bigint,boolean) from public, authenticated;
grant execute on function public.nadzor_knjige(text,int,text) to anon;
grant execute on function public.nadzor_kpr_stavka(text,bigint,boolean) to anon;
