import {
  FilesetResolver,
  PoseLandmarker,
  FaceLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// --- DOM REFERENCES ---
const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const toggleBtn = document.getElementById("toggleBtn");
const recalibrateBtn = document.getElementById("recalibrateBtn");
const audioBtn = document.getElementById("audioBtn");
const notifBtn = document.getElementById("notifBtn");
const screenPlaceholder = document.getElementById("screenPlaceholder");
const statusBadge = document.getElementById("statusBadge");
const fpsChip = document.getElementById("fpsChip");

const calibOverlay = document.getElementById("calibOverlay");
const calibStepBadge = document.getElementById("calibStepBadge");
const calibTitle = document.getElementById("calibTitle");
const calibDesc = document.getElementById("calibDesc");
const calibProgressBar = document.getElementById("calibProgressBar");

const mascotCard = document.getElementById("mascotCard");
const speechBubble = document.getElementById("speechBubble");
const starsCountEl = document.getElementById("starsCount");
const shopStarsBalance = document.getElementById("shopStarsBalance");

const angleValue = document.getElementById("angleValue");
const angleHint = document.getElementById("angleHint");
const slouchTimerEl = document.getElementById("slouchTimer");
const delayDisplay = document.getElementById("delayDisplay");
const scoreValue = document.getElementById("scoreValue");

const leniencySlider = document.getElementById("leniencySlider");
const delaySlider = document.getElementById("delaySlider");
const leniencyLabel = document.getElementById("leniencyLabel");
const delayThreshLabel = document.getElementById("delayThreshLabel");

// --- STATE ---
let poseLandmarker = null;
let faceLandmarker = null;
let isRunning = false;
let audioEnabled = true;
let notifEnabled = false;
let animationId = null;

// 2-Point Calibration & Hysteresis State
let calibStage = "IDLE"; // "IDLE" | "UPRIGHT" | "SLOUCH"
let calibSamples = [];
let uprightRef = null;
let slouchRef = null;

let smoothedScore = 100;
let isCurrentlySlouching = false;
let leniencyLevel = 2; // 1: Relaxed (65%), 2: Balanced (74%), 3: Strict (82%)
let alertDelay = 3;

let slouchStart = null;
let goodStreakStart = null;
let starsEarned = Number(localStorage.getItem("mochi_stars") || 0);
let unlockedItems = JSON.parse(localStorage.getItem("mochi_items") || "[]");
let lastBeepTime = 0;
let lastNotifTime = 0;

// Session Analytics for End-of-Session Chart
let sessionStartTime = null;
let goodFrames = 0;
let totalTrackedFrames = 0;
let timelineHistory = [];
let lastHistorySample = 0;
let lastVideoTime = -1;
let lastFrameTime = performance.now();
let chartInstance = null;

const HAPPY_QUOTES = [
  "Purr-fect 3D posture! Your spine is glowing today! ✨",
  "Look at that royal alignment! Keep shining, friend! 🌸",
  "Mochi is SO proud of your focus! 💖",
  "Tall neck, relaxed shoulders—10/10 ergonomics! 🍓",
];

const ANGRY_QUOTES = [
  "Hmph!! You're slouching! Sit up tall right now!! 💢",
  "Hey! No shrimp posture allowed in Mochi's studio! 😤",
  "Your neck is carrying 25 kg right now! Straighten up!! 💢",
];

// --- SYNC STARS & UNLOCKED SHOP ITEMS ---
function syncShopUI() {
  starsCountEl.textContent = starsEarned;
  shopStarsBalance.textContent = starsEarned;
  localStorage.setItem("mochi_stars", starsEarned);
  localStorage.setItem("mochi_items", JSON.stringify(unlockedItems));

  unlockedItems.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
  });

  document.querySelectorAll(".shop-buy-btn").forEach((btn) => {
    const item = btn.dataset.item;
    if (unlockedItems.includes(item)) {
      btn.textContent = "✅ Equipped!";
      btn.disabled = true;
    }
  });
}
syncShopUI();

document.querySelectorAll(".shop-buy-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const item = btn.dataset.item;
    const cost = Number(btn.dataset.cost);
    if (starsEarned >= cost && !unlockedItems.includes(item)) {
      starsEarned -= cost;
      unlockedItems.push(item);
      syncShopUI();
      playChime("happy");
    } else {
      alert(`You need ${cost} 🌸 Stars! Keep sitting tall to earn more!`);
    }
  });
});

