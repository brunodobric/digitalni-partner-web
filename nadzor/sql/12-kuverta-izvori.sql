-- Kuverta (Supabase projekt MyWeddingInvite): otkud dolaze posjetitelji, registracije i kupnje.
-- Pokreće se u projektu MyWeddingInvite, nakon migracije 024_izvori_kupaca.sql iz repozitorija
-- MyWeddingInvite (tablica statistika.posjete) i nakon 02 i 06 iz ove mape (nadzor.kljuc).
--
-- Izvor računa: oznaka s kojom je korisnik došao (user_metadata.izvor, samo uz pristanak na kolačiće),
-- a ako je nema, odgovor na pitanje "Kako ste čuli za Kuvertu?" (user_metadata.cuo_od).
-- Vraća samo brojeve po izvoru, bez e-mailova.

create or replace function public.nadzor_izvor_racuna(p_meta jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(p_meta #>> '{izvor,izvor}', ''),
    case p_meta ->> 'cuo_od' when 'pozivnica' then 'potpis' when '' then null else p_meta ->> 'cuo_od' end,
    'nepoznato'
  )
$$;
revoke all on function public.nadzor_izvor_racuna(jsonb) from public, anon, authenticated;

-- p_dana: razdoblje u danima (npr. 7, 30, 90), null ili 0 = sve.
create or replace function public.nadzor_izvori(p_kljuc text, p_dana integer default 30)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  v_od date := case when coalesce(p_dana, 0) > 0
                    then (now() at time zone 'Europe/Zagreb')::date - (p_dana - 1) else '-infinity'::date end;
begin
  if p_kljuc is null or not exists (
    select 1 from nadzor.kljuc where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'od', case when v_od = '-infinity'::date then null else v_od end,
    -- Po izvoru: posjete, registracije, kupnje i prihod u razdoblju.
    'po_izvoru', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'izvor', s.izvor, 'posjete', s.posjete, 'registracije', s.registracije, 'kupnje', s.kupnje, 'prihod', s.prihod
      ) order by s.prihod desc, s.registracije desc, s.posjete desc), '[]'::jsonb)
      from (
        select izvor, sum(posjete)::int posjete, sum(registracije)::int registracije, sum(kupnje)::int kupnje,
               round(sum(prihod), 2) prihod
        from (
          select p.izvor, p.broj posjete, 0 registracije, 0 kupnje, 0::numeric prihod
          from statistika.posjete p where p.dan >= v_od
          union all
          select public.nadzor_izvor_racuna(u.raw_user_meta_data), 0, 1, 0, 0
          from auth.users u
          where u.deleted_at is null and (u.created_at at time zone 'Europe/Zagreb')::date >= v_od
          union all
          select coalesce(public.nadzor_izvor_racuna(u.raw_user_meta_data), 'obrisan račun'), 0, 0, 1, up.iznos_centi / 100.0
          from public.uplate up left join auth.users u on u.id = up.owner_id
          where not up.testni and (up.created_at at time zone 'Europe/Zagreb')::date >= v_od
        ) x
        group by izvor
      ) s
    ),
    -- Posjete po kampanji (oznake utm_medium i utm_campaign), npr. oglasi Black Week.
    'po_kampanji', (
      select coalesce(jsonb_agg(jsonb_build_object('izvor', izvor, 'medij', medij, 'kampanja', kampanja, 'posjete', broj) order by broj desc), '[]'::jsonb)
      from (
        select izvor, medij, kampanja, sum(broj)::int broj
        from statistika.posjete where dan >= v_od and (medij <> '' or kampanja <> '')
        group by izvor, medij, kampanja
        order by 4 desc
        limit 50
      ) k
    ),
    -- Posjete po danu (zadnjih 30 dana), za mali graf.
    'po_danu', (
      select coalesce(jsonb_agg(jsonb_build_object('dan', g.dan, 'posjete', coalesce(p.broj, 0)) order by g.dan), '[]'::jsonb)
      from generate_series((now() at time zone 'Europe/Zagreb')::date - 29, (now() at time zone 'Europe/Zagreb')::date, interval '1 day') g(dan)
      left join (select dan, sum(broj)::int broj from statistika.posjete group by dan) p on p.dan = g.dan::date
    )
  );
end $$;

revoke all on function public.nadzor_izvori(text, integer) from public, authenticated;
grant execute on function public.nadzor_izvori(text, integer) to anon;

-- Popis korisnika (06) dobiva stupac izvor.
create or replace function public.nadzor_korisnici(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
begin
  if p_kljuc is null or not exists (
    select 1 from nadzor.kljuc where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'email', u.email,
      'registriran', u.created_at,
      'zadnja_prijava', u.last_sign_in_at,
      'potvrden', u.email_confirmed_at is not null,
      'izvor', public.nadzor_izvor_racuna(u.raw_user_meta_data),
      'pozivnica', exists (select 1 from public.invitations i where i.owner_id = u.id),
      'album', exists (select 1 from public.albums a where a.owner_id = u.id),
      'raspored', exists (select 1 from public.seating_plans s where s.owner_id = u.id),
      'placeno', (select coalesce(sum(p.iznos_centi), 0) / 100.0 from public.uplate p where p.owner_id = u.id and not coalesce(p.testni, false))
    ) order by u.created_at desc)
    from auth.users u
    where u.deleted_at is null
  ), '[]'::jsonb);
end $$;

revoke all on function public.nadzor_korisnici(text) from public, authenticated;
grant execute on function public.nadzor_korisnici(text) to anon;

notify pgrst, 'reload schema';
