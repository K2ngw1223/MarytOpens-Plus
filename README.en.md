# MarytOpens

[中文](README.md) | [English](README.en.md)

A community platform that runs on Cloudflare Workers. Use it as a personal blog, a forum,
or a place to run channels and groups.

The frontend is plain HTML/CSS/JS with no build step and no public CDN. The backend is a
single Worker file. Data lives in KV, D1 and R2.

```
https://your-site.com      → Cloudflare Pages (static frontend in pages/)
https://api.your-site.com  → Worker (worker/src/index.js)
```

## What it does

**Accounts**

Sign-up and login support email codes, Cloudflare Turnstile, and GitHub / Discord OAuth.
Passwords are hashed with SHA-256 in the browser, then derived again with PBKDF2 on the
server. The plaintext never leaves the browser.

**Permissions**

The Discord model: scopes, permission bits, roles and members. Super admin, channel owner,
group owner, moderator and member each get their own boundary. This part has a fair amount
of logic, documented separately in [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

**Content**

Markdown posts with visibility controls (public, members-only, private, specific role, draft).
Comments, likes, favorites, follows, direct messages, notifications and reports.
Direct messages use PawCrypt for end-to-end encryption. Keys stay with the user, the server
only holds ciphertext, and messages can be set to burn after reading.

**Moderation**

IP bans, mutes, forced username changes, site settings, outbound mail. Access logs and
stats are built in.

**User file storage**

Signed-in users can bind their own Cloudflare account, and the system creates KV and D1
resources there to hold their files. Sharing works through links, preview codes, or public
download. Users who haven't bound an account get browser-local storage with a warning that
files may be lost.

**Interface**

Nine languages, detected from the browser on first visit with a confirmation prompt.
Light and dark themes follow the system or can be set manually. All static assets are
self-hosted.

## Layout

```
MarytOpens/
├── site.config.json          central config, edit this
├── deploy-info.json          deploy record, generated
├── worker/
│   ├── src/index.js          backend, single file
│   ├── wrangler.toml         bindings and deploy config
│   ├── .dev.vars.example     local secret template
│   ├── scripts/              deploy and backup scripts
│   └── package.json
├── pages/                    frontend, 44 HTML pages
│   └── assets/{css,img,js}
├── tools/
│   ├── configure.mjs         config applier, run before deploying
│   ├── check-inline.js       inline script syntax check
│   ├── check-app-helpers.js  check for bare App member calls
│   └── i18n-*.py             translation extraction and merge
└── docs/
    ├── DEPLOY.md             deployment and troubleshooting
    ├── DEPLOY_REGISTRY.md    optional deploy registry
    ├── PERMISSIONS.md        permission system
    └── KV_SCHEMA.md          storage layout
```

## Deploying

### 1. Fill in the config

No domain is hardcoded. Everything comes from `site.config.json`:

```json
{
  "siteName": "MarytOpens",
  "siteOrigin": "https://your-site.com",
  "apiOrigin": "https://api.your-site.com",
  "supportEmail": "admin@your-site.com",
  "repoUrl": "https://github.com/you/marytopens"
}
```

Then run:

```bash
node tools/configure.mjs
```

This writes those values into the frontend pages, `worker/wrangler.toml` and the docs, and
generates `deploy-info.json`. It's safe to run repeatedly. Use
`node tools/configure.mjs --check` to find any placeholders you missed; it exits non-zero,
so it works in CI.

### 2. Create the Cloudflare resources

```bash
cd worker
npx wrangler kv namespace create DB
npx wrangler kv namespace create DB --preview
npx wrangler d1 create marytopens
npx wrangler r2 bucket create marytopens-media    # optional
```

Put the returned IDs into `worker/wrangler.toml`. The D1 tables have to be created by hand,
the Worker won't do it. Statements are in [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md).

### 3. Add secrets

```bash
cp .dev.vars.example .dev.vars          # for local dev
npx wrangler secret put JWT_SECRET
npx wrangler secret put SUPER_ADMIN_PASSWORD
```

Add the rest (Turnstile, OAuth, mail, encryption keys) as needed. The full list is in
`worker/.dev.vars.example`.

### 4. Deploy

```bash
cd worker
npx wrangler deploy                                            # backend
npx wrangler pages deploy ../pages --project-name marytopens   # frontend
```

If the machine runs a TUN-mode proxy, Node often can't reach `api.cloudflare.com` (DNS
returns a fake IP and the TLS handshake gets reset), so wrangler fails while curl works.
On those machines, deploy over the REST API instead:

```bash
CLOUDFLARE_API_TOKEN=xxx CF_ACCOUNT_ID=xxx npm run deploy:api:all
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for everything else.

## Storage

| Binding | Purpose |
| --- | --- |
| `DB1` (D1) | Primary store. A KV compatibility layer routes `env.DB` reads and writes here |
| `DB` (KV) | Binary fallback for `file:` keys. Also holds files when R2 isn't bound |
| `MEDIA` (R2, optional) | Avatars, banners, images. Key format `${kind}/${uid}/${fileId}.${ext}` |

Key naming rules are in [docs/KV_SCHEMA.md](docs/KV_SCHEMA.md).

## Development

```bash
node tools/check-inline.js pages        # inline script syntax
node tools/check-app-helpers.js pages   # bare calls to App members
node tools/configure.mjs --check        # config completeness
node --check worker/src/index.js        # backend syntax

cd worker && npx wrangler dev --local   # local backend
```

Run the first two after touching the frontend. Inline script errors usually only show up in
the browser console; in production they look like "the button does nothing", which is easy
to miss.

## Support

This is a personal open-source project provided as-is. There is no technical support.

To be specific: no deployment help, no server management, no guaranteed response time on
issues, and no custom development. If you get stuck, check [docs/DEPLOY.md](docs/DEPLOY.md)
and existing issues first — someone has probably hit the same thing.

Bug reports and feature suggestions are welcome as issues, but whether and when they get
picked up depends on the maintainer's time.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, don't open a public issue —
use the channel described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Check that your use complies with local law and Cloudflare's terms of service.
