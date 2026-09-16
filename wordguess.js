// Self-contained Wordle-style daily word game for the popup. No deps, no
// network: the answer is derived from the date against a fixed bundled list,
// so every user gets the SAME word each day and it changes at local midnight.
// One puzzle per day (locks after win/lose). Streak in chrome.storage.local.

let keyHandler = null;
let clickCanvas = null;
let clickHandler = null;
let G = null;

// A fixed, ordered list of common 5-letter words. Order must stay stable so the
// per-date index maps to the same word for everyone. ~365 words → no repeat for
// over a year. (Add new words at the END so existing days don't shift.)
const WORDS = (
  "about above abuse actor acute admit adopt adult after again agent agree ahead alarm album " +
  "alert alike alive allow alone along alter among anger angle angry ankle apart apple apply " +
  "arena argue arise armor array aside asset audio audit avoid awake award aware badge badly " +
  "baker basic basin batch beach beard beast began begin begun being belly below bench berry " +
  "birth black blade blame bland blank blast blaze bleak blend bless blind block blood bloom " +
  "board boast bonus boost booth bound brain brake brand brass brave bread break breed brick " +
  "bride brief bring brisk broad broke brown brush build built bunch burst cabin cable candy " +
  "cargo carve catch cause chain chair chalk charm chart chase cheap check cheer chess chest " +
  "chief child chill chose civic civil claim clamp clash class clean clear clerk click cliff " +
  "climb cloak clock close cloth cloud clown coach coast comet coral could count court cover " +
  "crack craft crash crawl crazy cream creek crest crime crisp cross crowd crown crumb crush " +
  "curve cycle daily dairy dance dated dealt death debit debut decay delay delta dense depth " +
  "diary dirty ditch diver dizzy dodge doing donor doubt dough dozen draft drain drama drank " +
  "dream dress dried drift drill drink drive drone drown dwell eager eagle early earth easel " +
  "eaten ebony edict eight elbow elder elect elite email ember empty enemy enjoy enter entry " +
  "equal equip error essay event every exact exalt exile exist extra fable faced faint fairy " +
  "faith false fancy fatal fault favor feast fence ferry fetch fever fewer field fiery fifth " +
  "fifty fight filet final finch first fixed flame flash fleet flesh flint float flock flood " +
  "floor flora flour fluid flush focus foggy force forge forth forty forum found frame frank " +
  "fraud fresh front frost frown fruit fudge fully funny fuzzy gauge ghost giant given giver " +
  "glass gleam globe gloom glory glove going grace grade grain grand grant grape graph grasp " +
  "grass grave graze great greed green greet grief grill grind groan groom group grove grown " +
  "gruff guard guess guest guide guild guilt habit handy happy hardy harsh haste hatch haunt " +
  "haven havoc heart heavy hedge hefty hello hertz hinge hobby honey honor horse hotel hound " +
  "house hover human humor hurry ideal idler image imply index inbox inept infer inlet inner " +
  "input irony issue ivory jazzy jelly jewel joint joker jolly judge juice jumbo kayak kebab " +
  "kneel knife knock known label labor lance large laser latch later laugh layer learn lease " +
  "leash least leave ledge lemon level lever light limit linen lingo liver lobby local lodge " +
  "logic loose lorry loser lotus lover lower loyal lucky lunar lunch lyric macro madam magic " +
  "major maker mango maple march marsh match mayor meant medal media medic melon mercy merge " +
  "merit metal meter midst might minor minus mirth mixer model money month moral motor mound " +
  "mount mourn mouse mouth mover movie music naval nerve never newly nicer niece night ninja " +
  "noble noise north notch noted novel nudge nurse nylon oasis occur ocean offer often olive " +
  "onion opera orbit order organ other otter ought ounce outer owner ozone paint panel panic " +
  "paper party pasta patch pause peace pearl pedal penny perch petal phase phone photo piano " +
  "piece piety pilot pinch pitch pixel pizza place plaid plain plane plank plant plate plaza " +
  "plead pluck plumb plume plump point polar porch pound power press price pride prime print " +
  "prior prism prize probe prone proof proud prove prune pulse pupil puppy purse quake quart " +
  "queen query quest queue quick quiet quill quilt quirk quota quote rabid radar radio rainy " +
  "raise rally ranch range rapid ratio raven reach ready realm rebel refer regal reign relax " +
  "relay renew reply rerun reset rhyme rider ridge rifle right rigid rinse risky rival river " +
  "roast robin robot rocky rogue roost rough round route rover royal rugby ruler rumor rural " +
  "saint salad salsa sandy sauce sauna saved savor scale scalp scare scarf scene scent scoop " +
  "scope score scorn scout scrap scrub seize sense serve seven shade shaft shake shall shame " +
  "shape share shark sharp shear sheep sheet shelf shell shine shiny shirt shock shore short " +
  "shout shown shrub sight silky silly since siren sixth sixty skate skill skirt slate sleek " +
  "sleep slice slide slime sling slope small smart smash smell smile smoke snack snail snake " +
  "sneak snowy solar solid solve sonic sorry sound south space spare spark speak spear speed " +
  "spell spend spice spike spill spine spite split spoke spoon sport spout spray stray " +
  "squad stack staff stage stain stair stake stale stalk stall stamp stand stare stark start " +
  "steam steel steep stern stick stiff still sting stock stole stomp stone stool store storm " +
  "story stout stove strap straw strip study stuff style sugar suite sunny super surge swamp " +
  "swarm sweat sweep sweet swell swept swift swing swirl sword syrup table taken tally tango " +
  "taper tardy taste teach tease tempo tenor tense tepid thank theft their theme there these " +
  "thick thief thigh thing think third thorn those three threw throb throw thumb tidal tiger " +
  "tight timer tipsy title toast today token tonal tooth topic torch total touch tough towel " +
  "tower toxic trace track trade trail train trait tramp trash tread treat trend triad trial " +
  "tribe trick tried tripe troop trout truce truck truly trump trunk trust truth tulip tumor " +
  "tutor twang tweak twice twist udder ulcer ultra uncle under undue unfit union unite unity " +
  "unzip upper upset urban usage usher usual utter vague valet valid value valve vapor vault " +
  "venom venue verge verse video vigor villa vinyl viola viper viral virus visit vital vivid " +
  "vocal vodka vogue voice voter vouch wagon waist waltz waste watch water weary weave wedge " +
  "weird whale wheat wheel where which while whine white whole whose widen widow width wield " +
  "witch witty woman world worry worse worst worth would wound woven wrath wreck wrist write " +
  "wrong xenon yacht yeast yield young youth zebra zesty zonal"
)
  .split(/\s+/)
  .filter((w) => w.length === 5);

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function todayKey() {
  return dateKey(new Date());
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}
// Consecutive integer per LOCAL calendar day → same for everyone in the tz.
function dayNumber() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 86400000);
}

