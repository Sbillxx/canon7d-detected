"""
app.py
Server backend Photobox Studio menggunakan Flask.
Mengintegrasikan Canon EOS 7D via digiCamControl REST API & CLI.
"""
import glob
import json
import os
import platform
import socket
import subprocess
import time
import uuid

from flask import Flask, Response, jsonify, render_template, request, send_from_directory
import qrcode
import requests

from photostrip import create_photostrip

app = Flask(__name__)

# Direktori Proyek
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES_DIR = os.path.join(BASE_DIR, "captures")
RAW_DIR = os.path.join(CAPTURES_DIR, "raw")
STRIPS_DIR = os.path.join(CAPTURES_DIR, "strips")
QR_DIR = os.path.join(CAPTURES_DIR, "qr")

for d in [RAW_DIR, STRIPS_DIR, QR_DIR]:
    os.makedirs(d, exist_ok=True)

DCC_BASE_URL = "http://localhost:5513"
DCC_REMOTECMD = r"A:\digicam\CameraControlRemoteCmd.exe"

# HTTP Session dengan persistent connection pooling agar tidak lag
http_session = requests.Session()
adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1)
http_session.mount("http://", adapter)

# State session aktif
session_state = {
    "session_id": None,
    "session_folder": None,
    "photos": [],
    "layout": "strip_3",
    "frame_color": "white",
    "filter": "original",
    "title": "PHOTOBOX STUDIO",
    "strip_path": None,
}


