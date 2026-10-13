"""Erzeugt die PNG-App-Symbole aus denselben Formen wie icons/icon.svg."""
from PIL import Image, ImageDraw
import os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
for size in (192, 512):
    s = size / 512
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(112 * s), fill=(11, 18, 32, 255))
    w = max(2, int(28 * s))
    d.rounded_rectangle([int(92 * s), int(128 * s), int(420 * s), int(336 * s)], radius=int(22 * s), outline=(14, 165, 233, 255), width=w)
    d.polygon([(220 * s, 190 * s), (300 * s, 232 * s), (220 * s, 274 * s)], fill=(255, 255, 255, 255))
    d.line([(256 * s, 336 * s), (256 * s, 392 * s)], fill=(14, 165, 233, 255), width=w)
    d.line([(196 * s, 400 * s), (316 * s, 400 * s)], fill=(14, 165, 233, 255), width=w)
    im.save(f'icons/icon-{size}.png')
print('icons ok')
