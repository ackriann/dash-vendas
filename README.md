# Painel de Vendas

Seu painel pessoal no estilo Utmify: vendas de todas as plataformas, gasto da Meta, lucro real com taxas, notificação de venda no celular, gestão de campanhas e de páginas do Facebook, e disparo manual de venda no pixel.

**Stack:** Next.js 16 · Supabase (Postgres) · Vercel · Web Push (PWA) · Graph API da Meta v26.0

---

## O que ele faz

| Área | O que tem |
|---|---|
| **Resumo** | Lucro real (faturamento − taxas − anúncios), ROAS, ROI, CPA, ticket, pendentes, reembolsos, gráfico por hora/dia, produtos e plataformas |
| **Vendas** | Lista com busca e filtros, detalhe da venda, **botão “Disparar venda no pixel”** (API de Conversões), **venda manual**, mudar status, excluir |
| **Resumo** (filtros) | Por conta de anúncio, plataforma e produto · formas de pagamento com taxa de aprovação · origem (utm_source) · horários das vendas · reembolso e chargeback em % |
| **Campanhas** | Contas, campanhas, conjuntos e anúncios com gasto × vendas reais × lucro · filtro por perfil/conta/status · busca · ordenar por qualquer coluna · **escolher colunas** (CPA, custo/IC, vis. página, conversões, CPC, CTR, CPM, hook, frequência, pendentes…) · **pausar/ativar**, **orçamento** e **duplicar** |
| **Regras** | Regras automáticas: “se Gastos > 100 e Vendas < 1 hoje → pausar”, “se ROAS ≥ 2 → +20% de orçamento”, com simulação, espera entre ações e aviso no celular |
| **UTMs** | Parâmetros dos anúncios, script da página e gerador de link com UTM |
| **Perfis Meta** | Vários perfis, cada um conectado por **App ID + chave secreta + token**; contas de anúncio ativadas por perfil; renovação automática do token |
| **Páginas** | Lista das fanpages, editar sobre/descrição/site/telefone, trocar foto e capa, publicar e agendar posts, excluir posts, **moderar comentários (inclusive dos anúncios)** |
| **Taxas** | % por venda, valor fixo por venda, % sobre o gasto em anúncios, custo fixo por dia — por plataforma, por produto (custo do produto) ou para todas |
| **Integrações** | Pixels, webhooks dos checkouts e log dos eventos |
| **Ajustes** | Notificações push por aparelho, o que avisar, moeda e câmbio |

Webhooks prontos: **Stripe, Hotmart, Digistore24** e um **universal** (Kiwify, Perfect Pay, Eduzz, Yampi, n8n, Make, Zapier, seu sistema…).

> **Sobre criar fanpage:** a Meta só libera criar página pela API para apps aprovados por ela. O botão tenta pela API e, se a Meta recusar, mostra o atalho para criar no Facebook. Todo o resto da gestão funciona normalmente.

---

## Colocando no ar (≈ 20 minutos)

### 1. Supabase (banco de dados)
1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **service_role** (secreta).

### 2. Chaves das notificações
No seu computador, dentro da pasta do projeto:
```bash
npm install
npm run vapid
```
Guarde a *Public Key* e a *Private Key* que aparecerem.

### 3. App da Meta (conexão por token + app)
Cada perfil é conectado em **Perfis Meta** de dois jeitos: botão **Entrar com Facebook** (usa o app de `META_APP_ID`/`META_APP_SECRET`) ou colando **App ID**, **chave secreta** e um **token** gerado por esse mesmo app. Perfis já conectados têm **Reconectar com Facebook**, que usa o app do próprio perfil. O painel confere os três juntos (`debug_token`), assina todas as chamadas com `appsecret_proof` e, se o token for de usuário comum, troca pelo de 60 dias e renova sozinho pelo agendador.