def get_local_ip():
    """Mendapatkan IP address lokal untuk link download QR code."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def set_dcc_folder(folder_path):
    """Mengatur folder penyimpanan foto di digiCamControl."""
    if os.path.exists(DCC_REMOTECMD):
        try:
            cmd = f'echo "" | "{DCC_REMOTECMD}" /c "set session.folder {folder_path}"'
            subprocess.run(cmd, shell=True, capture_output=True, timeout=5)
        except Exception as e:
            print(f"[!] Error setting DCC folder: {e}")


# ===================== ROUTES =====================

@app.route("/")
def index():
    """Halaman Kiosk Photobox untuk Layar Sentuh."""
    return render_template("index.html")


def check_dcc_camera():
    """Cek apakah kamera terdeteksi oleh digiCamControl via HTTP tanpa spawn process."""
    try:
        r = http_session.get(f"{DCC_BASE_URL}/?CMD=Get_Version", timeout=1)
        if r.status_code == 200:
            return True
    except Exception:
        pass
    return False


def close_dcc_liveview():
    """Pastikan jendela Live View digiCamControl tertutup agar tidak popup dan tidak makan USB bandwidth."""
    try:
        http_session.get(f"{DCC_BASE_URL}/?CMD=LiveViewWnd_Hide", timeout=2)
    except Exception:
        pass


@app.route("/api/status")
def api_status():
    """Cek status koneksi ke digiCamControl dan kamera."""
    status = {"dcc_running": False, "camera_connected": False, "liveview_active": False}
    try:
        r = http_session.get(f"{DCC_BASE_URL}/?CMD=Get_Version", timeout=1.5)
        if r.status_code == 200:
            status["dcc_running"] = True
            status["camera_connected"] = True
    except Exception:
        pass

    return jsonify(status)


@app.route("/api/liveview.jpg")
def api_liveview_proxy():
    """Proxy satu frame live view dengan persistent connection cepat."""
    try:
        r = http_session.get(f"{DCC_BASE_URL}/liveview.jpg", timeout=1.5)
        if r.status_code == 200 and len(r.content) > 500:
            res = Response(r.content, mimetype="image/jpeg")
            res.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            res.headers["Pragma"] = "no-cache"
            res.headers["Expires"] = "0"
            return res
    except Exception:
        pass
    return ("", 204)


@app.route("/api/start-session", methods=["POST"])
def api_start_session():
    """Mulai sesi photobox baru."""
    data = request.get_json(silent=True) or {}
    sid = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:4]
    session_folder = os.path.join(RAW_DIR, sid)
    os.makedirs(session_folder, exist_ok=True)

    # Set folder di digiCamControl
    set_dcc_folder(session_folder)

    session_state["session_id"] = sid
    session_state["session_folder"] = session_folder
    session_state["photos"] = []
    session_state["layout"] = data.get("layout", "strip_3")
    session_state["frame_color"] = data.get("frame_color", "white")
    session_state["filter"] = data.get("filter", "original")
    session_state["title"] = data.get("title", "PHOTOBOX STUDIO")
    session_state["strip_path"] = None

    # Pastikan jendela Live View digiCamControl tertutup (agar tidak popup dan tidak lag)
    close_dcc_liveview()

    return jsonify({
        "success": True,
        "session_id": sid,
        "layout": session_state["layout"],
        "target_photos": 4 if "4" in session_state["layout"] else 3,
    })


@app.route("/api/capture", methods=["POST"])
def api_capture():
    """Memicu kamera untuk menjepret 1 foto dan menunggu file tersimpan."""
    sid = session_state.get("session_id")
    folder = session_state.get("session_folder")
    if not sid or not folder:
        return jsonify({"success": False, "error": "Sesi belum dimulai"}), 400

    # Catat file jpg yang sudah ada sebelum jepret
    existing_files = set(glob.glob(os.path.join(folder, "*.jpg")))

    # Picu jepret kamera via digiCamControl
    triggered = False
    for cmd in ["Capture", "LiveView_Capture"]:
        try:
            r = http_session.get(f"{DCC_BASE_URL}/?CMD={cmd}", timeout=3)
            if r.status_code == 200:
                triggered = True
                break
        except Exception:
            continue

    if not triggered:
        # Fallback via RemoteCmd
        try:
            subprocess.run(f'echo "" | "{DCC_REMOTECMD}" /c capture', shell=True, timeout=4)
            triggered = True
        except Exception as e:
            return jsonify({"success": False, "error": f"Gagal trigger shutter: {e}"}), 500

    # Tunggu file baru muncul dan selesai ditransfer (maksimal 7 detik)
    new_photo = None
    start_t = time.time()
    while time.time() - start_t < 7.0:
        time.sleep(0.4)
        current_files = set(glob.glob(os.path.join(folder, "*.jpg")))
        added = current_files - existing_files
        if added:
            # Pastikan ukuran file sudah stabil / transfer selesai
            candidate = list(added)[0]
            try:
                size1 = os.path.getsize(candidate)
                time.sleep(0.3)
                size2 = os.path.getsize(candidate)
                if size1 > 50000 and size1 == size2:
                    new_photo = candidate
                    break
            except Exception:
                continue

    if not new_photo:
        return jsonify({"success": False, "error": "Timeout menunggu foto dari kamera"}), 504

    session_state["photos"].append(new_photo)
    filename = os.path.basename(new_photo)
    photo_url = f"/captures/raw/{sid}/{filename}"

    return jsonify({
        "success": True,
        "photo_url": photo_url,
        "current_count": len(session_state["photos"]),
    })


@app.route("/api/generate-strip", methods=["POST"])
def api_generate_strip():
    """Menyusun semua foto sesi menjadi Photo Strip dan membuat QR Code download."""
    data = request.get_json(silent=True) or {}
    sid = session_state.get("session_id")
    photos = session_state.get("photos", [])

    if not sid or not photos:
        return jsonify({"success": False, "error": "Tidak ada foto untuk disusun"}), 400

    layout = data.get("layout", session_state.get("layout", "strip_3"))
    frame_color = data.get("frame_color", session_state.get("frame_color", "white"))
    filter_name = data.get("filter", session_state.get("filter", "original"))
    title = data.get("title", session_state.get("title", "PHOTOBOX STUDIO"))

    # 1. Generate QR Code untuk download
    local_ip = get_local_ip()
    download_url = f"http://{local_ip}:5000/download/{sid}"
    qr_filename = f"qr_{sid}.png"
    qr_path = os.path.join(QR_DIR, qr_filename)

    qr = qrcode.QRCode(box_size=4, border=1)
    qr.add_data(download_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    qr_img.save(qr_path)

    # 2. Buat Photo Strip
    strip_filename = f"strip_{sid}.jpg"
    strip_path = os.path.join(STRIPS_DIR, strip_filename)

    try:
        create_photostrip(
            image_paths=photos,
            output_path=strip_path,
            layout=layout,
            frame_color_name=frame_color,
            filter_name=filter_name,
            studio_title=title,
            qr_image_path=qr_path,
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"Gagal membuat strip: {e}"}), 500

    session_state["strip_path"] = strip_path

    return jsonify({
        "success": True,
        "strip_url": f"/captures/strips/{strip_filename}",
        "qr_url": f"/captures/qr/{qr_filename}",
        "download_url": download_url,
    })


@app.route("/api/print", methods=["POST"])
def api_print():
    """Mengirim file photo strip ke printer default Windows."""
    strip_path = session_state.get("strip_path")
    if not strip_path or not os.path.exists(strip_path):
        return jsonify({"success": False, "error": "File strip belum dibuat"}), 400

    try:
        # Jalankan print bawaan Windows
        os.startfile(strip_path, "print")
        return jsonify({"success": True, "message": "Perintah cetak berhasil dikirim!"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/download/<session_id>")
def mobile_download_page(session_id):
    """Halaman download mobile yang dibuka saat pelanggan scan QR Code."""
    strip_file = f"strip_{session_id}.jpg"
    strip_path = os.path.join(STRIPS_DIR, strip_file)
    strip_exists = os.path.exists(strip_path)

    # List foto individual
    raw_folder = os.path.join(RAW_DIR, session_id)
    raw_photos = []
    if os.path.exists(raw_folder):
        raw_photos = [
            f"/captures/raw/{session_id}/{os.path.basename(f)}"
            for f in glob.glob(os.path.join(raw_folder, "*.jpg"))
        ]

    return render_template(
        "download.html",
        session_id=session_id,
        strip_url=f"/captures/strips/{strip_file}" if strip_exists else None,
        raw_photos=raw_photos,
    )


# Serve file statis folder captures
@app.route("/captures/<path:filename>")
def serve_capture(filename):
    return send_from_directory(CAPTURES_DIR, filename)


if __name__ == "__main__":
    ip = get_local_ip()
    print("=" * 60)
    print("  PHOTOBOX STUDIO RUNNING")
    print(f"  Akses Kiosk di PC/Monitor : http://localhost:5000")
    print(f"  Akses Download dari HP     : http://{ip}:5000")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