// --- MULTI-PAGE TAB NAVIGATION ---
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".page-view").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.page).classList.add("active");
  });
});

// --- POMODORO FOCUS TIMER ---
const pomoDisplay = document.getElementById("pomoDisplay");
const pomoModeLabel = document.getElementById("pomoModeLabel");
const pomoToggleBtn = document.getElementById("pomoToggleBtn");
const pomoResetBtn = document.getElementById("pomoResetBtn");
let pomoSeconds = 25 * 60;
let pomoIsBreak = false;
let pomoInterval = null;

function updatePomoText() {
  const m = String(Math.floor(pomoSeconds / 60)).padStart(2, "0");
  const s = String(pomoSeconds % 60).padStart(2, "0");
  pomoDisplay.textContent = `${m}:${s}`;
}

pomoToggleBtn.addEventListener("click", () => {
  if (pomoInterval) {
    clearInterval(pomoInterval);
    pomoInterval = null;
    pomoToggleBtn.textContent = "▶ Start";
    return;
  }
  pomoToggleBtn.textContent = "⏸ Pause";
  pomoInterval = setInterval(() => {
    pomoSeconds--;
    updatePomoText();
    if (pomoSeconds <= 0) {
      pomoIsBreak = !pomoIsBreak;
      pomoSeconds = pomoIsBreak ? 5 * 60 : 25 * 60;
      pomoModeLabel.textContent = pomoIsBreak ? "🍵 Break" : "🍅 Focus";
      playChime("happy");
      sendDesktopNotification(
        pomoIsBreak ? "🍵 5-Min Stretch Break!" : "🍅 Back to Focus!",
        pomoIsBreak ? "Stand up and stretch with Mochi!" : "Let's crush the next 25-min block!"
      );
    }
  }, 1000);
});

pomoResetBtn.addEventListener("click", () => {
  clearInterval(pomoInterval);
  pomoInterval = null;
  pomoIsBreak = false;
  pomoSeconds = 25 * 60;
  pomoModeLabel.textContent = "🍅 Focus";
  pomoToggleBtn.textContent = "▶ Start";
  updatePomoText();
});

// --- 30-SECOND STRETCH BREAK TIMER ---
const startStretchBtn = document.getElementById("startStretchBtn");
const stretchCountdown = document.getElementById("stretchCountdown");
let stretchInterval = null;

startStretchBtn.addEventListener("click", () => {
  if (stretchInterval) {
    clearInterval(stretchInterval);
    stretchInterval = null;
    stretchCountdown.textContent = "00:30";
    startStretchBtn.textContent = "▶ Start 30s Stretch";
    return;
  }
  let secondsLeft = 30;
  startStretchBtn.textContent = "⏹ Stop Timer";
  stretchInterval = setInterval(() => {
    secondsLeft--;
    stretchCountdown.textContent = `00:${String(secondsLeft).padStart(2, "0")}`;
    if (secondsLeft <= 0) {
      clearInterval(stretchInterval);
      stretchInterval = null;
      stretchCountdown.textContent = "Done! ✨";
      startStretchBtn.textContent = "▶ Start 30s Stretch";
      playChime("happy");
    }
  }, 1000);
});

// --- DESKTOP NOTIFICATIONS (WHILE CODING IN VS CODE) ---
notifBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
  }
  notifEnabled = !notifEnabled;
  notifBtn.textContent = `🔔 Alerts: ${notifEnabled ? "ON" : "OFF"}`;
});

function sendDesktopNotification(title, body) {
  if (notifEnabled && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

// --- CRISP WEB AUDIO CHIMES ---
function playChime(type = "alert") {
  if (!audioEnabled) return;
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (type === "happy") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(660, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(990, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.28);
    return;
  }

  [987.77, 739.99, 987.77].forEach((freq, idx) => {
    const t = audioCtx.currentTime + idx * 0.13;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  });
}

let currentMood = "happy";
function setMascotMood(mood, quote) {
  if (currentMood !== mood || mood === "happy") {
    currentMood = mood;
    mascotCard.className = `mascot-card mood-${mood}`;
    speechBubble.textContent = quote;
  }
}

// --- INITIALIZE MEDIAPIPE 3D POSE + FACE LANDMARKER ---
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });

  toggleBtn.disabled = false;
  toggleBtn.textContent = "📷 Start Camera";
  statusBadge.textContent = "✨ 3D AI Ready";
}

