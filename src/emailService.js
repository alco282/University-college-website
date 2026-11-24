const nodemailer = require('nodemailer');
const env = require('./config/env');

const OTP_PURPOSE_LABELS = {
  registration: 'Registration',
  reset_password: 'Password Reset',
  login_2fa: 'Sign-in Verification'
};
const OTP_VALIDITY_MINUTES = { registration: 5, reset_password: 5, login_2fa: 10 };

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100
});

// Non-blocking connection check on boot
transporter.verify()
  .then(() => console.log('[EMAIL SERVICE]: SMTP connection verified and ready.'))
  .catch((err) => console.warn('[EMAIL SERVICE WARNING]: SMTP handshake failed. Outgoing emails may fail:', err.message));

/**
 * Escapes characters to prevent HTML/XSS injection inside email clients.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const baseEmailTemplate = ({ title, preheader, content, callToAction }) => `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F4F3EF; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.06); border: 1px solid #E5E3DC; }
    .header { background: #B31217; padding: 35px 30px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700; }
    .header p { margin: 6px 0 0 0; font-size: 13px; font-style: italic; opacity: 0.9; color: #FEE2E2; }
    .body-content { padding: 35px 30px; color: #2D3748; line-height: 1.6; font-size: 15px; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 30px; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 18px; }
    .badge-pending { background-color: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
    .badge-support { background-color: #EDE9FE; color: #5B21B6; border: 1px solid #C4B5FD; }
    .badge-success { background-color: #D1FAE5; color: #065F46; border: 1px solid #6EE7B7; }
    .info-card { background: #FAF8F5; border: 1px solid #E5E3DC; border-radius: 12px; padding: 18px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
    .info-label { color: #718096; font-weight: 600; }
    .info-value { color: #1A202C; font-weight: bold; }
    .btn { display: inline-block; padding: 14px 28px; background: #B31217; color: #ffffff !important; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-top: 15px; box-shadow: 0 4px 12px rgba(179,18,23,0.25); }
    .footer { background: #FAF8F5; border-top: 1px solid #E5E3DC; padding: 22px 30px; text-align: center; font-size: 12px; color: #A0AEC0; }
    .footer a { color: #B31217; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div style="display:none; font-size:1px; color:#333333; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden;">
    ${escapeHtml(preheader || title)}
  </div>
  <div class="container">
    <div class="header">
      <h1>UNIVERSITY RESIDENCE</h1>
      <p>Your story, our future.</p>
    </div>
    <div class="body-content">
      ${content}
      ${callToAction ? `<div style="text-align: center; margin-top: 25px;">${callToAction}</div>` : ''}
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px 0;">University Residence  &copy; ${new Date().getFullYear()}</p>
      <p style="margin: 0;">Student's Digital Portal &bull; <a href="${env.FRONTEND_URL}">Enter the Portal</a></p>
    </div>
  </div>
</body>
</html>
`;

async function sendMailSafe({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
    });
    const safeSubject = String(subject || '').replace(/\b\d{6}\b/g, '[OTP]');
    console.log(`[EMAIL SENT]: Delivered to ${to} | Subject: ${safeSubject}`);
  } catch (error) {
    console.error(`[EMAIL DISPATCH FAILURE]: Target ${to}:`, error.message);
  }
}

async function sendRegistrationPendingEmail(user) {
  const html = baseEmailTemplate({
    title: 'Registration Pending Approval',
    preheader: 'Your registration request is awaiting verification.',
    content: `
      <span class="badge badge-pending">⏳Pending approval</span>
      <h2 style="margin: 0 0 12px 0; color: #1A1A1A; font-size: 20px;">Dear ${escapeHtml(user.firstName)},</h2>
      <p>Thank you for registering at<strong>University Residence Digital Student Portal</strong>.</p>
      <p>Your account has been placed in the approval queue. It will be activated:</p>
      <ul>
        <li>From the <strong> Admins </strong> through manual verification;</li>
        <li>Or through the<strong>identity confirmation (endorsement)</strong> by 3 collegues from the section.</li>
      </ul>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Access Email:</span> <span class="info-value">${escapeHtml(user.email)}</span></div>
      </div>
      <p style="font-size: 13px; color: #718096;">You will receive an email notification as soon as your account is enabled for access.</p>
    `
  });

  await sendMailSafe({
    to: user.email,
    subject: '🎓 Registration Received - University Residence ',
    html
  });
}

async function sendOcrSupportPendingEmail(user, reason) {
  const html = baseEmailTemplate({
    title: 'Support Request Received',
    preheader: 'Your request has been received for manual verification.',
    content: `
      <span class="badge badge-support">🔍 SuperAdmin Manual Check</span>
      <h2 style="margin: 0 0 12px 0; color: #1A1A1A; font-size: 20px;">Dear ${escapeHtml(user.firstName)},</h2>
      <p>We have recorded your request to join the Students' Portal.</p>
      <p>Since the automatic scanning of the document was not successful (<em>${escapeHtml(reason || 'ICAO check')}</em>), The request has been forwarded to the SuperAdmins for a manual review.</p>
      <p>You will receive a confirmation as soon as the review is completed.</p>
    `
  });

  await sendMailSafe({
    to: user.email,
    subject: '📋 Verification Request in Progress - University Residence',
    html
  });
}

async function sendAccountApprovedEmail(user) {
  const loginUrl = `${env.FRONTEND_URL}`;
  const html = baseEmailTemplate({
    title: 'Account Successfully Activated',
    preheader: 'Your account is active! You can now access the Portal.',
    content: `
      <span class="badge badge-success">✅ Account Verified & Active</span>
      <h2 style="margin: 0 0 12px 0; color: #1A1A1A; font-size: 20px;">Dear ${escapeHtml(user.firstName)},</h2>
      <p>Your identity has been <strong>confirmed and validated</strong>.</p>
      <p>Your account is now fully active. You can log in to complete your interactive bulletin board, view the Yearbook, and connect with other residents of the College.</p>
      <div class="info-card">
        <div class="info-row"><span class="info-label">Access Email:</span> <span class="info-value">${escapeHtml(user.email)}</span></div>
      </div>
    `,
    callToAction: `<a href="${loginUrl}" class="btn">Access the Portal</a>`
  });

  await sendMailSafe({
    to: user.email,
    subject: '🎉Your account is active! - University Residence',
    html
  });
}

async function sendOtpCodeEmail(email, code, purpose = 'registration') {
  const purposeLabel = OTP_PURPOSE_LABELS[purpose] || purpose;
  const minutes = OTP_VALIDITY_MINUTES[purpose] || 5;
  const html = baseEmailTemplate({
    title: `Code of ${escapeHtml(purposeLabel)}`,
    preheader: `Your temporary security code is ${escapeHtml(code)}`,
    content: `
      <h2 style="margin: 0 0 12px 0; color: #1A1A1A; font-size: 20px;">Security Code</h2>
      <p>Use the following 6-digit code to complete the operation of <strong>${escapeHtml(purposeLabel)}</strong>:</p>
      <div style="text-align: center; margin: 25px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #B31217; background: #FAF8F5; padding: 12px 24px; border-radius: 12px; border: 2px dashed #B31217;">
          ${escapeHtml(code)}
        </span>
      </div>
      <p style="font-size: 12px; color: #718096; text-align: center;">The code is valid for ${minutes} minutes. If you did not request this operation, you can ignore this message.</p>
    `
  });

  await sendMailSafe({
    to: email,
    subject: `🔐 Code of ${purposeLabel}: ${code} - University Residence`,
    html
  });
}

module.exports = {
  sendRegistrationPendingEmail,
  sendOcrSupportPendingEmail,
  sendAccountApprovedEmail,
  sendOtpCodeEmail
};