#!/usr/bin/env python3
"""
Cek apakah Canon EOS 7D terdeteksi lewat USB,
lalu tampilkan setting yang bisa diatur dari software (ISO, aperture, dll).

Persiapan:
  Windows: Install digiCamControl via terminal:
           winget install dukus.digiCamControl
           (atau unduh dari https://digicamcontrol.com)
  macOS  : brew install gphoto2
           killall PTPCamera 2>/dev/null; pkill -f ptpcamera
  Linux  : sudo apt install gphoto2

Kamera:
  - Colok kabel USB ke PC/Laptop
  - Nyalakan kamera (ON)
  - Mode dial ke M / Av / Tv (bukan Auto / Video)
  - Matikan Canon EOS Utility kalau sedang jalan

Jalankan:
  python detect_camera.py
"""
import os
import platform
import shutil
import subprocess
import sys
import time

IS_WINDOWS = platform.system() == "Windows"

# Path umum untuk CameraControlCmd.exe di Windows
DIGICAM_PATHS = [
    r"C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe",
    r"C:\Program Files\digiCamControl\CameraControlCmd.exe",
]

# Setting yang biasanya dipakai untuk photo box (gphoto2)
WATCH_GPHOTO = [
    "/main/imgsettings/iso",
    "/main/imgsettings/imageformat",
    "/main/capturesettings/aperture",
    "/main/capturesettings/shutterspeed",
    "/main/capturesettings/exposurecompensation",
    "/main/imgsettings/whitebalance",
    "/main/settings/capturetarget",
    "/main/actions/viewfinder",   # live view (7D mendukung)
    "/main/actions/eosremoterelease",
]


def run_cmd(args, timeout=25):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except Exception as e:
        return 1, str(e)


def find_digicam_cmd():
    # 1. Cek di PATH
    which_path = shutil.which("CameraControlCmd") or shutil.which("CameraControlCmd.exe")
    if which_path:
        return which_path
    # 2. Cek di folder Program Files default
    for p in DIGICAM_PATHS:
        if os.path.exists(p):
            return p
    return None


def check_windows_usb_devices():
    """Cek apakah Windows mendeteksi perangkat Canon di level USB hardware."""
    cmd = [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -like '*Canon*' } | Select-Object -ExpandProperty FriendlyName",
    ]
    code, out = run_cmd(cmd, timeout=10)
    if code == 0 and out:
        return [line.strip() for line in out.splitlines() if line.strip()]
    return []


def run_windows():
    print("=== Sistem Terdeteksi: Windows ===")

    # Cek level hardware USB terlebih dahulu
    print("\n-- Memeriksa koneksi USB fisik kamera --")
    detected_devices = check_windows_usb_devices()
    if detected_devices:
        for d in detected_devices:
            print(f"[OK] Hardware terdeteksi oleh Windows: {d}")
    else:
        print("[!] Perhatian: Windows belum mendeteksi kamera Canon yang aktif (Present).")
        print("    Pastikan:")
        print("    1. Kabel USB sudah terhubung dengan baik.")
        print("    2. Kamera posisi ON (bukan sleep/mati).")
        print("    3. Mode dial ke M / Av / Tv.")

    digicam_cmd = find_digicam_cmd()
    if not digicam_cmd:
        print("\n" + "=" * 60)
        print("[X] digiCamControl belum terinstall!")
        print("Di Windows, kontrol Canon EOS menggunakan digiCamControl CLI.")
        print("\nCara install mudah via Terminal / PowerShell:")
        print("  winget install dukus.digiCamControl")
        print("\nAtau download manual dari:")
        print("  https://digicamcontrol.com/download")
        print("=" * 60)
        sys.exit(1)

    print(f"\n[OK] digiCamControl CLI ditemukan: {digicam_cmd}")

    print("\n== 1. Deteksi kamera (digiCamControl) ==")
    code, out = run_cmd([digicam_cmd, "/cameras"])
    print(out if out else "(Tidak ada output teks)")

    print("\n== 2. Tes ambil foto (opsional) ==")
    ans = input("Jepret 1 foto tes ke folder ini? [y/N] ").strip().lower()
    if ans == "y":
        ts = time.strftime("%Y%m%d_%H%M%S")
        out_file = os.path.abspath(f"tes_{ts}.jpg")
        print(f"Mengambil foto dan menyimpan ke: {out_file} ...")
        code, out = run_cmd([digicam_cmd, "/filename", out_file, "/capture"], timeout=40)
        print(out)
        if os.path.exists(out_file):
            print(f"[OK] Foto berhasil diambil: {out_file}")
        else:
            print("[X] Pengambilan foto gagal. Pastikan aplikasi GUI digiCamControl sedang ditutup.")


def run_posix():
    print("=== Sistem Terdeteksi: macOS / Linux ===")
    if not shutil.which("gphoto2"):
        print("[X] gphoto2 belum terinstall.")
        print("  macOS: brew install gphoto2")
        print("  Linux: sudo apt install gphoto2")
        sys.exit(1)

    print("\n== 1. Deteksi kamera ==")
    code, out = run_cmd(["gphoto2", "--auto-detect"])
    print(out)
    if "Canon" not in out and "7D" not in out:
        print("\n[X] Kamera tidak terdeteksi. Cek: kabel data, kamera ON,")
        print("    program lain (EOS Utility / PTPCamera / Photos) yang mengunci koneksi.")
        sys.exit(2)
    print("[OK] Kamera terdeteksi.\n")

    print("== 2. Info kamera ==")
    _, out = run_cmd(["gphoto2", "--summary"])
    print(out[:1500], "\n")

    print("== 3. Setting yang bisa diatur ==")
    for key in WATCH_GPHOTO:
        code, out = run_cmd(["gphoto2", "--get-config", key])
        if code == 0:
            print(f"--- {key}\n{out}\n")
        else:
            print(f"--- {key}: tidak tersedia / error")

    print("== 4. Tes ambil foto (opsional) ==")
    ans = input("Jepret 1 foto tes ke folder ini? [y/N] ").strip().lower()
    if ans == "y":
        code, out = run_cmd(
            ["gphoto2", "--capture-image-and-download",
             "--filename", "tes_%Y%m%d_%H%M%S.%C"],
            timeout=40,
        )
        print(out)
        print("[OK] Berhasil" if code == 0 else "[X] Gagal")


def main():
    if IS_WINDOWS:
        run_windows()
    else:
        run_posix()


if __name__ == "__main__":
    main()

