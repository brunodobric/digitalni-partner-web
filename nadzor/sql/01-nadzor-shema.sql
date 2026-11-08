-- Baza dashboarda (Supabase projekt dp-nadzor).
-- Sve tablice imaju uključen RLS bez ijednog pravila, pa im se izvana ne može pristupiti izravno.
-- Worker dashboarda razgovara s bazom samo preko funkcija ispod, a svaka traži tajni ključ
-- čiji se SHA-256 sažetak čuva u privatnoj shemi (sam ključ je tajna u Workeru).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists privatno;
revoke all on schema privatno from public, anon, authenticated;

create table if not exists privatno.kljuc (
  id smallint primary key default 1 check (id = 1),
  sazetak text not null
);

-- LINIJE: usluge, aplikacije, vjencanja, obrt (zajedničko)

create table if not exists public.klijenti (
  id bigint generated always as identity primary key,
  oznaka text not null,
  djelatnost text not null default '',
  paket text not null,
  mjesecno numeric(10,2) not null default 0,
  pocetak date not null,
  obveza_do date,
  stanje text not null default 'aktivan' check (stanje in ('aktivan','novi','neuspjela naplata','otkazan')),
  ogledno boolean not null default false,
  stvoreno timestamptz not null default now()
);

create table if not exists public.upiti (
  id bigint generated always as identity primary key,
  stvoreno timestamptz not null default now(),
  ime text not null check (char_length(ime) between 1 and 120),
  kontakt text not null default '' check (char_length(kontakt) <= 200),
  djelatnost text not null default '' check (char_length(djelatnost) <= 120),
  poruka text not null default '' check (char_length(poruka) <= 4000),
  izvor text not null default 'web',
  status text not null default 'novi' check (status in ('novi','razgovor','ponuda','ugovor','odbijen')),
  ogledno boolean not null default false
);

create table if not exists public.prihodi (
  id bigint generated always as identity primary key,
  datum date not null,
  linija text not null check (linija in ('usluge','aplikacije','vjencanja')),
  opis text not null default '',
  iznos numeric(10,2) not null,
  izvor text not null default 'rucno',
  ogledno boolean not null default false
);

create table if not exists public.troskovi (
  id bigint generated always as identity primary key,
  datum date not null,
  opis text not null check (char_length(opis) between 1 and 200),
  iznos numeric(10,2) not null check (iznos >= 0),
  linija text not null default 'obrt' check (linija in ('obrt','usluge','aplikacije','vjencanja')),
  ogledno boolean not null default false
);

-- Dnevne metrike: jedan redak po danu, liniji i metrici. Novi izvor = novi prikupljač, ne nova tablica.
create table if not exists public.metrike (
  datum date not null,
  linija text not null,
  metrika text not null,
  vrijednost numeric not null,
  izvor text not null,
  ogledno boolean not null default false,
  azurirano timestamptz not null default now(),
  primary key (datum, linija, metrika)
);

-- Zapisnik pokretanja prikupljača (vidi se na dashboardu kao "zadnje osvježavanje").
create table if not exists public.osvjezavanja (
  id bigint generated always as identity primary key,
  vrijeme timestamptz not null default now(),
  izvor text not null,
  uspjeh boolean not null,
  poruka text not null default ''
);

alter table public.klijenti enable row level security;
alter table public.upiti enable row level security;
alter table public.prihodi enable row level security;
alter table public.troskovi enable row level security;
alter table public.metrike enable row level security;
alter table public.osvjezavanja enable row level security;

