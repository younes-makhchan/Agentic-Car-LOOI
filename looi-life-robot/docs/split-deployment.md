# Split Deployment

LOOI is deployed as two roles:

- Frontend: Netlify serves `frontend/`.
- Backend: EC2 runs `backend/server.js` for API and Gemini Live relay only.

## Frontend

Deploy the repo to Netlify with `netlify.toml`.

Set `frontend/runtime-config.js`:

```js
window.LOOI_RUNTIME_CONFIG = {
  backendBaseUrl: "https://api.looi.app"
};
```

The frontend serves:

- `index.html`
- browser JavaScript/CSS
- firmware files
- ESP Web Tools

The frontend still handles:

- camera/mic capture
- audio playback
- Web Bluetooth body control
- firmware upload over Web Serial
- browser-local tool execution

## Backend

Run `backend/server.js` on EC2.

Recommended backend environment:

```bash
PORT=3000
SERVE_FRONTEND=false
PUBLIC_BACKEND_BASE_URL=https://api.looi.app
GEMINI_LIVE_ENABLED=true
GEMINI_LIVE_ALLOW_PUBLIC_RELAY=true
GEMINI_API_KEY=...
```

The backend serves:

- `/api/config`
- `/api/gemini-live/session`
- `/api/gemini-live/relay`
- local brain endpoints if enabled

The backend does not handle:

- Bluetooth body control
- firmware upload
- frontend static asset traffic

## Caddy Reverse Proxy

Example `Caddyfile`:

```caddyfile
api.looi.app {
  reverse_proxy localhost:3000
}
```

Run Node with PM2 or systemd, and keep EC2 security group inbound rules limited to SSH from your IP plus HTTP/HTTPS.
