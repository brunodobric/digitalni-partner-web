-- Bankovni izvodi u formatu CAMT.053 za ekran Banka u dashboardu.
-- Pokreće se nakon 01-nadzor-shema.sql. XML čita Worker (src/camt.js), a baza sprema izvode,
-- stavke i izvornu datoteku. Isti izvod (IBAN + oznaka izvoda) uvezen dvaput se preskače.
-- Stanje računa je završno stanje (CLBD) najnovijeg izvoda za taj IBAN.

create table if not exists public.izvod_datoteke (
  sazetak text primary key check (sazetak ~ '^[0-9a-f]{64}$'),  -- SHA-256 datoteke
  naziv text not null default '' check (char_length(naziv) <= 200),
  xml text not null,
  uvezeno timestamptz not null default now()
);

create table if not exists public.izvodi (
  id bigint generated always as identity primary key,
  datoteka text not null references public.izvod_datoteke (sazetak),
  iban text not null check (iban ~ '^[A-Z0-9]{5,34}$'),
  valuta text not null check (valuta ~ '^[A-Z]{3}$'),
  oznaka text not null check (char_length(oznaka) between 1 and 200),  -- Stmt/Id
  redni_broj text,                                                      -- LglSeqNb ili ElctrncSeqNb
  izraden timestamptz,
  datum_od date,
  datum_do date,
  vlasnik text,
  banka text,
  pocetno_centi bigint,
  pocetno_datum date,
  zavrsno_centi bigint not null,
  zavrsno_datum date not null,
  raspolozivo_centi bigint,
  uskladeno boolean,  -- početno + knjiženi promet = završno; null kad izvod nema početno stanje
  uvezeno timestamptz not null default now(),
  unique (iban, oznaka)
);

create table if not exists public.izvod_stavke (
  id bigint generated always as identity primary key,
  izvod_id bigint not null references public.izvodi (id) on delete cascade,
  rb int not null,
  iznos_centi bigint not null,  -- priljev pozitivan, odljev negativan
  knjizeno date,
  datum_valute date,
  status text not null default 'BOOK',  -- BOOK knjiženo, PDNG na čekanju
  storno boolean not null default false,
  protustrana text,
  protustrana_iban text,
  opis text,
  poziv_na_broj text,
  referenca text,
  e2e text,
  broj_transakcija int not null default 1,
  unique (izvod_id, rb)
);

create index if not exists izvodi_iban_datum on public.izvodi (iban, zavrsno_datum desc);
create index if not exists izvod_stavke_knjizeno on public.izvod_stavke (knjizeno desc);

alter table public.izvod_datoteke enable row level security;
alter table public.izvodi enable row level security;
alter table public.izvod_stavke enable row level security;

