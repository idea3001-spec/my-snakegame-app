const CANVAS_SIZE = 400;
const GRID_SIZE = 20;
const CELL_SIZE = CANVAS_SIZE / GRID_SIZE;
const POINTS_PER_LEVEL = 50;
const LEVEL_SPEED_STEP = 10;
const MIN_MOVE_INTERVAL = 30;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const highScoreEl = document.getElementById('highScore');
const finalScoreEl = document.getElementById('finalScore');
const startOverlay = document.getElementById('startOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const pauseBtn = document.getElementById('pauseBtn');
const muteBtn = document.getElementById('muteBtn');
const difficultySelect = document.getElementById('difficulty');
const difficultyRestartSelect = document.getElementById('difficultyRestart');
const leaderboardList = document.getElementById('leaderboardList');
const dpadButtons = document.querySelectorAll('.dpad-btn');

const HISTORY_KEY = 'snakeHistory';
const HISTORY_LIMIT = 50;
const SWIPE_THRESHOLD = 20;

const AudioEngine = (() => {
  let audioCtx = null;
  let musicGain = null;
  let sfxGain = null;
  let musicTimerId = null;
  let musicStep = 0;
  let muted = false;

  const MELODY = [
    392, 440, 494, 523, 494, 440, 392, null,
    330, 392, 440, null, 349, 392, 440, null,
  ];
  const NOTE_DURATION = 0.18;

  function ensureContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();
    musicGain = audioCtx.createGain();
    musicGain.gain.value = muted ? 0 : 0.07;
    musicGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = muted ? 0 : 0.25;
    sfxGain.connect(audioCtx.destination);
  }

  function playTone(freq, duration, type, destination, delay = 0, peak = 1) {
    if (!audioCtx || muted) return;
    const startTime = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.03);
  }

  function playEat() {
    ensureContext();
    playTone(880, 0.07, 'square', sfxGain, 0, 0.5);
    playTone(1318, 0.09, 'square', sfxGain, 0.05, 0.4);
  }

  function playLevelUp() {
    ensureContext();
    [523, 659, 784, 1047].forEach((freq, i) => {
      playTone(freq, 0.14, 'triangle', sfxGain, i * 0.08, 0.5);
    });
  }

  function playGameOver() {
    ensureContext();
    [440, 349, 294, 220].forEach((freq, i) => {
      playTone(freq, 0.28, 'sawtooth', sfxGain, i * 0.14, 0.4);
    });
  }

  function playClick() {
    ensureContext();
    playTone(600, 0.05, 'square', sfxGain, 0, 0.25);
  }

  function scheduleMusicStep() {
    if (!audioCtx || muted) {
      musicTimerId = null;
      return;
    }
    const note = MELODY[musicStep % MELODY.length];
    if (note !== null) {
      playTone(note, NOTE_DURATION * 0.9, 'triangle', musicGain, 0, 0.6);
    }
    musicStep++;
    musicTimerId = setTimeout(scheduleMusicStep, NOTE_DURATION * 1000);
  }

  function startMusic() {
    ensureContext();
    if (musicTimerId || muted || !audioCtx) return;
    musicStep = 0;
    scheduleMusicStep();
  }

  function stopMusic() {
    if (musicTimerId) clearTimeout(musicTimerId);
    musicTimerId = null;
  }

  function setMuted(value) {
    muted = value;
    if (musicGain) musicGain.gain.value = muted ? 0 : 0.07;
    if (sfxGain) sfxGain.gain.value = muted ? 0 : 0.25;
    if (muted) stopMusic();
  }

  return {
    ensureContext,
    playEat,
    playLevelUp,
    playGameOver,
    playClick,
    startMusic,
    stopMusic,
    setMuted,
    isMuted: () => muted,
  };
})();

let snake, direction, nextDirection, food, score, highScore, level, moveInterval;
let gameLoopId = null;
let lastMoveTime = 0;
let isRunning = false;
let isPaused = false;
let touchStartX = 0;
let touchStartY = 0;

function loadHighScore() {
  return Number(localStorage.getItem('snakeHighScore')) || 0;
}

function saveHighScore(value) {
  localStorage.setItem('snakeHighScore', String(value));
}

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function addHistoryEntry(finalScore) {
  const history = loadHistory();
  history.push({ score: finalScore, date: Date.now() });
  history.sort((a, b) => b.score - a.score);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

function renderLeaderboard() {
  const top5 = loadHistory().slice(0, 5);
  leaderboardList.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const entry = top5[i];
    const li = document.createElement('li');
    li.innerHTML = `<span class="rank">${i + 1}위</span><span class="rank-score">${entry ? entry.score : '-'}</span>`;
    leaderboardList.appendChild(li);
  }
}

function syncDifficultyFrom(sourceSelect) {
  const value = sourceSelect.value;
  difficultySelect.value = value;
  difficultyRestartSelect.value = value;
}

function initGame() {
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  level = 1;
  highScore = loadHighScore();
  moveInterval = Number(difficultySelect.value);
  scoreEl.textContent = score;
  levelEl.textContent = level;
  highScoreEl.textContent = highScore;
  placeFood();
}

