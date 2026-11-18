-- Mapa Spam i blokirani pošiljatelji (ekran Pošta). Pokreće se nakon 14-posta.sql.
-- Mail ide u Spam ako je pošiljatelj blokiran ili ako ne prođe provjeru pošiljatelja:
--   DMARC fail, ili SPF fail/softfail bez DKIM pass i bez DMARC pass.
-- Izvodi se uvoze bez obzira na mapu.

alter table public.posta add column if not exists adresa text not null default '';      -- adresa pošiljatelja (From), mala slova
alter table public.posta add column if not exists mapa text not null default 'ulazni';
alter table public.posta add column if not exists spam_razlog text not null default '';
do $$ begin
  alter table public.posta add constraint posta_mapa check (mapa in ('ulazni', 'spam'));
exception when duplicate_object then null; end $$;
create index if not exists posta_mapa_id on public.posta (mapa, id desc);

-- Postojeći mailovi dobiju adresu iz zaglavlja From.
update public.posta
set adresa = lower(coalesce(substring(od from '[^\s<>"(),;:]+@[^\s<>"(),;:]+'), omotnica_od))
where adresa = '';

create table if not exists public.posta_blokirani (
  uzorak text primary key check (uzorak ~ '^([^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$'),  -- adresa ili @domena
  dodano timestamptz not null default now()
);
alter table public.posta_blokirani enable row level security;

create or replace function privatno.posta_blokiran(p_adresa text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posta_blokirani b
    where p_adresa <> '' and (b.uzorak = p_adresa or (left(b.uzorak, 1) = '@' and right(p_adresa, length(b.uzorak)) = b.uzorak))
  );
$$;

create or replace function privatno.posta_provjera_pada(p_provjera text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_provjera, '') ~ '\mdmarc=fail'
      or (coalesce(p_provjera, '') ~ '\mspf=(fail|softfail)'
          and coalesce(p_provjera, '') !~ '\mdkim=pass'
          and coalesce(p_provjera, '') !~ '\mdmarc=pass');
$$;

