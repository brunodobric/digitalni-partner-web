-- Upozorenja mailom (Worker ih provjerava svaki sat, vidi provjeriUpozorenja u src/index.js).
-- Pokreće se nakon 01, 04 i 05. Svako upozorenje ima svoj ključ i šalje se samo jednom:
-- Worker prvo pita koja još nisu poslana, pošalje mail i tek onda ih zabilježi.

create table if not exists public.obavijesti (
  kljuc text primary key check (char_length(kljuc) between 1 and 200),
  poslano timestamptz not null default now()
);
alter table public.obavijesti enable row level security;

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
    -- Prikupljači kojima je zadnje pokretanje u zadnjih 26 sati završilo greškom.
    'greske_prikupljanja', (
      select coalesce(jsonb_agg(jsonb_build_object('izvor', o.izvor, 'vrijeme', o.vrijeme, 'poruka', o.poruka)), '[]'::jsonb)
      from (select distinct on (izvor) * from public.osvjezavanja order by izvor, vrijeme desc) o
      where not o.uspjeh and o.vrijeme > now() - interval '26 hours'
    )
  );
end $$;

-- Od zadanih ključeva vraća one koji još nisu poslani.
create or replace function public.nadzor_obavijesti_nove(p_kljuc text, p_kljucevi text[])
returns text[] language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return coalesce((
    select array_agg(k) from unnest(p_kljucevi) k
    where not exists (select 1 from public.obavijesti o where o.kljuc = k)
  ), '{}');
end $$;

-- Bilježi poslana upozorenja.
create or replace function public.nadzor_obavijesti_poslane(p_kljuc text, p_kljucevi text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.obavijesti (kljuc) select left(k, 200) from unnest(p_kljucevi) k on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.nadzor_upozorenja(text) from public, authenticated;
revoke all on function public.nadzor_obavijesti_nove(text,text[]) from public, authenticated;
revoke all on function public.nadzor_obavijesti_poslane(text,text[]) from public, authenticated;
grant execute on function public.nadzor_upozorenja(text) to anon;
grant execute on function public.nadzor_obavijesti_nove(text,text[]) to anon;
grant execute on function public.nadzor_obavijesti_poslane(text,text[]) to anon;