function placeFood() {
  let newFood;
  do {
    newFood = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
  } while (snake.some((segment) => segment.x === newFood.x && segment.y === newFood.y));
  food = newFood;
}

function update() {
  direction = nextDirection;

  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y,
  };

  if (
    head.x < 0 ||
    head.x >= GRID_SIZE ||
    head.y < 0 ||
    head.y >= GRID_SIZE ||
    snake.some((segment) => segment.x === head.x && segment.y === head.y)
  ) {
    endGame();
    return;
  }

  snake.unshift(head);

  if (head.x === food.x && head.y === food.y) {
    score += 10;
    scoreEl.textContent = score;
    AudioEngine.playEat();
    checkLevelUp();
    placeFood();
  } else {
    snake.pop();
  }
}

function checkLevelUp() {
  const targetLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;
  if (targetLevel > level) {
    level = targetLevel;
    levelEl.textContent = level;
    moveInterval = Math.max(MIN_MOVE_INTERVAL, moveInterval - LEVEL_SPEED_STEP);
    AudioEngine.playLevelUp();
  }
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(food.x * CELL_SIZE, food.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

  snake.forEach((segment, index) => {
    ctx.fillStyle = index === 0 ? '#9dffa4' : '#7ee787';
    ctx.fillRect(
      segment.x * CELL_SIZE + 1,
      segment.y * CELL_SIZE + 1,
      CELL_SIZE - 2,
      CELL_SIZE - 2
    );
  });
}

function gameLoop(timestamp) {
  if (!isRunning || isPaused) return;

  if (timestamp - lastMoveTime >= moveInterval) {
    lastMoveTime = timestamp;
    update();
    if (!isRunning) return;
    draw();
  }

  gameLoopId = requestAnimationFrame(gameLoop);
}

function startGame() {
  AudioEngine.ensureContext();
  initGame();
  isRunning = true;
  isPaused = false;
  pauseBtn.textContent = '일시정지';
  pauseBtn.classList.remove('hidden');
  startOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  lastMoveTime = 0;
  draw();
  gameLoopId = requestAnimationFrame(gameLoop);
  AudioEngine.startMusic();
}

function togglePause() {
  if (!isRunning) return;

  isPaused = !isPaused;

  if (isPaused) {
    pauseBtn.textContent = '재개';
    cancelAnimationFrame(gameLoopId);
    AudioEngine.stopMusic();
  } else {
    pauseBtn.textContent = '일시정지';
    lastMoveTime = 0;
    gameLoopId = requestAnimationFrame(gameLoop);
    AudioEngine.startMusic();
  }
}

function endGame() {
  isRunning = false;
  isPaused = false;
  pauseBtn.classList.add('hidden');
  cancelAnimationFrame(gameLoopId);
  AudioEngine.stopMusic();
  AudioEngine.playGameOver();

  if (score > highScore) {
    highScore = score;
    saveHighScore(highScore);
    highScoreEl.textContent = highScore;
  }

  finalScoreEl.textContent = score;
  gameOverOverlay.classList.remove('hidden');

  addHistoryEntry(score);
  renderLeaderboard();
}

function toggleMute() {
  AudioEngine.ensureContext();
  const nextMuted = !AudioEngine.isMuted();
  AudioEngine.setMuted(nextMuted);
  muteBtn.textContent = nextMuted ? '🔇' : '🔊';
  if (!nextMuted && isRunning && !isPaused) {
    AudioEngine.startMusic();
  }
}

function setDirection(dx, dy) {
  if (!isRunning || isPaused) return;

  if (dx !== 0 && direction.x === 0) {
    nextDirection = { x: dx, y: 0 };
  } else if (dy !== 0 && direction.y === 0) {
    nextDirection = { x: 0, y: dy };
  }
}

document.addEventListener('keydown', (e) => {
  if (!isRunning || isPaused) return;

  switch (e.key) {
    case 'ArrowUp':
      setDirection(0, -1);
      break;
    case 'ArrowDown':
      setDirection(0, 1);
      break;
    case 'ArrowLeft':
      setDirection(-1, 0);
      break;
    case 'ArrowRight':
      setDirection(1, 0);
      break;
    default:
      return;
  }
  e.preventDefault();
});

dpadButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setDirection(Number(btn.dataset.dx), Number(btn.dataset.dy));
  });
});

canvas.addEventListener(
  'touchstart',
  (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  },
  { passive: true }
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener('touchend', (e) => {
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (Math.max(absDx, absDy) < SWIPE_THRESHOLD) return;

  if (absDx > absDy) {
    setDirection(dx > 0 ? 1 : -1, 0);
  } else {
    setDirection(0, dy > 0 ? 1 : -1);
  }
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', () => {
  AudioEngine.playClick();
  togglePause();
});
muteBtn.addEventListener('click', toggleMute);
difficultySelect.addEventListener('change', () => syncDifficultyFrom(difficultySelect));
difficultyRestartSelect.addEventListener('change', () => syncDifficultyFrom(difficultyRestartSelect));

highScoreEl.textContent = loadHighScore();
renderLeaderboard();
