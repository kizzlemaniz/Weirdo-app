# Number Bank v4 — iPhone Powerball number generator and drawing research

**Free installable Home Screen web app (PWA).** No Apple Developer account, server, API key or paid service required. Build files are plain HTML, CSS and JavaScript. All personal entries live on the device; make backups frequently.

## What's in v4

- **Generator:** Five distinct white balls from 1–69 and a red ball from 1–26. **Default:** red ball MAY equal any white ball, which matches Powerball rules. **Optional strict switch:** all six values must differ. Pure random uses browser cryptographic randomness. Optional modest history-based weighting is experimental and does not establish better winning odds. Never re-save an identical generated white-set-plus-red combination.
- **Unlimited-in-app personal bank:** Store previous picks manually, generate and save, search, import/export CSV/JSON. The app imposes **no fixed record limit**, but iPhone/IndexedDB storage is finite. Data is NOT synchronized between devices automatically.
- **Historical results:** When open and online, downloads and locally caches actual Powerball winning numbers from the **New York State Gaming Commission** public dataset (https://data.ny.gov/d/d6yy-54nr). Only dates on/after October 7, 2015, compatible with these number ranges. Official sorted white-ball results are distinct from the physical order of selection. Data source updates may lag.
- **Actual draw order:** Separate five-position order for the white balls. Includes a **12-drawing static sample**, transcribed from the Texas Lottery's published “View in Draw Order” table (https://www.texaslottery.com/export/sites/lottery/Games/Powerball/Winning_Numbers/index.html_799109696.html), Oct 7–Nov 2, 2026. Users can fill new orders manually, link them to the matching date, or import a simple CSV of draw orders. When official sorted results have loaded, saving a draw-order entry with different numbers is blocked. **New Texas draw orders are NOT automatically fetched**: browser cross-origin permissions and source formats are not assured.
- **Video analysis:** User selects a locally available drawing clip; app measures broad visible **frame-to-frame motion intensity** as it plays. User can mark numbered balls with their on-video timestamps. Use the **Attach current Video Lab measurements** button in the Drawing Research section to store motion summaries, downsampled motion points, and ball timestamps under a particular drawing date. The original video file is NOT stored in the app or uploaded. A video URL can be saved to reopen the original reference.
- **Equipment observations:** Manually record white/red machine IDs, ball-set IDs, observed mixing time, camera conditions and notes, linked by drawing date to official result, white-ball exit order and video measurements.
- **Cross-draw exploration:** Compare first-ball counts and group your saved observations by white-ball machine. A small sample or visible correlation is not evidence of a mechanical bias or forecasting advantage.
- **Backups:** **Backup JSON includes personal number sets AND date-linked drawing studies** (including video summaries and equipment notes). Official cached results can be resynced; the video files themselves are excluded. Import a v4 JSON backup, or an older Number Bank backup with saved sets. For bulk draw-order import use the separate CSV importer in Drawing Research.

## Install from an iPhone (no computer required)

1. Download the ZIP from your ChatGPT conversation. If the in-app link fails, sign in to the same conversation from Safari at https://chatgpt.com and download there.
2. Save in Files, open the Files app, locate ZIP in Downloads, and tap ZIP once to extract its folder.
3. Create a free GitHub account at https://github.com and create a **public** repository, for example `number-bank`.
4. In the GitHub repository choose **Add file → Upload files**. Select and upload **all the files inside** the extracted folder to the root of the repository, **not** the enclosing folder. Commit. On iPhone Safari, using *Request Desktop Website* can make GitHub's upload controls easier to reach.
5. Repository **Settings → Pages → Deploy from a branch**, choose branch `main` and folder `/(root)`. Save. GitHub Pages hosts public repositories free. The app URL will look like `https://YOUR-USERNAME.github.io/number-bank/`.
6. Open your app URL in iPhone **Safari**, Share → **Add to Home Screen** → Add. Choose **Open as Web App** if offered.
7. Open the Number Bank icon from your Home Screen. You can now generate/save numbers, open archived drawings, record equipment observations and analyze local video clips.

**Updating from an earlier Number Bank app:** Before uploading new files, export a JSON backup of your saved sets. Replace the existing root app files in the SAME repository so your website URL remains unchanged. On first launch the IndexedDB version will upgrade from v2 to v3 and **preserve existing saved sets and official results**, adding the date-linked studies store. The service worker's cache name changes to v4. If old files persist, close/reopen the app or refresh Safari after the deployment updates. Avoid clearing browser data before you export a backup.

## Enter a draw order using a CSV

Create a CSV with six columns, in this exact order, such as:

```csv
date,first,second,third,fourth,fifth
2026-11-02,7,29,64,23,66
2026-10-31,50,4,2,18,56
```

*These sample sequences are from the Texas Lottery published draw-order table, not sorted winning numbers.* All five must be distinct and range from 1–69. When an official result is cached for the selected date, it must contain exactly the same five white-ball numbers. Imported draw orders are labeled as user-supplied. Source documentation should be checked independently.

## Four-way research workflow

1. Under **Past Powerball drawings**, tap **Open linked drawing study** on any listed draw, or select a date in Drawing Research.
2. The official result loads when synced. Enter the five actual white balls in the order they exited. For a source, open the Texas draw-order listing or the Powerball drawing page. Save.
3. In **Video Lab**, select a video recording that you can lawfully access, press Play, and optionally mark each ball's number as it exits. Return to **Drawing Research** with the same date and tap **Attach current Video Lab measurements**.
4. Record machine/ball-set identifiers only if visible or otherwise documented. Record stirring duration, camera conditions and observational notes. Tap **Save drawing study**. The four facets now share the same drawing date.
5. Compare study samples. Export JSON backup and save to Files/iCloud Drive.

## Scope and important limitations

- **The automatic data sync is for winning-number history only**, while the app is open and online. iOS can suspend web apps; no background sync after closing the app is promised.
- Remote livestreams or YouTube videos **cannot be downloaded and analyzed automatically** by this free client-side GitHub Pages app due to cross-site video-access rules, media formats and processing requirements. The app opens official video sources and analyzes local video files supplied by the user. It **does not individually track every ball** or automatically determine ball identity or mechanical variables.
- Approximate frame-difference “motion” is sensitive to camera movements, editing, compression, lighting and overlays. Ball positions, weights, air currents, and machine internals are not known from an ordinary broadcast.
- **No prediction advantage is demonstrated.** Historical draw results are descriptive. For a fair independent drawing, frequency and physical-motion observations cannot be assumed to improve selection accuracy. Rigorous testing would require large well-labeled samples, source verification and independent future-draw validation.
- Local data persists in iPhone browser storage until browser/site data is cleared, storage is evicted, app is removed, or device is reset. No unlimited storage is possible. Export JSON regularly. GitHub Pages is a **public-code** website; do not commit personal number records or secrets to the public repository.
- This tool is independent and is not affiliated with Powerball, MUSL, New York State Gaming Commission, Texas Lottery or Apple. Always check officially certified winning results for prize claims.

## Development and verification

Built as a no-build static PWA (15 files including this README). JavaScript syntax, data-field references and iPhone-width static layout were checked. Random-generator tests checked 10,000 sets with red matching enabled (five white balls always distinct; red/white matches occurred) and another 10,000 in strict mode (all six distinct). November 2, 2026 red-ball equality and draw-order cross-check were tested. **The live NY API connection and Home Screen install were not testable end-to-end in the offline build environment**; verify once deployed.