-- Uvoz jedne datoteke: p_izvodi je niz koji vraća citajCamt053 (src/camt.js).
-- Vraća {uvezeni: [oznaka...], preskoceni: [oznaka...]}.
create or replace function public.nadzor_izvod_uvoz(p_kljuc text, p_naziv text, p_sazetak text, p_xml text, p_izvodi jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_iz jsonb;
  v_id bigint;
  v_uvezeni jsonb := '[]'::jsonb;
  v_preskoceni jsonb := '[]'::jsonb;
begin
  perform privatno.provjeri(p_kljuc);
  if jsonb_typeof(p_izvodi) <> 'array' or jsonb_array_length(p_izvodi) = 0 then
    raise exception 'Nema izvoda za uvoz';
  end if;

  insert into public.izvod_datoteke (sazetak, naziv, xml)
  values (p_sazetak, left(coalesce(p_naziv, ''), 200), p_xml)
  on conflict (sazetak) do nothing;

  for v_iz in select * from jsonb_array_elements(p_izvodi) loop
    insert into public.izvodi (
      datoteka, iban, valuta, oznaka, redni_broj, izraden, datum_od, datum_do, vlasnik, banka,
      pocetno_centi, pocetno_datum, zavrsno_centi, zavrsno_datum, raspolozivo_centi, uskladeno
    ) values (
      p_sazetak, v_iz->>'iban', v_iz->>'valuta', v_iz->>'oznaka', v_iz->>'redniBroj',
      (v_iz->>'izraden')::timestamptz, (v_iz->>'od')::date, (v_iz->>'do')::date,
      left(v_iz->>'vlasnik', 200), left(v_iz->>'banka', 200),
      (v_iz#>>'{pocetno,centi}')::bigint, (v_iz#>>'{pocetno,datum}')::date,
      (v_iz#>>'{zavrsno,centi}')::bigint, (v_iz#>>'{zavrsno,datum}')::date,
      (v_iz#>>'{raspolozivo,centi}')::bigint, (v_iz->>'uskladeno')::boolean
    )
    on conflict (iban, oznaka) do nothing
    returning id into v_id;

    if v_id is null then
      v_preskoceni := v_preskoceni || to_jsonb(v_iz->>'oznaka');
      continue;
    end if;

    insert into public.izvod_stavke (
      izvod_id, rb, iznos_centi, knjizeno, datum_valute, status, storno, protustrana,
      protustrana_iban, opis, poziv_na_broj, referenca, e2e, broj_transakcija
    )
    select v_id, (s->>'rb')::int, (s->>'iznosCenti')::bigint, (s->>'knjizeno')::date,
           (s->>'datumValute')::date, coalesce(s->>'status', 'BOOK'), coalesce((s->>'storno')::boolean, false),
           left(s->>'protustrana', 200), left(s->>'protustranaIban', 50), left(s->>'opis', 1000),
           left(s->>'pozivNaBroj', 100), left(s->>'referenca', 100), left(s->>'e2e', 100),
           coalesce((s->>'brojTransakcija')::int, 1)
    from jsonb_array_elements(coalesce(v_iz->'stavke', '[]'::jsonb)) s;

    v_uvezeni := v_uvezeni || to_jsonb(v_iz->>'oznaka');
    v_id := null;
  end loop;

  return jsonb_build_object('uvezeni', v_uvezeni, 'preskoceni', v_preskoceni);
end $$;

-- Sve za ekran Banka: stanje po računu, niz salda, izvodi i stavke zadnjih 13 mjeseci.
create or replace function public.nadzor_banka(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_od date := (now() at time zone 'Europe/Zagreb')::date - interval '13 months';
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'racuni', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'iban', z.iban, 'valuta', z.valuta, 'vlasnik', z.vlasnik, 'banka', z.banka,
        'stanje_centi', z.zavrsno_centi, 'stanje_datum', z.zavrsno_datum,
        'raspolozivo_centi', z.raspolozivo_centi, 'redni_broj', z.redni_broj, 'uvezeno', z.uvezeno
      ) order by z.iban), '[]'::jsonb)
      from (
        select distinct on (iban) * from public.izvodi
        order by iban, zavrsno_datum desc, datum_do desc nulls last, izraden desc nulls last, id desc
      ) z
    ),
    'salda', (
      select coalesce(jsonb_agg(jsonb_build_array(d.iban, d.zavrsno_datum, d.zavrsno_centi) order by d.iban, d.zavrsno_datum), '[]'::jsonb)
      from (
        select distinct on (iban, zavrsno_datum) iban, zavrsno_datum, zavrsno_centi from public.izvodi
        where zavrsno_datum >= v_od
        order by iban, zavrsno_datum, datum_do desc nulls last, izraden desc nulls last, id desc
      ) d
    ),
    'izvodi', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'iban', i.iban, 'valuta', i.valuta, 'oznaka', i.oznaka, 'redni_broj', i.redni_broj,
        'od', i.datum_od, 'do', i.datum_do, 'pocetno_centi', i.pocetno_centi, 'zavrsno_centi', i.zavrsno_centi,
        'zavrsno_datum', i.zavrsno_datum, 'uskladeno', i.uskladeno, 'uvezeno', i.uvezeno,
        'datoteka', f.naziv,
        'stavki', (select count(*) from public.izvod_stavke s where s.izvod_id = i.id)
      ) order by i.zavrsno_datum desc, i.id desc), '[]'::jsonb)
      from (select * from public.izvodi order by zavrsno_datum desc, id desc limit 200) i
      join public.izvod_datoteke f on f.sazetak = i.datoteka
    ),
    'stavke', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'iban', i.iban, 'valuta', i.valuta, 'izvod', coalesce(i.redni_broj, i.oznaka),
        'iznos_centi', s.iznos_centi, 'knjizeno', coalesce(s.knjizeno, i.zavrsno_datum),
        'datum_valute', s.datum_valute, 'status', s.status, 'storno', s.storno,
        'protustrana', s.protustrana, 'protustrana_iban', s.protustrana_iban, 'opis', s.opis,
        'poziv_na_broj', s.poziv_na_broj, 'broj_transakcija', s.broj_transakcija
      ) order by coalesce(s.knjizeno, i.zavrsno_datum) desc, i.id desc, s.rb desc), '[]'::jsonb)
      from public.izvod_stavke s
      join public.izvodi i on i.id = s.izvod_id
      where coalesce(s.knjizeno, i.zavrsno_datum) >= v_od
    )
  );
end $$;

revoke all on function public.nadzor_izvod_uvoz(text,text,text,text,jsonb) from public, authenticated;
revoke all on function public.nadzor_banka(text) from public, authenticated;
grant execute on function public.nadzor_izvod_uvoz(text,text,text,text,jsonb) to anon;
grant execute on function public.nadzor_banka(text) to anon;
