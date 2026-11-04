# Turn on "Sign in with Google" (about 10 minutes, free)

Sign-in lets your family keep XP, puzzles and progress on every device (iPad, phone, computer).
It uses **Firebase**, Google's free service for apps. Nothing to install.

> Until you finish these steps the app works as before, without the sign-in button.

## 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. **Create a project** → name it `chess-detectives` → you can turn Google Analytics **off** → **Create**.

## 2. Turn on Google sign-in
1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → **Enable** → pick your email as support email → **Save**.
3. **Settings** tab → **Authorized domains** → **Add domain** → `premjiitian.github.io` → **Add**.

## 3. Create the progress database
1. Left menu: **Build → Firestore Database → Create database** → choose a location near you → **Production mode** → **Create**.
2. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules) from this repository, and press **Publish**.
   (This rule means each person can only read and write their own progress.)

## 4. Connect the app
1. Project overview (⚙️ next to "Project Overview") → **Project settings** → **Your apps** → click the **`</>`** (Web) icon.
2. Nickname `chess-detectives` → **Register app**. Firebase shows a `firebaseConfig = { ... }` block.
3. In this GitHub repository open **`public/`** → **Add file → Create new file** → name it **`firebase-config.json`** and paste:
   ```json
   {
     "apiKey": "…",
     "authDomain": "…firebaseapp.com",
     "projectId": "…",
     "appId": "…"
   }
   ```
   using the four values from Firebase (keep the quotes). **Commit changes**.
4. Wait ~1 minute for the site to rebuild. The **Sign in with Google** button now appears.

These values are *not* secret — every Firebase web app shows them to the browser. Your data is protected by
the rule from step 3.

## Kids and Google accounts
Google accounts for children under 13 are managed with **Family Link**; depending on your settings they may not be
able to sign in to third-party apps. A simple option: sign in on your child's iPad with **your** account — their
progress is then saved there.
