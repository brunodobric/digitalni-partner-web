-- Brisanje ekrana Pošta (sandučić za dolazne mailove). Mail za digitalnipartner.hr od 19. 11. 2026. ide na iCloud+,
-- pa sandučić u dashboardu više ne treba. Briše tablice posta i posta_blokirani i sve funkcije sandučića
-- (bile su u 14-posta.sql, 15-posta-spam.sql i 16-posta-mape.sql). Izvodi iz banke ne ovise o ovome.
-- Pokreće se jednom, nakon objave Workera bez Pošte. R2 bucket dp-nadzor-posta briše se zasebno u Cloudflareu.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as potpis
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'nadzor\_posta\_%')
       or (n.nspname = 'privatno' and p.proname like 'posta\_%')
  loop
    execute 'drop function ' || f.potpis;
  end loop;
end $$;

drop table if exists public.posta_blokirani;
drop table if exists public.posta;
