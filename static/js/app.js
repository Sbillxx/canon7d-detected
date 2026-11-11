/**
 * PHOTOBOX STUDIO - CLIENT SCRIPT
 * Workflow Sesi 3 Menit Global + Manual Shutter Trigger (Bebas Ngaca)
 * + Selective Retake per Kotak Grid + Time's Up Auto-Lock.
 */

// ================= AUDIO SYNTHESIZER =================
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
  } catch (e) {}
}

function playShutterSound() {
  try {
    initAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);

    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch (e) {}
}

function playSuccessChime() {
  try {
    initAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now);        // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (e) {}
}

function playBuzzerSound() {
  try {
    initAudio();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.setValueAtTime(160, now + 0.2);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) {}
}

// ================= STATE SISTEM =================
const state = {
  layout: "strip_3",
  frameColor: "white",
  filter: "original",
  totalSlots: 3,
  slots: [null, null, null], // URL foto per slot
  activeSlotIndex: 0,
  isRetakeMode: false,
  isCapturing: false,
  
  // Timer Sesi 3 Menit (180 detik)
  sessionSecondsLeft: 180,
  sessionTimerInterval: null,
  isSessionExpired: false,

  sessionId: null,
  stripUrl: null,
  qrUrl: null,
  preferredVideoId: null,
  resetTimer: null,
};

// ================= DOM ELEMENTS =================
const screens = {
  welcome: document.getElementById("screen-welcome"),
  setup: document.getElementById("screen-setup"),
  shoot: document.getElementById("screen-shoot"),
  review: document.getElementById("screen-review"),
  processing: document.getElementById("screen-processing"),
  preview: document.getElementById("screen-preview"),
};

// Global Timer
const sessionTimerPill = document.getElementById("session-timer-pill");
const sessionTimerText = document.getElementById("session-timer-text");
const reviewTimerText = document.getElementById("review-timer-text");

// Shoot Screen
const hdmiVideo = document.getElementById("hdmi-video");
const liveviewImg = document.getElementById("liveview-img");
const shotPreviewOverlay = document.getElementById("shot-preview-overlay");
const shotPreviewImg = document.getElementById("shot-preview-img");
const shotPreviewNum = document.getElementById("shot-preview-num");
const poseIndicator = document.getElementById("pose-indicator");
const retakeBanner = document.getElementById("retake-banner");
const retakeTargetNum = document.getElementById("retake-target-num");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNum = document.getElementById("countdown-num");
const intermissionOverlay = document.getElementById("intermission-overlay");
const flashOverlay = document.getElementById("flash-overlay");
const btnTriggerCapture = document.getElementById("btn-trigger-capture");
const btnCaptureText = document.getElementById("btn-capture-text");
const slotsTray = document.getElementById("slots-tray");
const videoSourceSelect = document.getElementById("video-source-select");

// Review Hub
const reviewCardsGrid = document.getElementById("review-cards-grid");
const btnProceedPrint = document.getElementById("btn-proceed-print");

// Preview & Finish
const previewStripImg = document.getElementById("preview-strip-img");
const modalQr = document.getElementById("modal-qr");
const qrCodeImg = document.getElementById("qr-code-img");
const resetSecondsSpan = document.getElementById("reset-seconds");
const modalTimesUp = document.getElementById("modal-times-up");
const btnTimesUpOk = document.getElementById("btn-times-up-ok");

// Status
const camIndicator = document.getElementById("cam-indicator");
const camText = document.getElementById("cam-text");

// ================= NAVIGASI SCREEN =================
function showScreen(name) {
  Object.keys(screens).forEach((key) => {
    if (screens[key]) {
      screens[key].classList.toggle("active", key === name);
    }
  });
  if (name !== "shoot") {
    stopCameraPreview();
  }
}

