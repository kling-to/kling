/**
 * Email Service Utility
 *
 * Provides helper functions for sending transactional emails
 * (invitations, password resets, etc.) using the message provider system.
 */
import { getProviderForChannel } from '../providers';
// Base URL for email links (configurable via env)
const getBaseUrl = () => process.env.APP_BASE_URL || 'http://localhost:3000';
/**
 * Send an invitation email to a new team member.
 */
export async function sendInvitationEmail(params) {
    const { email, token, tenantName, inviterName, role } = params;
    const baseUrl = getBaseUrl();
    const inviteUrl = `${baseUrl}/invite/accept?token=${token}`;
    const subject = inviterName
        ? `${inviterName} invited you to join ${tenantName}`
        : `You've been invited to join ${tenantName}`;
    const body = `
You've been invited to join ${tenantName} as a ${role}.

Click the link below to accept the invitation:
${inviteUrl}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.
  `.trim();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">You're invited!</h2>
  <p>You've been invited to join <strong>${tenantName}</strong> as a <strong>${role}</strong>.</p>
  <p style="margin: 30px 0;">
    <a href="${inviteUrl}" style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">
      Accept Invitation
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">This invitation will expire in 7 days.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">
    If you didn't expect this invitation, you can safely ignore this email.<br>
    Link not working? Copy and paste this URL: ${inviteUrl}
  </p>
</body>
</html>
  `.trim();
    const message = {
        to: email,
        subject,
        body,
        html,
        metadata: {
            type: 'invitation',
            tenantName,
            role,
        },
    };
    try {
        const provider = getProviderForChannel('email');
        const result = await provider.send(message);
        if (result.success) {
            console.log(`[Email] Invitation sent to ${email} via ${provider.name}`);
            return { success: true };
        }
        else {
            console.error(`[Email] Failed to send invitation to ${email}:`, result.error);
            return { success: false, error: result.error };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Email] Error sending invitation to ${email}:`, errorMessage);
        return { success: false, error: errorMessage };
    }
}
/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail(params) {
    const { email, token, userName } = params;
    const baseUrl = getBaseUrl();
    const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;
    const greeting = userName ? `Hi ${userName},` : 'Hi,';
    const body = `
${greeting}

We received a request to reset your password. Click the link below to set a new password:

${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.
  `.trim();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Reset Your Password</h2>
  <p>${greeting}</p>
  <p>We received a request to reset your password. Click the button below to set a new password:</p>
  <p style="margin: 30px 0;">
    <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">
      Reset Password
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">This link will expire in 1 hour.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">
    If you didn't request a password reset, you can safely ignore this email.<br>
    Link not working? Copy and paste this URL: ${resetUrl}
  </p>
</body>
</html>
  `.trim();
    const message = {
        to: email,
        subject: 'Reset Your Password',
        body,
        html,
        metadata: {
            type: 'password_reset',
        },
    };
    try {
        const provider = getProviderForChannel('email');
        const result = await provider.send(message);
        if (result.success) {
            console.log(`[Email] Password reset sent to ${email} via ${provider.name}`);
            return { success: true };
        }
        else {
            console.error(`[Email] Failed to send password reset to ${email}:`, result.error);
            return { success: false, error: result.error };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Email] Error sending password reset to ${email}:`, errorMessage);
        return { success: false, error: errorMessage };
    }
}
/**
 * Send a welcome email to a new user after registration.
 */
export async function sendWelcomeEmail(params) {
    const { email, userName, tenantName } = params;
    const baseUrl = getBaseUrl();
    const body = `
Welcome to ${tenantName}, ${userName}!

Your account has been created successfully. You can now log in and start using the platform.

Log in here: ${baseUrl}/auth/login

If you have any questions, feel free to reach out to our support team.
  `.trim();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Welcome to ${tenantName}!</h2>
  <p>Hi ${userName},</p>
  <p>Your account has been created successfully. You can now log in and start using the platform.</p>
  <p style="margin: 30px 0;">
    <a href="${baseUrl}/auth/login" style="display: inline-block; background-color: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">
      Log In
    </a>
  </p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">
    If you have any questions, feel free to reach out to our support team.
  </p>
</body>
</html>
  `.trim();
    const message = {
        to: email,
        subject: `Welcome to ${tenantName}!`,
        body,
        html,
        metadata: {
            type: 'welcome',
            tenantName,
        },
    };
    try {
        const provider = getProviderForChannel('email');
        const result = await provider.send(message);
        if (result.success) {
            console.log(`[Email] Welcome email sent to ${email} via ${provider.name}`);
            return { success: true };
        }
        else {
            console.error(`[Email] Failed to send welcome email to ${email}:`, result.error);
            return { success: false, error: result.error };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Email] Error sending welcome email to ${email}:`, errorMessage);
        return { success: false, error: errorMessage };
    }
}
