# Kaltura Avatar SDK Demo

An interactive web demo for the [Kaltura Live Avatar SDK](https://docs.kaltura.com/models/avatar/docs/) that lets you control an AI avatar with typed text or your own recorded voice.

## Features

- **Avatar display** — full-width 16:9 video frame powered by WebRTC
- **Text to speech** — type any text and have the avatar say it (Ctrl+Enter shortcut)
- **Voice recording** — record audio, preview it, re-record, or send it to the avatar for lip-sync
- **Interrupt** — stop the avatar mid-speech
- **Settings** — paste your KS, Avatar ID, and Voice ID via the settings panel; stored locally in the browser

## Getting Started

### Prerequisites

- Node.js 20+
- A Kaltura Session (KS), Avatar ID, and optionally a Voice ID from your Kaltura account

### Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **Settings ⚙️**, and paste your credentials.

### Build for production

```bash
npm run build
npm run preview
```

## Tech Stack

| Package | Purpose |
|---|---|
| [`@unisphere/models-sdk-js`](https://www.npmjs.com/package/@unisphere/models-sdk-js) | Kaltura Avatar SDK (WebRTC, session management) |
| [`lamejs`](https://github.com/zhuker/lamejs) | In-browser MP3 encoding for voice recordings |
| [Vite](https://vitejs.dev) | Dev server & bundler |

## Security Note

Your KS is stored in `localStorage` for convenience. **For production deployments, keep the KS server-side only** — create sessions from your backend and pass only the session token to the frontend.