export function stopWord() {
  if (keyHandler) window.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  if (clickCanvas && clickHandler) clickCanvas.removeEventListener("click", clickHandler);
  clickCanvas = null;
  clickHandler = null;
  G = null;
}

export async function startWord({ canvas, scoreEl, highEl }) {
  stopWord();
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const css = getComputedStyle(document.documentElement);
  const cv = (n, f) => css.getPropertyValue(n).trim() || f;
  const colBg = cv("--bg", "#0d1420");
  const colInk = cv("--ink", "#f1f5f9");
  const colLine = cv("--line", "#334155");
  // Fixed tile colors so white letters stay readable in light AND dark themes
  // (theme greens/ambers can be too pale for white text).
  const colGreen = "#6aaa64";
  const colYellow = "#c9a227";
  const colAbsent = "#787c7e";
  const colGray = cv("--faint", "#64748b"); // subtle border for typed tiles

  const ROWS = 6;
  const COLS = 5;
  const GAP = 6;
  const startY = 12;
  const msgH = 26;
  const TILE = Math.min(52, Math.floor((H - startY - msgH - (ROWS - 1) * GAP) / ROWS));
  const gridW = COLS * TILE + (COLS - 1) * GAP;
  const startX = (W - gridW) / 2;

  const today = todayKey();
  const answer = WORDS[((dayNumber() % WORDS.length) + WORDS.length) % WORDS.length].toUpperCase();

  const stored = await chrome.storage.local
    .get(["wordStreak", "wordBest", "wordLastWin", "wordDaily"])
    .catch(() => ({}));
  let streak = stored.wordStreak || 0;
  let best = stored.wordBest || 0;
  if (scoreEl) scoreEl.textContent = streak;
  if (highEl) highEl.textContent = best;

  // Resume today's puzzle (progress or completed+locked); else start fresh.
  const daily = stored.wordDaily && stored.wordDaily.date === today ? stored.wordDaily : null;
  G = {
    answer,
    guesses: daily ? daily.guesses || [] : [],
    current: "",
    done: daily ? !!daily.done : false,
    win: daily ? !!daily.win : false,
  };

  function persist() {
    chrome.storage.local.set({
      wordDaily: { date: today, guesses: G.guesses, done: G.done, win: G.win },
    });
  }

  function evaluate(guess) {
    const res = Array(COLS).fill("x");
    const ans = G.answer.split("");
    const used = Array(COLS).fill(false);
    for (let i = 0; i < COLS; i++) {
      if (guess[i] === ans[i]) {
        res[i] = "g";
        used[i] = true;
      }
    }
    for (let i = 0; i < COLS; i++) {
      if (res[i] === "g") continue;
      const j = ans.findIndex((ch, k) => !used[k] && ch === guess[i]);
      if (j >= 0) {
        res[i] = "y";
        used[j] = true;
      }
    }
    return res;
  }

  function finishWin() {
    G.done = true;
    G.win = true;
    // Daily streak: extend if the previous win was yesterday, else start at 1.
    streak = stored.wordLastWin === yesterdayKey() ? (stored.wordStreak || 0) + 1 : 1;
    best = Math.max(best, streak);
    chrome.storage.local.set({ wordStreak: streak, wordBest: best, wordLastWin: today });
    if (scoreEl) scoreEl.textContent = streak;
    if (highEl) highEl.textContent = best;
  }
  function finishLose() {
    G.done = true;
    G.win = false;
    streak = 0;
    chrome.storage.local.set({ wordStreak: 0 });
    if (scoreEl) scoreEl.textContent = 0;
  }

  function submit() {
    if (G.current.length !== COLS || G.done) return;
    const guess = G.current;
    G.guesses.push({ guess, res: evaluate(guess) });
    G.current = "";
    if (guess === G.answer) finishWin();
    else if (G.guesses.length >= ROWS) finishLose();
    persist();
    draw();
  }

  const tileColor = (s) => (s === "g" ? colGreen : s === "y" ? colYellow : colAbsent);
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  function drawTile(r, c, letter, state) {
    const x = startX + c * (TILE + GAP);
    const y = startY + r * (TILE + GAP);
    if (state) {
      ctx.fillStyle = tileColor(state);
      rr(x, y, TILE, TILE, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
    } else {
      ctx.fillStyle = colBg;
      rr(x, y, TILE, TILE, 8);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = letter ? colGray : colLine;
      rr(x, y, TILE, TILE, 8);
      ctx.stroke();
      ctx.fillStyle = colInk;
    }
    if (letter) {
      ctx.font = `bold ${Math.round(TILE * 0.5)}px -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, x + TILE / 2, y + TILE / 2 + 1);
    }
  }

  function draw() {
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < ROWS; r++) {
      const g = G.guesses[r];
      for (let c = 0; c < COLS; c++) {
        if (g) drawTile(r, c, g.guess[c], g.res[c]);
        else if (r === G.guesses.length && !G.done) drawTile(r, c, G.current[c] || "", null);
        else drawTile(r, c, "", null);
      }
    }
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.font = "13px -apple-system, Segoe UI, sans-serif";
    const my = H - 12;
    if (G.done && G.win) {
      ctx.fillStyle = colGreen;
      ctx.fillText("Solved! 🎉  Come back tomorrow", W / 2, my);
    } else if (G.done) {
      ctx.fillStyle = colInk;
      ctx.fillText(`Answer: ${G.answer} · new word tomorrow`, W / 2, my);
    } else {
      ctx.fillStyle = colGray;
      ctx.fillText("Today's word · type 5 letters, Enter", W / 2, my);
    }
  }
  draw();

  keyHandler = (e) => {
    if (G.done) return; // locked until tomorrow
    const k = e.key;
    if (k === "Enter") {
      e.preventDefault();
      submit();
    } else if (k === "Backspace") {
      e.preventDefault();
      G.current = G.current.slice(0, -1);
      draw();
    } else if (/^[a-zA-Z]$/.test(k) && G.current.length < COLS) {
      G.current += k.toUpperCase();
      draw();
    }
  };
  window.addEventListener("keydown", keyHandler);
  clickCanvas = canvas;
  clickHandler = () => {};
  canvas.addEventListener("click", clickHandler);
}
