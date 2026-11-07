"""
photostrip.py
Modul untuk menyusun foto-foto pose menjadi Photo Strip estetik menggunakan Pillow.
Mendukung berbagai layout (Strip 3 foto, Strip 4 foto, Grid 2x2), warna frame, dan filter.
"""
import datetime
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

# Palet warna frame
FRAME_COLORS = {
    "white": {"bg": (255, 255, 255), "text": (30, 30, 30), "accent": (160, 160, 160)},
    "black": {"bg": (24, 24, 24), "text": (245, 245, 245), "accent": (100, 100, 100)},
    "pink": {"bg": (247, 214, 208), "text": (74, 53, 49), "accent": (180, 140, 135)},
    "beige": {"bg": (244, 235, 217), "text": (61, 53, 46), "accent": (165, 150, 135)},
    "sage": {"bg": (216, 226, 220), "text": (45, 58, 52), "accent": (140, 155, 148)},
}


def apply_filter(image: Image.Image, filter_name: str) -> Image.Image:
    """Menerapkan filter foto (original, bw, vintage, cool)."""
    filter_name = (filter_name or "original").lower()

    if filter_name == "bw":
        gray = ImageOps.grayscale(image)
        # Tambah kontras sedikit agar lebih dramatis
        enhancer = ImageEnhance.Contrast(gray)
        gray = enhancer.enhance(1.25)
        return gray.convert("RGB")

    elif filter_name == "vintage":
        # Trik sepia / warm tint
        rgb = image.convert("RGB")
        r, g, b = rgb.split()
        r = r.point(lambda i: min(255, int(i * 1.1 + 10)))
        g = g.point(lambda i: int(i * 0.95))
        b = b.point(lambda i: int(i * 0.8))
        warm = Image.merge("RGB", (r, g, b))
        # Sedikit turunkan saturasi
        enhancer = ImageEnhance.Color(warm)
        return enhancer.enhance(0.85)

    elif filter_name == "cool":
        rgb = image.convert("RGB")
        r, g, b = rgb.split()
        r = r.point(lambda i: int(i * 0.88))
        b = b.point(lambda i: min(255, int(i * 1.1 + 12)))
        cool = Image.merge("RGB", (r, g, b))
        return cool

    # Default original
    return image.convert("RGB")


