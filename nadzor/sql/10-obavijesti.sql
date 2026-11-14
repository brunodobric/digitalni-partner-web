-- Upozorenje za razred paušala i popis poslanih obavijesti (ekran Obavijesti).
-- Pokreće se nakon 08 i 09: zamjenjuje nadzor_upozorenja iz 08 verzijom koja vraća i primitke.

-- Sve što bi moglo trebati upozorenje, u jednom JSON-u.
create or replace function public.nadzor_upozorenja(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    -- Računi bez JIR-a dulje od dva sata (rok za naknadnu dostavu je kratak).
    'ceka_jir', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'oznaka', r.broj || '/' || r.oznaka_prostora || '/' || r.oznaka_uredaja,
        'izdan', r.izdan, 'okolina', r.okolina, 'iznos', r.iznos_centi / 100.0) order by r.izdan), '[]'::jsonb)
      from fisk.racuni r where r.stanje = 'izdan' and r.izdan < now() - interval '2 hours'
    ),
    'odbijeni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'oznaka', r.broj || '/' || r.oznaka_prostora || '/' || r.oznaka_uredaja,
        'izdan', r.izdan, 'okolina', r.okolina) order by r.izdan), '[]'::jsonb)
      from fisk.racuni r where r.stanje = 'odbijen' and r.stvoren > now() - interval '14 days'
    ),
    -- Ručno uvezeni izvodi koji se ne slažu (za one iz maila obavijest šalje već uvoz).
    'neuskladeni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'iban', i.iban, 'oznaka', coalesce(i.redni_broj, i.oznaka), 'datum', i.zavrsno_datum)), '[]'::jsonb)
      from public.izvodi i join public.izvod_datoteke d on d.sazetak = i.datoteka
      where i.uskladeno = false and i.uvezeno > now() - interval '3 days' and d.naziv not like 'mail:%'
    ),
    'zadnji_izvodi', (
      select coalesce(jsonb_agg(jsonb_build_object('iban', z.iban, 'datum', z.datum)), '[]'::jsonb)
      from (select iban, max(zavrsno_datum) as datum from public.izvodi group by iban) z
    ),
    -- Primici ove godine kao u knjizi prometa (ekran Knjige): pravi računi bez odbijenih
    -- i priljevi s izvoda koji ulaze u KPR (ručna odluka, inače sve osim Stripea).
    'primici', (
      select jsonb_build_object('godina', g.godina, 'centi',
        coalesce((select sum(r.iznos_centi) from fisk.racuni r
                  where r.godina = g.godina and r.okolina = 'produkcija' and r.stanje <> 'odbijen'), 0)
        + coalesce((select sum(s.iznos_centi) from public.izvod_stavke s
                  where s.iznos_centi > 0 and s.status = 'BOOK' and not s.storno
                    and extract(year from s.knjizeno) = g.godina
                    and coalesce(s.kpr, not ((coalesce(s.protustrana, '') || ' ' || coalesce(s.opis, '')) ~* 'stripe'))), 0))
      from (select extract(year from now() at time zone 'Europe/Zagreb')::int as godina) g
    ),
    -- Prikupljači kojima je zadnje pokretanje u zadnjih 26 sati završilo greškom.
    'greske_prikupljanja', (
      select coalesce(jsonb_agg(jsonb_build_object('izvor', o.izvor, 'vrijeme', o.vrijeme, 'poruka', o.poruka)), '[]'::jsonb)
      from (select distinct on (izvor) * from public.osvjezavanja order by izvor, vrijeme desc) o
      where not o.uspjeh and o.vrijeme > now() - interval '26 hours'
    )
  );
end $$;

-- Zadnje poslane obavijesti, za ekran Obavijesti.
create or replace function public.nadzor_obavijesti_popis(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return (select coalesce(jsonb_agg(jsonb_build_object('kljuc', o.kljuc, 'poslano', o.poslano) order by o.poslano desc), '[]'::jsonb)
          from (select * from public.obavijesti order by poslano desc limit 50) o);
end $$;

revoke all on function public.nadzor_upozorenja(text) from public, authenticated;
revoke all on function public.nadzor_obavijesti_popis(text) from public, authenticated;
grant execute on function public.nadzor_upozorenja(text) to anon;
grant execute on function public.nadzor_obavijesti_popis(text) to anon;
