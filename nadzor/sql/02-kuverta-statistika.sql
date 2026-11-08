-- Kuverta (Supabase projekt MyWeddingInvite): zbirni brojevi za dashboard, samo za čitanje.
-- Funkcija ne vraća imena, poruke ni kontakte gostiju, nego samo brojeve po vjenčanju i mjesecu.
-- Traži tajni ključ (isti kao u Workeru dashboarda); u bazu ide samo njegov SHA-256 sažetak.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists nadzor;
revoke all on schema nadzor from public, anon, authenticated;

create table if not exists nadzor.kljuc (
  id smallint primary key default 1 check (id = 1),
  sazetak text not null
);

create or replace function public.nadzor_statistika(p_kljuc text)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare
  v_danas date := (now() at time zone 'Europe/Zagreb')::date;
begin
  if p_kljuc is null or not exists (
    select 1 from nadzor.kljuc where sazetak = encode(extensions.digest(p_kljuc, 'sha256'), 'hex')
  ) then
    raise exception 'neispravan ključ' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pozivnice', (select count(*) from public.invitations),
    'pozivnice_objavljene', (select count(*) from public.invitations where published),
    'potvrde', (select count(*) from public.rsvps),
    'potvrde_dolazi', (select count(*) from public.rsvps where attending),
    'gosti_potvrdeni', (select coalesce(sum(adults + children), 0) from public.rsvps where attending),
    'albumi', (select count(*) from public.albums),
    'albumi_ukljuceni', (select count(*) from public.albums where enabled),
    'fotografije', (select count(*) from public.album_files where status = 'done'),
    'album_bajtovi', (select coalesce(sum(size_bytes), 0) from public.album_files where status = 'done'),
    'rasporedi', (select count(*) from public.seating_plans),
    'stolovi', (select count(*) from public.seating_tables),
    'gosti_u_rasporedu', (select count(*) from public.seating_guests where not cancelled),
    'po_mjesecima', (
      select coalesce(jsonb_agg(jsonb_build_object('mjesec', to_char(g.mj, 'YYYY-MM'), 'broj', coalesce(c.broj, 0)) order by g.mj), '[]'::jsonb)
      from generate_series(date_trunc('month', v_danas), date_trunc('month', v_danas) + interval '11 months', interval '1 month') g(mj)
      left join (
        select date_trunc('month', d) mj, count(*) broj from (
          select event_date d from public.invitations where event_date is not null
          union all
          select sp.event_date from public.seating_plans sp
          where sp.event_date is not null
            and not exists (select 1 from public.invitations i where i.owner_id = sp.owner_id and i.event_date = sp.event_date)
        ) s group by 1
      ) c on c.mj = g.mj
    ),
    'iduca', (
      select coalesce(jsonb_agg(x order by x->>'datum'), '[]'::jsonb) from (
        select jsonb_build_object(
          'datum', i.event_date,
          'objavljena', i.published,
          'potvrde', (select count(*) from public.rsvps r where r.invitation_id = i.id),
          'dolazi', (select coalesce(sum(r.adults + r.children), 0) from public.rsvps r where r.invitation_id = i.id and r.attending),
          'ima_album', exists (select 1 from public.albums a where a.invitation_id = i.id),
          'stolovi', (select count(*) from public.seating_tables t join public.seating_plans p on p.id = t.plan_id where p.owner_id = i.owner_id)
        ) x
        from public.invitations i
        where i.event_date >= v_danas
        order by i.event_date
        limit 10
      ) y
    )
  );
end $$;

revoke all on function public.nadzor_statistika(text) from public, authenticated;
grant execute on function public.nadzor_statistika(text) to anon;
