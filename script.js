'use strict';

/* ============================================================
   GENIUS (Simon) — jogo de memória
   ------------------------------------------------------------
   Arquitetura em três partes:
     1. AudioEngine — toca o som de cada cor e o som de erro.
     2. Game        — máquina de estados + regras do jogo.
     3. bootstrap() — conecta o DOM (botões, teclado) ao Game.

   Estados possíveis do jogo:
     IDLE     -> aguardando o jogador iniciar
     SHOWING  -> o computador está tocando a sequência (entrada travada)
     INPUT    -> vez do jogador reproduzir a sequência
     OVER     -> o jogador errou; fim de jogo
   ============================================================ */

/** Ordem canônica das cores; o índice (0..3) é a "linguagem" do jogo. */
const PADS = ['green', 'red', 'blue', 'yellow'];

/** Som tocado por cada cor. */
const PAD_SOUNDS = {
    green: 'sounds/DO.wav',
    red: 'sounds/MI.wav',
    blue: 'sounds/SOL.wav',
    yellow: 'sounds/SI.wav',
};

/** Velocidades (ms) por dificuldade: quanto a cor fica acesa e a pausa entre cores. */
const DIFFICULTY = {
    facil: { flash: 520, gap: 300 },
    medio: { flash: 380, gap: 200 },
    dificil: { flash: 260, gap: 130 },
};

/** Chaves usadas no localStorage. */
const STORAGE = {
    highScore: 'genius:highScore',
    muted: 'genius:muted',
    difficulty: 'genius:difficulty',
};

/** Promessa que resolve após `ms` milissegundos. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sorteia um índice de cor (0..3). */
const randomPad = () => Math.floor(Math.random() * PADS.length);

/** Nome de cada cor (para anúncio em leitor de tela). */
const PAD_NAMES = { green: 'Verde', red: 'Vermelho', blue: 'Azul', yellow: 'Amarelo' };

/**
 * Acesso ao localStorage tolerante a falhas: modo privado, sandbox ou quota
 * podem lançar exceção. Nunca deixa a UI quebrar por causa de persistência.
 */
const storage = {
    get(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            /* persistência indisponível — segue o jogo */
        }
    },
};

/* ============================================================
   AudioEngine — som das cores (amostras .wav) + erro (Web Audio)
   ============================================================ */

class AudioEngine {
    constructor() {
        this.muted = false;
        /** @type {Record<string, HTMLAudioElement>} */
        this.samples = {};
        for (const [pad, src] of Object.entries(PAD_SOUNDS)) {
            const audio = new Audio(src);
            audio.preload = 'auto';
            this.samples[pad] = audio;
        }
        /** AudioContext criado sob demanda (apenas para o som de erro). */
        this._ctx = null;
    }

    setMuted(muted) {
        this.muted = muted;
    }

    /** Toca o som de uma cor. Clona o nó para permitir disparos rápidos sobrepostos. */
    playPad(pad) {
        if (this.muted) return;
        const base = this.samples[pad];
        if (!base) return;
        try {
            const node = base.cloneNode();
            node.volume = 0.55;
            node.play().catch(() => { /* navegador pode bloquear sem interação */ });
        } catch {
            /* áudio indisponível — o jogo continua sem som */
        }
    }

    /** Som de erro: um "buzz" descendente sintetizado (não depende de arquivo). */
    playError() {
        if (this.muted) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = this._ctx ?? (this._ctx = new Ctx());
            if (ctx.state === 'suspended') ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const now = ctx.currentTime;

            osc.type = 'square';
            osc.frequency.setValueAtTime(190, now);
            osc.frequency.exponentialRampToValueAtTime(70, now + 0.5);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

            osc.connect(gain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.5);
        } catch {
            /* Web Audio indisponível — ignora */
        }
    }
}

/* ============================================================
   Game — máquina de estados e regras
   ============================================================ */

class Game {
    /**
     * @param {View} view   Camada de apresentação (manipula o DOM).
     * @param {AudioEngine} audio
     */
    constructor(view, audio) {
        this.view = view;
        this.audio = audio;

        /** @type {number[]} Sequência completa gerada pelo computador. */
        this.sequence = [];
        /** Posição atual do jogador ao reproduzir a sequência. */
        this.playerIndex = 0;
        /** Estado atual da máquina. */
        this.state = 'IDLE';
        this.difficulty = 'medio';

        /**
         * Identificador da "rodada de jogo" atual. Toda vez que start() é
         * chamado ele é incrementado; loops assíncronos em andamento checam
         * esse valor e abortam se uma nova partida começou (evita duas
         * sequências tocando ao mesmo tempo).
         */
        this.runId = 0;

        this.highScore = Number(storage.get(STORAGE.highScore)) || 0;
        this.view.setHighScore(this.highScore);
        this.view.setRound(0);
    }

