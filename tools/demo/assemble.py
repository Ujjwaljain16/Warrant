import json, sys
from pathlib import Path
from PIL import Image

frames_dir = Path(__file__).parent / ".frames"
out = Path(sys.argv[1])
meta = json.loads((frames_dir / "durations.json").read_text())
images, durations = [], []
for item in meta:
    img = Image.open(frames_dir / item["file"]).convert("RGB")
    img = img.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    images.append(img)
    durations.append(int(item["seconds"] * 1000))
images[0].save(out, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(out, out.stat().st_size // 1024, "KB", len(images), "frames")
