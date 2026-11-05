# Chess Detectives on the App Store (iPhone + iPad)

The iOS app is ready in this repository (`ios/`). It is the same app as the
website, with everything inside the app, so it also works offline. GitHub builds and tests it on a Mac in the cloud
on every change (Actions → **iOS app**), so **you don't need a Mac**.

What only you can do (Apple needs the account owner):

## 0. Your choices (5 Nov 2026)
- Apple Developer account: **Individual, already enrolled** → skip step 1, just look up your Team ID.
- Progress in the app: **stays on the device** (no sign-in in the app for now).
- Store screenshots and reviewer: a **kid-friendly demo chess.com account**. When you have it:
  GitHub → Settings → Secrets and variables → Actions → **Variables** → New variable
  `DEMO_CHESS_USER` = the username. The next "iOS app" run makes the screenshots with it,
  and put the same name in `docs/app-store.md` (reviewer notes).
- Privacy contact: prem.jiitian@gmail.com.

## 1. Join the Apple Developer Program (once, 99 USD / year)
1. Go to <https://developer.apple.com/programs/enroll/> and sign in with your Apple ID.
2. Enrol as an **Individual** (your name is shown as the seller) or an **Organization**
   (needs a D-U-N-S number; shows your company name). Approval takes from a few hours to 2 days.
3. Find your **Team ID**: <https://developer.apple.com/account> → **Membership details** → Team ID (10 characters).

## 2. Create the app in App Store Connect
1. <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platform **iOS** · Name **Chess Detectives** (if it is taken, try e.g. "Chess Detectives Coach")
   · Primary language **English** · Bundle ID: choose **com.chessdetectives.app**
   (if it is not in the list: <https://developer.apple.com/account/resources/identifiers> → **+** → App IDs → App →
   Bundle ID *explicit* `com.chessdetectives.app` → Continue → Register; then try again)
   · SKU: `chess-detectives-1` · **Create**.

## 3. Create an API key so GitHub can upload builds
1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys** → **+**.
2. Name `GitHub upload`, Access **Admin** (needed so it can create the signing certificate) → **Generate**.
3. Note the **Issuer ID** (top of the page) and the **Key ID**. **Download** the `.p8` file (only possible once).

## 4. Give the key to GitHub (never paste it in a chat)
On your computer, turn the key into one line of text:
- Mac: `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy` (copies it)
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard`

Then GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**, four times:

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | your Team ID (step 1) |
| `ASC_KEY_ID` | the Key ID (step 3) |
| `ASC_ISSUER_ID` | the Issuer ID (step 3) |
| `ASC_KEY_P8_BASE64` | the line you copied |

## 5. Upload a build to TestFlight
GitHub → **Actions** → **iOS release (TestFlight)** → **Run workflow** → version `1.0` → **Run**.
About 15 minutes later the build appears in App Store Connect → your app → **TestFlight**.
Add yourself (and your kids' devices) as **internal testers** and install the **TestFlight** app on the iPad to try it.

## 6. Submit for review
In App Store Connect → your app → **App Store** tab, fill in (texts are ready in [`docs/app-store.md`](docs/app-store.md)):
- Screenshots (iPhone 6.9" and iPad 13"): the **iOS app** workflow makes real ones from the simulators
  (Actions → latest run → *ios-simulator-screens*).
- Description, keywords, support URL, **privacy policy URL**:
  `https://premjiitian.github.io/Chessdetectives/privacy.html`
- **App Privacy**: choose **"Data Not Collected"**.
- **Age rating** questionnaire: answer *None* everywhere → 4+.
- Pick the build from TestFlight → **Add for Review** → **Submit**. Review usually takes 1–2 days.

## Working on the app on a Mac (optional)
```bash
npm ci
npm run ios:sync     # builds the web app and copies it into ios/
npm run ios:open     # opens Xcode; pick a simulator or your iPad and press ▶
```
