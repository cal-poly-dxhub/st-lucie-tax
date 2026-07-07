/**
 * Test credentials loader.
 * Loads credentials from environment variables for security.
 * NEVER commit actual credentials to version control.
 */

import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.test if it exists (for local development)
const envTestPath = resolve(__dirname, ".env.test");
if (existsSync(envTestPath)) {
  config({ path: envTestPath });
}

/**
 * Get office operations test credentials from environment.
 * Throws if credentials are not configured.
 */
export function getOfficeCredentials() {
  const email = process.env.TEST_OFFICE_EMAIL;
  const password = process.env.TEST_OFFICE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Office test credentials not configured. Set TEST_OFFICE_EMAIL and TEST_OFFICE_PASSWORD environment variables, " +
      "or create tests/.env.test file from tests/.env.test.example"
    );
  }

  return { email, password };
}

/**
 * Get chatbot test credentials from environment.
 * Throws if credentials are not configured.
 */
export function getChatbotCredentials() {
  const email = process.env.TEST_CHATBOT_EMAIL;
  const password = process.env.TEST_CHATBOT_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Chatbot test credentials not configured. Set TEST_CHATBOT_EMAIL and TEST_CHATBOT_PASSWORD environment variables, " +
      "or create tests/.env.test file from tests/.env.test.example"
    );
  }

  return { email, password };
}

/**
 * Get CloudFront URL from environment.
 * Throws if not configured.
 */
export function getCloudFrontUrl() {
  const url = process.env.CLOUDFRONT_URL;

  if (!url) {
    throw new Error(
      "CloudFront URL not configured. Set CLOUDFRONT_URL environment variable, " +
      "or create tests/.env.test file from tests/.env.test.example"
    );
  }

  return url;
}

/**
 * Get Chatbot CloudFront URL from environment.
 * Throws if not configured.
 */
export function getChatbotUrl() {
  const url = process.env.CLOUDFRONT_CHAT_URL;

  if (!url) {
    throw new Error(
      "Chatbot CloudFront URL not configured. Set CLOUDFRONT_CHAT_URL environment variable, " +
      "or create tests/.env.test file from tests/.env.test.example"
    );
  }

  return url;
}

/**
 * Get screenshot directory from environment or return default.
 */
export function getScreenshotDir() {
  return process.env.SCREENSHOT_DIR || resolve(__dirname, "screenshots", "e2e");
}
