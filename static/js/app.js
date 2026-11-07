/**
 * PHOTOBOX STUDIO - CLIENT SCRIPT
 * Mengatur alur pemotretan, audio synthesizer Web Audio API,
 * countdown animasi, dan preview foto.
 */

// ================= AUDIO SYNTHESIZER (Tanpa file eksternal) =================
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeep(freq = 800, duration = 0.1) {
  try {
    initAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Abaikan jika audio diblokir browser
  }
}

function playShutterSound() {
  try {
    initAudio();
    // Suara simulasi klik mekanik kamera
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch (e) {}
}

// ================= STATE SISTEM =================
const state = {
  layout: "strip_3",
  frameColor: "white",
  filter: "original",
  currentPose: 1,
  totalPoses: 3,
  sessionId: null,
  stripUrl: null,
  qrUrl: null,
  liveviewInterval: null,
  resetTimer: null,
};

// ================= DOM ELEMENTS =================
const screens = {
  welcome: document.getElementById("screen-welcome"),
  setup: document.getElementById("screen-setup"),
  shoot: document.getElementById("screen-shoot"),
  processing: document.getElementById("screen-processing"),
  preview: document.getElementById("screen-preview"),
};

const liveviewImg = document.getElementById("liveview-img");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNum = document.getElementById("countdown-num");
const intermissionOverlay = document.getElementById("intermission-overlay");
const poseIndicator = document.getElementById("pose-indicator");
const thumbsRibbon = document.getElementById("thumbs-ribbon");
const flashOverlay = document.getElementById("flash-overlay");
const previewStripImg = document.getElementById("preview-strip-img");
const modalQr = document.getElementById("modal-qr");
const qrCodeImg = document.getElementById("qr-code-img");
const resetSecondsSpan = document.getElementById("reset-seconds");
const camIndicator = document.getElementById("cam-indicator");
const camText = document.getElementById("cam-text");

// ================= NAVIGASI SCREEN =================
function showScreen(name) {
  Object.keys(screens).forEach((key) => {
    screens[key].classList.toggle("active", key === name);
  });
  if (name !== "shoot") {
    stopLiveView();
  }
}

// ================= CEK STATUS KAMERA =================
async function checkCameraStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.dcc_running && data.camera_connected) {
      camIndicator.className = "status-dot green";
      camText.textContent = "Kamera Siap (Canon 7D)";
    } else if (data.dcc_running) {
      camIndicator.className = "status-dot green";
      camText.textContent = "digiCamControl Aktif";
    } else {
      camIndicator.className = "status-dot red";
      camText.textContent = "Kamera Terputus";
    }
  } catch (e) {
    camIndicator.className = "status-dot red";
    camText.textContent = "Server Offline";
  }
}
setInterval(checkCameraStatus, 4000);
checkCameraStatus();

// ================= HIGH-PERFORMANCE LIVE VIEW STREAM =================
let isLiveViewActive = false;
let isFrameInFlight = false;
let useDirectDCC = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

function startLiveView() {
  stopLiveView();
  isLiveViewActive = true;
  isFrameInFlight = false;
  fetchNextLiveFrame();
}

function stopLiveView() {
  isLiveViewActive = false;
  isFrameInFlight = false;
}

function fetchNextLiveFrame() {
  if (!isLiveViewActive || isFrameInFlight) return;

  isFrameInFlight = true;
  const t0 = performance.now();
  const nextFrame = new Image();

  // Jika diakses lokal di PC, tembak langsung port 5513 untuk 0 latency & 25 FPS
  const frameUrl = useDirectDCC
    ? `http://127.0.0.1:5513/liveview.jpg?rand=${Math.random()}`
    : `/api/liveview.jpg?t=${Date.now()}`;

  nextFrame.onload = () => {
    if (!isLiveViewActive) return;
    liveviewImg.src = nextFrame.src;
    isFrameInFlight = false;

    // Adaptif: jeda minimal agar 20-25 FPS mulus tanpa numpuk antrean
    const elapsed = performance.now() - t0;
    const targetDelay = Math.max(15, 45 - elapsed);
    setTimeout(fetchNextLiveFrame, targetDelay);
  };

  nextFrame.onerror = () => {
    isFrameInFlight = false;
    // Jika akses langsung gagal, fallback ke proxy Flask
    if (useDirectDCC) {
      useDirectDCC = false;
    }
    if (isLiveViewActive) {
      setTimeout(fetchNextLiveFrame, 150);
    }
  };

  nextFrame.src = frameUrl;
}

// ================= EFEK FLASH =================
function triggerFlash() {
  flashOverlay.classList.remove("active");
  void flashOverlay.offsetWidth; // trigger reflow
  flashOverlay.classList.add("active");
  playShutterSound();
}

// ================= ALUR SHOOTING / COUNTDOWN =================
async function startPhotoSession() {
  showScreen("shoot");
  startLiveView();
  thumbsRibbon.innerHTML = "";
  state.currentPose = 1;
  state.totalPoses = state.layout.includes("4") ? 4 : 3;

  try {
    const res = await fetch("/api/start-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: state.layout,
        frame_color: state.frameColor,
        filter: state.filter,
      }),
    });
    const data = await res.json();
    state.sessionId = data.session_id;

    // Jeda 1.5 detik agar user bersiap
    setTimeout(runCountdownStep, 1500);
  } catch (e) {
    alert("Gagal memulai sesi: " + e.message);
    showScreen("welcome");
  }
}

