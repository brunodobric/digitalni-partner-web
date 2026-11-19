-- Kuverta (Supabase projekt MyWeddingInvite): posjete, registracije i kupnje po oznaci poveznice
-- (izvor, medij, kampanja i utm_content). Iz ovoga nadzor slaže tablice "Po grupi" (utm_medium=grupa)
-- i "Pinterest" (utm_source=pinterest, medij profil ili pin, ime pina u utm_content).
-- Zamjenjuje nadzor_grupe iz 18 (ta ostaje, nadzor je koristi dok se ova ne pokrene).
--
-- Pokreće se u projektu MyWeddingInvite, nakon migracije 029_posjete_oglas.sql. Vraća samo brojeve, bez e-mailova.

-- p_dana: razdoblje u danima (npr. 7, 30, 90), null ili 0 = sve.
create or replace function public.nadzor_oznake(p_kljuc text, p_dana integer default 30)
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
        where p.dan >= v_od and (p.oglas <> '' or p.medij = 'grupa' or p.izvor = 'pinterest')
        union all
        select m #>> '{izvor}', coalesce(m #>> '{medij}', ''), coalesce(m #>> '{kampanja}', ''), coalesce(m #>> '{oglas}', ''), 0, 1, 0, 0
        from (select u.raw_user_meta_data -> 'izvor' m, u.created_at from auth.users u where u.deleted_at is null) u
        where (u.created_at at time zone 'Europe/Zagreb')::date >= v_od and coalesce(m ->> 'izvor', '') <> ''
          and (coalesce(m ->> 'oglas', '') <> '' or m ->> 'medij' = 'grupa' or m ->> 'izvor' = 'pinterest')
        union all
        select m #>> '{izvor}', coalesce(m #>> '{medij}', ''), coalesce(m #>> '{kampanja}', ''), coalesce(m #>> '{oglas}', ''), 0, 0, 1, up.iznos_centi / 100.0
        from public.uplate up join (select id, raw_user_meta_data -> 'izvor' m from auth.users) u on u.id = up.owner_id
        where not up.testni and (up.created_at at time zone 'Europe/Zagreb')::date >= v_od and coalesce(m ->> 'izvor', '') <> ''
          and (coalesce(m ->> 'oglas', '') <> '' or m ->> 'medij' = 'grupa' or m ->> 'izvor' = 'pinterest')
      ) x
      group by izvor, medij, kampanja, oglas
      order by 8 desc, 6 desc, 5 desc
      limit 300
    ) s
  ), '[]'::jsonb);
end $$;

revoke all on function public.nadzor_oznake(text, integer) from public, authenticated;
grant execute on function public.nadzor_oznake(text, integer) to anon;

notify pgrst, 'reload schema';
