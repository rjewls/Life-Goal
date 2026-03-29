# Life Advisor 🌟

Your personal guide hub + savings tracker. Runs locally in your browser.

---

## ▶️ How to Start the App

Open a terminal (PowerShell or CMD), navigate to this folder, then run these two commands:

### Step 1 — Install packages (first time only, do this once)
```
npm install
```

### Step 2 — Start the server
```
node server.js
```

### Step 3 — Open in your browser
```
http://localhost:3001
```

That's it! The app will be running at that address.

---

## 🛑 How to Stop the Server

Press **Ctrl + C** in the terminal where the server is running.

---

## 🔁 Every Time You Want to Use the App

You only need to run **Step 2** again (no need to `npm install` again):
```
node server.js
```
Then open `http://localhost:3001` in your browser.

---

## 💾 Your Data

- All your items and settings are saved automatically in `data.json` (in this folder).
- You **never lose data** when you close the browser or stop the server.
- To back up your data: go to **Settings → Save Snapshot** in the app.
- Backups are saved in the `backups/` folder with a date-and-time filename.

---

## 📁 Folder Structure (what each file does)

```
Life Goal/
├── index.html          ← The app (opens in your browser)
├── server.js           ← The local server (run this with node)
├── package.json        ← Lists the packages the app needs
├── data.json           ← Where all your data is saved
├── README.md           ← This file
├── static/
│   ├── css/style.css   ← App styling
│   └── js/app.js       ← App logic
└── backups/            ← Timestamped data backups (created by app)
```

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Install Node.js from https://nodejs.org (LTS version) |
| `Cannot find module 'express'` | Run `npm install` first |
| Page won't load | Make sure `node server.js` is running in the terminal |
| Port already in use | Another app is using the default port. Try stopping the conflicting process, or run the server on a different port (examples below). |

---

## 🔧 Optional: Change the Port

The server now defaults to port `3001`. If you need to change it, set the `PORT` environment variable before running.

**PowerShell (example using port 3002):**
```powershell
$env:PORT=3002; node server.js
```
**CMD (example using port 3002):**
```cmd
set PORT=3002 && node server.js
```
Then open `http://localhost:3002` in your browser.