// ================= GLOBAL TIMER (3 MENIT) =================
function startGlobalTimer(durationSeconds = 180) {
  stopGlobalTimer();
  state.sessionSecondsLeft = durationSeconds;
  state.isSessionExpired = false;
  const pill = document.getElementById("session-timer-pill") || sessionTimerPill;
  if (pill) {
    pill.style.display = "flex";
    pill.className = "session-timer-pill";
  }
  updateTimerDisplay();

  state.sessionTimerInterval = setInterval(() => {
    state.sessionSecondsLeft--;
    updateTimerDisplay();

    const p = document.getElementById("session-timer-pill") || sessionTimerPill;
    if (p) {
      if (state.sessionSecondsLeft <= 60 && state.sessionSecondsLeft > 30) {
        p.classList.add("warning");
      } else if (state.sessionSecondsLeft <= 30 && state.sessionSecondsLeft > 0) {
        p.classList.remove("warning");
        p.classList.add("danger");
      }
    }
    if (state.sessionSecondsLeft <= 0) {
      handleTimesUp();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(Math.max(0, state.sessionSecondsLeft) / 60);
  const s = Math.max(0, state.sessionSecondsLeft) % 60;
  const formatted = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const timerText = document.getElementById("session-timer-text") || sessionTimerText;
  if (timerText) {
    timerText.textContent = formatted;
  }
  const revText = document.getElementById("review-timer-text") || reviewTimerText;
  if (revText) {
    revText.textContent = formatted;
  }
}

function stopGlobalTimer() {
  if (state.sessionTimerInterval) {
    clearInterval(state.sessionTimerInterval);
    state.sessionTimerInterval = null;
  }
  const pill = document.getElementById("session-timer-pill") || sessionTimerPill;
  if (pill) {
    pill.style.display = "none";
  }
}

function handleTimesUp() {
  stopGlobalTimer();
  state.isSessionExpired = true;
  playBuzzerSound();

  // Kunci semua tombol ganti foto
  document.querySelectorAll(".btn-retake-slot").forEach((btn) => {
    btn.disabled = true;
    btn.textContent = "🔒 Waktu Habis";
  });

  // Tampilkan popup Waktu Habis
  const modal = document.getElementById("modal-times-up") || modalTimesUp;
  if (modal) {
    modal.classList.add("active");
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

// ================= WEBCAM / HDMI STREAM & FALLBACK =================
let activeWebcamStream = null;
let isUsbPollingActive = false;
let isUsbFrameInFlight = false;

async function populateCameraDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const previousVal = videoSourceSelect.value;

    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch (e) {}

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");

    videoSourceSelect.innerHTML = "";

    const optAuto = document.createElement("option");
    optAuto.value = "auto";
    optAuto.textContent = "✨ Otomatis (HDMI Capture Card 60 FPS)";
    videoSourceSelect.appendChild(optAuto);

    let foundCaptureCardId = null;

    videoDevices.forEach((dev, idx) => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      const label = dev.label || `Kamera ${idx + 1}`;
      opt.textContent = `📹 ${label}`;
      videoSourceSelect.appendChild(opt);

      const lower = label.toLowerCase();
      if (
        lower.includes("game link") ||
        lower.includes("ezcap") ||
        lower.includes("capture") ||
        lower.includes("cam link") ||
        lower.includes("hdmi") ||
        lower.includes("usb video")
      ) {
        foundCaptureCardId = dev.deviceId;
      }
    });

    const optUsb = document.createElement("option");
    optUsb.value = "dcc_usb";
    optUsb.textContent = "🔌 USB digiCamControl (Standard)";
    videoSourceSelect.appendChild(optUsb);

    if (foundCaptureCardId) {
      state.preferredVideoId = foundCaptureCardId;
    }

    if (previousVal && [...videoSourceSelect.options].some((o) => o.value === previousVal)) {
      videoSourceSelect.value = previousVal;
    } else if (foundCaptureCardId) {
      videoSourceSelect.value = foundCaptureCardId;
    }
  } catch (err) {
    console.warn("Gagal membaca daftar kamera:", err);
  }
}

async function startCameraPreview() {
  const chosen = videoSourceSelect.value;

  if (chosen === "dcc_usb") {
    stopWebcamStream();
    hdmiVideo.style.display = "none";
    liveviewImg.style.display = "block";
    startUsbPolling();
    return;
  }

  stopUsbPolling();
  liveviewImg.style.display = "none";
  hdmiVideo.style.display = "block";

  let targetDeviceId = chosen === "auto" ? state.preferredVideoId : chosen;

  const constraints = {
    video: targetDeviceId
      ? { deviceId: { exact: targetDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  };

  try {
    activeWebcamStream = await navigator.mediaDevices.getUserMedia(constraints);
    hdmiVideo.srcObject = activeWebcamStream;
    await hdmiVideo.play();
  } catch (err) {
    console.error("Gagal membuka HDMI Video:", err);
    hdmiVideo.style.display = "none";
    liveviewImg.style.display = "block";
    startUsbPolling();
  }
}

function stopCameraPreview() {
  stopWebcamStream();
  stopUsbPolling();
}

function stopWebcamStream() {
  if (activeWebcamStream) {
    activeWebcamStream.getTracks().forEach((track) => track.stop());
    activeWebcamStream = null;
  }
  if (hdmiVideo) {
    hdmiVideo.srcObject = null;
  }
}

function startUsbPolling() {
  stopUsbPolling();
  isUsbPollingActive = true;
  isUsbFrameInFlight = false;
  fetchNextUsbFrame();
}

function stopUsbPolling() {
  isUsbPollingActive = false;
  isUsbFrameInFlight = false;
}

function fetchNextUsbFrame() {
  if (!isUsbPollingActive || isUsbFrameInFlight) return;
  isUsbFrameInFlight = true;
  const t0 = performance.now();
  const nextFrame = new Image();

  nextFrame.onload = () => {
    if (!isUsbPollingActive) return;
    liveviewImg.src = nextFrame.src;
    isUsbFrameInFlight = false;
    const elapsed = performance.now() - t0;
    setTimeout(fetchNextUsbFrame, Math.max(15, 45 - elapsed));
  };

  nextFrame.onerror = () => {
    isUsbFrameInFlight = false;
    if (isUsbPollingActive) {
      setTimeout(fetchNextUsbFrame, 200);
    }
  };

  nextFrame.src = `http://127.0.0.1:5513/liveview.jpg?rand=${Math.random()}`;
}

// ================= EFEK FLASH =================
function triggerFlash() {
  flashOverlay.classList.remove("active");
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add("active");
  playShutterSound();
}

// ================= INISIALISASI SESI BARU =================
async function startPhotoSession() {
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
    state.totalSlots = data.target_photos || (state.layout.includes("4") ? 4 : 3);
    state.slots = new Array(state.totalSlots).fill(null);
    state.activeSlotIndex = 0;
    state.isRetakeMode = false;
    state.isCapturing = false;

    // Mulai Timer Global 3 Menit
    startGlobalTimer(180);

    // Masuk ke Studio Kamera
    goToCameraShoot();
  } catch (e) {
    alert("Gagal memulai sesi: " + e.message);
    showScreen("welcome");
  }
}

function goToCameraShoot() {
  showScreen("shoot");
  startCameraPreview();
  const shotOverlay = document.getElementById("shot-preview-overlay") || shotPreviewOverlay;
  if (shotOverlay) shotOverlay.style.display = "none";
  const cdOverlay = document.getElementById("countdown-overlay") || countdownOverlay;
  if (cdOverlay) cdOverlay.style.display = "none";
  const imOverlay = document.getElementById("intermission-overlay") || intermissionOverlay;
  if (imOverlay) imOverlay.style.display = "none";
  state.isCapturing = false;

  updateShootUI();
}

function updateShootUI() {
  const currentNum = state.activeSlotIndex + 1;
  const banner = document.getElementById("retake-banner") || retakeBanner;
  const targetNum = document.getElementById("retake-target-num") || retakeTargetNum;
  const poseInd = document.getElementById("pose-indicator") || poseIndicator;
  const capText = document.getElementById("btn-capture-text") || btnCaptureText;
  const trigBtn = document.getElementById("btn-trigger-capture") || btnTriggerCapture;

  if (state.isRetakeMode) {
    if (banner) banner.style.display = "block";
    if (targetNum) targetNum.textContent = currentNum;
    if (poseInd) poseInd.textContent = `Foto Ulang: Kotak ${currentNum}`;
    if (capText) capText.textContent = `JEPRET ULANG KOTAK ${currentNum} (3s)`;
  } else {
    if (banner) banner.style.display = "none";
    if (poseInd) poseInd.textContent = `Pose ${currentNum} dari ${state.totalSlots}: Pasang Gayanya!`;
    if (capText) capText.textContent = `AMBIL FOTO (3s)`;
  }

  if (trigBtn) trigBtn.disabled = false;
  renderSlotsTray();
}

function renderSlotsTray() {
  const tray = document.getElementById("slots-tray") || slotsTray;
  if (!tray) return;
  tray.innerHTML = "";
  for (let i = 0; i < state.totalSlots; i++) {
    const thumb = document.createElement("div");
    thumb.className = "slot-thumb";
    
    if (i === state.activeSlotIndex) {
      thumb.classList.add("active");
    }

    if (state.slots[i]) {
      thumb.classList.add("filled");
      thumb.innerHTML = `
        <img src="${state.slots[i]}" alt="Slot ${i + 1}">
        <span class="slot-check">✓</span>
      `;
    } else {
      thumb.textContent = `#${i + 1}`;
    }

    tray.appendChild(thumb);
  }
}

// ================= MANUAL SHUTTER TRIGGER & COUNTDOWN =================
function triggerManualCapture() {
  if (state.isCapturing || countdownOverlay.style.display === "flex") return;
  if (screens.shoot.classList.contains("active") === false) return;

  state.isCapturing = true;
  btnTriggerCapture.disabled = true;

  // Mulai Countdown 3.. 2.. 1..
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

      // Kilat Flash & Jepret Kamera!
      triggerFlash();
      await executeSlotCapture();
    }
  }, 1000);
}

