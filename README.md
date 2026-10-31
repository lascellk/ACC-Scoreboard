# ACC Scoreboard

A four-sheet curling scoreboard for the Almonte Curling Club. Phones enter scores, and a TV shows all four sheets and the draw countdown.

| Page | Used by | What it does |
|---|---|---|
| `admin.html` | Draw organiser (admin PIN) | Create draws, enter teams and logos, set stones, hammer, ends and timer minutes. Make a draw live. Adjust or reset the timer. |
| `index.html` | Scorers (score PIN) | See all four sheets, start the draw, enter each end. Tap a sheet to score, correct an end, swap the hammer or finish the game. |
| `tv.html` | The TV | Four sheet strips and the countdown. Casts to a Chromecast, or open it in any TV browser. |

## How it works

- `docs/` is the website, published with GitHub Pages. There is no build step.
- `backend/` is a Google Apps Script web app bound to a Google Sheet, which holds the draws, games and logos.
- Each page asks the backend for the live draw every 4 seconds, so a score reaches the TV within about 5 seconds.
- The timer is a stored start time, so phones and the TV count down together and a page can reload without losing it.
- The TV fetches its own data. The phone that starts casting can disconnect and the TV keeps updating.

The hammer is worked out from the ends: the team that scores gives up the hammer, and a blank end leaves it where it was. Correcting an earlier end updates everything after it. **Swap hammer** flips who started with it, for when the setup was wrong.

If a tied game needs an extra end, keep scoring: the line score grows by itself. **Finish game** stops a sheet early and removes its hammer.

## Setup

About 30 minutes, once.

### 1. Backend

1. Create a Google Sheet named *ACC Scoreboard* in the [Scoreboard Drive folder](https://drive.google.com/drive/folders/18C8T33iLIa6voeHC0URsgBMwzITZQrru).
2. Open **Extensions → Apps Script**. Replace `Code.gs` with `backend/Code.gs`. Under **Project Settings**, tick *Show "appsscript.json"*, then replace that file with `backend/appsscript.json`.
3. Choose the `setup` function and click **Run**. Approve the permissions. This creates the `Draws`, `Games` and `Logos` tabs.
4. Under **Project Settings → Script properties**, add `ADMIN_PIN` and `SCORE_PIN`. The app refuses every change until they are set.
5. Click **Deploy → New deployment → Web app**, with *Execute as* **Me** and *Who has access* **Anyone**. Copy the `/exec` address.

To push later changes with `clasp` instead of pasting, set `"rootDir": "backend"` in `.clasp.json`. After changing `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the `/exec` address stays the same.

### 2. Website

1. Paste the `/exec` address into `API_URL` in `docs/js/config.js`.
2. Push this folder to a GitHub repository, for example `lascellk/ACC-Scoreboard`.
3. Under **Settings → Pages**, choose **Deploy from a branch**, `main`, `/docs`.

### 3. Google Cast

Follow `ACC_50-50/CAST_SETUP.md`. The registration fee is already paid and the Chromecast may already be a test device, so only these parts differ:

- **Name:** `ACC Scoreboard`
- **Receiver Application URL:** `https://lascellk.github.io/ACC-Scoreboard/tv.html?cast=1`
- Put the Application ID in `CAST_APP_ID` in `docs/js/config.js`.

The Cast icon is at the top of the scoring and admin pages. If casting can't start, tapping it says why.

Casting from a web page works in Chrome on Android and computers, but not on iPhones or iPads. An iPhone user can still score, and someone with Android or a computer starts the cast. Until the Cast app is registered, open `tv.html` in Chrome on a computer and use Chrome's **Cast tab**.

## Logos

**Add logo** on the admin page takes a PNG, JPEG or WebP. The browser shrinks it to 160 pixels and it is saved in the `Logos` tab. The ACC crest is always available, and a team with no logo shows its initials.

## Developing

```
npm test      # rules and backend tests
npm run dev   # http://localhost:8787, admin PIN 1234, score PIN 0000
```

`npm run dev` runs the real `Code.gs` against an in-memory fake of the Google services (`dev/gas-fake.js`). Its data is lost when it stops.

## Limits

- Apps Script is free but not instant. The first request after a quiet spell can take a few seconds.
- The two PINs keep casual visitors out. They are not strong security, and the scoreboard itself is public to anyone with the link.
- The original artwork in `Reference/` is kept out of the repository. The site uses the smaller copies in `docs/assets/`.
