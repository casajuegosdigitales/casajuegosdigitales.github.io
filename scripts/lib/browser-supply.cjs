"use strict";

let browserPromise = null;
let browserDisabled = null;

function browserAllowed() {
  if (process.env.DISABLE_BROWSER_SUPPLY === "1") return false;
  return true;
}

function launchOptions() {
  const opts = {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  };
  if (!process.env.GITHUB_ACTIONS && process.env.PLAYWRIGHT_CHANNEL !== "none") {
    opts.channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  }
  return opts;
}

async function getBrowser() {
  if (!browserAllowed()) return null;
  if (browserDisabled) return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = require("playwright");
        return chromium.launch(launchOptions());
      } catch (err) {
        browserDisabled = err.message;
        browserPromise = null;
        return null;
      }
    })();
  }
  return browserPromise;
}

let browserQueue = Promise.resolve();

async function runWithPage(fn, options = {}) {
  const browser = await getBrowser();
  if (!browser) return null;
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 768 },
    ...(options.context || {}),
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  if (options.initScript) {
    await context.addInitScript(options.initScript);
  }
  if (options.cookies?.length) {
    await context.addCookies(options.cookies);
  }
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function withPage(fn, options) {
  const job = browserQueue.then(() => runWithPage(fn, options));
  browserQueue = job.catch(() => {});
  return job;
}

async function waitCloudflare(page, maxSec) {
  const limit = maxSec || 25;
  for (let i = 0; i < limit; i++) {
    const title = await page.title();
    if (!/moment|just a moment|un momento|cloudflare/i.test(title)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch (_) {}
  browserPromise = null;
}

module.exports = { withPage, waitCloudflare, closeBrowser, browserAllowed };