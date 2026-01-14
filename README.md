# Kling - Self-Hosted Marketing Automation

**Version 1.0.23** | [kling.to](https://kling.to)

## About

[Kling](https://kling.to) is a self-hosted Klaviyo alternative that cuts e-commerce marketing costs by 70-90%. Create automated email and SMS campaigns using natural language prompts, segment customers with 30+ behavioral filters, and keep full control of your data.

## Quick Start

See [INSTALLATION.md](./INSTALLATION.md) for Docker and manual installation instructions.

## Updating

### Docker Compose

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

### Manual Installation

```bash
git fetch --tags
git checkout v1.0.23
npm install --omit=dev
npx prisma generate
```

## One-Click Install

Prefer managed hosting? [kling.to/installations/new](https://kling.to/installations/new)

## Support

- Website: [kling.to](https://kling.to)
- Documentation: [kling.to/docs](https://kling.to/docs)
- Issues: [github.com/kling-to/kling/issues](https://github.com/kling-to/kling/issues)

## License

See [LICENSE](./LICENSE) for details.