async function executeSlotCapture() {
  try {
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_index: state.activeSlotIndex }),
    });
    const data = await res.json();

    if (data.success && data.photo_url) {
      // Perbarui data slots
      state.slots = data.slots;
      renderSlotsTray();

      // Tampilkan Instant Preview Popup selama 1.8 detik
      shotPreviewImg.src = `${data.photo_url}?t=${Date.now()}`;
      shotPreviewNum.textContent = state.activeSlotIndex + 1;
      shotPreviewOverlay.style.display = "flex";
      playSuccessChime();

      await new Promise((resolve) => setTimeout(resolve, 1800));
      shotPreviewOverlay.style.display = "none";

      state.isCapturing = false;

      if (state.isRetakeMode) {
        // Mode retake selesai -> kembali ke Review Hub
        state.isRetakeMode = false;
        showReviewHub();
      } else if (data.all_slots_filled) {
        // Semua kotak awal sudah terisi -> masuk ke Review Hub!
        showReviewHub();
      } else {
        // Lanjut isi kotak kosong berikutnya
        const nextEmpty = state.slots.findIndex((s) => s === null);
        state.activeSlotIndex = nextEmpty !== -1 ? nextEmpty : state.activeSlotIndex + 1;
        updateShootUI();
      }
    } else {
      alert("Gagal mengambil foto: " + (data.error || "Timeout"));
      state.isCapturing = false;
      btnTriggerCapture.disabled = false;
    }
  } catch (e) {
    alert("Error capture: " + e.message);
    state.isCapturing = false;
    btnTriggerCapture.disabled = false;
  }
}

