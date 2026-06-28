# 🎮 Genius

Releitura do clássico jogo de memória **Genius / Simon**, feita em **HTML, CSS e JavaScript puros** — sem frameworks e sem etapa de build. É só abrir o `index.html` no navegador.

O computador toca uma sequência de cores que cresce a cada rodada; você precisa repeti-la na ordem certa. Errou, acabou.

> Este projeto começou como um exercício de início de curso e foi **reconstruído do zero** para servir de peça de portfólio: arquitetura limpa, acessibilidade e atenção aos detalhes.

---

## ✨ Funcionalidades

- **Jogabilidade fiel ao Simon** — a sequência cresce uma cor por rodada.
- **Três níveis de dificuldade** (Fácil / Médio / Difícil) que mudam a velocidade.
- **Recorde persistente** — salvo no `localStorage`, sobrevive ao recarregar a página.
- **Som** com as notas musicais originais + efeito de erro sintetizado, com botão liga/desliga.
- **Jogável por teclado** (teclas `1` `2` `3` `4`) além do mouse/toque.
- **Responsivo de verdade** — funciona do celular ao desktop, inclusive em paisagem (telas baixas), com `100dvh`, *safe-area* (notch) e toque otimizado (`touch-action`).
- **Acessível** — `aria-live`, foco visível preservado a cada rodada, rótulos nas cores, narração da sequência para leitor de tela e respeito a `prefers-reduced-motion`.

---

## 🚀 Como rodar

Por usar apenas arquivos estáticos, basta **abrir o `index.html`** no navegador.

Para a melhor experiência (especialmente com os sons), sirva a pasta com um servidor estático:

```bash
# Python 3
python -m http.server

# ou Node
npx serve
```

Depois acesse `http://localhost:8000`.

---

## 🧠 Decisões técnicas

O código antigo misturava animação, cliques e verificação no mesmo lugar — e por isso não funcionava. A reconstrução girou em torno de uma ideia central: **separar estado de apresentação**.

### Máquina de estados

Todo o jogo gira em torno de quatro estados explícitos:

```
IDLE  →  SHOWING  →  INPUT  →  (acertou → SHOWING) | (errou → OVER)
```

- **`IDLE`** — antes de começar.
- **`SHOWING`** — o computador toca a sequência; a entrada do jogador fica travada.
- **`INPUT`** — vez do jogador; cada clique é comparado **na hora** com a sequência.
- **`OVER`** — fim de jogo; mostra o resultado e atualiza o recorde.

### Separação de responsabilidades

| Classe        | Responsabilidade                                            |
| ------------- | ----------------------------------------------------------- |
| `AudioEngine` | Tocar o som das cores e o efeito de erro.                   |
| `Game`        | Regras, estado e fluxo da partida. Não toca no DOM.         |
| `View`        | Tudo que manipula o DOM (acender cores, mensagens, placar). |
| `bootstrap()` | Liga eventos (cliques, teclado) ao `Game`.                  |

`Game` nunca acessa o DOM diretamente — ele fala com a `View`. Isso deixa as regras testáveis e fáceis de seguir.

### Detalhe sutil: cancelar partidas anteriores

A sequência é tocada com `async/await`. Se o jogador reinicia no meio de uma animação, poderiam existir **dois loops rodando ao mesmo tempo**. Um contador `runId` resolve isso: cada partida tem o seu, e todo loop assíncrono verifica se ainda é o atual antes de continuar.

---

## 📂 Estrutura

```
.
├── index.html      # marcação semântica e acessível
├── reset.css       # reset moderno e enxuto
├── style.css       # tema escuro, tabuleiro e animações
├── script.js       # AudioEngine + Game + View + bootstrap
└── sounds/         # notas musicais (.wav)
```

---

## 🔭 Próximos passos possíveis

- Modo "estrito" (errou, recomeça do zero) como no Simon original.
- Aceleração progressiva dentro da mesma partida.
- Testes automatizados da lógica do `Game`.

---

Feito com 💛 como exercício de reconstrução — de um protótipo de curso para um projeto bem-acabado.
