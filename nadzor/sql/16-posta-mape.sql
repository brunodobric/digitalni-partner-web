-- Pošta kao prava mail aplikacija: mape Arhiva i Obrisano, zvjezdica (Označeno), filtar po adresi
-- na koju je mail stigao i skupne radnje. Pokreće se nakon 15-posta-spam.sql.
-- Stare funkcije ostaju, da Worker radi i prije i poslije ovog SQL-a.

alter table public.posta add column if not exists oznaceno boolean not null default false;
alter table public.posta add column if not exists premjesteno timestamptz;   -- kad je mail zadnji put premješten u drugu mapu

alter table public.posta drop constraint if exists posta_mapa;
alter table public.posta add constraint posta_mapa check (mapa in ('ulazni', 'arhiva', 'spam', 'obrisano'));
create index if not exists posta_oznaceno_id on public.posta (id desc) where oznaceno;

-- Premještanje u mapu (jedan mail). Sada i Arhiva i Obrisano.
create or replace function public.nadzor_posta_mapa(p_kljuc text, p_id bigint, p_mapa text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  if p_mapa not in ('ulazni', 'arhiva', 'spam', 'obrisano') then raise exception 'Nepoznata mapa'; end if;
  update public.posta
  set mapa = p_mapa, premjesteno = now(),
      spam_razlog = case when p_mapa = 'spam' then (case when mapa = 'spam' then spam_razlog else 'premješteno ručno' end) else '' end
  where id = p_id;
  return found;
end $$;

-- Popis jedne mape. p_mapa: ulazni, arhiva, spam, obrisano ili oznaceno (sve sa zvjezdicom osim Spama i Obrisanog).
-- p_adresa: samo mailovi koji su stigli na tu adresu (prazno = sve adrese).
create or replace function public.nadzor_posta_popis(p_kljuc text, p_trazi text, p_prije_id bigint, p_mapa text, p_adresa text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t text := nullif(trim(coalesce(p_trazi, '')), '');
  v_a text := nullif(lower(trim(coalesce(p_adresa, ''))), '');
  v_mapa text := case when p_mapa in ('ulazni', 'arhiva', 'spam', 'obrisano', 'oznaceno') then p_mapa else 'ulazni' end;
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'mapa', v_mapa,
    'adresa', coalesce(v_a, ''),
    'neprocitano', (select count(*) from public.posta where not procitano and mapa = 'ulazni'),
    'spam', (select count(*) from public.posta where mapa = 'spam'),
    'brojevi', (select jsonb_build_object(
        'ulazni', count(*) filter (where mapa = 'ulazni' and not procitano),
        'oznaceno', count(*) filter (where oznaceno and mapa in ('ulazni', 'arhiva')),
        'arhiva', count(*) filter (where mapa = 'arhiva'),
        'spam', count(*) filter (where mapa = 'spam'),
        'obrisano', count(*) filter (where mapa = 'obrisano'))
      from public.posta),
    'adrese', (select coalesce(jsonb_agg(a order by a.adresa), '[]'::jsonb) from (
        select lower(omotnica_za) as adresa,
               count(*) filter (where mapa = 'ulazni' and not procitano) as neprocitano,
               count(*) as ukupno
        from public.posta where mapa in ('ulazni', 'arhiva') and omotnica_za <> ''
        group by lower(omotnica_za)
      ) a),
    'ukupno', (select count(*) from public.posta p
               where (case when v_mapa = 'oznaceno' then p.oznaceno and p.mapa in ('ulazni', 'arhiva') else p.mapa = v_mapa end)
                 and (v_a is null or lower(p.omotnica_za) = v_a)),
    'mailovi', (
      select coalesce(jsonb_agg(m order by m.id desc), '[]'::jsonb) from (
        select p.id, p.primljeno, p.poslano, p.od, p.adresa, p.omotnica_od, p.omotnica_za, p.naslov, p.procitano, p.oznaceno, p.izvod, p.mapa, p.spam_razlog,
               left(regexp_replace(p.tekst, '\s+', ' ', 'g'), 160) as isjecak,
               jsonb_array_length(p.privitci) as broj_privitaka
        from public.posta p
        where (case when v_mapa = 'oznaceno' then p.oznaceno and p.mapa in ('ulazni', 'arhiva') else p.mapa = v_mapa end)
          and (v_a is null or lower(p.omotnica_za) = v_a)
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

-- Skupne radnje nad odabranim mailovima (najviše 500 odjednom).
-- p_radnja: ulazni, arhiva, spam, obrisano (premještanje), procitano, neprocitano, oznaci, odznaci.
-- Vraća broj promijenjenih mailova.
create or replace function public.nadzor_posta_skupno(p_kljuc text, p_ids bigint[], p_radnja text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Najviše 500 mailova odjednom'; end if;
  if p_radnja in ('ulazni', 'arhiva', 'spam', 'obrisano') then
    update public.posta
    set mapa = p_radnja, premjesteno = now(),
        spam_razlog = case when p_radnja = 'spam' then (case when mapa = 'spam' then spam_razlog else 'premješteno ručno' end) else '' end
    where id = any(p_ids) and mapa <> p_radnja;
  elsif p_radnja in ('procitano', 'neprocitano') then
    update public.posta set procitano = (p_radnja = 'procitano') where id = any(p_ids) and procitano <> (p_radnja = 'procitano');
  elsif p_radnja in ('oznaci', 'odznaci') then
    update public.posta set oznaceno = (p_radnja = 'oznaci') where id = any(p_ids) and oznaceno <> (p_radnja = 'oznaci');
  else
    raise exception 'Nepoznata radnja';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Trajno brisanje, samo iz Obrisanog ili Spama. Vraća ključeve u R2, da Worker obriše i datoteke.
-- p_ids null znači "isprazni cijelu mapu" p_mapa.
create or replace function public.nadzor_posta_obrisi_trajno(p_kljuc text, p_ids bigint[], p_mapa text)
returns text[] language plpgsql security definer set search_path = '' as $$
declare v text[];
begin
  perform privatno.provjeri(p_kljuc);
  if p_mapa not in ('obrisano', 'spam') then raise exception 'Trajno se briše samo iz Obrisanog ili Spama'; end if;
  with d as (
    delete from public.posta where mapa = p_mapa and (p_ids is null or id = any(p_ids)) returning r2_kljuc
  ) select coalesce(array_agg(r2_kljuc), '{}') into v from d;
  return v;
end $$;

-- Blokiranje sada premješta u Spam i mailove iz Arhive.
create or replace function public.nadzor_posta_blokiraj(p_kljuc text, p_uzorak text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_u text := lower(trim(coalesce(p_uzorak, ''))); v_n integer;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.posta_blokirani (uzorak) values (v_u) on conflict (uzorak) do nothing;
  update public.posta set mapa = 'spam', spam_razlog = 'blokiran pošiljatelj', premjesteno = now()
  where mapa in ('ulazni', 'arhiva') and (adresa = v_u or (left(v_u, 1) = '@' and right(adresa, length(v_u)) = v_u));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.nadzor_posta_popis(text,text,bigint,text,text) from public, authenticated;
revoke all on function public.nadzor_posta_skupno(text,bigint[],text) from public, authenticated;
revoke all on function public.nadzor_posta_obrisi_trajno(text,bigint[],text) from public, authenticated;
grant execute on function public.nadzor_posta_popis(text,text,bigint,text,text) to anon;
grant execute on function public.nadzor_posta_skupno(text,bigint[],text) to anon;
grant execute on function public.nadzor_posta_obrisi_trajno(text,bigint[],text) to anon;