function runCountdownStep() {
  poseIndicator.textContent = `Pose ${state.currentPose} dari ${state.totalPoses}`;
  intermissionOverlay.style.display = "none";
  countdownOverlay.style.display = "flex";

  let count = 3;
  countdownNum.textContent = count;
  playBeep(800, 0.12);

  const timer = setInterval(async () => {
    count--;
    if (count > 0) {
      countdownNum.textContent = count;
      playBeep(count === 1 ? 1100 : 800, 0.12);
    } else {
      clearInterval(timer);
      countdownOverlay.style.display = "none";

      // Jepret kamera!
      triggerFlash();
      await capturePhoto();
    }
  }, 1000);
}

async function capturePhoto() {
  try {
    const res = await fetch("/api/capture", { method: "POST" });
    const data = await res.json();

    if (data.success && data.photo_url) {
      // Tambah thumbnail ke ribbon
      const thumb = document.createElement("div");
      thumb.className = "thumb-item";
      thumb.innerHTML = `<img src="${data.photo_url}" alt="Pose ${state.currentPose}">`;
      thumbsRibbon.appendChild(thumb);

      if (state.currentPose < state.totalPoses) {
        // Tampilkan istirahat antar pose (3.5 detik)
        state.currentPose++;
        intermissionOverlay.style.display = "flex";
        setTimeout(runCountdownStep, 3500);
      } else {
        // Selesai semua pose -> Generate Photo Strip
        setTimeout(finishAndGenerateStrip, 1000);
      }
    } else {
      alert("Gagal mengambil foto: " + (data.error || "Timeout"));
      showScreen("welcome");
    }
  } catch (e) {
    alert("Error capture: " + e.message);
    showScreen("welcome");
  }
}

async function finishAndGenerateStrip() {
  showScreen("processing");
  try {
    const res = await fetch("/api/generate-strip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: state.layout,
        frame_color: state.frameColor,
        filter: state.filter,
      }),
    });
    const data = await res.json();

    if (data.success) {
      state.stripUrl = data.strip_url;
      state.qrUrl = data.qr_url;

      previewStripImg.src = `${data.strip_url}?t=${Date.now()}`;
      qrCodeImg.src = `${data.qr_url}?t=${Date.now()}`;
      showScreen("preview");
    } else {
      alert("Gagal membuat photo strip: " + data.error);
      showScreen("welcome");
    }
  } catch (e) {
    alert("Error generate strip: " + e.message);
    showScreen("welcome");
  }
}

// ================= FILTER UPDATE DI PREVIEW =================
async function updateFilter(newFilter) {
  state.filter = newFilter;
  document.querySelectorAll(".btn-filter").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === newFilter);
  });

  previewStripImg.style.opacity = "0.5";
  try {
    const res = await fetch("/api/generate-strip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layout: state.layout,
        frame_color: state.frameColor,
        filter: state.filter,
      }),
    });
    const data = await res.json();
    if (data.success) {
      previewStripImg.src = `${data.strip_url}?t=${Date.now()}`;
    }
  } catch (e) {
    console.error(e);
  } finally {
    previewStripImg.style.opacity = "1";
  }
}

// ================= MODAL QR CODE & AUTO RESET =================
function showQrModal() {
  modalQr.classList.add("active");
  let timeLeft = 25;
  resetSecondsSpan.textContent = timeLeft;

  if (state.resetTimer) clearInterval(state.resetTimer);
  state.resetTimer = setInterval(() => {
    timeLeft--;
    resetSecondsSpan.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(state.resetTimer);
      modalQr.classList.remove("active");
      showScreen("welcome");
    }
  }, 1000);
}

// ================= EVENT LISTENERS =================
document.addEventListener("DOMContentLoaded", () => {
  // Screen 1: Welcome
  document.getElementById("btn-start").addEventListener("click", () => {
    initAudio();
    showScreen("setup");
  });

  // Screen 2: Setup Back / Ready
  document.getElementById("btn-back-welcome").addEventListener("click", () => {
    showScreen("welcome");
  });

  document.getElementById("btn-ready-shoot").addEventListener("click", () => {
    startPhotoSession();
  });

  // Selector Layout
  document.querySelectorAll("#layout-selector .pill-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll("#layout-selector .pill-opt")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.layout = btn.dataset.val;
    });
  });

  // Selector Warna Frame
  document.querySelectorAll("#color-selector .color-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll("#color-selector .color-swatch")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.frameColor = btn.dataset.val;
    });
  });

  // Filter Buttons di Preview
  document.querySelectorAll(".btn-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateFilter(btn.dataset.filter);
    });
  });

  // Cetak Foto (Print)
  document.getElementById("btn-print").addEventListener("click", async () => {
    try {
      const res = await fetch("/api/print", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert("🖨️ Foto sedang dikirim ke printer. Silakan ambil hasil cetakmu!");
      } else {
        alert("Gagal cetak: " + data.error);
      }
    } catch (e) {
      alert("Error print: " + e.message);
    }
  });

  // Buka Modal QR
  document.getElementById("btn-show-qr").addEventListener("click", () => {
    showQrModal();
  });

  // Selesai Sesi di Modal QR
  document.getElementById("btn-finish-session").addEventListener("click", () => {
    if (state.resetTimer) clearInterval(state.resetTimer);
    modalQr.classList.remove("active");
    showScreen("welcome");
  });

  // Foto Ulang (Retake)
  document.getElementById("btn-retake").addEventListener("click", () => {
    if (confirm("Ingin foto ulang dari awal? Foto sebelumnya akan diganti.")) {
      showScreen("setup");
    }
  });
});