    get speed() {
        return DIFFICULTY[this.difficulty];
    }

    setDifficulty(difficulty) {
        if (DIFFICULTY[difficulty]) this.difficulty = difficulty;
    }

    /** Inicia (ou reinicia) uma partida. */
    async start() {
        const runId = ++this.runId; // invalida qualquer loop anterior
        this.sequence = [];
        this.playerIndex = 0;
        this.view.setStartLabel('Recomeçar');
        await this.nextRound(runId);
    }

    /** Adiciona uma nova cor e toca a sequência inteira. */
    async nextRound(runId) {
        this.playerIndex = 0;
        this.sequence.push(randomPad());
        this.view.setRound(this.sequence.length);

        await sleep(600);
        if (runId !== this.runId) return; // partida foi reiniciada

        const finished = await this.playSequence(runId);
        if (!finished || runId !== this.runId) return;

        this.state = 'INPUT';
        this.view.setInputEnabled(true);
        this.view.setMessage('Sua vez!');
    }

    /** Toca a sequência inteira, acendendo uma cor por vez. */
    async playSequence(runId) {
        this.state = 'SHOWING';
        this.view.setInputEnabled(false);
        // Inclui a rodada na mensagem (região aria-live) para o leitor de tela
        // anunciar o avanço de progresso, além de mostrar no hub.
        this.view.setMessage(`Rodada ${this.sequence.length}. Observe a sequência…`);

        const { flash, gap } = this.speed;
        await sleep(gap);

        for (const padIndex of this.sequence) {
            if (runId !== this.runId) return false;
            await this.flashPad(padIndex, flash);
            if (runId !== this.runId) return false;
            await sleep(gap);
        }
        return true;
    }

    /** Acende uma cor por `duration` ms e toca o som correspondente. */
    async flashPad(padIndex, duration) {
        const pad = PADS[padIndex];
        this.view.activate(pad);
        this.view.announce(PAD_NAMES[pad]);
        this.audio.playPad(pad);
        await sleep(duration);
        this.view.deactivate(pad);
    }

    /** Processa um clique/tecla do jogador. Só age durante o estado INPUT. */
    press(padIndex) {
        if (this.state !== 'INPUT') return;

        const pad = PADS[padIndex];
        this.view.activate(pad);
        this.audio.playPad(pad);
        setTimeout(() => this.view.deactivate(pad), 180);

        const expected = this.sequence[this.playerIndex];
        if (padIndex !== expected) {
            this.gameOver();
            return;
        }

        this.playerIndex++;

        // Completou a sequência da rodada?
        if (this.playerIndex === this.sequence.length) {
            this.state = 'SHOWING'; // trava a entrada durante a transição
            this.view.setInputEnabled(false);
            this.view.setMessage('Boa! 🎉');
            this.nextRound(this.runId);
        }
    }

    /** Fim de jogo: toca o erro, atualiza recorde e libera reinício. */
    gameOver() {
        this.state = 'OVER';
        this.runId++; // cancela qualquer loop pendente por garantia
        this.view.setInputEnabled(false);
        this.view.flashError();
        this.audio.playError();

        const score = this.sequence.length - 1; // rodadas completadas com sucesso

        if (score > this.highScore) {
            this.highScore = score;
            storage.set(STORAGE.highScore, String(score));
            this.view.setHighScore(score);
            this.view.setMessage(`🏆 Novo recorde: ${score} ${plural(score)}!`);
        } else {
            this.view.setMessage(`Você fez ${score} ${plural(score)}. Tente de novo!`);
        }

        this.view.setStartLabel('Jogar de novo');
    }
}

/** "1 rodada" vs "N rodadas". */
const plural = (n) => (n === 1 ? 'rodada' : 'rodadas');

/* ============================================================
   View — tudo que toca no DOM fica isolado aqui
   ============================================================ */

