-- Kuverta (Supabase projekt MyWeddingInvite): zadnja aktivnost korisnika i izvori za jedan dan.
-- Pokreće se u projektu MyWeddingInvite, nakon 12 i 20 iz ove mape. Zamjenjuje nadzor_korisnici iz 12
-- i nadzor_izvori iz 12, a nadzor_oznake iz 20 dobiva isti parametar za dan.
--
-- Zadnja aktivnost: last_sign_in_at se mijenja samo kod nove prijave, pa korisnik koji ostane prijavljen
-- u pregledniku zauvijek ima datum registracije. Sesija (auth.sessions) se zato osvježi svaki put kad
-- korisnik otvori Kuvertu nakon što mu istekne pristupni token (sat vremena), jer Worker Kuverte tada
-- obnovi token. Zadnje osvježavanje sesije je zato stvarna zadnja aktivnost, s točnošću od oko sat vremena.
-- Kad se korisnik odjavi, sesija se briše, pa ostaje zadnja prijava.

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
      'zadnja_aktivnost', greatest(u.last_sign_in_at, (
        select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC'))
        from auth.sessions s where s.user_id = u.id
      )),
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

-- Izvori: novi parametar p_dan (jedan dan, klik na stupac grafa). Kad je zadan, p_dana se ne gleda.
-- Graf po danu prati razdoblje (7, 30 ili 90 dana; "sve" crta zadnjih 90) i ima i registracije.
drop function if exists public.nadzor_izvori(text, integer);
create or replace function public.nadzor_izvori(p_kljuc text, p_dana integer default 30, p_dan date default null)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  v_danas date := (now() at time zone 'Europe/Zagreb')::date;
  v_od date := case when p_dan is not null then p_dan
                    when coalesce(p_dana, 0) > 0 then v_danas - (p_dana - 1) else '-infinity'::date end;
  v_do date := coalesce(p_dan, 'infinity'::date);
  v_graf_od date := case when coalesce(p_dana, 0) between 1 and 90 then v_danas - (p_dana - 1) else v_danas - 89 end;
begin
  if p_kljuc is null or not exists (
    select 1 from nadzor.kljuc where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'od', case when v_od = '-infinity'::date then null else v_od end,
    'dan', p_dan,
    'po_izvoru', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'izvor', s.izvor, 'posjete', s.posjete, 'registracije', s.registracije, 'kupnje', s.kupnje, 'prihod', s.prihod
      ) order by s.prihod desc, s.registracije desc, s.posjete desc), '[]'::jsonb)
      from (
        select izvor, sum(posjete)::int posjete, sum(registracije)::int registracije, sum(kupnje)::int kupnje,
               round(sum(prihod), 2) prihod
        from (
          select p.izvor, p.broj posjete, 0 registracije, 0 kupnje, 0::numeric prihod
          from statistika.posjete p where p.dan between v_od and v_do
          union all
          select public.nadzor_izvor_racuna(u.raw_user_meta_data), 0, 1, 0, 0
          from auth.users u
          where u.deleted_at is null and (u.created_at at time zone 'Europe/Zagreb')::date between v_od and v_do
          union all
          select coalesce(public.nadzor_izvor_racuna(u.raw_user_meta_data), 'obrisan račun'), 0, 0, 1, up.iznos_centi / 100.0
          from public.uplate up left join auth.users u on u.id = up.owner_id
          where not up.testni and (up.created_at at time zone 'Europe/Zagreb')::date between v_od and v_do
        ) x
        group by izvor
      ) s
    ),
    'po_kampanji', (
      select coalesce(jsonb_agg(jsonb_build_object('izvor', izvor, 'medij', medij, 'kampanja', kampanja, 'posjete', broj) order by broj desc), '[]'::jsonb)
      from (
        select izvor, medij, kampanja, sum(broj)::int broj
        from statistika.posjete where dan between v_od and v_do and (medij <> '' or kampanja <> '')
        group by izvor, medij, kampanja
        order by 4 desc
        limit 50
      ) k
    ),
    -- Posjete i registracije po danu, za graf (uvijek cijelo razdoblje, i kad je odabran jedan dan).
    'po_danu', (
      select coalesce(jsonb_agg(jsonb_build_object('dan', g.dan::date, 'posjete', coalesce(p.broj, 0), 'registracije', coalesce(r.broj, 0)) order by g.dan), '[]'::jsonb)
      from generate_series(v_graf_od, v_danas, interval '1 day') g(dan)
      left join (select dan, sum(broj)::int broj from statistika.posjete where dan >= v_graf_od group by dan) p on p.dan = g.dan::date
      left join (
        select (created_at at time zone 'Europe/Zagreb')::date dan, count(*)::int broj
        from auth.users where deleted_at is null and (created_at at time zone 'Europe/Zagreb')::date >= v_graf_od
        group by 1
      ) r on r.dan = g.dan::date
    )
  );
