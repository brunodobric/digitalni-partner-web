-- Računi iz fiskalizacije (shema fisk, isti Supabase projekt) za ekran Računi u dashboardu.
-- Pokreće se nakon 01-nadzor-shema.sql. Vraća sve račune, najnoviji prvi, bez ZKI potpisa i XML-a.
create or replace function public.nadzor_racuni(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'oznaka', r.broj || '/' || r.oznaka_prostora || '/' || r.oznaka_uredaja,
      'godina', r.godina,
      'izdan', r.izdan,
      'iznos', r.iznos_centi / 100.0,
      'nacin_placanja', r.nacin_placanja,
      'stanje', r.stanje,
      'okolina', r.okolina,
      'izvor', r.izvor,
      'vanjski_id', r.vanjski_id,
      'jir', r.jir,
      'fiskaliziran_u', r.fiskaliziran_u,
      'opis', case when jsonb_typeof(r.podaci) = 'object' then r.podaci->>'opis' end,
      'kupac', case when jsonb_typeof(r.podaci) = 'object' then r.podaci #>> '{kupac,email}' end,
      'storno', r.storno_od is not null,
      'greska', (select p.greske from fisk.poruke p where p.racun_id = r.id and p.greske is not null
                 order by p.poslano desc limit 1)
    ) order by r.izdan desc, r.broj desc)
    from fisk.racuni r
  ), '[]'::jsonb);
end $$;

revoke all on function public.nadzor_racuni(text) from public, authenticated;
grant execute on function public.nadzor_racuni(text) to anon;
