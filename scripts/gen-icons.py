# scripts/gen-icons.py
# Run with: python3 scripts/gen-icons.py
# Requires: pip3 install Pillow

from PIL import Image, ImageDraw, ImageFont
import os

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r = max(2, size // 6)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(37, 99, 235))
    font_size = int(size * 0.6)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_size)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), 'H', font=font)
    x = (size - (bbox[2] - bbox[0])) // 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) // 2 - bbox[1]
    draw.text((x, y), 'H', fill=(255, 255, 255), font=font)
    return img

os.makedirs('ihss-extension/icons', exist_ok=True)
for size in [16, 48, 128]:
    make_icon(size).save(f'ihss-extension/icons/icon{size}.png')
    print(f'Created icon{size}.png')
