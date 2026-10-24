-- =====================================================================
-- Atualização: várias contas (login por e-mail) e vários dashes por conta.
-- Cole no Supabase > SQL Editor > New query > Run. Pode rodar de novo.
--
-- Tudo o que já existe passa a ser da "conta principal". No primeiro login
-- depois da atualização, entre com o seu e-mail e a senha atual do painel:
-- o e-mail fica gravado como o login da conta principal.
-- =====================================================================

-- Contas (cada uma é um painel separado: Meta, checkouts, pixels, vendas...)
create table if not exists workspaces (
  id             uuid primary key default gen_random_uuid(),
  email          text unique,          -- null só na conta principal, até o primeiro login
  name           text,
  password_hash  text,                 -- scrypt; null = conta principal ainda usa ADMIN_PASSWORD
  is_owner       boolean not null default false,
  created_at     timestamptz not null default now()
);
alter table workspaces enable row level security;

insert into workspaces (name, is_owner)
select 'Principal', true
where not exists (select 1 from workspaces where is_owner);

-- Dashes: visões de uma conta filtradas por produto e por conta de anúncio
create table if not exists dashboards (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  products        text[] not null default '{}',   -- vazio = todos os produtos
  ad_account_ids  text[] not null default '{}',   -- vazio = todas as contas de anúncio
  position        int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists dashboards_workspace_idx on dashboards (workspace_id);
alter table dashboards enable row level security;

-- Conta principal (usada como padrão enquanto o código antigo ainda está no ar)
create or replace function owner_workspace() returns uuid
language sql stable as $$ select id from workspaces where is_owner order by created_at limit 1 $$;

-- Coluna workspace_id em todas as tabelas, com os dados atuais na conta principal
do $$
declare
  t text;
  owner uuid;
begin
  select id into owner from workspaces where is_owner order by created_at limit 1;
  foreach t in array array['settings','clicks','sales','fees','pixels','push_subscriptions','events_log','meta_profiles','ad_accounts','automation_rules'] loop
    execute format('alter table %I add column if not exists workspace_id uuid references workspaces(id) on delete cascade', t);
    execute format('update %I set workspace_id = %L where workspace_id is null', t, owner);
    execute format('alter table %I alter column workspace_id set not null', t);
    execute format('alter table %I alter column workspace_id set default owner_workspace()', t);
    execute format('create index if not exists %I on %I (workspace_id)', t || '_workspace_idx', t);
  end loop;
end $$;

-- Chaves que agora valem por conta
alter table settings drop constraint if exists settings_pkey;
alter table settings add primary key (workspace_id, key);

alter table sales drop constraint if exists sales_platform_external_id_key;
alter table sales drop constraint if exists sales_workspace_platform_external_key;
alter table sales add constraint sales_workspace_platform_external_key unique (workspace_id, platform, external_id);

alter table ad_accounts drop constraint if exists ad_accounts_pkey;
alter table ad_accounts add primary key (workspace_id, id);

alter table push_subscriptions drop constraint if exists push_subscriptions_pkey;
alter table push_subscriptions add primary key (workspace_id, endpoint);

-- Taxa que vale só para um dash (null = vale em todos)
alter table fees add column if not exists dashboard_id uuid references dashboards(id) on delete cascade;

-- Cliques por conta: o mesmo visitante (mesmo domínio) pode estar em duas contas
alter table sales drop constraint if exists sales_click_id_fkey;
alter table clicks drop constraint if exists clicks_pkey;
alter table clicks add primary key (workspace_id, id);