-- Upis maila, sada i s adresom pošiljatelja i razvrstavanjem u mapu.
create or replace function public.nadzor_posta_upis(p_kljuc text, p_mail jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_adresa text := lower(left(coalesce(p_mail->>'adresa', ''), 320));
  v_provjera text := left(coalesce(p_mail->>'provjera', ''), 200);
  v_razlog text := '';
begin
  perform privatno.provjeri(p_kljuc);
  if privatno.posta_blokiran(v_adresa) then
    v_razlog := 'blokiran pošiljatelj';
  elsif privatno.posta_provjera_pada(v_provjera) then
    v_razlog := 'pao provjeru pošiljatelja (' || v_provjera || ')';
  end if;
  insert into public.posta (r2_kljuc, omotnica_od, omotnica_za, od, za, kopija, odgovor_na, naslov, poslano, message_id, velicina, tekst, ima_html, privitci, provjera, adresa, mapa, spam_razlog)
  values (
    p_mail->>'r2_kljuc',
    left(coalesce(p_mail->>'omotnica_od', ''), 500),
    left(coalesce(p_mail->>'omotnica_za', ''), 500),
    left(coalesce(p_mail->>'od', ''), 500),
    left(coalesce(p_mail->>'za', ''), 2000),
    left(coalesce(p_mail->>'kopija', ''), 2000),
    left(coalesce(p_mail->>'odgovor_na', ''), 500),
    left(coalesce(p_mail->>'naslov', ''), 1000),
    case when coalesce(p_mail->>'poslano', '') ~ '^\d{4}-\d{2}-\d{2}T' then (p_mail->>'poslano')::timestamptz end,
    left(coalesce(p_mail->>'message_id', ''), 500),
    coalesce((p_mail->>'velicina')::int, 0),
    left(coalesce(p_mail->>'tekst', ''), 100000),
    coalesce((p_mail->>'ima_html')::boolean, false),
    case when jsonb_typeof(p_mail->'privitci') = 'array' then p_mail->'privitci' else '[]'::jsonb end,
    v_provjera,
    v_adresa,
    case when v_razlog = '' then 'ulazni' else 'spam' end,
    v_razlog
  )
  on conflict (r2_kljuc) do update set r2_kljuc = excluded.r2_kljuc
  returning id into v_id;
  return v_id;
end $$;

-- Popis jedne mape. Brojevi: nepročitani u ulaznoj pošti, ukupno u ovoj mapi, i broj mailova u Spamu.
create or replace function public.nadzor_posta_popis(p_kljuc text, p_trazi text, p_prije_id bigint, p_mapa text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t text := nullif(trim(coalesce(p_trazi, '')), '');
  v_mapa text := case when p_mapa = 'spam' then 'spam' else 'ulazni' end;
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'mapa', v_mapa,
    'neprocitano', (select count(*) from public.posta where not procitano and mapa = 'ulazni'),
    'ukupno', (select count(*) from public.posta where mapa = v_mapa),
    'spam', (select count(*) from public.posta where mapa = 'spam'),
    'mailovi', (
      select coalesce(jsonb_agg(m order by m.id desc), '[]'::jsonb) from (
        select p.id, p.primljeno, p.poslano, p.od, p.omotnica_od, p.omotnica_za, p.naslov, p.procitano, p.izvod, p.mapa, p.spam_razlog,
               left(regexp_replace(p.tekst, '\s+', ' ', 'g'), 160) as isjecak,
               jsonb_array_length(p.privitci) as broj_privitaka
        from public.posta p
        where p.mapa = v_mapa
          and (p_prije_id is null or p.id < p_prije_id)
          and (v_t is null
               or p.od ilike '%' || v_t || '%' or p.omotnica_od ilike '%' || v_t || '%'
               or p.za ilike '%' || v_t || '%' or p.omotnica_za ilike '%' || v_t || '%'
               or p.naslov ilike '%' || v_t || '%' or p.tekst ilike '%' || v_t || '%')
        order by p.id desc
        limit 50
      ) m
    )
  );
end $$;

-- Premještanje jednog maila u ulaznu poštu ili u Spam.
create or replace function public.nadzor_posta_mapa(p_kljuc text, p_id bigint, p_mapa text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  if p_mapa not in ('ulazni', 'spam') then raise exception 'Nepoznata mapa'; end if;
  update public.posta
  set mapa = p_mapa, spam_razlog = case when p_mapa = 'spam' then 'premješteno ručno' else '' end
  where id = p_id;
  return found;
end $$;

-- Blokiranje adrese ili domene (@domena.hr). Svi postojeći mailovi od tog pošiljatelja idu u Spam.
-- Vraća koliko je mailova premješteno.
create or replace function public.nadzor_posta_blokiraj(p_kljuc text, p_uzorak text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_u text := lower(trim(coalesce(p_uzorak, ''))); v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.posta_blokirani (uzorak) values (v_u) on conflict (uzorak) do nothing;
  update public.posta set mapa = 'spam', spam_razlog = 'blokiran pošiljatelj'
  where mapa = 'ulazni' and (adresa = v_u or (left(v_u, 1) = '@' and right(adresa, length(v_u)) = v_u));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Odblokiranje. Mailovi ostaju u Spamu dok ih ne premjestiš.
create or replace function public.nadzor_posta_odblokiraj(p_kljuc text, p_uzorak text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  delete from public.posta_blokirani where uzorak = lower(trim(coalesce(p_uzorak, '')));
  return found;
end $$;

create or replace function public.nadzor_posta_blokirani(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return (select coalesce(jsonb_agg(jsonb_build_object('uzorak', uzorak, 'dodano', dodano) order by uzorak), '[]'::jsonb) from public.posta_blokirani);
end $$;

revoke all on function privatno.posta_blokiran(text) from public, anon, authenticated;
revoke all on function privatno.posta_provjera_pada(text) from public, anon, authenticated;
revoke all on function public.nadzor_posta_popis(text,text,bigint,text) from public, authenticated;
revoke all on function public.nadzor_posta_mapa(text,bigint,text) from public, authenticated;
revoke all on function public.nadzor_posta_blokiraj(text,text) from public, authenticated;
revoke all on function public.nadzor_posta_odblokiraj(text,text) from public, authenticated;
revoke all on function public.nadzor_posta_blokirani(text) from public, authenticated;
grant execute on function public.nadzor_posta_popis(text,text,bigint,text) to anon;
grant execute on function public.nadzor_posta_mapa(text,bigint,text) to anon;
grant execute on function public.nadzor_posta_blokiraj(text,text) to anon;
grant execute on function public.nadzor_posta_odblokiraj(text,text) to anon;
grant execute on function public.nadzor_posta_blokirani(text) to anon;
