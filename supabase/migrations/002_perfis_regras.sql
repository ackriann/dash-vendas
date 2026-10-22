-- =====================================================================
-- Atualização: perfis da Meta (token + app), contas de anúncio por perfil,
-- regras automáticas e taxas por produto.
-- Cole no Supabase > SQL Editor > New query > Run. Pode rodar de novo.
-- =====================================================================

-- Perfis da Meta conectados por token + app (App ID e chave secreta)
create table if not exists meta_profiles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  fb_user_id   text,
  app_id       text not null,
  app_name     text,
  app_secret   text not null,
  token        text not null,
  token_type   text,                 -- USER | SYSTEM_USER | PAGE
  expires_at   timestamptz,          -- null = não expira
  scopes       text[] not null default '{}',
  status       text not null default 'ok',   -- ok | error
  last_error   text,
  checked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Contas de anúncio de cada perfil (enabled = entra no painel)
create table if not exists ad_accounts (
  id              text primary key,  -- act_123
  profile_id      uuid not null references meta_profiles(id) on delete cascade,
  name            text not null,
  currency        text not null default 'BRL',
  account_status  int,
  timezone_name   text,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now()
);
create index if not exists ad_accounts_profile_idx on ad_accounts (profile_id);

-- Regras automáticas (pausar, ativar, mudar orçamento)
create table if not exists automation_rules (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  active          boolean not null default true,
  level           text not null check (level in ('campaign','adset','ad')),
  account_id      text,              -- null = todas as contas do painel
  name_contains   text,
  period          text not null default 'today',
  conditions      jsonb not null default '[]',   -- [{metric, op, value}]
  action          text not null check (action in ('pause','activate','budget_up','budget_down','budget_set')),
  action_value    numeric(14,2),
  only_active     boolean not null default true,
  cooldown_hours  int not null default 24,
  notify          boolean not null default true,
  applied         jsonb not null default '{}',   -- {objectId: iso da última ação}
  last_run_at     timestamptz,
  last_result     text,
  created_at      timestamptz not null default now()
);

-- Taxas/custos que valem só para um produto (ex.: custo do produto)
alter table fees add column if not exists product text;

create index if not exists sales_product_idx on sales (product_name);

alter table meta_profiles     enable row level security;
alter table ad_accounts       enable row level security;
alter table automation_rules  enable row level security;

-- O token único antigo e a lista antiga de contas não são mais usados
delete from settings where key in ('meta_token', 'ad_accounts');