end $$;

revoke all on function public.nadzor_izvori(text, integer, date) from public, authenticated;
grant execute on function public.nadzor_izvori(text, integer, date) to anon;

drop function if exists public.nadzor_oznake(text, integer);
create or replace function public.nadzor_oznake(p_kljuc text, p_dana integer default 30, p_dan date default null)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  v_od date := case when p_dan is not null then p_dan
                    when coalesce(p_dana, 0) > 0 then (now() at time zone 'Europe/Zagreb')::date - (p_dana - 1)
                    else '-infinity'::date end;
  v_do date := coalesce(p_dan, 'infinity'::date);
begin
  if p_kljuc is null or not exists (
    select 1 from nadzor.kljuc where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'izvor', s.izvor, 'medij', s.medij, 'kampanja', s.kampanja, 'oglas', s.oglas,
      'posjete', s.posjete, 'registracije', s.registracije, 'kupnje', s.kupnje, 'prihod', s.prihod
    ) order by s.prihod desc, s.registracije desc, s.posjete desc, s.oglas)
    from (
      select izvor, medij, kampanja, oglas, sum(posjete)::int posjete, sum(registracije)::int registracije,
             sum(kupnje)::int kupnje, round(sum(prihod), 2) prihod
      from (
        select p.izvor, p.medij, p.kampanja, p.oglas, p.broj posjete, 0 registracije, 0 kupnje, 0::numeric prihod
        from statistika.posjete p
        where p.dan between v_od and v_do
        union all
        select m #>> '{izvor}', coalesce(m #>> '{medij}', ''), coalesce(m #>> '{kampanja}', ''), coalesce(m #>> '{oglas}', ''), 0, 1, 0, 0
        from (select u.raw_user_meta_data -> 'izvor' m, u.created_at from auth.users u where u.deleted_at is null) u
        where (u.created_at at time zone 'Europe/Zagreb')::date between v_od and v_do and coalesce(m ->> 'izvor', '') <> ''
        union all
        select m #>> '{izvor}', coalesce(m #>> '{medij}', ''), coalesce(m #>> '{kampanja}', ''), coalesce(m #>> '{oglas}', ''), 0, 0, 1, up.iznos_centi / 100.0
        from public.uplate up join (select id, raw_user_meta_data -> 'izvor' m from auth.users) u on u.id = up.owner_id
        where not up.testni and (up.created_at at time zone 'Europe/Zagreb')::date between v_od and v_do and coalesce(m ->> 'izvor', '') <> ''
      ) x
      group by izvor, medij, kampanja, oglas
      order by 8 desc, 6 desc, 5 desc
      limit 500
    ) s
  ), '[]'::jsonb);
end $$;

revoke all on function public.nadzor_oznake(text, integer, date) from public, authenticated;
grant execute on function public.nadzor_oznake(text, integer, date) to anon;

notify pgrst, 'reload schema';
