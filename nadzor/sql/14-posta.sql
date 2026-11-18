-- Sandučić za dolazne mailove (ekran Pošta u dashboardu).
-- Pokreće se nakon 01-nadzor-shema.sql. Worker svaki mail koji primi preko Cloudflare Email Routinga
-- spremi u cijelosti (.eml) u R2 (bucket dp-nadzor-posta), a ovdje upiše zaglavlja, tekst i popis privitaka,
-- da se sandučić može prikazati i pretraživati bez čitanja R2.

create table if not exists public.posta (
  id bigint generated always as identity primary key,
  r2_kljuc text not null unique check (char_length(r2_kljuc) <= 200),  -- ključ .eml datoteke u R2
  primljeno timestamptz not null default now(),
  omotnica_od text not null default '',   -- pošiljatelj iz SMTP omotnice (kod prosljeđivanja to je sandučić koji prosljeđuje)
  omotnica_za text not null default '',   -- adresa na koju je mail stigao
  od text not null default '',            -- zaglavlje From, dekodirano
  za text not null default '',            -- zaglavlje To
  kopija text not null default '',        -- zaglavlje Cc
  odgovor_na text not null default '',    -- zaglavlje Reply-To
  naslov text not null default '',
  poslano timestamptz,                    -- zaglavlje Date
  message_id text not null default '',
  velicina int not null default 0,        -- bajtova cijelog maila
  tekst text not null default '',         -- tekst poruke (ili tekst iz HTML-a), najviše 100.000 znakova
  ima_html boolean not null default false,
  privitci jsonb not null default '[]'::jsonb,  -- [{naziv, vrsta, velicina}]
  provjera text not null default '',      -- SPF, DKIM i DMARC iz zaglavlja Authentication-Results
  izvod text,                             -- ishod uvoza izvoda, ako je mail stigao na adresu za izvode
  procitano boolean not null default false
);

create index if not exists posta_primljeno on public.posta (primljeno desc);
alter table public.posta enable row level security;

-- Upis jednog maila. p_mail ima polja kao stupci (bez id, primljeno, procitano). Vraća id.
create or replace function public.nadzor_posta_upis(p_kljuc text, p_mail jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform privatno.provjeri(p_kljuc);
  insert into public.posta (r2_kljuc, omotnica_od, omotnica_za, od, za, kopija, odgovor_na, naslov, poslano, message_id, velicina, tekst, ima_html, privitci, provjera)
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
    left(coalesce(p_mail->>'provjera', ''), 200)
  )
  on conflict (r2_kljuc) do update set r2_kljuc = excluded.r2_kljuc
  returning id into v_id;
  return v_id;
end $$;

-- Ishod uvoza izvoda uz mail.
create or replace function public.nadzor_posta_izvod(p_kljuc text, p_id bigint, p_izvod text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  update public.posta set izvod = left(p_izvod, 1000) where id = p_id;
end $$;

-- Popis za sandučić: najviše 50 mailova, najnoviji prvi, bez punog teksta.
-- p_trazi pretražuje pošiljatelja, primatelja, naslov i tekst. p_prije_id je za "Učitaj starije".
create or replace function public.nadzor_posta_popis(p_kljuc text, p_trazi text, p_prije_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_t text := nullif(trim(coalesce(p_trazi, '')), '');
begin
  perform privatno.provjeri(p_kljuc);
  return jsonb_build_object(
    'neprocitano', (select count(*) from public.posta where not procitano),
    'ukupno', (select count(*) from public.posta),
    'mailovi', (
      select coalesce(jsonb_agg(m order by m.id desc), '[]'::jsonb) from (
        select p.id, p.primljeno, p.poslano, p.od, p.omotnica_od, p.omotnica_za, p.naslov, p.procitano, p.izvod,
               left(regexp_replace(p.tekst, '\s+', ' ', 'g'), 160) as isjecak,
               jsonb_array_length(p.privitci) as broj_privitaka
        from public.posta p
        where (p_prije_id is null or p.id < p_prije_id)
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

-- Jedan mail sa svim podacima. p_oznaci_procitano označi ga pročitanim.
create or replace function public.nadzor_posta_jedna(p_kljuc text, p_id bigint, p_oznaci_procitano boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform privatno.provjeri(p_kljuc);
  if p_oznaci_procitano then
    update public.posta set procitano = true where id = p_id and not procitano;
  end if;
  select to_jsonb(p) into v from public.posta p where p.id = p_id;
  return v;
end $$;

create or replace function public.nadzor_posta_procitano(p_kljuc text, p_id bigint, p_procitano boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform privatno.provjeri(p_kljuc);
  update public.posta set procitano = p_procitano where id = p_id;
  return found;
end $$;

-- Brisanje maila. Vraća ključ u R2, da Worker obriše i datoteku (null ako mail ne postoji).
create or replace function public.nadzor_posta_obrisi(p_kljuc text, p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_r2 text;
begin
  perform privatno.provjeri(p_kljuc);
  delete from public.posta where id = p_id returning r2_kljuc into v_r2;
  return v_r2;
end $$;

revoke all on function public.nadzor_posta_upis(text,jsonb) from public, authenticated;
revoke all on function public.nadzor_posta_izvod(text,bigint,text) from public, authenticated;
revoke all on function public.nadzor_posta_popis(text,text,bigint) from public, authenticated;
revoke all on function public.nadzor_posta_jedna(text,bigint,boolean) from public, authenticated;
revoke all on function public.nadzor_posta_procitano(text,bigint,boolean) from public, authenticated;
revoke all on function public.nadzor_posta_obrisi(text,bigint) from public, authenticated;
grant execute on function public.nadzor_posta_upis(text,jsonb) to anon;
grant execute on function public.nadzor_posta_izvod(text,bigint,text) to anon;
grant execute on function public.nadzor_posta_popis(text,text,bigint) to anon;
grant execute on function public.nadzor_posta_jedna(text,bigint,boolean) to anon;
grant execute on function public.nadzor_posta_procitano(text,bigint,boolean) to anon;
grant execute on function public.nadzor_posta_obrisi(text,bigint) to anon;
