-- Pravi prihod Kuverte na dashboardu: fiskalizirani računi Kuverte (shema fisk, okolina produkcija)
-- ulaze u liniju vjencanja, zajedno s ručno upisanim prihodima iz tablice prihodi.
-- Storno računi imaju negativan iznos, pa se povrat sam oduzme. Testni računi (CIS test) i računi koje je Porezna odbila se ne broje, a račun koji još čeka JIR se broji (kao u knjizi prometa).
-- Pokreće se u projektu dp-nadzor nakon 01 i 04.

create or replace view privatno.prihodi_svi as
  select datum, linija, opis, iznos, izvor, ogledno from public.prihodi
  union all
  select (r.izdan at time zone 'Europe/Zagreb')::date, 'vjencanja',
         'Kuverta, račun ' || r.broj || '/' || r.oznaka_prostora || '/' || r.oznaka_uredaja || case when r.storno_od is not null then ' (storno)' else '' end,
         (r.iznos_centi / 100.0)::numeric(10,2), 'fiskalizacija', false
  from fisk.racuni r
  where r.izvor = 'kuverta' and r.okolina = 'produkcija' and r.stanje <> 'odbijen';

revoke all on privatno.prihodi_svi from public, anon, authenticated;

create or replace function public.nadzor_podaci(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_danas date := (now() at time zone 'Europe/Zagreb')::date;
  v_mj date := date_trunc('month', v_danas)::date;
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'danas', v_danas,
    'prihodi_po_mjesecima', (
      select coalesce(jsonb_agg(m order by m->>'mjesec'), '[]'::jsonb) from (
        select jsonb_build_object(
          'mjesec', to_char(g.mj, 'YYYY-MM'),
          'usluge', coalesce(sum(p.iznos) filter (where p.linija = 'usluge'), 0),
          'aplikacije', coalesce(sum(p.iznos) filter (where p.linija = 'aplikacije'), 0),
          'vjencanja', coalesce(sum(p.iznos) filter (where p.linija = 'vjencanja'), 0),
          'ogledno', coalesce(bool_or(p.ogledno), false)
        ) m
        from generate_series(v_mj - interval '5 months', v_mj, interval '1 month') g(mj)
        left join privatno.prihodi_svi p on date_trunc('month', p.datum) = g.mj
        group by g.mj
      ) x
    ),
    'prihod_godina', (select coalesce(sum(iznos), 0) from privatno.prihodi_svi where date_trunc('year', datum) = date_trunc('year', v_danas)),
    'prihod_godina_ogledno', (select coalesce(bool_or(ogledno), false) from privatno.prihodi_svi where date_trunc('year', datum) = date_trunc('year', v_danas)),
    'klijenti', (select coalesce(jsonb_agg(to_jsonb(k) order by k.obveza_do nulls last, k.pocetak), '[]'::jsonb) from public.klijenti k where k.stanje <> 'otkazan'),
    'otkazani_ovaj_mjesec', (select count(*) from public.klijenti where stanje = 'otkazan' and stvoreno >= v_mj),
    'upiti', (select coalesce(jsonb_agg(to_jsonb(u) order by u.stvoreno desc), '[]'::jsonb) from (select * from public.upiti where stvoreno >= v_mj - interval '2 months' order by stvoreno desc limit 100) u),
    'prihodi_ovaj_mjesec', (select coalesce(jsonb_agg(to_jsonb(p) order by p.datum desc), '[]'::jsonb) from privatno.prihodi_svi p where p.datum >= v_mj),
    'troskovi_ovaj_mjesec', (select coalesce(jsonb_agg(to_jsonb(t) order by t.iznos desc), '[]'::jsonb) from public.troskovi t where t.datum >= v_mj),
    'metrike', (
      select coalesce(jsonb_object_agg(z.linija || '.' || z.metrika, jsonb_build_object('vrijednost', z.vrijednost, 'datum', z.datum, 'izvor', z.izvor, 'ogledno', z.ogledno)), '{}'::jsonb)
      from (select distinct on (linija, metrika) * from public.metrike order by linija, metrika, datum desc) z
    ),
    'nizovi', (
      select coalesce(jsonb_object_agg(s.kljuc, s.niz), '{}'::jsonb) from (
        select linija || '.' || metrika as kljuc,
               jsonb_agg(jsonb_build_array(datum, vrijednost) order by datum) as niz
        from public.metrike where datum > v_danas - 31
        group by linija, metrika
      ) s
    ),
    'osvjezavanja', (
      select coalesce(jsonb_object_agg(o.izvor, jsonb_build_object('vrijeme', o.vrijeme, 'uspjeh', o.uspjeh, 'poruka', o.poruka)), '{}'::jsonb)
      from (select distinct on (izvor) * from public.osvjezavanja order by izvor, vrijeme desc) o
    )
  );
end $$;

grant execute on function public.nadzor_podaci(text) to anon;
