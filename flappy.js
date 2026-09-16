// Self-contained one-button flapper for the popup. No deps, original assets.
// High score in chrome.storage.local (flappyHigh).

let raf = null;
let keyHandler = null;
let clickCanvas = null;
let clickHandler = null;
let F = null;

export function stopFlappy() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  if (clickCanvas && clickHandler) clickCanvas.removeEventListener("click", clickHandler);
  clickCanvas = null;
  clickHandler = null;
  F = null;
}

export async function startFlappy({ canvas, scoreEl, highEl }) {
  stopFlappy();
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const css = getComputedStyle(document.documentElement);
  const cv = (n, f) => css.getPropertyValue(n).trim() || f;
  const colBg = cv("--bg", "#0d1420");
  const colBird = cv("--amber", "#f59e0b");
  const colPipe = cv("--green", "#22c55e");
  const colMuted = cv("--muted", "#94a3b8");

  const stored = await chrome.storage.local.get("flappyHigh").catch(() => ({}));
  let high = stored.flappyHigh || 0;
  if (highEl) highEl.textContent = high;

  const GRAV = 0.42;
  const FLAP = -6.8;
  const PIPE_W = 46;
  const GAP = 122;
  const SPEED = 2.1;
  const PIPE_INT = 1500; // ms between pipes

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

  function reset() {
    F = {
      bird: { x: 72, y: H / 2, vy: 0, r: 11 },
      pipes: [],
      score: 0,
      started: false,
      over: false,
      lastPipe: 0,
      t: 0,
    };
    if (scoreEl) scoreEl.textContent = 0;
  }
  reset();

  function flap() {
    if (F.over) {
      reset();
      F.started = true;
      F.bird.vy = FLAP;
      return;
    }
    if (!F.started) F.started = true;
    F.bird.vy = FLAP;
  }
  function gameOver() {
    F.over = true;
    if (F.score > high) {
      high = F.score;
      if (highEl) highEl.textContent = high;
      chrome.storage.local.set({ flappyHigh: high });
    }
  }

  keyHandler = (e) => {
    if (e.key === " " || e.code === "Space" || e.key === "ArrowUp") {
      e.preventDefault();
      flap();
    }
  };
  window.addEventListener("keydown", keyHandler);
  clickCanvas = canvas;
  clickHandler = () => flap();
  canvas.addEventListener("click", clickHandler);

  function update(dt, ts) {
    if (!F.started || F.over) return;
    const f = Math.min(2, dt / 16.7); // frame-rate scaling, clamped
    const b = F.bird;
    b.vy += GRAV * f;
    b.y += b.vy * f;

    if (ts - F.lastPipe > PIPE_INT) {
      F.lastPipe = ts;
      const gap = 44 + Math.random() * (H - GAP - 88);
      F.pipes.push({ x: W, gap, passed: false });
    }
    for (const p of F.pipes) p.x -= SPEED * f;
    F.pipes = F.pipes.filter((p) => p.x + PIPE_W > 0);

    for (const p of F.pipes) {
      if (!p.passed && p.x + PIPE_W < b.x) {
        p.passed = true;
        F.score++;
        if (scoreEl) scoreEl.textContent = F.score;
      }
      if (b.x + b.r > p.x && b.x - b.r < p.x + PIPE_W) {
        if (b.y - b.r < p.gap || b.y + b.r > p.gap + GAP) gameOver();
      }
    }
    if (b.y + b.r > H || b.y - b.r < 0) gameOver();
  }

  function draw() {
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = colPipe;
    for (const p of F.pipes) {
      roundRect(p.x, 0, PIPE_W, p.gap, 4);
      roundRect(p.x, p.gap + GAP, PIPE_W, H - (p.gap + GAP), 4);
    }
    // bird
    const b = F.bird;
    ctx.fillStyle = colBird;
    circle(b.x, b.y, b.r);
    ctx.fillStyle = "#ffffff";
    circle(b.x + 3, b.y - 3, 3);
    ctx.fillStyle = "#0f172a";
    circle(b.x + 4, b.y - 3, 1.5);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 24px -apple-system, Segoe UI, sans-serif";
    if (F.started && !F.over) ctx.fillText(String(F.score), W / 2, 34);

    if (!F.started || F.over) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      const cx = W / 2;
      const cy = H / 2;
      if (F.over) {
        ctx.font = "bold 20px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Game over", cx, cy - 12);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText(`Score ${F.score} · best ${high}`, cx, cy + 10);
        ctx.fillText("Space / tap to fly again", cx, cy + 28);
      } else {
        ctx.font = "bold 18px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("🐤 Flappy", cx, cy - 8);
        ctx.font = "12px -apple-system, Segoe UI, sans-serif";
        ctx.fillText("Space / tap to flap", cx, cy + 14);
      }
    }
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = F.t ? ts - F.t : 16.7;
    F.t = ts;
    if (F.started && !F.over) update(dt, ts);
    else F.lastPipe = ts; // don't spawn a backlog while waiting
    draw();
  }
  raf = requestAnimationFrame(frame);
}