def get_font(size: int, bold: bool = False):
    """Mencari font sistem yang tersedia di Windows, fallback ke default font."""
    font_names = [
        "arialbd.ttf" if bold else "arial.ttf",
        "seguisb.ttf" if bold else "segoeui.ttf",
        "calibrib.ttf" if bold else "calibri.ttf",
    ]
    fonts_dir = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts")
    for name in font_names:
        p = os.path.join(fonts_dir, name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def crop_to_aspect(image: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Crop foto dari tengah (center-crop) agar pas dengan rasio target."""
    target_ratio = target_w / target_h
    img_w, img_h = image.size
    img_ratio = img_w / img_h

    if img_ratio > target_ratio:
        # Foto lebih lebar -> potong sisi kiri dan kanan
        new_w = int(img_h * target_ratio)
        offset = (img_w - new_w) // 2
        crop_box = (offset, 0, offset + new_w, img_h)
    else:
        # Foto lebih tinggi -> potong atas dan bawah
        new_h = int(img_w / target_ratio)
        offset = (img_h - new_h) // 2
        crop_box = (0, offset, img_w, offset + new_h)

    cropped = image.crop(crop_box)
    return cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)


def create_photostrip(
    image_paths: list,
    output_path: str,
    layout: str = "strip_3",
    frame_color_name: str = "white",
    filter_name: str = "original",
    studio_title: str = "PHOTOBOX STUDIO",
    date_str: str = None,
    qr_image_path: str = None,
) -> str:
    """
    Membuat file Photo Strip dari list foto.
    - layout: 'strip_3' (3 foto vertikal), 'strip_4' (4 foto vertikal), 'grid_4' (2x2)
    - frame_color_name: 'white', 'black', 'pink', 'beige', 'sage'
    """
    theme = FRAME_COLORS.get(frame_color_name.lower(), FRAME_COLORS["white"])
    bg_color = theme["bg"]
    text_color = theme["text"]
    accent_color = theme["accent"]

    if date_str is None:
        date_str = datetime.datetime.now().strftime("%d . %m . %Y")

    # Load dan filter gambar
    loaded_images = []
    for p in image_paths:
        if os.path.exists(p):
            try:
                img = Image.open(p)
                img = apply_filter(img, filter_name)
                loaded_images.append(img)
            except Exception as e:
                print(f"[!] Error loading {p}: {e}")

    if not loaded_images:
        raise ValueError("Tidak ada gambar yang berhasil dimuat.")

    # Dimensi kanvas resolusi tinggi (standar cetak photo strip 2x6 inch = 800 x 2400 px)
    if layout == "grid_4":
        canvas_w, canvas_h = 1600, 2400
        cols, rows = 2, 2
        margin_x = 70
        margin_top = 100
        gap = 40
        footer_h = 240
    elif layout == "strip_4":
        canvas_w, canvas_h = 800, 2400
        cols, rows = 1, 4
        margin_x = 55
        margin_top = 80
        gap = 35
        footer_h = 280
    else:  # default 'strip_3'
        canvas_w, canvas_h = 800, 2400
        cols, rows = 1, 3
        margin_x = 60
        margin_top = 90
        gap = 45
        footer_h = 320

    # Buat kanvas dasar
    canvas = Image.new("RGB", (canvas_w, canvas_h), color=bg_color)
    draw = ImageDraw.Draw(canvas)

    # Hitung ukuran kotak foto
    available_w = canvas_w - (2 * margin_x) - ((cols - 1) * gap)
    photo_w = available_w // cols

    available_h = canvas_h - margin_top - footer_h - ((rows - 1) * gap)
    photo_h = available_h // rows

    # Pasang foto ke kanvas
    img_idx = 0
    for r in range(rows):
        for c in range(cols):
            if img_idx < len(loaded_images):
                img = loaded_images[img_idx]
                cropped = crop_to_aspect(img, photo_w, photo_h)

                pos_x = margin_x + c * (photo_w + gap)
                pos_y = margin_top + r * (photo_h + gap)

                # Paste foto
                canvas.paste(cropped, (pos_x, pos_y))

                # Gambar border tipis estetis di sekeliling foto
                draw.rectangle(
                    [pos_x, pos_y, pos_x + photo_w, pos_y + photo_h],
                    outline=accent_color,
                    width=1,
                )
                img_idx += 1

    # Desain Footer: Brand Title & Tanggal
    font_title = get_font(34, bold=True)
    font_sub = get_font(20, bold=False)

    footer_center_y = canvas_h - (footer_h // 2)

    # QR Code di footer jika ada
    qr_size = 110
    if qr_image_path and os.path.exists(qr_image_path):
        try:
            qr_img = Image.open(qr_image_path).resize(
                (qr_size, qr_size), Image.Resampling.LANCZOS
            )
            qr_x = canvas_w - margin_x - qr_size
            qr_y = footer_center_y - (qr_size // 2)
            canvas.paste(qr_img, (qr_x, qr_y))
            # Text bergeser ke kiri
            text_area_w = canvas_w - (2 * margin_x) - qr_size - 20
        except Exception:
            text_area_w = canvas_w - (2 * margin_x)
    else:
        text_area_w = canvas_w - (2 * margin_x)

    # Gambar teks judul studio
    draw.text(
        (margin_x + (text_area_w // 2), footer_center_y - 25),
        studio_title,
        fill=text_color,
        font=font_title,
        anchor="mm",
    )

    # Gambar teks tanggal
    draw.text(
        (margin_x + (text_area_w // 2), footer_center_y + 20),
        date_str,
        fill=accent_color,
        font=font_sub,
        anchor="mm",
    )

    # Pastikan direktori tujuan ada
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    canvas.save(output_path, quality=95)
    return output_path

