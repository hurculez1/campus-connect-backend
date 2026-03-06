const logger = require('../utils/logger');

// Email is optional — only works when SMTP credentials are configured
const hasEmailConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

let transporter = null;

if (hasEmailConfig) {
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } catch (e) {
    logger.warn('Nodemailer init failed — emails disabled:', e.message);
  }
}

exports.sendVerificationEmail = async (email, token, firstName) => {
  if (!transporter) {
    logger.info(`[Email skipped — no SMTP config] Verification token for ${email}: ${token}`);
    return;
  }
  try {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
    await transporter.sendMail({
      from: '"Campus Connect Uganda" <noreply@campusconnect.ug>',
      to: email,
      subject: 'Verify Your Student Email - Campus Connect Uganda',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f43f5e;">Welcome to Campus Connect Uganda! ❤️</h2>
          <p>Hi ${firstName},</p>
          <p>Please verify your student email by clicking the button below:</p>
          <a href="${verificationUrl}"
             style="display: inline-block; background: linear-gradient(135deg,#f43f5e,#f59e0b);
                    color: white; padding: 12px 24px; text-decoration: none;
                    border-radius: 8px; margin: 16px 0; font-weight: bold;">
            Verify Email ✓
          </a>
          <p>Or copy: ${verificationUrl}</p>
          <p>This link expires in 24 hours.</p>
          <p>Connecting hearts on campus,<br>The Campus Connect Team 🇺🇬</p>
        </div>
      `,
    });
    logger.info(`Verification email sent to ${email}`);
  } catch (error) {
    logger.error('Email send error:', error.message);
    // Don't throw — registration should still succeed even if email fails
  }
};

exports.sendPasswordReset = async (email, token, firstName) => {
  if (!transporter) {
    logger.info(`[Email skipped] Password reset token for ${email}: ${token}`);
    return;
  }
  try {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    await transporter.sendMail({
      from: '"Campus Connect Uganda" <noreply@campusconnect.ug>',
      to: email,
      subject: 'Password Reset - Campus Connect Uganda',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #f43f5e;">Password Reset</h2>
          <p>Hi ${firstName},</p>
          <p>Click below to reset your password:</p>
          <a href="${resetUrl}"
             style="display: inline-block; background: #f43f5e; color: white;
                    padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 16px 0;">
            Reset Password
          </a>
          <p>This link expires in 1 hour.</p>
        </div>
      `,
    });
  } catch (error) {
    logger.error('Password reset email error:', error.message);
  }
};