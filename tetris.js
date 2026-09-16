// Self-contained falling-blocks game ("Blocks") for the popup. No deps,
// original assets. High score in chrome.storage.local (tetrisHigh).

let raf = null;
let keyHandler = null;
let clickCanvas = null;
let clickHandler = null;
let T = null;

const COLS = 10;
const ROWS = 16; // slightly shorter well so cells can be bigger (wider board)

const PIECES = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
const COLORS = {
  I: "#22d3ee",
  O: "#facc15",
  T: "#a78bfa",
  S: "#4ade80",
  Z: "#f87171",
  J: "#60a5fa",
  L: "#fb923c",
};

export function stopTetris() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  if (clickCanvas && clickHandler) clickCanvas.removeEventListener("click", clickHandler);
  clickCanvas = null;
  clickHandler = null;
  T = null;
}

export async function startTetris({ canvas, scoreEl, highEl }) {
  stopTetris();
  const ctx = canvas.getContext("2d");
  const CELL = Math.floor(canvas.width / COLS);

  const css = getComputedStyle(document.documentElement);
  const cv = (n, f) => css.getPropertyValue(n).trim() || f;
  const colBg = cv("--bg", "#0d1420");
  const colGrid = cv("--line", "#1e293b");

  const stored = await chrome.storage.local.get("tetrisHigh").catch(() => ({}));
  let high = stored.tetrisHigh || 0;
  if (highEl) highEl.textContent = high;

  const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));

  let bag = [];
  function nextType() {
    if (!bag.length) bag = Object.keys(PIECES).sort(() => Math.random() - 0.5);
    return bag.pop();
  }
  function spawn() {
    const type = nextType();
    const matrix = PIECES[type].map((r) => r.slice());
    return { type, matrix, color: COLORS[type], x: ((COLS - matrix[0].length) / 2) | 0, y: 0 };
  }
  function collide(piece, board, ox = 0, oy = 0, m = piece.matrix) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const x = piece.x + c + ox;
        const y = piece.y + r + oy;
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && board[y][x]) return true;
      }
    }
    return false;
  }
  function rotateCW(m) {
    const n = m.length;
    const w = m[0].length;
    const res = Array.from({ length: w }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++) for (let c = 0; c < w; c++) res[c][n - 1 - r] = m[r][c];
    return res;
  }
  function lock() {
    const { matrix, x, y, color } = T.cur;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const yy = y + r;
        if (yy < 0) {
          T.over = true;
          return;
        }
        T.board[yy][x + c] = color;
      }
    }
    // Clear full lines, then let any block above fall into the empty space
    // beneath it. Repeat so blocks that fall and complete a new line also
    // clear (a satisfying cascade).
    let cleared = 0;
    for (;;) {
      let any = false;
      for (let r = 0; r < ROWS; r++) {
        if (T.board[r].every((v) => v)) {
          T.board[r] = Array(COLS).fill(0);
          cleared++;
          any = true;
        }
      }
      if (!any) break;
      // Per-column gravity: compact each column down into the gaps.
      for (let c = 0; c < COLS; c++) {
        let write = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          if (T.board[r][c]) {
            const v = T.board[r][c];
            T.board[r][c] = 0;
            T.board[write][c] = v;
            write--;
          }
        }
      }
    }
    if (cleared) {
      const table = [0, 100, 300, 500, 800];
      const pts = cleared < table.length ? table[cleared] : 800 + (cleared - 4) * 300;
      T.lines += cleared;
      T.score += pts * T.level;
      T.level = 1 + Math.floor(T.lines / 10);
      T.dropMs = Math.max(90, 800 - (T.level - 1) * 70);
      if (scoreEl) scoreEl.textContent = T.score;
    }
    T.cur = T.next;
    T.next = spawn();
    if (collide(T.cur, T.board)) T.over = true;
    if (T.over && T.score > high) {
      high = T.score;
      if (highEl) highEl.textContent = high;
      chrome.storage.local.set({ tetrisHigh: high });
    }
  }
  const move = (dx) => {
    if (!collide(T.cur, T.board, dx, 0)) T.cur.x += dx;
  };
  const softDrop = () => {
    if (!collide(T.cur, T.board, 0, 1)) T.cur.y++;
    else lock();
    T.last = 0;
  };
  const hardDrop = () => {
    while (!collide(T.cur, T.board, 0, 1)) T.cur.y++;
    lock();
  };
  const tryRotate = () => {
    const m = rotateCW(T.cur.matrix);
    for (const k of [0, -1, 1, -2, 2]) {
      if (!collide(T.cur, T.board, k, 0, m)) {
        T.cur.matrix = m;
        T.cur.x += k;
        return;
      }
    }
  };

  function reset() {
    bag = [];
    T = {
      board: emptyBoard(),
      cur: spawn(),
      next: spawn(),
      score: 0,
      lines: 0,
      level: 1,
      dropMs: 800,
      last: 0,
      started: false,
      over: false,
    };
    if (scoreEl) scoreEl.textContent = 0;
  }
  reset();

  function begin() {
    if (T.over) reset();
    T.started = true;
    T.last = 0;
  }

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  };
  const cell = (c, r, color) => {
    ctx.fillStyle = color;
    roundRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, 3);
  };
  function drawPiece(p, oy, ghost) {
    for (let r = 0; r < p.matrix.length; r++) {
      for (let c = 0; c < p.matrix[r].length; c++) {
        if (!p.matrix[r][c]) continue;
        const y = p.y + r + oy;
        if (y < 0) continue;
        if (ghost) {
          ctx.globalAlpha = 0.25;
          cell(p.x + c, y, p.color);
          ctx.globalAlpha = 1;
        } else {
          cell(p.x + c, y, p.color);
        }
      }
    }
  }

  function draw() {
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = colGrid;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * CELL);
      ctx.lineTo(COLS * CELL, j * CELL);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (T.board[r][c]) cell(c, r, T.board[r][c]);

    if (T.started && !T.over) {
      let gy = 0;
      while (!collide(T.cur, T.board, 0, gy + 1)) gy++;
      drawPiece(T.cur, gy, true);
    }
    drawPiece(T.cur, 0, false);

    if (!T.started || T.over) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      const cx = canvas.width / 2;
      const cyy = canvas.height / 2;
      if (T.over) {
        ctx.font = "bold 20px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Game over", cx, cyy - 12);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText(`Score ${T.score} · best ${high}`, cx, cyy + 10);
        ctx.fillText("Space / tap to retry", cx, cyy + 28);
      } else {
        ctx.font = "bold 18px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("🧱 Blocks", cx, cyy - 8);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Space / tap to start", cx, cyy + 14);
      }
    }
  }

  const MOVE_KEYS = [
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "a", "d", "w", "s", "A", "D", "W", "S",
  ];
  keyHandler = (e) => {
    const k = e.key;
    if (k === " " || e.code === "Space") {
      e.preventDefault();
      if (!T.started || T.over) begin();
      else hardDrop();
      return;
    }
    if (!MOVE_KEYS.includes(k)) return;
    e.preventDefault();
    if (!T.started && !T.over) T.started = true;
    if (!T.started || T.over) return;
    if (k === "ArrowLeft" || k === "a" || k === "A") move(-1);
    else if (k === "ArrowRight" || k === "d" || k === "D") move(1);
    else if (k === "ArrowUp" || k === "w" || k === "W") tryRotate();
    else if (k === "ArrowDown" || k === "s" || k === "S") softDrop();
  };
  window.addEventListener("keydown", keyHandler);

  clickCanvas = canvas;
  clickHandler = () => begin();
  canvas.addEventListener("click", clickHandler);

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (T.started && !T.over) {
      if (!T.last) T.last = ts;
      if (ts - T.last >= T.dropMs) {
        T.last = ts;
        if (!collide(T.cur, T.board, 0, 1)) T.cur.y++;
        else lock();
      }
    } else {
      T.last = 0;
    }
    draw();
  }
  raf = requestAnimationFrame(frame);
}
