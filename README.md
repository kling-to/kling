# Kling - Self-Hosted Marketing Automation

**Version 1.0.1**

Kling is a self-hosted Klaviyo alternative for e-commerce marketing automation.

## Quick Start

### Docker (Recommended)

```bash
docker pull ghcr.io/mukama/kling:1.0.1
docker run -d -p 3001:3001 ghcr.io/mukama/kling:1.0.1
```

### Manual Installation

```bash
git clone https://github.com/mukama/kling-releases.git
cd kling-releases
git checkout v1.0.1
npm install
cp .env.example .env
# Edit .env with your settings
npm run prisma:generate
npm run migrate
npm start
```

## Updating

Updates can be managed through the Admin UI at `/admin/updates` or manually:

```bash
git fetch --tags
git checkout v1.0.1
npm install
npm run prisma:generate
npm run migrate
npm start
```

## Documentation

- [Installation Guide](https://github.com/mukama/kling/blob/main/docs/INSTALLATION.md)
- [Update Guide](https://github.com/mukama/kling/blob/main/docs/UPDATE_GUIDE.md)

## Support

For issues and feature requests: https://github.com/mukama/kling/issues

## License

See [LICENSE](./LICENSE) for details.
