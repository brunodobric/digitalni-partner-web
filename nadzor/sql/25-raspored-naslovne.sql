-- Postavke nadzora koje trebaju vrijediti na svim uređajima. Zasad samo raspored kartica na naslovnoj (ime 'naslovna'):
-- [[kartica, veličina 1-4], ...] redom kako stoje. Worker ih čita i sprema preko /api/raspored.
-- Pokreće se u projektu dp-nadzor nakon 01.

create table if not exists public.postavke (
  ime text primary key check (char_length(ime) <= 60),
  vrijednost jsonb not null,
  azurirano timestamptz not null default now()
);
alter table public.postavke enable row level security;

create or replace function public.nadzor_postavka(p_kljuc text, p_ime text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  return (select vrijednost from public.postavke where ime = p_ime);
end $$;

create or replace function public.nadzor_postavka_spremi(p_kljuc text, p_ime text, p_vrijednost jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  if octet_length(p_vrijednost::text) > 20000 then raise exception 'postavka je prevelika'; end if;
  insert into public.postavke (ime, vrijednost) values (p_ime, p_vrijednost)
  on conflict (ime) do update set vrijednost = excluded.vrijednost, azurirano = now();
end $$;

revoke all on function public.nadzor_postavka(text, text) from public, authenticated;
revoke all on function public.nadzor_postavka_spremi(text, text, jsonb) from public, authenticated;
grant execute on function public.nadzor_postavka(text, text) to anon;
grant execute on function public.nadzor_postavka_spremi(text, text, jsonb) to anon;

notify pgrst, 'reload schema';