1. Em [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar app** → tipo **Empresa**, com o caso de uso de Marketing API (e Páginas, se for usar a tela Páginas).
2. Em **Configurações → Básico**, copie o **ID do app** e a **Chave secreta**.
3. Gere o token **com esse app**:
   - **Usuário do sistema** (recomendado, não vence): Gerenciador de Negócios → Usuários do sistema → atribua contas de anúncio e páginas → Gerar token → escolha o app → validade *Nunca*.
   - **Usuário comum**: [Explorador da Graph API](https://developers.facebook.com/tools/explorer/) → escolha o app → adicione as permissões → Generate Access Token.
4. Cole tudo em **Perfis Meta → Conectar perfil**. Repita para cada perfil/BM.
5. Para o login com Facebook: adicione o produto **Login do Facebook** e cadastre em **URIs de redirecionamento OAuth válidos** `https://SEU-PAINEL.vercel.app/api/auth/facebook/callback`.

Permissões: `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_posts`, `pages_manage_metadata`, `pages_manage_engagement`.

### 4. Vercel
1. Suba esta pasta para um repositório no GitHub.
2. Em [vercel.com](https://vercel.com) → **Add New → Project** → importe o repositório.
3. Em **Environment Variables**, cadastre as variáveis do `.env.example` (veja abaixo).
4. **Deploy**. Depois, ajuste `APP_URL` para o endereço final e faça um novo deploy.

### Variáveis de ambiente

| Variável | O que é |
|---|---|
| `APP_URL` | Endereço do painel, ex.: `https://meupainel.vercel.app` |
| `APP_TIMEZONE` | `America/Sao_Paulo` |
| `ADMIN_PASSWORD` | Senha antiga do painel: só serve para o primeiro login da conta principal |
| `SESSION_SECRET` | Texto aleatório longo (`openssl rand -hex 32`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Do passo 1 |
| `META_APP_ID`, `META_APP_SECRET` | Opcional — app usado pelo botão “Entrar com Facebook” |
| `META_API_VERSION` | `v26.0` |
| `CRON_SECRET` | Opcional — só se usar o Vercel Cron (plano pago) para as regras |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Do passo 2 |
| `VAPID_SUBJECT` | `mailto:seu-email` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Opcional — dá para conectar pelo painel |
| `HOTMART_HOTTOK` | Opcional — dá para conectar pelo painel |
| `DIGISTORE_IPN_PASSPHRASE` | Opcional — dá para conectar pelo painel |
| `UNIVERSAL_WEBHOOK_KEY` | Opcional — dá para gerar pelo painel |

> As chaves dos checkouts também podem ser cadastradas em **Integrações → Webhooks dos checkouts**. Na Stripe basta colar a chave secreta e clicar em **Conectar**: o painel cria o webhook e guarda o segredo sozinho. O que for salvo no painel vale mais que a variável de ambiente.

---

## Contas e dashes

- **Conta** (login por e-mail + senha): cada conta é um painel separado, com perfis Meta, checkouts, webhooks, pixel, vendas, taxas, regras e notificações próprios. A conta principal é a que já existia. Para criar outra, gere um código de convite em **Ajustes → Criar outras contas** e abra `/cadastro`.
- **Dash** (menu **Dashes**): dentro de uma conta, cada dash mostra só as vendas dos produtos escolhidos e o gasto das contas de anúncio escolhidas. O seletor no topo de Resumo, Vendas e Campanhas troca entre **Todos** e cada dash. Custos de um produto só podem ser ligados ao dash em **Taxas → Vale para**.
- As URLs públicas (webhooks, `t.js`, cron) das contas que não são a principal levam `?a=<id da conta>`. O painel já mostra as URLs certas em Integrações e UTMs.
- Atualizando uma instalação antiga: rode `supabase/migrations/003_contas_dashes.sql` no SQL Editor **antes** do deploy. No primeiro login, entre com o seu e-mail e a senha antiga (`ADMIN_PASSWORD`): o e-mail vira o login da conta principal.

## Primeiros passos dentro do painel

0. Já tinha o painel rodando? Rode `supabase/migrations/002_perfis_regras.sql` no SQL Editor (instalação nova: o `schema.sql` já inclui tudo).
1. **Perfis Meta → Entrar com Facebook** (ou App ID + chave + token) e ative as contas de anúncio.
2. **Integrações → Pixel**: cadastre o ID do pixel e o token da API de Conversões (Gerenciador de Eventos → seu pixel → Configurações → Gerar token de acesso).
3. **Integrações → Webhooks**: conecte cada checkout que você usa (Stripe: cole a chave secreta e clique em **Conectar**; Hotmart: cole o Hottok; Digistore24: gere a senha do IPN).
4. Nos anúncios, em **Parâmetros de URL** (copie em **UTMs**), use:
   ```
   utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}
   ```
5. Na sua página de vendas, cole o script do pixel do painel (copie em **UTMs** ou **Integrações → Pixel**) e **tire o código antigo do pixel da Meta**:
   ```html
   <script src="https://SEU-PAINEL.vercel.app/t.js" data-pixel="ID_DO_PIXEL" async></script>
   ```
   Ele carrega o pixel e manda PageView, ViewContent e InitiateCheckout pelo navegador e pelo servidor (mesmo `event_id`, sem duplicar). Sem `data-pixel`, só rastreia as UTMs.
6. **Taxas**: cadastre gateway, impostos e custos fixos.
7. **Regras**: gere a chave do agendador e cadastre a URL em um cron gratuito (ex.: cron-job.org) a cada 15–30 min. A mesma chamada renova os tokens.
8. **Ajustes**: no celular, instale o painel (Android: menu do Chrome → *Instalar app*; iPhone: Compartilhar → *Adicionar à Tela de Início*), abra pelo ícone e toque em **Ativar neste aparelho**.

---

## Como o rastreamento funciona

```
Anúncio (UTMs com IDs) → página de vendas com t.js → checkout → webhook → painel
```

- Com `data-pixel`, o `t.js` carrega o pixel da Meta, cria o `_fbp` na hora e envia PageView/ViewContent (ao abrir) e InitiateCheckout (no clique do checkout) pelo navegador e pela API de Conversões (`/api/track/event`), com o mesmo `event_id` e o ID da visita como `external_id`. O Purchase vai pelo servidor quando o webhook aprova (ligue o **envio automático**).
- O `t.js` cria um ID da visita, salva UTMs, `fbclid`, `_fbc` e `_fbp`, e coloca esse ID no link do checkout:
  - Hotmart → `sck` · Digistore24 → `custom` · Stripe → `client_reference_id` · outros → `vid` e `sck`
- Quando o webhook chega com esse ID, o painel junta a venda com o clique: sabe a campanha, o conjunto e o anúncio, e tem `fbc`/`fbp`/IP/navegador para o pixel casar melhor a conversão.
- Se o checkout não devolver o ID, o painel tenta ler as UTMs que vierem no próprio webhook.

## Disparo manual no pixel

- Em **Vendas**, cada venda aprovada tem o botão **Disparar** (na lista) e **Disparar venda no pixel** (no detalhe).
- **Nova venda manual** registra uma venda que não chegou por webhook e pode já disparar no pixel.
- O evento é um `Purchase` com e-mail, telefone e nome em hash (SHA-256), valor, moeda e os dados do clique.
- O `event_id` é sempre o mesmo para a mesma venda, então a Meta descarta duplicados — reenviar não conta duas vezes.
- A Meta só aceita eventos de site com até 7 dias.
- Para testar sem afetar as campanhas, salve o **código de teste** no pixel (Gerenciador de Eventos → Eventos de teste) e remova depois.

Use o disparo para **vendas reais** que o pixel não marcou. Enviar compras que não aconteceram vai contra as políticas da Meta e piora a otimização das campanhas.

## Como o lucro é calculado

```
Lucro = Faturamento aprovado
      − taxas por venda (% e fixas)
      − gasto com anúncios
      − % sobre anúncios (impostos)
      − custos fixos por dia × dias do período
```

As taxas são aplicadas na hora de mostrar, então mudar uma taxa recalcula todo o histórico. Vendas em outras moedas são convertidas com o câmbio de **Ajustes** no momento em que chegam; o gasto da Meta é convertido com o câmbio atual.

## Rodando no seu computador

```bash
cp .env.example .env.local   # preencha
npm install
npm run dev                  # http://localhost:3000
```
Para testar webhooks localmente, use um túnel (ex.: `ngrok http 3000`) e coloque a URL do túnel em `APP_URL`.

## Estrutura

```
src/
  proxy.ts                    proteção por senha
  lib/
    meta.ts                   Graph API (com appsecret_proof): insights, campanhas, páginas
    profiles.ts               perfis por token + app, contas de anúncio, renovação
    ads.ts                    linhas e métricas de Campanhas (também usadas pelas regras)
    rules.ts                  regras automáticas
    capi.ts                   API de Conversões (Purchase)
    sales.ts                  entrada de vendas + notificação + envio automático
    report.ts                 cálculo do resumo e gráficos
    fees.ts, money.ts, dates.ts, utm.ts, push.ts
  app/
    (painel)/                 telas do painel
    api/webhooks/             stripe, hotmart, digistore, universal
    api/track                 recebe as visitas do t.js
    api/push                  notificações
    api/auth/facebook         login com Facebook (perfil novo ou reconectar)
    api/cron/rules            agendador das regras + renovação dos tokens
    api/export/vendas         CSV das vendas
public/
  t.js                        script de rastreamento
  sw.js, manifest.webmanifest PWA e push
supabase/schema.sql           banco de dados (instalação nova)
supabase/migrations/          atualizações para quem já tinha o banco
```

## Segurança

- O painel inteiro fica atrás da senha; só webhooks, `t.js`, o agendador (com chave) e arquivos do PWA são públicos.
- Webhooks validam assinatura/token (Stripe, Hottok, SHA-512 da Digistore, chave do universal).
- Tokens e chaves secretas dos apps da Meta e dos pixels ficam no banco, acessados só pelo servidor com a service role. O RLS fica ligado sem políticas, então a chave pública do Supabase não lê nada.