// --- GUIDED 2-POINT CALIBRATION ---
function beginTwoPointCalibration() {
  calibStage = "UPRIGHT";
  calibSamples = [];
  calibOverlay.classList.remove("hidden");
  calibStepBadge.textContent = "Step 1 of 2";
  calibTitle.textContent = "Sit Comfortably Upright ✨";
  calibDesc.textContent = "Hold your healthy posture for 2 seconds...";
  calibProgressBar.style.width = "0%";
}

recalibrateBtn.addEventListener("click", beginTwoPointCalibration);

// --- EXTRACT 3D BIOMETRIC POSTURE VECTOR ---
function extract3DFeatures(poseRes, faceRes) {
  if (!poseRes.landmarks?.length || !poseRes.worldLandmarks?.length) return null;

  const lm = poseRes.landmarks[0];
  const wlm = poseRes.worldLandmarks[0];

  const lEar = lm[7], rEar = lm[8], lSh = lm[11], rSh = lm[12];
  const wLEar = wlm[7], wREar = wlm[8], wLSh = wlm[11], wRSh = wlm[12];

  const shoulderWidth = Math.hypot(lSh.x - rSh.x, lSh.y - rSh.y);
  if (shoulderWidth < 0.08) return null;

  // 1. 3D Forward Head Z-Protrusion
  const midShoulderZ = (wLSh.z + wRSh.z) / 2;
  const midEarZ = (wLEar.z + wREar.z) / 2;
  const forwardZ = midShoulderZ - midEarZ;

  // 2. Normalized vertical neck height
  const midShoulderY = (lSh.y + rSh.y) / 2;
  const midEarY = (lEar.y + rEar.y) / 2;
  const neckLift = (midShoulderY - midEarY) / shoulderWidth;

  // 3. 3D Face Pitch
  let facePitch = 0;
  if (faceRes.faceLandmarks?.length) {
    const flm = faceRes.faceLandmarks[0];
    const forehead = flm[10];
    const chin = flm[152];
    const noseTip = flm[1];
    const faceMidY = (forehead.y + chin.y) / 2;
    const faceHeight = Math.max(0.02, Math.abs(chin.y - forehead.y));
    facePitch = (noseTip.y - faceMidY) / faceHeight;
  }

  const compositeIndex = neckLift * 1.4 - forwardZ * 2.2 - facePitch * 0.9;

  return {
    compositeIndex,
    drawPts: {
      ear: { x: ((lEar.x + rEar.x) / 2) * canvas.width, y: midEarY * canvas.height },
      lSh: { x: lSh.x * canvas.width, y: lSh.y * canvas.height },
      rSh: { x: rSh.x * canvas.width, y: rSh.y * canvas.height },
      midSh: { x: ((lSh.x + rSh.x) / 2) * canvas.width, y: midShoulderY * canvas.height },
    },
  };
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => (video.onloadedmetadata = resolve));
  video.play();

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  screenPlaceholder.style.display = "none";

  isRunning = true;
  sessionStartTime = performance.now();
  goodFrames = 0;
  totalTrackedFrames = 0;
  timelineHistory = [];
  smoothedScore = 100;
  isCurrentlySlouching = false;

  recalibrateBtn.disabled = false;
  toggleBtn.textContent = "⏹ Stop & Report";
  beginTwoPointCalibration();
  detectLoop();
}

function stopCameraAndShowReport() {
  isRunning = false;
  calibStage = "IDLE";
  calibOverlay.classList.add("hidden");
  recalibrateBtn.disabled = true;

  if (animationId) cancelAnimationFrame(animationId);
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  screenPlaceholder.style.display = "flex";
  toggleBtn.textContent = "📷 Start Camera";
  fpsChip.textContent = "-- FPS";
  statusBadge.className = "status-pill neutral";
  statusBadge.textContent = "💤 Session Ended";

  showSessionReportModal();
}

