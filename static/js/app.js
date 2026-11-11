/**
 * PHOTOBOX STUDIO - CLIENT SCRIPT
 * Mendukung HDMI Capture Card 60FPS (Webcam mode) + USB Trigger digiCamControl
 * Disertai Flash, Chime, dan Instant Photo Preview per Pose.
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
    osc.frequency.setValueAtTime(523.25, now);       // C5
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
  preferredVideoId: null,
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

const hdmiVideo = document.getElementById("hdmi-video");
const liveviewImg = document.getElementById("liveview-img");
const shotPreviewOverlay = document.getElementById("shot-preview-overlay");
const shotPreviewImg = document.getElementById("shot-preview-img");
const shotPreviewNum = document.getElementById("shot-preview-num");
const videoSourceSelect = document.getElementById("video-source-select");

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
    stopCameraPreview();
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

    // Minta izin kamera agar label nama device (ezcap, dll) bisa dibaca browser
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      console.warn("Izin kamera belum diberikan oleh user:", e);
    }

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

    // Pertahankan pilihan user jika sebelumnya sudah memilih
    if (previousVal && [...videoSourceSelect.options].some((o) => o.value === previousVal)) {
      videoSourceSelect.value = previousVal;
    } else if (foundCaptureCardId) {
      // Otomatis pilih ezcap HDMI Capture Card langsung di dropdown!
      videoSourceSelect.value = foundCaptureCardId;
    }
  } catch (err) {
    console.warn("Gagal membaca daftar kamera:", err);
  }
}

async function startCameraPreview() {
  const chosen = videoSourceSelect.value;
  console.log("[Photobox] Memulai preview kamera. Pilihan:", chosen);

  if (chosen === "dcc_usb") {
    // Mode USB murni
    stopWebcamStream();
    hdmiVideo.style.display = "none";
    liveviewImg.style.display = "block";
    startUsbPolling();
    return;
  }

  // Mode HDMI (Webcam) 60 FPS
  stopUsbPolling();
  liveviewImg.style.display = "none";
  hdmiVideo.style.display = "block";

  let targetDeviceId = chosen === "auto" ? state.preferredVideoId : chosen;
  console.log("[Photobox] Target deviceId:", targetDeviceId);

  // Jangan pasang batasan 'min' agar ezcap tidak throw OverconstrainedError
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
    console.log("[Photobox] HDMI Webcam berhasil aktif pada video element!");
  } catch (err) {
    console.error("[Photobox] Gagal membuka HDMI Video:", err);
    alert("Perhatian: Browser tidak dapat membuka video dari HDMI Capture Card (" + (err.name || err.message) + "). Pastikan izin kamera di browser diizinkan.");
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

// Fallback USB Image Polling
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

// ================= ALUR SHOOTING / COUNTDOWN =================
async function startPhotoSession() {
  showScreen("shoot");
  await startCameraPreview();
  thumbsRibbon.innerHTML = "";
  shotPreviewOverlay.style.display = "none";
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

    // Jeda 1.5 detik agar pelanggan bersiap
    setTimeout(runCountdownStep, 1500);
  } catch (e) {
    alert("Gagal memulai sesi: " + e.message);
    showScreen("welcome");
  }
}

function runCountdownStep() {
  poseIndicator.textContent = `Pose ${state.currentPose} dari ${state.totalPoses}`;
  intermissionOverlay.style.display = "none";
  shotPreviewOverlay.style.display = "none";
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
      // 1. Tambah thumbnail ke ribbon bawah
      const thumb = document.createElement("div");
      thumb.className = "thumb-item";
      thumb.innerHTML = `<img src="${data.photo_url}" alt="Pose ${state.currentPose}">`;
      thumbsRibbon.appendChild(thumb);

      // 2. POPUP INSTAN PREVIEW HASIL FOTO BARUSAN! ("Oh gini oke!")
      shotPreviewImg.src = `${data.photo_url}?t=${Date.now()}`;
      shotPreviewNum.textContent = state.currentPose;
      shotPreviewOverlay.style.display = "flex";
      playSuccessChime();

      // Tampilkan hasil foto selama 1.8 detik
      await new Promise((resolve) => setTimeout(resolve, 1800));
      shotPreviewOverlay.style.display = "none";

      if (state.currentPose < state.totalPoses) {
        // Tampilkan istirahat antar pose (2.5 detik)
        state.currentPose++;
        intermissionOverlay.style.display = "flex";
        setTimeout(runCountdownStep, 2500);
      } else {
        // Selesai semua pose -> Susun Photo Strip
        setTimeout(finishAndGenerateStrip, 500);
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
  // Inisialisasi daftar kamera (deteksi HDMI Capture Card)
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

  // Foto Ulang (Retake)
  document.getElementById("btn-retake").addEventListener("click", () => {
    if (confirm("Ingin foto ulang dari awal? Foto sebelumnya akan diganti.")) {
      showScreen("setup");
    }
  });
});
