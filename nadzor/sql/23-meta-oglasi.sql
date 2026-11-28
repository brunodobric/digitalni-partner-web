-- Meta oglasi: dnevni brojevi po oglasu i ocjena oglasa (alat za vođenje oglasa, src/oglasi.js).
-- Pokreće se u projektu dp-nadzor nakon 01. Upisuje jutarnji cron (metaJutro u src/index.js),
-- a ekrani Kuverta i Čestitka (tab Oglasi i izvori) čitaju preko nadzor_meta_oglasi.

-- Jedan redak po danu i oglasu. Meta naknadno ispravlja zadnjih par dana, pa se redak prepisuje (upsert).
create table if not exists public.meta_oglasi_dan (
  datum date not null,
  ad_id text not null,
  ad_name text,
  campaign_name text,
  adset text,
  proizvod text not null default 'kuverta' check (proizvod in ('kuverta', 'cestitka')),
  impressions integer not null default 0,
  reach integer not null default 0,
  clicks integer not null default 0,
  spend numeric(12,2) not null default 0,
  cpm numeric(12,2),
  ctr numeric(8,3),
  frequency numeric(8,3),
  meta_registracije integer not null default 0,
  meta_kupnje integer not null default 0,
  azurirano timestamptz not null default now(),
  primary key (datum, ad_id)
);
alter table public.meta_oglasi_dan enable row level security;

-- Ocjena oglasa svako jutro (zadnjih 7 dana) i odluka o pauzi. Povijest ostaje: jedan redak po oglasu i danu.
create table if not exists public.meta_oglasi_stanje (
  id uuid primary key default gen_random_uuid(),
  ad_id text not null,
  datum date not null,
  ad_name text,
  campaign_name text,
  proizvod text not null default 'kuverta',
  stanje text not null check (stanje in ('dobar', 'slab', 'malo_podataka', 'prijedlog_pauza', 'pauziran', 'samo_izvjestaj')),
  razlog text,
  potrosnja_7 numeric(12,2),
  registracije_7 integer,
  frekvencija_7 numeric(8,3),
  odobreno boolean,
  odluceno timestamptz,
  stvoreno timestamptz not null default now(),
  unique (ad_id, datum)
);
alter table public.meta_oglasi_stanje enable row level security;
create index if not exists meta_oglasi_stanje_datum on public.meta_oglasi_stanje (datum desc);

create or replace function public.nadzor_meta_upis(p_kljuc text, p_redovi jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.meta_oglasi_dan as d (datum, ad_id, ad_name, campaign_name, adset, proizvod, impressions, reach, clicks, spend, cpm, ctr, frequency, meta_registracije, meta_kupnje, azurirano)
  select (r->>'datum')::date, r->>'ad_id', r->>'ad_name', r->>'campaign_name', r->>'adset', coalesce(r->>'proizvod', 'kuverta'),
    coalesce((r->>'impressions')::integer, 0), coalesce((r->>'reach')::integer, 0), coalesce((r->>'clicks')::integer, 0),
    coalesce((r->>'spend')::numeric, 0), (r->>'cpm')::numeric, (r->>'ctr')::numeric, (r->>'frequency')::numeric,
    coalesce((r->>'meta_registracije')::integer, 0), coalesce((r->>'meta_kupnje')::integer, 0), now()
  from jsonb_array_elements(p_redovi) r
  on conflict (datum, ad_id) do update set ad_name = excluded.ad_name, campaign_name = excluded.campaign_name, adset = excluded.adset,
    proizvod = excluded.proizvod, impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks, spend = excluded.spend,
    cpm = excluded.cpm, ctr = excluded.ctr, frequency = excluded.frequency, meta_registracije = excluded.meta_registracije,
    meta_kupnje = excluded.meta_kupnje, azurirano = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Jutarnja ocjena. Odluka koja je već donesena (odobreno nije null) se ne prepisuje.
create or replace function public.nadzor_meta_stanje_upis(p_kljuc text, p_redovi jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.meta_oglasi_stanje as s (ad_id, datum, ad_name, campaign_name, proizvod, stanje, razlog, potrosnja_7, registracije_7, frekvencija_7)
  select r->>'ad_id', (r->>'datum')::date, r->>'ad_name', r->>'campaign_name', coalesce(r->>'proizvod', 'kuverta'), r->>'stanje', r->>'razlog',
    (r->>'potrosnja_7')::numeric, (r->>'registracije_7')::integer, (r->>'frekvencija_7')::numeric
  from jsonb_array_elements(p_redovi) r
  on conflict (ad_id, datum) do update set ad_name = excluded.ad_name, campaign_name = excluded.campaign_name, stanje = excluded.stanje,
    razlog = excluded.razlog, potrosnja_7 = excluded.potrosnja_7, registracije_7 = excluded.registracije_7, frekvencija_7 = excluded.frekvencija_7
  where s.odobreno is null;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'ad_id', s.ad_id)), '[]'::jsonb)
    from public.meta_oglasi_stanje s
    where s.datum in (select distinct (r->>'datum')::date from jsonb_array_elements(p_redovi) r) and s.stanje = 'prijedlog_pauza' and s.odobreno is null);
end $$;

create or replace function public.nadzor_meta_prijedlog(p_kljuc text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  perform privatno.provjeri(p_kljuc);
  return (select to_jsonb(s) from public.meta_oglasi_stanje s where s.id = p_id);
end $$;

-- Bilježi odluku samo za prijedlog koji još čeka (vraća false ako je već odlučeno).
create or replace function public.nadzor_meta_odluka(p_kljuc text, p_id uuid, p_odobreno boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  update public.meta_oglasi_stanje set odobreno = p_odobreno, odluceno = now(),
    stanje = case when p_odobreno then 'pauziran' else stanje end
  where id = p_id and stanje = 'prijedlog_pauza' and odobreno is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- Za ekrane: dnevni retci i zadnja ocjena svakog oglasa.
create or replace function public.nadzor_meta_oglasi(p_kljuc text, p_dana integer default 30)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_od date := case when coalesce(p_dana, 0) > 0 then (now() at time zone 'Europe/Zagreb')::date - (p_dana - 1) else date '2000-01-01' end;
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'dani', (select coalesce(jsonb_agg(to_jsonb(d) order by d.datum, d.ad_id), '[]'::jsonb) from public.meta_oglasi_dan d where d.datum >= v_od),
    'stanje', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      from (select distinct on (ad_id) * from public.meta_oglasi_stanje order by ad_id, datum desc) s)
  );
end $$;

revoke all on function public.nadzor_meta_upis(text,jsonb) from public, authenticated;
revoke all on function public.nadzor_meta_stanje_upis(text,jsonb) from public, authenticated;
revoke all on function public.nadzor_meta_prijedlog(text,uuid) from public, authenticated;
revoke all on function public.nadzor_meta_odluka(text,uuid,boolean) from public, authenticated;
revoke all on function public.nadzor_meta_oglasi(text,integer) from public, authenticated;
grant execute on function public.nadzor_meta_upis(text,jsonb) to anon;
grant execute on function public.nadzor_meta_stanje_upis(text,jsonb) to anon;
grant execute on function public.nadzor_meta_prijedlog(text,uuid) to anon;
grant execute on function public.nadzor_meta_odluka(text,uuid,boolean) to anon;
grant execute on function public.nadzor_meta_oglasi(text,integer) to anon;
