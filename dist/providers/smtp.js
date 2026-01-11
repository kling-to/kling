import nodemailer from 'nodemailer';
export class SmtpEmailProvider {
    name = 'smtp';
    channel = 'email';
    transporter;
    fromAddress;
    fromName;
    constructor(config) {
        if (!config.host) {
            throw new Error('SMTP host is required');
        }
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port || 587,
            secure: config.secure || false,
            auth: config.username
                ? {
                    user: config.username,
                    pass: config.password,
                }
                : undefined,
        });
        this.fromAddress = config.fromAddress || 'noreply@example.com';
        this.fromName = config.fromName || 'Kling';
    }
    async send(message) {
        try {
            const from = this.fromName ? `${this.fromName} <${this.fromAddress}>` : this.fromAddress;
            const info = await this.transporter.sendMail({
                from,
                to: message.to,
                subject: message.subject || 'No Subject',
                text: message.body,
                html: message.html,
            });
            return {
                success: true,
                providerMessageId: info.messageId,
                providerResponse: {
                    accepted: info.accepted,
                    rejected: info.rejected,
                    response: info.response,
                },
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: errorMessage,
                retryable: this.isRetryableError(error),
            };
        }
    }
    isRetryableError(error) {
        if (!error || typeof error !== 'object')
            return false;
        const err = error;
        if (err.code === 'ECONNREFUSED' ||
            err.code === 'ECONNRESET' ||
            err.code === 'ETIMEDOUT' ||
            err.code === 'ESOCKET') {
            return true;
        }
        if (err.responseCode && err.responseCode >= 400 && err.responseCode < 500) {
            return true;
        }
        return false;
    }
    verifyWebhook(_payload, _signature) {
        return true;
    }
    parseWebhook(_payload) {
        return null;
    }
    async healthCheck() {
        try {
            await this.transporter.verify();
            return true;
        }
        catch {
            return false;
        }
    }
}
