-- Kuverta (Supabase projekt MyWeddingInvite): posjete, registracije i kupnje po grupi
-- (npr. Facebook grupe za vjenčanja). Grupa je svaka poveznica s utm_medium=grupa, a ime grupe je utm_content:
--   https://kuverta.hr/?utm_source=facebook&utm_medium=grupa&utm_campaign=predstavljanje&utm_content=svezavjencanja
-- Nova grupa se pojavi sama čim netko dođe s njezinom poveznicom.
--
-- Pokreće se u projektu MyWeddingInvite, nakon migracije 029_posjete_oglas.sql iz repozitorija
-- MyWeddingInvite (stupac statistika.posjete.oglas) i nakon 12 iz ove mape.
-- Vraća samo brojeve po grupi, bez e-mailova.

-- p_dana: razdoblje u danima (npr. 7, 30, 90), null ili 0 = sve.
create or replace function public.nadzor_grupe(p_kljuc text, p_dana integer default 30)
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
      'izvor', s.izvor, 'kampanja', s.kampanja, 'grupa', s.grupa,
      'posjete', s.posjete, 'registracije', s.registracije, 'kupnje', s.kupnje, 'prihod', s.prihod
    ) order by s.prihod desc, s.registracije desc, s.posjete desc, s.grupa)
    from (
      select izvor, kampanja, grupa, sum(posjete)::int posjete, sum(registracije)::int registracije,
             sum(kupnje)::int kupnje, round(sum(prihod), 2) prihod
      from (
        select p.izvor, p.kampanja, p.oglas grupa, p.broj posjete, 0 registracije, 0 kupnje, 0::numeric prihod
        from statistika.posjete p
        where p.medij = 'grupa' and p.dan >= v_od
        union all
        select u.raw_user_meta_data #>> '{izvor,izvor}', coalesce(u.raw_user_meta_data #>> '{izvor,kampanja}', ''),
               coalesce(u.raw_user_meta_data #>> '{izvor,oglas}', ''), 0, 1, 0, 0
        from auth.users u
        where u.deleted_at is null and u.raw_user_meta_data #>> '{izvor,medij}' = 'grupa'
          and (u.created_at at time zone 'Europe/Zagreb')::date >= v_od
        union all
        select u.raw_user_meta_data #>> '{izvor,izvor}', coalesce(u.raw_user_meta_data #>> '{izvor,kampanja}', ''),
               coalesce(u.raw_user_meta_data #>> '{izvor,oglas}', ''), 0, 0, 1, up.iznos_centi / 100.0
        from public.uplate up join auth.users u on u.id = up.owner_id
        where not up.testni and u.raw_user_meta_data #>> '{izvor,medij}' = 'grupa'
          and (up.created_at at time zone 'Europe/Zagreb')::date >= v_od
      ) x
      group by izvor, kampanja, grupa
    ) s
  ), '[]'::jsonb);
end $$;

revoke all on function public.nadzor_grupe(text, integer) from public, authenticated;
grant execute on function public.nadzor_grupe(text, integer) to anon;

notify pgrst, 'reload schema';