class View {
    constructor() {
        this.pads = {};
        document.querySelectorAll('.pad').forEach((el) => {
            this.pads[PADS[Number(el.dataset.pad)]] = el;
        });
        this.board = document.querySelector('.board');
        this.roundEl = document.querySelector('[data-round]');
        this.highEl = document.querySelector('[data-highscore]');
        this.statusEl = document.querySelector('[data-status]');
        this.startBtn = document.querySelector('[data-action="start"]');
        this.narrateEl = document.querySelector('[data-narrate]');
        this._errorTimer = null;
        this._narrateFlip = false;
    }

    activate(pad) {
        this.pads[pad]?.classList.add('pad--active');
    }

    deactivate(pad) {
        this.pads[pad]?.classList.remove('pad--active');
    }

    setRound(n) {
        this.roundEl.textContent = String(n);
    }

    setHighScore(n) {
        this.highEl.textContent = String(n);
    }

    setMessage(text) {
        this.statusEl.textContent = text;
    }

    setStartLabel(text) {
        this.startBtn.textContent = text;
    }

    /** Anuncia uma cor para o leitor de tela durante a demonstração. */
    announce(text) {
        if (!this.narrateEl) return;
        // Alterna um espaço invisível no fim para forçar o reanúncio de cores
        // repetidas consecutivas (a região live só dispara quando o texto muda).
        this._narrateFlip = !this._narrateFlip;
        this.narrateEl.textContent = this._narrateFlip ? text : `${text} `;
    }

    /**
     * Habilita/desabilita a entrada do jogador. Usa aria-disabled + .board--locked
     * (que bloqueia o ponteiro via CSS) em vez do atributo [disabled], assim as
     * pads continuam focáveis e o anel de foco do teclado não some a cada rodada.
     */
    setInputEnabled(enabled) {
        this.board.classList.toggle('board--locked', !enabled);
        for (const el of Object.values(this.pads)) {
            el.setAttribute('aria-disabled', String(!enabled));
        }
    }

    /** Animação curta de erro no tabuleiro. */
    flashError() {
        this.board.classList.add('board--error');
        clearTimeout(this._errorTimer);
        this._errorTimer = setTimeout(
            () => this.board.classList.remove('board--error'),
            450,
        );
    }
}

/* ============================================================
   bootstrap — liga DOM ao Game
   ============================================================ */

function bootstrap() {
    const view = new View();
    const audio = new AudioEngine();
    const game = new Game(view, audio);

    view.setInputEnabled(false); // tabuleiro começa travado

    // --- Cliques nas cores ---
    for (const [pad, el] of Object.entries(view.pads)) {
        const index = PADS.indexOf(pad);
        el.addEventListener('click', () => game.press(index));
    }

    // --- Teclado: teclas 1..4 ---
    const KEY_TO_PAD = { '1': 0, '2': 1, '3': 2, '4': 3 };
    window.addEventListener('keydown', (event) => {
        if (event.repeat) return; // ignora auto-repeat do SO ao segurar a tecla
        if (event.key in KEY_TO_PAD) {
            event.preventDefault();
            game.press(KEY_TO_PAD[event.key]);
        }
    });

    // --- Botão começar/recomeçar ---
    view.startBtn.addEventListener('click', () => game.start());

    // --- Dificuldade (persistida) ---
    const diffBtns = [...document.querySelectorAll('[data-difficulty]')];
    const applyDifficulty = (value) => {
        if (!DIFFICULTY[value]) return;
        game.setDifficulty(value);
        for (const btn of diffBtns) {
            btn.setAttribute('aria-pressed', String(btn.dataset.difficulty === value));
        }
        storage.set(STORAGE.difficulty, value);
    };
    for (const btn of diffBtns) {
        btn.addEventListener('click', () => applyDifficulty(btn.dataset.difficulty));
    }
    applyDifficulty(storage.get(STORAGE.difficulty) || 'medio');

    // --- Liga/desliga som (persistido) ---
    const soundBtn = document.querySelector('[data-action="sound"]');
    let muted = storage.get(STORAGE.muted) === '1';
    const applyMuted = () => {
        audio.setMuted(muted);
        soundBtn.setAttribute('aria-pressed', String(!muted));
        soundBtn.textContent = muted ? '🔇 Som' : '🔊 Som';
    };
    soundBtn.addEventListener('click', () => {
        muted = !muted;
        storage.set(STORAGE.muted, muted ? '1' : '0');
        applyMuted();
    });
    applyMuted();
}

document.addEventListener('DOMContentLoaded', bootstrap);
