// Self-contained Snake game for the popup. No dependencies, original assets.
// Colors are read from the extension's theme CSS variables so it matches the
// chosen accent / light-dark. High score is kept in chrome.storage.local.

let raf = null;
let keyHandler = null;
let clickCanvas = null;
let clickHandler = null;
let S = null;

const DIRS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  W: [0, -1],
  S: [0, 1],
  A: [-1, 0],
  D: [1, 0],
};

export function stopSnake() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  if (clickCanvas && clickHandler) clickCanvas.removeEventListener("click", clickHandler);
  clickCanvas = null;
  clickHandler = null;
  S = null;
}

export async function startSnake({ canvas, scoreEl, highEl }) {
  stopSnake();
  const ctx = canvas.getContext("2d");
  const CELL = 20;
  const COLS = Math.floor(canvas.width / CELL);
  const ROWS = Math.floor(canvas.height / CELL);

  const css = getComputedStyle(document.documentElement);
  const cv = (n, f) => css.getPropertyValue(n).trim() || f;
  const colBg = cv("--bg", "#0d1420");
  const colGrid = cv("--line", "#1e293b");

  const stored = await chrome.storage.local.get("snakeHigh").catch(() => ({}));
  let high = stored.snakeHigh || 0;
  if (highEl) highEl.textContent = high;

  const freshFood = (snake) => {
    let f;
    do {
      f = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 };
    } while (snake.some((s) => s.x === f.x && s.y === f.y));
    return f;
  };

  function reset() {
    const cy = (ROWS / 2) | 0;
    const snake = [
      { x: 3, y: cy },
      { x: 2, y: cy },
      { x: 1, y: cy },
    ];
    S = {
      snake,
      dir: [1, 0],
      next: [1, 0],
      food: freshFood(snake),
      score: 0,
      started: false,
      alive: true,
      over: false,
      stepMs: 200,
      last: 0,
    };
    if (scoreEl) scoreEl.textContent = 0;
  }
  reset();

  function gameOver() {
    S.alive = false;
    S.over = true;
    if (S.score > high) {
      high = S.score;
      if (highEl) highEl.textContent = high;
      chrome.storage.local.set({ snakeHigh: high });
    }
  }

  function step() {
    S.dir = S.next;
    const head = { x: S.snake[0].x + S.dir[0], y: S.snake[0].y + S.dir[1] };
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return gameOver();
    const eating = head.x === S.food.x && head.y === S.food.y;
    const body = eating ? S.snake : S.snake.slice(0, -1);
    if (body.some((s) => s.x === head.x && s.y === head.y)) return gameOver();
    S.snake.unshift(head);
    if (eating) {
      S.score++;
      if (scoreEl) scoreEl.textContent = S.score;
      S.food = freshFood(S.snake);
      // Gentler ramp: starts calm, speeds up slowly, and never gets frantic.
      S.stepMs = Math.max(110, 200 - S.score * 3);
    } else {
      S.snake.pop();
    }
  }

  const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
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

  function draw() {
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = colGrid;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, canvas.height);
      ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * CELL);
      ctx.lineTo(canvas.width, j * CELL);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const t = performance.now();

    // Pulsing "apple" with a dark halo so it stays visible over any color.
    const fx = S.food.x * CELL + CELL / 2;
    const fy = S.food.y * CELL + CELL / 2;
    const pulse = CELL * (0.3 + 0.05 * Math.sin(t / 150));
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    circle(fx, fy, pulse + 2);
    ctx.fillStyle = "#ffd23f";
    circle(fx, fy, pulse);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    circle(fx - pulse * 0.3, fy - pulse * 0.3, pulse * 0.25);

    // Animated rainbow snake — hue shifts along the body and over time.
    const baseHue = (t / 30) % 360;
    S.snake.forEach((s, i) => {
      const hue = (baseHue + i * 14) % 360;
      ctx.fillStyle =
        i === 0 ? `hsl(${hue}, 95%, 62%)` : `hsl(${hue}, 80%, 55%)`;
      roundRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4, 5);
    });

    if (!S.started || S.over) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      const cx = canvas.width / 2;
      const cyy = canvas.height / 2;
      if (S.over) {
        ctx.font = "bold 22px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Game over", cx, cyy - 14);
        ctx.font = "13px -apple-system, Segoe UI, sans-serif";
        ctx.fillText(`Score ${S.score} · best ${high}`, cx, cyy + 10);
        ctx.fillText("Space / tap to retry", cx, cyy + 30);
      } else {
        ctx.font = "bold 20px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("🐍 Snake", cx, cyy - 10);
        ctx.font = "13px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Arrow keys / WASD · Space to start", cx, cyy + 14);
      }
    }
  }

  function begin() {
    if (S.over) reset();
    S.started = true;
    S.last = 0;
  }

  keyHandler = (e) => {
    if (e.key === " " || e.key === "Spacebar" || e.code === "Space") {
      e.preventDefault();
      begin();
      return;
    }
    const d = DIRS[e.key];
    if (!d) return;
    e.preventDefault();
    if (!S.started && !S.over) S.started = true;
    // Can't reverse straight back onto yourself.
    if (d[0] === -S.dir[0] && d[1] === -S.dir[1]) return;
    S.next = d;
  };
  window.addEventListener("keydown", keyHandler);

  clickCanvas = canvas;
  clickHandler = () => begin();
  canvas.addEventListener("click", clickHandler);

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (S.started && S.alive) {
      if (!S.last) S.last = ts;
      if (ts - S.last >= S.stepMs) {
        S.last = ts;
        step();
      }
    } else {
      S.last = 0;
    }
    draw();
  }
  raf = requestAnimationFrame(frame);
}
