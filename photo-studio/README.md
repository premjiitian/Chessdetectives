# Private Photo Studio

One-tap **auto edit** for your photos, in the spirit of Remini and Lightroom's Auto,
but **your photos never leave your device**. No account, no upload, no cloud.
It works on iPhone, iPad and laptop, and keeps working in Airplane Mode.

## Use it
1. **Open**: tap *Choose photos* (or drag photos onto the page on a laptop).
2. **Auto edit** runs straight away and lists *what it changed and why*.
   Hold the photo to compare with the original. Pick a **Look** (Natural, Vivid,
   Portrait, Landscape, Golden, B&W), set **Auto strength**, or fine-tune the sliders.
3. **Save**: on iPhone/iPad the share sheet opens. Choose **Save Image** to put the
   edited copy in Photos. On a laptop it goes to Downloads.
   The saved copy keeps its date and camera details, so it sorts next to the original.
   Location is removed unless you tick *Keep location*.

### Install on iPhone / iPad (works like an app)
Open the site in Safari → Share → **Add to Home Screen**. It opens full-screen,
works offline, and has no access to anything except the photos you pick.

## How Auto decides (Lightroom best practices)
Same order as Lightroom's Basic panel: **white balance → exposure → highlights /
shadows → whites / blacks → contrast → clarity → vibrance → sharpening**.

| Step | What a pro does | What Auto does |
|---|---|---|
| White balance | Click something grey with the eyedropper | Tries many corrections and keeps the one that makes the most areas truly grey. Gentler when few greys exist, so sunsets stay warm |
| Exposure | Set by the mid-tones, not the sky | Only moves brightness if the middle of the photo is outside a comfortable band. Snow and beach scenes stay bright |
| Highlights / Shadows | Pull highlights down, lift shadows | Measures how much sky is near white and how dark the shadows are |
| Whites / Blacks | Shift-double-click to set the end points | Puts the brightest 0.5 % at 96 % and the darkest 0.5 % at 3 %, and never pushes already-burnt highlights back up |
| Contrast | Only for flat photos | Measures the spread of tones, adds contrast only if it's narrow |
| Presence | Vibrance rather than Saturation | Vibrance boosts dull colours and protects skin. Less clarity when skin tones are found |
| Detail | Light sharpening with masking | Sharpens edges only, so smooth areas don't get noisy |

## The improvement loop
```
npm install
npm run loop      # type check + 42 unit/quality tests + build + browser robot → scorecard
npm run dev       # try it locally
```
The scorecard measures **output quality** (how much of each camera mistake Auto
repairs, and that a good photo is left nearly alone) and **experience**
(privacy: zero requests leave the device; saving at full resolution; EXIF and
location; accessibility in light and dark; phone layout at 360 px; offline;
speed; hostile file names). Screenshots go to `scripts/out/`. Look at them.

## Limits (honest list)
- Edits are measured "smart auto" adjustments, not generative AI. It won't invent
  detail in a blurry face the way Remini does. See *Next steps*.
- iPhone/iPad Safari can save up to about 16 megapixels (a browser limit). Bigger
  48 MP photos are scaled down to that size when saved.
- HEIC files open in Safari. Chrome on a laptop needs JPEG or PNG.
