const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(5000),
  
  // Database & Cache
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  
  // Security Secrets
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters long'),
  JWT_ISSUER: z.string().min(1).default('e-api'),
  JWT_AUDIENCE: z.string().min(1).default('e-web'),
  PASSWORD_PEPPER: z.string().min(32, 'PASSWORD_PEPPER must be at least 32 characters long'),
  OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be at least 32 characters long').optional(),
  
  // Network & Domains
  FRONTEND_URL: z.string().url(),
  FRONTEND_DOMAIN: z.string().min(1),
  
  // Provisioning
  FOUNDER_EMAIL: z.string().email(),
  SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  SERVICE_ACCOUNT_PASSWORD: z.string().min(8).optional(),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  
  // SMTP Transport
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  
  // Third-party API keys
  CARTO_API_KEY: z.string().optional(),
  // Public Turnstile sitekey. It is safe to expose to the browser.
  TURNSTILE_SITE_KEY: z.string().min(10).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(10).optional(),
  // Explicit opt-in for Cloudflare's official dummy/test credentials.
  // Test credentials are not bot protection and must never be enabled for a
  // real production deployment.
  TURNSTILE_TEST_MODE: z.coerce.boolean().default(false),
  TURNSTILE_ALLOWED_HOSTNAMES: z.string().optional()
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('CRITICAL: Environment variable validation failed:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

module.exports = parsedEnv.data;