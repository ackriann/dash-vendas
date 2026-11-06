-- =====================================================================
-- Atualização: módulo "Automação de Campanhas".
-- Usa os perfis Meta (meta_profiles) e as contas de anúncio (ad_accounts)
-- que já existem — nada de nova conexão ou novo token.
-- Cole no Supabase > SQL Editor > New query > Run. Pode rodar de novo.
-- =====================================================================

-- Rascunhos do assistente de criação (campanha → conjunto → criativos → revisão)
create table if not exists auto_drafts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  name          text not null default 'Nova campanha',
  account_id    text,
  step          int not null default 1,
  data          jsonb not null default '{}',
  status        text not null default 'draft',       -- draft | queued | published | failed
  run_id        uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists auto_drafts_workspace_idx on auto_drafts (workspace_id, updated_at desc);

-- Fila persistente: um "processo" (run) tem várias operações (jobs) em ordem.
-- idem_key evita processos duplicados se a página for recarregada ou a conexão cair.
create table if not exists ops_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  kind          text not null,                       -- publish | page_sync | catalog_update
  title         text not null,
  idem_key      text not null,
  status        text not null default 'queued',      -- queued | running | done | failed | canceled
  ref_id        text,                                -- rascunho, automação de catálogo...
  summary       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create unique index if not exists ops_runs_idem_key on ops_runs (workspace_id, idem_key);
create index if not exists ops_runs_workspace_idx on ops_runs (workspace_id, created_at desc);

create table if not exists ops_jobs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  run_id        uuid not null references ops_runs(id) on delete cascade,
  seq           int not null,
  key           text not null,                       -- campaign | adset | media:<id> | creative:<n> | ad:<n> | review:<n> | page:<id> ...
  kind          text not null,
  label         text not null,
  status        text not null default 'pending',     -- pending | running | waiting_sync | done | failed | skipped
  input         jsonb not null default '{}',
  result        jsonb,
  meta_id       text,
  message       text,
  error         text,
  attempts      int not null default 0,
  polls         int not null default 0,
  run_after     timestamptz not null default now(),
  locked_until  timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz not null default now(),
  unique (run_id, key)
);
create index if not exists ops_jobs_run_idx on ops_jobs (run_id, seq);
create index if not exists ops_jobs_ready_idx on ops_jobs (workspace_id, status, run_after);

-- Pega a próxima operação pronta (respeita a ordem do processo) sem que dois
-- processadores peguem a mesma: FOR UPDATE SKIP LOCKED + trava com prazo.
create or replace function ops_claim_job(p_workspace uuid, p_run uuid default null, p_lock_seconds int default 120)
returns setof ops_jobs
language plpgsql as $$
declare
  jid uuid;
begin
  select o.id into jid
    from ops_jobs o
    join ops_runs r on r.id = o.run_id and r.status in ('queued', 'running')
   where o.workspace_id = p_workspace
     and (p_run is null or o.run_id = p_run)
     and o.status in ('pending', 'running', 'waiting_sync')
     and (o.locked_until is null or o.locked_until < now())
     and o.run_after <= now()
     and not exists (
       select 1 from ops_jobs p
        where p.run_id = o.run_id and p.seq < o.seq and p.status not in ('done', 'skipped')
     )
   order by o.run_after, o.seq
   limit 1
   for update of o skip locked;
  if jid is null then return; end if;

  return query
    update ops_jobs
       set locked_until = now() + make_interval(secs => p_lock_seconds),
           status = case when status = 'waiting_sync' then 'waiting_sync' else 'running' end,
           attempts = case when status = 'waiting_sync' then attempts else attempts + 1 end,
           started_at = coalesce(started_at, now()),
           updated_at = now()
     where id = jid
     returning *;
end $$;

-- FanPages sincronizadas das conexões Meta existentes
create table if not exists fb_pages (
  workspace_id        uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  page_id             text not null,
  profile_id          uuid references meta_profiles(id) on delete set null,
  name                text not null,
  picture_url         text,
  category            text,
  tasks               text[] not null default '{}',   -- permissões do perfil na página
  instagram_id        text,
  instagram_username  text,
  ad_accounts         jsonb not null default '[]',   -- [{id, name, running, limit}]
  ads_running         int,                            -- anúncios ativos/em revisão (maior entre as contas)
  ads_limit           int,                            -- limite por página informado pela Meta
  enabled_in_creator  boolean not null default true,
  synced_at           timestamptz,
  sync_error          text,
  primary key (workspace_id, page_id)
);

-- Biblioteca de imagens e vídeos (arquivo no Supabase Storage, bucket público "automacao")
create table if not exists media_assets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  kind          text not null check (kind in ('image', 'video')),
  name          text not null,
  storage_path  text not null,
  public_url    text not null,
  mime          text,
  size_bytes    bigint,
  status        text not null default 'uploading',  -- uploading | ready
  meta_ids      jsonb not null default '{}',         -- {act_123: {hash} | {video_id, thumbnail_url}}
  created_at    timestamptz not null default now()
);
create index if not exists media_assets_workspace_idx on media_assets (workspace_id, created_at desc);

-- Atualizações programadas de catálogo
create table if not exists catalog_schedules (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  name              text not null,
  profile_id        uuid not null references meta_profiles(id) on delete cascade,
  catalog_id        text not null,
  catalog_name      text,
  product_ids       text[] not null default '{}',     -- ids dos itens na Meta
  media_ids         uuid[] not null default '{}',     -- media_assets em ordem
  update_type       text not null check (update_type in ('rotate_image', 'set_media')),
  interval_minutes  int not null check (interval_minutes >= 15),
  start_at          timestamptz not null default now(),
  next_run_at       timestamptz not null default now(),
  cursor            int not null default 0,           -- posição do rodízio
  active            boolean not null default true,
  last_run_at       timestamptz,
  last_result       text,
  created_at        timestamptz not null default now()
);
create index if not exists catalog_schedules_due_idx on catalog_schedules (workspace_id, active, next_run_at);

-- Histórico de cada alteração de produto enviada à Meta
create table if not exists catalog_update_logs (
  id              bigserial primary key,
  workspace_id    uuid not null default owner_workspace() references workspaces(id) on delete cascade,
  run_id          uuid references ops_runs(id) on delete set null,
  schedule_id     uuid references catalog_schedules(id) on delete set null,
  catalog_id      text not null,
  product_id      text,
  retailer_id     text,
  product_name    text,
  previous_media  jsonb,
  current_media   jsonb,
  meta_response   jsonb,
  sync_status     text not null default 'waiting',   -- waiting | synced | rejected | error
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists catalog_update_logs_idx on catalog_update_logs (workspace_id, created_at desc);

alter table auto_drafts          enable row level security;
alter table ops_runs             enable row level security;
alter table ops_jobs             enable row level security;
alter table fb_pages             enable row level security;
alter table media_assets         enable row level security;
alter table catalog_schedules    enable row level security;
alter table catalog_update_logs  enable row level security;

-- Bucket público para as mídias (a Meta busca vídeos e imagens de catálogo por URL).
-- O painel também cria o bucket sozinho no primeiro upload, se faltar.
insert into storage.buckets (id, name, public)
values ('automacao', 'automacao', true)
on conflict (id) do nothing;
