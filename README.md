# Sketch: AI image editor

A browser-based image editor with the core Photoshop basics plus **Gemini** image editing. You can apply AI edits to the whole image or only to a selected area.
It has no dependencies and no build step.

## Run

- Double-click `index.html`, **or**
- run `start.bat`, which serves the editor at http://localhost:8080 using Python. Use this if your browser blocks clipboard or API access from `file://` pages.

Then open **Settings** in the Gemini panel and paste an API key from <https://aistudio.google.com/apikey>.
The key is stored only in your browser's localStorage.

## Features

| Area | What you get |
|---|---|
| Layers | add / duplicate / delete / reorder, visibility, opacity, 16 blend modes, merge down, flatten, layer via copy/cut |
| Selection | rectangle, ellipse, lasso, magic wand (tolerance, contiguous); add / subtract / intersect (Shift / Alt); feather, expand, contract, invert, load from layer alpha |
| Painting | brush & eraser (size, hardness, opacity), paint bucket, linear/radial gradient, shapes, text |
| Image | crop tool, crop to selection, image size, canvas size (anchor), rotate, flip |
| Adjust | brightness/contrast, levels, hue/saturation, vibrance, temperature/tint, auto levels, desaturate, invert, sepia, posterize, threshold |
| Filters | gaussian blur, unsharp mask, noise, pixelate, vignette |
| General | undo/redo with a history panel, zoom/pan, drag-and-drop, clipboard paste, export PNG/JPEG/WebP |

Every paint, fill, adjustment and filter is limited to the active selection.

## How the Gemini edit works

1. **No selection**: the visible image (or only the active layer) is sent with your prompt. The result comes back as a new layer.
2. **With a selection**, choose what to send:
   - **Selection only** (default): only the selected pixels are sent. Everything outside the selection is replaced with neutral gray padding, so the rest of the image never leaves your machine.
   - **With context**: the selection plus some surrounding area (adjustable) is sent, together with a black and white **mask** that tells Gemini where to edit. This usually blends better with the surroundings.

   In both cases the crop is fitted to the nearest aspect ratio Gemini supports. The result is placed back at the same spot as a new layer, masked to your selection with a soft **edge blend**.
3. **Variations** (1–4) run in parallel. Each one becomes its own layer, and only the first is visible, so you can toggle them to compare.
4. **Reference images** (from a file, or from the canvas or selection) are sent along. For example: "put this logo on the shirt".
5. The **Generate** tab creates new images from text. They are added as a layer or as a new document.

Since every AI result is a regular layer, you can lower its opacity, erase parts of it, change its blend mode, or undo it.

Models: `gemini-2.5-flash-image` (fast) and `gemini-3-pro-image-preview` (higher quality, 2K/4K output). A custom model id field covers newer models.

## Code layout

```
index.html        app shell
css/styles.css    dark UI theme
js/core.js        utilities, document/layers, history (snapshot-based, shares unchanged layers), view & rendering
js/selection.js   selection mask, marching ants, wand, feather/grow
js/tools.js       tools (move, marquee, lasso, wand, crop, eyedropper, brush, eraser, fill, gradient, shape, text, hand, zoom)
js/filters.js     adjustments & filters with live-preview dialogs
js/gemini.js      Gemini REST calls + AI panel
js/ui.js          menus, toolbar, options bar, panels, dialogs, keyboard, file I/O
```

Press **F1** in the app to see the keyboard shortcuts.
