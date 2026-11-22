# Bundle Book

An installable, offline-first notebook for buying stone. Log bundles, photos, sizes, prices and decisions at the yard. It all saves on the phone first. When there's a connection, photos and one Google Sheet per trip sync to your Google Drive:

```
My Drive
└── Bundle Book
    ├── Photos
    │   └── <Trip name>
    │       └── <Bundle #> — <Material> — <id>
    │           └── 4471_1_xxxxxx.jpg …
    └── Sheets
        ├── Bundle Book — Brazil — March 2027   (one Google Sheet per trip)
        ├── Bundle Book — Day-to-day
        └── Daily copies
            └── All trips — 2026-11-22   (dated copy of every trip, one per day)
```

### Trip sheets

- **Creating a trip** creates its sheet on the next sync. It starts with just the column headings.
- **Saving, moving or deleting a bundle** rewrites only the sheet for that bundle's trip. When a bundle moves between trips, both sheets are rewritten.
- **Renaming a trip** renames its sheet. The link stays the same, because each sheet is tagged with its trip's internal id.
- **Day-to-day** gets a sheet once it has a bundle.
- **A new phone** finds the existing trip sheets rather than making copies.
- **Don't type into a trip sheet.** Each sync overwrites it.

### Using a trip sheet in your own spreadsheet

To build your own views, formulas or formatting:

1. In the app, tap **Drive**, then **Copy link** next to the trip.
2. In your own Google Sheet, enter:
   ```
   =IMPORTRANGE("paste-the-link-here", "A1:Z")
   ```
3. Click **Allow access** the first time.

Your sheet then updates on its own whenever the app syncs.

## How it works

- **Storage:** bundles, trips and full photos live in the browser's IndexedDB on the device. On the first save the app asks the browser for persistent storage, so the OS is less likely to clear it.
- **Offline:** a service worker (`sw.js`) caches the app, so it opens with no signal. Google Fonts are cached the first time they load.
- **Sync queue:** each save queues the bundle's new photos, a rewrite of its trip's sheet, and a rewrite of today's all-trips copy. Repeated edits before a sync still mean one upload per sheet. The queue runs:
  - when you save
  - when the connection comes back
  - when you reopen the app
  - every 5 minutes while the app is open
  - when you tap **Drive › Sync now**

  Failed jobs stay queued, with the error shown in the Drive panel.
- **Sheets:** each trip's sheet keeps the same file, and its content is replaced in place. The daily all-trips copy is rewritten through the day, and earlier days' copies are left as snapshots.
- **Google sign-in:** the app redirects to Google's sign-in page and back, using your OAuth client and only the `drive.file` scope. That scope lets the app see only the files and folders it created, nothing else in your Drive. Pop-ups aren't used because they fail inside an installed iPhone app.
  - Google gives a browser-only app a token for about an hour and no refresh token.
  - After the hour, new items wait on the phone until you tap **Reconnect**. That's usually a single tap, because Google remembers your consent.
- **Deleting:** deleting a bundle removes it and its photos from the device. Copies already in Drive stay.

## One-time setup

### 1. Put it on GitHub Pages

1. Create a GitHub repository, for example `bundle-book`. A public repo works on the free plan. The code holds no secrets, and your data never goes into the repo.
2. Push the contents of this folder to the repository root: `index.html`, `app.js`, `store.js`, `drive.js`, `config.js`, `sw.js`, `manifest.webmanifest`, `icons/`, `.nojekyll`.
3. On GitHub, open **Settings › Pages**. Under Source, choose **Deploy from a branch**, then branch `main`, folder `/ (root)`.
4. Note the site address, for example `https://YOUR-USER.github.io/bundle-book/`. You need it in step 2.

### 2. Create the Google OAuth client

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project, or pick an existing one.
2. **APIs & Services › Library:** enable the **Google Drive API**.
3. **Google Auth Platform › Branding** (older consoles call this the *OAuth consent screen*):
   - App name: Bundle Book.
   - User type: **External**.
   - Leave the app in **Testing**.
4. **Audience › Test users:** add your own Google account. In Testing mode only listed accounts can sign in, which suits a one-person app. A browser-only app doesn't use refresh tokens, so Testing mode's 7-day refresh-token limit doesn't affect it.
5. **Data access:** add the scope `https://www.googleapis.com/auth/drive.file`.
6. **Clients › Create client:**
   - Type: **Web application**.
   - **Authorized JavaScript origins:**
     - `https://YOUR-USER.github.io`
     - `http://localhost:8765` (optional, for local testing)
   - **Authorized redirect URIs:** both must match exactly, trailing slash included.
     - `https://YOUR-USER.github.io/bundle-book/`
     - `http://localhost:8765/` (optional)
7. Copy the client ID. It looks like `1234567890-abc…xyz.apps.googleusercontent.com`.

### 3. Add the client ID

Edit `config.js`:

```js
window.BB_CONFIG = { googleClientId: '1234567890-abc…xyz.apps.googleusercontent.com' };
```

Commit and push.

### 4. Install it on your phone

- **iPhone:** open the site in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open the site in Chrome and tap **Install**, either from the app's own button or from Chrome's menu.

Then open the app, tap **Drive**, tap **Connect Google Drive**, and approve.

On iPhone, an installed web app keeps storage separate from Safari. Use the installed app, not a Safari tab, or you'll end up with two separate notebooks.

## Deploying changes

The app is served cache-first. After changing any file, bump `VERSION` in `sw.js` (`bb-v1` → `bb-v2`) before pushing. The next time the app opens online it fetches the new version and shows a **Reload** prompt.

## Local testing

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. To test sign-in locally, add the localhost origin and redirect URI to the OAuth client.

## Limits to know

- The data lives on one device. A new phone starts empty, except for what's already in Drive. Back up by syncing.
- iOS can clear storage for web apps that haven't been opened for several weeks, even when installed. Sync before long breaks.
- Dictation uses the browser's speech recognition and usually needs a connection. You can still type notes offline.
