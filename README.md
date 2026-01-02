# Kling - Self-Hosted Marketing Automation

**Version 1.0.20** | [kling.to](https://kling.to)

## About

[Kling](https://kling.to) is a self-hosted Klaviyo alternative that cuts e-commerce marketing costs by 70-90%. Create automated email and SMS campaigns using natural language prompts, segment customers with 30+ behavioral filters, and keep full control of your data.

## Quick Start (Docker)

```bash
docker run -d \
  --name kling \
  -p 3001:3001 \
  -v kling-data:/data \
  -e JWT_SECRET="$(openssl rand -base64 32)" \
  -e ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --restart unless-stopped \
  ghcr.io/kling-to/kling:latest
```

Open `http://your-server-ip:3001` and create your admin account.

## Manual Installation

```bash
git clone https://github.com/kling-to/kling.git
cd kling
git checkout v1.0.20
npm install --omit=dev
cp .env.example .env
# Edit .env with your settings
npx prisma generate
npx prisma migrate deploy
node --import tsx dist/index.js
```

See [INSTALLATION.md](./INSTALLATION.md) for detailed setup instructions.

## Updating

```bash
git fetch --tags
git checkout v1.0.20
npm install --omit=dev
npx prisma generate
npx prisma migrate deploy
```

## One-Click Install

Prefer managed hosting? [kling.to/installations/new](https://kling.to/installations/new)

## Support

- Website: [kling.to](https://kling.to)
- Documentation: [kling.to/docs](https://kling.to/docs)
- Issues: [github.com/kling-to/kling/issues](https://github.com/kling-to/kling/issues)

## License

See [LICENSE](./LICENSE) for details.