create or replace function privatno.provjeri(p_kljuc text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_kljuc is null or not exists (
    select 1 from privatno.kljuc
    where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;
end $$;

-- Novi upit s kontakt obrasca na webu.
create or replace function public.nadzor_upit(p_kljuc text, p_ime text, p_kontakt text, p_djelatnost text, p_poruka text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.upiti (ime, kontakt, djelatnost, poruka)
  values (left(coalesce(p_ime,''),120), left(coalesce(p_kontakt,''),200), left(coalesce(p_djelatnost,''),120), left(coalesce(p_poruka,''),4000))
  returning id into v_id;
  return v_id;
end $$;

-- Promjena statusa upita (lijevak prodaje).
create or replace function public.nadzor_upit_status(p_kljuc text, p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  update public.upiti set status = p_status where id = p_id;
end $$;

-- Ručni unos troška.
create or replace function public.nadzor_trosak(p_kljuc text, p_datum date, p_opis text, p_iznos numeric, p_linija text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.troskovi (datum, opis, iznos, linija) values (p_datum, p_opis, p_iznos, coalesce(p_linija,'obrt'))
  returning id into v_id;
  return v_id;
end $$;

-- Upis metrika iz prikupljača: [{datum, linija, metrika, vrijednost, izvor}, ...]
create or replace function public.nadzor_metrike(p_kljuc text, p_redovi jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.metrike (datum, linija, metrika, vrijednost, izvor, ogledno, azurirano)
  select (r->>'datum')::date, r->>'linija', r->>'metrika', (r->>'vrijednost')::numeric, r->>'izvor', false, now()
  from jsonb_array_elements(p_redovi) r
  on conflict (datum, linija, metrika) do update
    set vrijednost = excluded.vrijednost, izvor = excluded.izvor, ogledno = false, azurirano = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.nadzor_zapis(p_kljuc text, p_izvor text, p_uspjeh boolean, p_poruka text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.osvjezavanja (izvor, uspjeh, poruka) values (p_izvor, p_uspjeh, left(coalesce(p_poruka,''), 1000));
end $$;

-- Kad se izvor spoji: brisanje oglednih redaka jedne linije (ili svih, p_linija = 'sve').
create or replace function public.nadzor_obrisi_ogledno(p_kljuc text, p_linija text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  if p_linija in ('usluge','sve') then
    delete from public.klijenti where ogledno;
    delete from public.upiti where ogledno;
  end if;
  delete from public.prihodi where ogledno and (linija = p_linija or p_linija = 'sve');
  delete from public.metrike where ogledno and (linija = p_linija or p_linija = 'sve');
  if p_linija in ('obrt','sve') then
    delete from public.troskovi where ogledno;
  end if;
end $$;

-- Sve što dashboard prikazuje, u jednom JSON-u.
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
        left join public.prihodi p on date_trunc('month', p.datum) = g.mj
        group by g.mj
      ) x
    ),
    'prihod_godina', (select coalesce(sum(iznos), 0) from public.prihodi where date_trunc('year', datum) = date_trunc('year', v_danas)),
    'prihod_godina_ogledno', (select coalesce(bool_or(ogledno), false) from public.prihodi where date_trunc('year', datum) = date_trunc('year', v_danas)),
    'klijenti', (select coalesce(jsonb_agg(to_jsonb(k) order by k.obveza_do nulls last, k.pocetak), '[]'::jsonb) from public.klijenti k where k.stanje <> 'otkazan'),
    'otkazani_ovaj_mjesec', (select count(*) from public.klijenti where stanje = 'otkazan' and stvoreno >= v_mj),
    'upiti', (select coalesce(jsonb_agg(to_jsonb(u) order by u.stvoreno desc), '[]'::jsonb) from (select * from public.upiti where stvoreno >= v_mj - interval '2 months' order by stvoreno desc limit 100) u),
    'prihodi_ovaj_mjesec', (select coalesce(jsonb_agg(to_jsonb(p) order by p.datum desc), '[]'::jsonb) from public.prihodi p where p.datum >= v_mj),
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

revoke all on function privatno.provjeri(text) from public, anon, authenticated;
grant usage on schema privatno to postgres;
grant execute on function public.nadzor_upit(text,text,text,text,text) to anon;
grant execute on function public.nadzor_upit_status(text,bigint,text) to anon;
grant execute on function public.nadzor_trosak(text,date,text,numeric,text) to anon;
grant execute on function public.nadzor_metrike(text,jsonb) to anon;
grant execute on function public.nadzor_zapis(text,text,boolean,text) to anon;
grant execute on function public.nadzor_obrisi_ogledno(text,text) to anon;
grant execute on function public.nadzor_podaci(text) to anon;
