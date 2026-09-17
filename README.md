# Afterimage · Step 01

A local, silent mouth-motion prototype made from the supplied portrait.

## Run

On this Mac, double-click `Start.command`, then open **http://127.0.0.1:8765** in Safari or Chrome. Keep the terminal window open. Control-C stops the server.

Alternatively, run `python3 server.py` in this directory. Python 3.9+ is required. No packages need to be installed. Mandarin romanization uses macOS CoreFoundation. There are no remote requests, model downloads, audio playback, or microphone access.

## Try

1. Play the English example.
2. Select the Chinese example and play it.
3. Enter mixed text, such as `Hello，你还在这里吗？`.
4. Use **Inspect face** to examine the mouth.
5. Adjust movement strength. Pace applies to the next playback; changing it stops current playback.
6. Expand the mouth-shape inspector to hold an individual shape.

Command-Enter plays the current text. Stop smoothly returns the mouth to rest. Full screen shows the image alone.

## What this version does

- Creates a timed sequence of nine approximate mouth shapes from text.
- Romanizes Mandarin phrases using the macOS system library. Polyphonic characters can still be incorrect.
- Uses approximate English spelling rules, not a pronunciation dictionary. Unusual words, accents, and names will be imperfect. Numbers are currently read digit by digit in English.
- Deforms the original lip texture locally using WebGL, with a procedural dark mouth interior. This tests motion and timing; it is not final photorealistic mouth artwork.
- Leaves the rest of the original image still. No AI-generated replacement images are used.

## Not connected yet

Microphone capture, speech recognition, reply generation, persistent memory, and LoRA training are future steps. Entering text here plays that text; it does not ask an AI a question.

Planned reply policy: English speech → English reply; Mandarin speech → Mandarin reply; non-speech environment → English by default. Mixed-language utterances follow the predominant language, with a later manual override.

## 下一步

先确认这张脸的口型运动和幅度。当前输入的文字就是要播放的文字，并非 AI 的回答。口型近似，不做精确唇读。确认视觉后，再接入麦克风与中英双语识别。

Files: `server.py` creates the timeline; `app.js` renders and plays it; `index.html` is the test interface; `assets/portrait.png` is an unchanged copy of the supplied image.
# homeless-agents

## Mouth guide overlay

Toggle **Guide points / 定位点** above the image to show black circular guides. It is off by default and works in the full image, face close-up, and fullscreen view. The guides show the fixed mouth center, moving corners and opening contour, plus four surrounding skin anchors initialized at the falloff scales. These use the renderer's shared manual calibration. They are not automatically detected facial landmarks; the surrounding anchors do not mark a hard boundary. The overlay does not alter mouth motion.

The overlay also includes four decorative points on each cheek; these follow the exact skin deformation every frame without driving it. All guide dots are rendered at 75% of the original diameter.
