# Kling - Self-Hosted Marketing Automation

**Version 1.0.7** | [kling.to](https://kling.to)

## About

[Kling](https://kling.to) is a self-hosted Klaviyo alternative that cuts e-commerce marketing costs by 70-90%. Create automated email and SMS campaigns using natural language prompts, segment customers with 30+ behavioral filters, and keep full control of your data.

**Key Features:**
- Natural language campaign creation ("Send an email to customers who haven't purchased in 30 days")
- Visual automation flow builder for abandoned cart, welcome series, post-purchase sequences
- Smart customer segmentation (churn risk, lifetime value, purchase history)
- Multi-channel delivery (email + SMS) with automatic fallback
- E-commerce integrations (Shopify, WooCommerce, BigCommerce, Wix, Magento, Square)
- GDPR-compliant data export and deletion
- Klaviyo migration tools

## Installation

```bash
git clone https://github.com/kling-to/kling.git
cd kling-releases
git checkout v1.0.7
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
git checkout v1.0.7
npm install
npm run prisma:generate
npm run migrate
npm start
```

## Support

- Website: [kling.to](https://kling.to)
- Documentation: [kling.to/docs](https://kling.to/docs)
- Issues: [github.com/kling-to/kling/issues](https://github.com/kling-to/kling/issues)

## License

See [LICENSE](./LICENSE) for details.
