-- Kuverta (Supabase projekt MyWeddingInvite): popis registriranih korisnika za ekran Kuverta.
-- Pokreće se u projektu MyWeddingInvite, nakon 02-kuverta-statistika.sql (koristi nadzor.kljuc).
-- Vraća e-mail, datum registracije, zadnju prijavu, što je korisnik napravio i koliko je platio.
-- Ne vraća lozinke, tokene, imena parova ni podatke gostiju. Traži isti tajni ključ kao nadzor_statistika,
-- pa javni (anon) ključ Kuverte bez njega ne dobije ništa.

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