// ================= REVIEW & SELECTIVE RETAKE HUB =================
function showReviewHub() {
  showScreen("review");

  reviewCardsGrid.innerHTML = "";

  state.slots.forEach((photoUrl, idx) => {
    const card = document.createElement("div");
    card.className = "slot-card";
    card.innerHTML = `
      <div class="slot-card-preview">
        <img src="${photoUrl ? photoUrl + '?t=' + Date.now() : '/static/img/placeholder.jpg'}" alt="Pose ${idx + 1}">
      </div>
      <div class="slot-card-info">
        <span class="slot-card-title">Kotak Foto #${idx + 1}</span>
      </div>
      <button class="btn-retake-slot" data-slot="${idx}" type="button" ${state.isSessionExpired ? "disabled" : ""}>
        <span>🔄 Ganti Foto Ini</span>
      </button>
    `;

    const retakeBtn = card.querySelector(".btn-retake-slot");
    retakeBtn.addEventListener("click", () => {
      if (state.isSessionExpired) {
        alert("Waktu berpose sudah habis. Silakan langsung lanjut ke pencetakan.");
        return;
      }
      // Masuk ke mode foto ulang slot ini
      state.isRetakeMode = true;
      state.activeSlotIndex = idx;
      goToCameraShoot();
    });

    reviewCardsGrid.appendChild(card);
  });
}

// ================= GENERATE STRIP & SELESAI =================
async function finishAndGenerateStrip() {
  stopGlobalTimer();
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
  populateCameraDevices();

  // Screen 1: Welcome
  document.getElementById("btn-start").addEventListener("click", () => {
    initAudio();
    populateCameraDevices();
    showScreen("setup");
  });

  // Screen 2: Setup Back / Ready
  document.getElementById("btn-back-welcome").addEventListener("click", () => {
    showScreen("welcome");
  });

  document.getElementById("btn-ready-shoot").addEventListener("click", () => {
    startPhotoSession();
  });

  // Tombol Manual Shutter Capture
  btnTriggerCapture.addEventListener("click", () => {
    triggerManualCapture();
  });

  // Shortcut Keyboard Spasi untuk Shutter / Wireless Remote
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && screens.shoot.classList.contains("active")) {
      e.preventDefault();
      triggerManualCapture();
    }
  });

  // Tombol Lanjut ke Cetak dari Review Hub
  btnProceedPrint.addEventListener("click", () => {
    finishAndGenerateStrip();
  });

  // Tombol OK pada Popup Waktu Habis
  btnTimesUpOk.addEventListener("click", () => {
    modalTimesUp.classList.remove("active");
    finishAndGenerateStrip();
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

  // Tombol Flip / Mirror View
  const btnToggleMirror = document.getElementById("btn-toggle-mirror");
  if (btnToggleMirror) {
    btnToggleMirror.addEventListener("click", () => {
      const wrapper = document.querySelector(".liveview-wrapper");
      if (wrapper) {
        wrapper.classList.toggle("mirrored");
        const isNowMirrored = wrapper.classList.contains("mirrored");
        const btnText = document.getElementById("mirror-btn-text");
        if (btnText) {
          btnText.textContent = isNowMirrored ? "Mode Cermin" : "Flip Normal";
        }
      }
    });
  }

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

  // Foto Ulang (Retake Total dari Awal)
  document.getElementById("btn-retake").addEventListener("click", () => {
    if (confirm("Ingin foto ulang dari awal? Sesi baru akan dimulai.")) {
      showScreen("setup");
    }
  });
});