function drawSkeleton(pts, lineColor, jointColor) {
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(pts.lSh.x, pts.lSh.y);
  ctx.lineTo(pts.rSh.x, pts.rSh.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pts.midSh.x, pts.midSh.y);
  ctx.lineTo(pts.ear.x, pts.ear.y);
  ctx.stroke();

  [pts.ear, pts.lSh, pts.rSh, pts.midSh].forEach((p) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = jointColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function detectLoop() {
  if (!isRunning) return;

  const now = performance.now();
  if (video.currentTime !== lastVideoTime) {
    const fps = Math.round(1000 / Math.max(1, now - lastFrameTime));
    lastFrameTime = now;
    fpsChip.textContent = `${fps} FPS`;
    lastVideoTime = video.currentTime;

    const poseRes = poseLandmarker.detectForVideo(video, now);
    const faceRes = faceLandmarker.detectForVideo(video, now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const feat = extract3DFeatures(poseRes, faceRes);

    if (feat) {
      if (calibStage === "UPRIGHT" || calibStage === "SLOUCH") {
        calibSamples.push(feat.compositeIndex);
        drawSkeleton(feat.drawPts, "#a78bfa", "#7c3aed");
        const pct = Math.min(100, Math.round((calibSamples.length / 30) * 100));
        calibProgressBar.style.width = `${pct}%`;

        if (calibSamples.length >= 30) {
          const avg = calibSamples.reduce((a, b) => a + b, 0) / calibSamples.length;
          if (calibStage === "UPRIGHT") {
            uprightRef = avg;
            calibStage = "SLOUCH";
            calibSamples = [];
            calibStepBadge.textContent = "Step 2 of 2";
            calibTitle.textContent = "Now Slouch Forward Once 🐢";
            calibDesc.textContent = "Hunch like you're tired for 2 seconds so Mochi learns your slouch...";
            calibProgressBar.style.width = "0%";
            playChime("happy");
          } else {
            slouchRef = Math.min(avg, uprightRef - 0.18);
            calibStage = "IDLE";
            calibOverlay.classList.add("hidden");
            smoothedScore = 100;
            slouchStart = null;
            playChime("happy");
            setMascotMood("happy", "2-Point 3D Calibration complete! Mochi is locked in! ✨");
          }
        }
        animationId = requestAnimationFrame(detectLoop);
        return;
      }

      if (uprightRef !== null && slouchRef !== null) {
        const rawPct = ((feat.compositeIndex - slouchRef) / (uprightRef - slouchRef)) * 100;
        const clampedPct = Math.max(0, Math.min(100, rawPct));
        smoothedScore = smoothedScore * 0.75 + clampedPct * 0.25;

        const triggerThreshold = leniencyLevel === 1 ? 65 : leniencyLevel === 2 ? 74 : 82;
        const recoverThreshold = triggerThreshold + 6;

        if (!isCurrentlySlouching && smoothedScore < triggerThreshold) {
          isCurrentlySlouching = true;
        } else if (isCurrentlySlouching && smoothedScore >= recoverThreshold) {
          isCurrentlySlouching = false;
        }

        totalTrackedFrames++;
        if (!isCurrentlySlouching) goodFrames++;
        const avgSessionPct = Math.round((goodFrames / totalTrackedFrames) * 100);
        scoreValue.textContent = `${avgSessionPct}%`;

        if (now - lastHistorySample >= 5000) {
          const elapsedSec = Math.round((now - sessionStartTime) / 1000);
          timelineHistory.push({
            timeLabel: `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`,
            score: Math.round(smoothedScore),
          });
          lastHistorySample = now;
        }

        if (isCurrentlySlouching) {
          if (!slouchStart) slouchStart = now;
          goodStreakStart = null;
        } else {
          slouchStart = null;
          if (!goodStreakStart) goodStreakStart = now;
          if (now - goodStreakStart >= 15000) {
            starsEarned++;
            syncShopUI();
            goodStreakStart = now;
            playChime("happy");
          }
        }

        const slouchSec = slouchStart ? (now - slouchStart) / 1000 : 0;
        const isAlert = slouchSec >= alertDelay;

        angleValue.textContent = `${Math.round(smoothedScore)}%`;
        angleHint.textContent = `Goal ≥ ${triggerThreshold}%`;
        slouchTimerEl.textContent = `${slouchSec.toFixed(1)}s`;

        if (isAlert) {
          statusBadge.className = "status-pill bad";
          statusBadge.textContent = "💢 3D Slouch Alert — Sit Tall!";
          setMascotMood("angry", ANGRY_QUOTES[starsEarned % ANGRY_QUOTES.length]);
          drawSkeleton(feat.drawPts, "#ff758f", "#d90429");

          if (now - lastBeepTime > 2400) {
            playChime("alert");
            lastBeepTime = now;
          }
          if (now - lastNotifTime > 12000) {
            sendDesktopNotification("💢 Mochi Posture Alert!", "You've been slouching—sit up tall!");
            lastNotifTime = now;
          }
        } else if (isCurrentlySlouching) {
          statusBadge.className = "status-pill warn";
          statusBadge.textContent = "⚠️ Posture Dipping...";
          setMascotMood("warn", "Careful! Mochi detects forward head lean... 👀");
          drawSkeleton(feat.drawPts, "#fbbf24", "#d97706");
        } else {
          statusBadge.className = "status-pill good";
          statusBadge.textContent = "🌸 Purr-fect 3D Posture!";
          setMascotMood("happy", HAPPY_QUOTES[starsEarned % HAPPY_QUOTES.length]);
          drawSkeleton(feat.drawPts, "#34d399", "#059669");
        }
      }
    } else {
      statusBadge.className = "status-pill neutral";
      statusBadge.textContent = "🌷 Keep your face & shoulders visible";
    }
  }

  animationId = requestAnimationFrame(detectLoop);
}

// --- END-OF-SESSION REPORT MODAL & CHART.JS ---
const reportModal = document.getElementById("reportModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const downloadReportBtn = document.getElementById("downloadReportBtn");

function showSessionReportModal() {
  const elapsedSec = Math.max(1, Math.round((performance.now() - sessionStartTime) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const avgPct = totalTrackedFrames ? Math.round((goodFrames / totalTrackedFrames) * 100) : 100;

  document.getElementById("repDuration").textContent = `${mins}m ${secs}s`;
  document.getElementById("repAvgScore").textContent = `${avgPct}%`;
  document.getElementById("repStars").textContent = `${starsEarned} 🌸`;
  reportModal.classList.remove("hidden");

  const labels = timelineHistory.length ? timelineHistory.map((d) => d.timeLabel) : ["Start", "End"];
  const data = timelineHistory.length ? timelineHistory.map((d) => d.score) : [avgPct, avgPct];

  if (chartInstance) chartInstance.destroy();
  const chartCtx = document.getElementById("sessionChart").getContext("2d");
  chartInstance = new Chart(chartCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "3D Posture Alignment (%)",
          data,
          borderColor: "#ff758f",
          backgroundColor: "rgba(255, 117, 143, 0.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100 } },
    },
  });
}

closeModalBtn.addEventListener("click", () => reportModal.classList.add("hidden"));

downloadReportBtn.addEventListener("click", () => {
  const payload = {
    date: new Date().toISOString(),
    averagePosturePercent: totalTrackedFrames ? Math.round((goodFrames / totalTrackedFrames) * 100) : 100,
    totalStars: starsEarned,
    timeline: timelineHistory,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mochi-posture-report.json";
  a.click();
});

// --- CONTROLS ---
toggleBtn.addEventListener("click", () => {
  if (isRunning) stopCameraAndShowReport();
  else startCamera();
});

audioBtn.addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  audioBtn.textContent = `🔊 Chime: ${audioEnabled ? "ON" : "OFF"}`;
});

leniencySlider.addEventListener("input", (e) => {
  leniencyLevel = Number(e.target.value);
  leniencyLabel.textContent = { 1: "Relaxed", 2: "Balanced", 3: "Strict" }[leniencyLevel];
});

delaySlider.addEventListener("input", (e) => {
  alertDelay = Number(e.target.value);
  delayThreshLabel.textContent = `${alertDelay}s`;
  delayDisplay.textContent = alertDelay;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

initModels();

// --- FLOATING MINI MOCHI POP-OUT (DOCUMENT PICTURE-IN-PICTURE) ---
const pipBtn = document.getElementById("pipBtn");
if (pipBtn) {
  pipBtn.addEventListener("click", async () => {
    if (!("documentPictureInPicture" in window)) {
      alert("Tip: Use Chrome or Edge desktop to pop Mochi out into a floating mini-window!");
      return;
    }
    const pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 260,
      height: 290,
    });
    // Copy stylesheets into mini window
    [...document.styleSheets].forEach((sheet) => {
      if (sheet.href) {
        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        pipWindow.document.head.appendChild(link);
      }
    });
    const originalParent = mascotCard.parentElement;
    pipWindow.document.body.style.padding = "0.65rem";
    pipWindow.document.body.appendChild(mascotCard);

    pipWindow.addEventListener("pagehide", () => {
      originalParent.prepend(mascotCard);
    });
  });
}