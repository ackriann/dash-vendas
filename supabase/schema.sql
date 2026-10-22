-- =====================================================================
-- Painel de Vendas — schema do banco (Supabase / Postgres)
-- Cole tudo no Supabase > SQL Editor > New query > Run.
-- Pode rodar de novo sem problema: usa "if not exists".
-- =====================================================================

create extension if not exists pgcrypto;

-- Configurações gerais (token da Meta, câmbio, preferências...)
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Cliques/visitas registrados pelo script de rastreamento (t.js)
create table if not exists clicks (
  id            text primary key,              -- visitor id (vid) enviado ao checkout
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  campaign_id   text,
  adset_id      text,
  ad_id         text,
  fbclid        text,
  fbc           text,
  fbp           text,
  ip            text,
  user_agent    text,
  landing_url   text,
  referrer      text
);
create index if not exists clicks_created_idx on clicks (created_at desc);

-- Vendas (todas as plataformas)
create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null,             -- stripe | hotmart | digistore | universal | manual
  external_id      text not null,             -- id da transação na plataforma
  status           text not null,             -- approved | pending | refunded | chargeback | canceled | refused
  created_at       timestamptz not null default now(),  -- data da venda
  approved_at      timestamptz,
  updated_at       timestamptz not null default now(),
  product_id       text,
  product_name     text,
  customer_name    text,
  customer_email   text,
  customer_phone   text,
  customer_country text,
  payment_method   text,
  installments     int,
  currency         text not null default 'BRL',
  gross_amount     numeric(14,2) not null default 0,   -- na moeda original
  gross_base       numeric(14,2) not null default 0,   -- convertido para a moeda do painel
  net_reported     numeric(14,2),                      -- líquido informado pela plataforma (se houver)
  click_id         text references clicks(id) on delete set null,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  utm_term         text,
  campaign_id      text,
  adset_id         text,
  ad_id            text,
  capi_sent_at     timestamptz,
  capi_event_id    text,
  capi_pixel_id    text,
  capi_last_error  text,
  raw              jsonb,
  unique (platform, external_id)
);
create index if not exists sales_created_idx  on sales (created_at desc);
create index if not exists sales_status_idx   on sales (status);
create index if not exists sales_campaign_idx on sales (campaign_id);
create index if not exists sales_adset_idx    on sales (adset_id);
create index if not exists sales_ad_idx       on sales (ad_id);

-- Taxas e custos para chegar no valor real
--   percent_sale : % sobre o valor bruto de cada venda (gateway, imposto, coprodução...)
--   fixed_sale   : valor fixo por venda aprovada
--   percent_ads  : % sobre o gasto em anúncios (ex.: impostos cobrados pela Meta)
--   fixed_day    : custo fixo por dia (ferramentas, equipe...)
create table if not exists fees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('percent_sale','fixed_sale','percent_ads','fixed_day')),
  value       numeric(14,4) not null,
  platform    text,                -- null = todas as plataformas
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Pixels para a API de Conversões
create table if not exists pixels (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  pixel_id         text not null,
  access_token     text not null,
  test_event_code  text,
  is_default       boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Aparelhos inscritos para receber notificação push
create table if not exists push_subscriptions (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- Log de webhooks e envios (ajuda a depurar)
create table if not exists events_log (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  source      text not null,
  kind        text,
  ok          boolean not null default true,
  message     text,
  payload     jsonb
);
create index if not exists events_log_created_idx on events_log (created_at desc);

-- Segurança: RLS ligado e sem políticas = ninguém acessa pela chave pública.
-- O painel usa a service role key, só no servidor.
alter table settings            enable row level security;
alter table clicks              enable row level security;
alter table sales               enable row level security;
alter table fees                enable row level security;
alter table pixels              enable row level security;
alter table push_subscriptions  enable row level security;
alter table events_log          enable row level security;

-- Valores iniciais
insert into settings (key, value) values
  ('base_currency', '"BRL"'),
  ('fx_rates', '{"BRL":1,"USD":5.40,"EUR":5.90,"GBP":6.90}'),
  ('notify', '{"approved":true,"pending":false,"refund":true}'),
  ('auto_capi', 'false')
on conflict (key) do nothing;

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
