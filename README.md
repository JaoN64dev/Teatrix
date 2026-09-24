# Teatrix

Jogo de teatro online: cada jogador escreve um roteiro (drama, comédia, novela…), os roteiros são sorteados e cada um interpreta o de outra pessoa gravando **só áudio** ou **vídeo**. No final, todos assistem às atuações e votam no **melhor roteiro** e na **melhor atuação**.

Node.js + Express + Socket.IO + MongoDB, com páginas renderizadas em Handlebars.

## Como rodar

Requisitos: Node 20+ e um MongoDB (local ou Atlas).

```bash
cd server
npm install
cp .env.example .env   # ajuste MONGO_URI e SESSION_SECRET
npm run dev            # reinicia ao salvar; use npm start em produção
```

Abra http://localhost:3000.

> **Gravação exige HTTPS.** Navegadores só liberam microfone/câmera em `https://` ou em `localhost`.
> Para jogar com amigos em outros computadores, publique o servidor com HTTPS (ou use um túnel como ngrok / Cloudflare Tunnel).

## Como funciona uma partida

1. **Sala de espera** — o anfitrião cria a sala (código de 5 letras) e escolhe os tempos: para escrever (1–10 min) e para ensaiar e gravar (30 s–5 min). De 3 a 10 jogadores.
2. **Escrever** — cada um escreve um roteiro com título e escolhe o tipo de atuação: triste, com raiva, feliz ou outra (escrita pelo autor). Se o tempo acabar sem escolha, uma das prontas é sorteada.
3. **Atuar** — cada jogador recebe, por sorteio, o roteiro de **outra** pessoa (com a emoção pedida) e grava áudio ou vídeo. Dá para ouvir/assistir e regravar antes de enviar. Quando o tempo acaba, o que foi gravado é enviado automaticamente.
4. **Apresentação** — as atuações são exibidas uma a uma e quem não é autor nem ator tenta adivinhar a emoção (as opções são as prontas, as escritas na partida e 3 emoções extras sorteadas, em ordem alfabética, para as escritas não se destacarem). O anfitrião revela a emoção e depois avança; também pode **pular** o vídeo/áudio da atuação atual ou de todas as que faltam — os palpites e a revelação continuam, com base no roteiro. Os autores ficam em segredo.
5. **Votação** — melhor roteiro e melhor atuação (não vale votar em si mesmo).
6. **Resultado** — placar, autores revelados, acertos de emoção e moedas: 10 por partida, +5 para o anfitrião, +25 por vitória — melhor roteiro, melhor atuação e **melhor palpiteiro** (quem mais acertou emoções). Empates: todos ganham.

Quem cair tem 30 s para voltar; depois disso suas etapas ficam em branco e a partida segue.

## Modos de jogo

- **🌐 Online** — cada jogador no seu aparelho, em uma sala com código (fluxo acima). Vale moedas e é salvo no histórico.
- **📱 Local** (`/local`) — um único aparelho passado de mão em mão, de 3 a 10 jogadores. Entre uma vez e outra aparece a tela "Passe o aparelho para…", para ninguém ver o roteiro, a gravação, o palpite ou o voto do outro. Cada jogador escreve e grava na sua vez; na apresentação todos assistem juntos, cada um palpita a emoção em segredo e a emoção é revelada para o grupo; no fim, votos secretos e resultado. Roda inteiro no navegador (`public/js/local.js`): nada é enviado ao servidor, as gravações somem ao sair da página e a partida não vale moedas nem vai para o histórico.

### Emoção: escolhida pelo autor ou sorteada

Configuração da partida (no lobby online, pelo anfitrião, e na preparação do modo local):

- **Escolhida pelo autor** (padrão) — quem escreve escolhe a emoção; autor e ator não palpitam.
- **Sorteada para quem atua** — o roteiro é escrito sem emoção, e cada ator recebe uma emoção sorteada (das prontas ou da lista extra). Como o autor também não sabe qual caiu, ele palpita; só o ator fica de fora.

## Outras funcionalidades

- **Entrar por QR code**: na sala, o botão "QR code" mostra um código com o link da sala (gerado no servidor em `GET /room/:code/qr.svg`). Quem não estiver logado faz login ou cria conta e volta direto para a sala.
- **Contas**: cadastro e login (passport-local + bcrypt), sessão salva no MongoDB. Senhas novas com 8+ caracteres e diferentes do usuário; o formulário mostra os requisitos ao vivo, tem "mostrar senha" e aviso de Caps Lock.
- **Esqueci a senha**: ao criar a conta, o jogador recebe um **código de recuperação** (ex.: `K7QF-2MZP-9XHT`), mostrado uma única vez. Em `/forgot`, usuário + código + nova senha trocam a senha e geram um código novo (o usado deixa de valer). No perfil dá para gerar outro código confirmando a senha. Só o hash do código fica no banco.
- **Segurança**: limite de tentativas (login: 10 falhas/15 min por IP; cadastro: 5 contas/h; recuperação: 5 falhas/15 min; gravações: 10/min por usuário); o upload é conferido (sala, jogador, tipo, tamanho) antes de o arquivo ser lido; em produção (`NODE_ENV=production`) o servidor não sobe sem um `SESSION_SECRET` forte; cookie `Secure` automático em HTTPS.
- **Loja e temas**: temas comprados com moedas; trocados na loja ou no perfil (`data-theme` + variáveis CSS).
- **Histórico**: todas as partidas ficam salvas com roteiros, gravações, votos e vencedores. As gravações só podem ser acessadas por quem participou da partida.

## Estrutura

```
server/
  src/
    app.js            entrada: Express + Socket.IO + MongoDB
    config/           db, sessão, passport
    models/           User, Item, Match
    routes/           auth, lobby (salas), media (upload/stream das gravações), shop, history, profile
    game/             Room (máquina de estados), RoomManager, socket, media (arquivos)
    middleware/       auth, locals das views
    validation/       schemas Joi
    seed/items.js     itens da loja (sincronizados ao iniciar)
    views/helpers.js  helpers do Handlebars
  views/              templates .hbs
  public/             css (themes.css, style.css) e js (room.js, recorder.js, local.js)
  uploads/            gravações (criado automaticamente, fora do git)
```

### Adicionando um tema

1. Adicione o item em `server/src/seed/items.js` (`type: 'theme'`).
2. Crie o bloco `[data-theme="<key>"] { ... }` em `server/public/css/themes.css`.

### Eventos do Socket.IO

| Cliente → servidor | Servidor → cliente |
| --- | --- |
| `room:join`, `room:leave`, `room:settings`, `room:start`, `script:submit`, `performance:skip`, `showcase:guess`, `showcase:reveal`, `showcase:skip`, `showcase:next`, `vote:submit`, `room:lobby` | `room:state`, `phase:write`, `phase:perform`, `phase:progress`, `showcase:show`, `showcase:progress`, `showcase:reveal`, `showcase:skipped`, `phase:vote`, `results`, `match:saved`, `error:msg` |

As gravações são enviadas por HTTP: `POST /room/:code/performance` (corpo = arquivo, `Content-Type: audio/*` ou `video/*`) e lidas em `GET /media/:arquivo`.
