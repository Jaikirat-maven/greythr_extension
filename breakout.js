// Self-contained Breakout for the popup. No deps, original assets.
// High score in chrome.storage.local (breakoutHigh).

let raf = null;
let keyHandler = null;
let moveHandler = null;
let clickCanvas = null;
let clickHandler = null;
let B = null;

export function stopBreakout() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  if (clickCanvas && moveHandler) clickCanvas.removeEventListener("mousemove", moveHandler);
  if (clickCanvas && clickHandler) clickCanvas.removeEventListener("click", clickHandler);
  clickCanvas = null;
  moveHandler = null;
  clickHandler = null;
  B = null;
}

export async function startBreakout({ canvas, scoreEl, highEl }) {
  stopBreakout();
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const css = getComputedStyle(document.documentElement);
  const cv = (n, f) => css.getPropertyValue(n).trim() || f;
  const colBg = cv("--bg", "#0d1420");
  const colPaddle = cv("--blue", "#3b82f6");

  const stored = await chrome.storage.local.get("breakoutHigh").catch(() => ({}));
  let high = stored.breakoutHigh || 0;
  if (highEl) highEl.textContent = high;

  const ROWS = 5;
  const COLS = 7;
  const MARGIN = 6;
  const brickW = (W - MARGIN * 2) / COLS;
  const brickH = 16;
  const brickTop = 34;
  const rowColors = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#60a5fa"];
  const paddleY = H - 20;

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
  const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Level 1 is a full wall; later levels are randomly generated with gaps and
  // shifting colors, so the game is endless and different every time.
  function makeBricks(level) {
    const bricks = [];
    const rows = Math.min(ROWS, 3 + Math.floor((level + 1) / 2));
    const density = Math.min(0.92, 0.55 + level * 0.06);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if (level > 1 && Math.random() > density) continue;
        bricks.push({
          x: MARGIN + c * brickW,
          y: brickTop + r * (brickH + 5),
          w: brickW - 4,
          h: brickH,
          color: rowColors[(r + level) % rowColors.length],
          alive: true,
        });
      }
    }
    if (bricks.length < COLS) {
      for (let c = 0; c < COLS; c++) {
        bricks.push({
          x: MARGIN + c * brickW,
          y: brickTop,
          w: brickW - 4,
          h: brickH,
          color: rowColors[level % rowColors.length],
          alive: true,
        });
      }
    }
    return bricks;
  }

  function stickBall() {
    B.ball = { x: B.paddle.x + B.paddle.w / 2, y: paddleY - 8, vx: 0, vy: 0, r: 6, stuck: true };
  }

  function reset() {
    const pw = 66;
    B = {
      paddle: { w: pw, h: 10, x: (W - pw) / 2 },
      ball: null,
      bricks: makeBricks(1),
      score: 0,
      lives: 3,
      level: 1,
      speed: 3.4,
      started: false,
      over: false,
    };
    stickBall();
    if (scoreEl) scoreEl.textContent = 0;
  }
  reset();

  function launch() {
    if (B.over) reset();
    if (B.ball.stuck) {
      B.ball.stuck = false;
      const ang = -Math.PI / 2 + (Math.random() * 0.6 - 0.3);
      B.ball.vx = Math.cos(ang) * B.speed;
      B.ball.vy = Math.sin(ang) * B.speed;
    }
    B.started = true;
  }

  function loseLife() {
    B.lives--;
    if (B.lives <= 0) return gameOver();
    stickBall();
  }
  function gameOver() {
    B.over = true;
    if (B.score > high) {
      high = B.score;
      if (highEl) highEl.textContent = high;
      chrome.storage.local.set({ breakoutHigh: high });
    }
  }

  function setPaddle(centerX) {
    B.paddle.x = Math.max(0, Math.min(W - B.paddle.w, centerX - B.paddle.w / 2));
    if (B.ball.stuck) B.ball.x = B.paddle.x + B.paddle.w / 2;
  }

  moveHandler = (e) => {
    const rect = canvas.getBoundingClientRect();
    setPaddle((e.clientX - rect.left) * (W / rect.width));
  };
  canvas.addEventListener("mousemove", moveHandler);

  keyHandler = (e) => {
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      launch();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      setPaddle(B.paddle.x + B.paddle.w / 2 - 26);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      setPaddle(B.paddle.x + B.paddle.w / 2 + 26);
    }
  };
  window.addEventListener("keydown", keyHandler);

  clickCanvas = canvas;
  clickHandler = () => launch();
  canvas.addEventListener("click", clickHandler);

  function update() {
    if (!B.started || B.over || B.ball.stuck) return;
    const ball = B.ball;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x - ball.r < 0) {
      ball.x = ball.r;
      ball.vx *= -1;
    }
    if (ball.x + ball.r > W) {
      ball.x = W - ball.r;
      ball.vx *= -1;
    }
    if (ball.y - ball.r < 0) {
      ball.y = ball.r;
      ball.vy *= -1;
    }
    const p = B.paddle;
    if (
      ball.vy > 0 &&
      ball.y + ball.r >= paddleY &&
      ball.y + ball.r <= paddleY + p.h + Math.abs(ball.vy) &&
      ball.x >= p.x &&
      ball.x <= p.x + p.w
    ) {
      ball.y = paddleY - ball.r;
      const hit = (ball.x - (p.x + p.w / 2)) / (p.w / 2);
      const ang = -Math.PI / 2 + hit * (Math.PI / 3);
      const sp = Math.min(6.5, Math.hypot(ball.vx, ball.vy) + 0.05);
      ball.vx = Math.cos(ang) * sp;
      ball.vy = Math.sin(ang) * sp;
    }
    if (ball.y - ball.r > H) return loseLife();
    for (const br of B.bricks) {
      if (!br.alive) continue;
      if (
        ball.x + ball.r > br.x &&
        ball.x - ball.r < br.x + br.w &&
        ball.y + ball.r > br.y &&
        ball.y - ball.r < br.y + br.h
      ) {
        br.alive = false;
        B.score += 10;
        if (scoreEl) scoreEl.textContent = B.score;
        ball.vy *= -1;
        break;
      }
    }
    if (B.bricks.every((b) => !b.alive)) {
      // Cleared! Advance to a fresh random level — endless play.
      B.level++;
      B.bricks = makeBricks(B.level);
      B.speed = Math.min(6.5, 3.4 + (B.level - 1) * 0.35);
      stickBall();
    }
  }

  function draw() {
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);
    for (const br of B.bricks) {
      if (!br.alive) continue;
      ctx.fillStyle = br.color;
      roundRect(br.x, br.y, br.w, br.h, 3);
    }
    ctx.fillStyle = colPaddle;
    roundRect(B.paddle.x, paddleY, B.paddle.w, B.paddle.h, 5);
    ctx.fillStyle = "#ffffff";
    circle(B.ball.x, B.ball.y, B.ball.r);

    ctx.fillStyle = cv("--muted", "#94a3b8");
    ctx.font = "11px -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("♥".repeat(Math.max(0, B.lives)), 6, 18);
    ctx.textAlign = "right";
    ctx.fillText("Lv " + B.level, W - 6, 18);

    if (B.started && !B.over && B.ball.stuck) {
      ctx.textAlign = "center";
      ctx.fillStyle = cv("--muted", "#94a3b8");
      ctx.font = "12px -apple-system, Segoe UI, sans-serif";
      ctx.fillText("Space / click to launch", W / 2, H / 2 + 44);
    }

    if (!B.started || B.over) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      const cx = W / 2;
      const cy = H / 2;
      if (B.over) {
        ctx.font = "bold 20px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Game over", cx, cy - 12);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText(`Score ${B.score} · best ${high}`, cx, cy + 10);
        ctx.fillText("Space / click to play again", cx, cy + 28);
      } else {
        ctx.font = "bold 18px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("🧱 Breakout", cx, cy - 8);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Move: mouse / ← → · Space to launch", cx, cy + 14);
      }
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    update();
    draw();
  }
  raf = requestAnimationFrame(frame);
}
