# Screenshot Capture Guide

The Chrome Web Store wants 1–5 screenshots at **1280×800** or **640×400**
(16:10), PNG or JPEG.

## What to capture

Pick 3–5 of these — judges/reviewers and users skim them:

1. **Hero — populated popup.** Show the popup with 4–5 items of mixed
   types: a link, a code snippet, a hex color, an image thumbnail, and a
   plain text item. Light theme.
2. **Dark mode.** Same popup populated, dark theme. Side-by-side with #1
   in the listing demonstrates polish.
3. **Expand modal — image.** Open an image item full-size with the
   "Edit / Copy" footer visible.
4. **Expand modal — color.** Open a hex color item; the big swatch and
   hex / RGB readout sells the smart-type story.
5. **Settings page.** Show the iOS-style switches and the segmented theme
   control.

## Seed the popup with realistic demo data

Open the popup, right-click the popup, choose **Inspect**, switch to the
**Console** tab, and paste:

```js
// Demo data — paste in the popup's DevTools console.
const demo = [
  { kind:"text",  text:"Anthropic raises Series E at $X bn valuation", source:"techcrunch.com",  ts:Date.now() - 60_000 },
  { kind:"text",  text:"https://en.wikipedia.org/wiki/Squircle",        source:"en.wikipedia.org", ts:Date.now() - 5*60_000 },
  { kind:"text",  text:"#0a84ff",                                        source:"figma.com",       ts:Date.now() - 8*60_000 },
  { kind:"text",  text:"const sum = (a, b) => a + b;\nexport default sum;", source:"github.com", ts:Date.now() - 15*60_000 },
  { kind:"text",  text:"hello@work-domain.com",                          source:"linear.app",      ts:Date.now() - 60*60_000 },
];
const ids = demo.map((d, i) => ({...d, id:`demo_${i}`, pinned:false, dataUrl:""}));
chrome.storage.local.set({ clipboard_items: ids });
```

Add an image manually by copying any image (right-click → Copy image)
before opening the popup — the image will appear at the top.

After the screenshots are taken, clear demo data:

```js
chrome.storage.local.set({ clipboard_items: [] });
```

## Capture commands (macOS)

```bash
# Capture a window region with shadow trimmed (Cmd+Shift+5 → "Capture
# Selected Window") — saves to ~/Desktop. Then resize to 1280×800:
sips -Z 1280 ~/Desktop/Screenshot*.png --out ~/Desktop/clipboard-shot.png
```

The popup itself is 380×600 — too small for the store. Place it on a
softly blurred desktop or a marketing background and crop to 1280×800.

## Promotional tile (440×280, optional)

Use a single hero rendering (popup + a "Clipboard" wordmark + the
gradient squircle icon) on a dark background. Save as PNG.
