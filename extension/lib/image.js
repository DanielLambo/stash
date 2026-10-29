export function findAlphaBounds(rgba, width, height, threshold = 5) {
  if (!rgba || width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < left ? null : { left, right, top, bottom };
}
