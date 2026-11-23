# STOPBALL — Gestão da produção

App web (HTML + JavaScript puro, sem build) para publicar no GitHub Pages em **https://stopball.gutgestao.com.br**, com banco no Supabase (projeto **PROJETOS**, schema **`stopball`**). Mesmo padrão dos apps BERNARD, KLINIK, MALI e YAZFIT.

Substitui o AppSheet "Stopball" (planilha "GESTÃO STOPBALL").

## Fluxo
1. **Pedido** entra em TRIAGEM (perfil `pedidos`): ordem, lote, artigo, vendedor, quantidade, datas, especificação (linha, gola, tecidos…), PDF.
2. **Painel por setor**: cada área (Design, Sublimado, Uniforme, Logística, Bolsas, Acabamento) vê os setores dela, com os pedidos agrupados por vendedor e a cor do prazo.
3. **Iniciar** (escolhe o operador) → **Finalizar** (escolhe o próximo setor). Finalizar grava o apontamento com data e hora, troca o setor e recalcula a previsão, tudo numa transação (`stopball.finalizar_setor`). Dá para selecionar vários cartões e iniciar ou finalizar em lote.
4. **Reposições**, **checklist de design**, **facção / dividir (DIV2)** e **OP para imprimir** ficam na janela do pedido.

## Regras (no banco)
- Previsão no setor = data da movimentação + round((entrega − pedido) × prazo do setor). DESIGN-GRID limitado a 20 dias. Prazos em **Cadastros → Setores**.
- Cada área só movimenta os setores dela (`stopball.pode_mover`); admin movimenta tudo.
- Histórico vindo do AppSheet tem `so_data = true` (o AppSheet gravava só a data). O tempo real por setor vale só para o que for feito no app novo.

## Perfis
| Perfil | Pode |
|---|---|
| admin | tudo, inclusive usuários e cadastros |
| pedidos | cadastrar, editar e corrigir setor de pedidos |
| design · sublimado · uniforme · logistica · bolsas · acabamento | iniciar e finalizar nos setores da sua área |

Login por área: o admin cria em **Usuários** (ex.: usuário `design`, que vira `design@stopball.app` no Auth).

## Importação da planilha
`stopball_import.raw` recebe as abas (via `public.stopball_importar_lote`, com token de `stopball_import.tokens`) e `stopball_import.sincronizar()` recria pedidos, apontamentos e reposições vindos da planilha (os que têm `legacy_id`). Grafias erradas de vendedor ficam em `stopball_import.alias_vendedor`. Rodar de novo no dia da virada.

## Publicação
Branch `main` publicada pelo GitHub Pages a partir da raiz. Domínio: registro **CNAME** `stopball` → `facsimprojetos-cloud.github.io` no DNS de `gutgestao.com.br` (arquivo `CNAME` na raiz). O schema `stopball` precisa estar em **Settings → Data API → Exposed schemas** no Supabase.

## Estrutura
```
index.html              página única
css/app.css             estilos (inclui a OP para impressão)
js/config.js            URL e chave pública do Supabase, áreas
js/estado.js            cliente Supabase e usuário logado
js/app.js               login, menu e rotas
js/util.js              utilidades, modal, cadastros em cache, impressão
js/pedido.js            janela do pedido, iniciar/finalizar, formulário, reposição, OP
js/telas/*.js           painel, pedidos, reposições, histórico, cadastros, usuários
supabase/migrations/    migrations do schema stopball
```
