-- =====================================================================
-- Atualização: código único de pixel (modelo Utmify).
-- Um código por dash (e um da conta) carrega todos os pixels ligados a ele;
-- trocar os pixels no painel não exige mudar o código no site.
-- Cole no Supabase > SQL Editor > New query > Run. Pode rodar de novo.
-- =====================================================================

-- Pixels de cada dash (vazio = todos os pixels da conta)
alter table dashboards add column if not exists pixel_ids uuid[] not null default '{}';

-- Códigos públicos (vão no site): px_ + 16 caracteres
alter table workspaces add column if not exists pixel_code text;
alter table dashboards add column if not exists pixel_code text;
alter table workspaces alter column pixel_code set default ('px_' || substr(md5(gen_random_uuid()::text), 1, 16));
alter table dashboards alter column pixel_code set default ('px_' || substr(md5(gen_random_uuid()::text), 1, 16));
update workspaces set pixel_code = 'px_' || substr(md5(gen_random_uuid()::text), 1, 16) where pixel_code is null;
update dashboards set pixel_code = 'px_' || substr(md5(gen_random_uuid()::text), 1, 16) where pixel_code is null;
alter table workspaces alter column pixel_code set not null;
alter table dashboards alter column pixel_code set not null;
create unique index if not exists workspaces_pixel_code_key on workspaces (pixel_code);
create unique index if not exists dashboards_pixel_code_key on dashboards (pixel_code);
