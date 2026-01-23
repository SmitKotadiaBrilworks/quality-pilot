import {
  chromium,
  firefox,
  webkit,
  Browser,
  Page,
  BrowserContext,
} from "playwright";
import {
  generateTestSteps,
  injectCredentials,
  StructuredStep,
} from "../ai/geminiAgent";
import { TestPrompt, TestStep, WSMessageType } from "@quality-pilot/shared";
import { inspectPage } from "./pageInspector.js";

type ExecutionCallback = (message: {
  type: WSMessageType;
  data: unknown;
}) => void;

// Store active test executions for cancellation
const activeExecutions = new Map<
  string,
  {
    browser: Browser | null;
    context: BrowserContext | null;
    page: Page | null;
    cancelled: boolean;
  }
>();

// Browser session manager - keeps browser alive between tests
interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
  lastUsed: number;
  url: string;
}

const activeSessions = new Map<string, BrowserSession>();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Get or create a browser session
 */
async function getOrCreateSession(
  sessionId: string,
  url: string,
  browserType: "chromium" | "firefox" | "webkit",
  headless: boolean
): Promise<BrowserSession> {
  // Check if we have an existing session
  const existing = activeSessions.get(sessionId);
  if (existing) {
    console.log(`♻️  Reusing existing browser session: ${sessionId}`);
    existing.lastUsed = Date.now();

    // Navigate to URL if different
    if (existing.url !== url) {
      await existing.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      existing.url = url;
    }

    return existing;
  }

  // Create new session
  console.log(`🌐 Creating new browser session: ${sessionId}`);
  const browserEngine = getBrowserEngine(browserType);
  const browser = await browserEngine.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const session: BrowserSession = {
    browser,
    context,
    page,
    sessionId,
    lastUsed: Date.now(),
    url,
  };

  activeSessions.set(sessionId, session);
  return session;
}

/**
 * Close a specific browser session
 */
export async function closeBrowserSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (session) {
    console.log(`🔒 Closing browser session: ${sessionId}`);
    await session.page.close().catch(() => {});
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    activeSessions.delete(sessionId);
  }
}

/**
 * Close all browser sessions
 */
export async function closeAllBrowserSessions(): Promise<void> {
  console.log(
    `🔒 Closing all browser sessions (${activeSessions.size} active)`
  );
  for (const [sessionId, session] of activeSessions.entries()) {
    await session.page.close().catch(() => {});
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    activeSessions.delete(sessionId);
  }
}

/**
 * Clean up old sessions (run periodically)
 */
setInterval(async () => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastUsed > SESSION_TIMEOUT) {
      console.log(`⏰ Session timeout, closing: ${sessionId}`);
      await closeBrowserSession(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Cancel a running test execution
 */
export function cancelTestExecution(testId: string): void {
  const execution = activeExecutions.get(testId);
  if (execution) {
    execution.cancelled = true;
    console.log(`🛑 Cancellation requested for test ${testId}`);
  }
}

/**
 * Main test execution function
 */
export async function executeTest(
  testId: string,
  testPrompt: TestPrompt,
  callback: ExecutionCallback
): Promise<void> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let usingSession = false;

  // Register this execution for cancellation
  activeExecutions.set(testId, {
    browser: null,
    context: null,
    page: null,
    cancelled: false,
  });

  try {
    // Step 1: Get or create browser session (keeps session alive between tests)
    const browserType = testPrompt.options?.browser || "chromium";
    const headless = testPrompt.options?.headless !== false;
    const keepSessionAlive = testPrompt.options?.keepSessionAlive !== false; // Default: true

    // Use URL as session ID (so all tests on same domain share session)
    const sessionId = new URL(testPrompt.url).origin;

    // Check if cancelled before starting browser
    const execution = activeExecutions.get(testId);
    if (execution?.cancelled) {
      throw new Error("Test execution was cancelled");
    }

    if (keepSessionAlive) {
      // Reuse or create session
      callback({
        type: "log",
        data: { message: `♻️  Getting browser session for ${sessionId}...` },
      });

      const session = await getOrCreateSession(
        sessionId,
        testPrompt.url,
        browserType,
        headless
      );

      browser = session.browser;
      context = session.context;
      page = session.page;
      usingSession = true;

      callback({
        type: "log",
        data: { message: `✅ Browser session ready (cookies/login preserved)` },
      });
    } else {
      // Fresh browser for this test only
      callback({
        type: "log",
        data: { message: `🌐 Launching fresh ${browserType} browser...` },
      });

      const browserEngine = getBrowserEngine(browserType);
      browser = await browserEngine.launch({
        headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      context = await browser.newContext({
        viewport: testPrompt.options?.viewport || { width: 1280, height: 720 },
      });

      page = await context.newPage();
      page.setDefaultTimeout(15000);
    }

    // Update execution record
    if (execution) {
      execution.browser = browser;
      execution.context = context;
      execution.page = page;
    }

    // Step 2: Initial navigation and page inspection
    callback({
      type: "log",
      data: { message: `🚀 Navigating to ${testPrompt.url}...` },
    });

    await page.goto(testPrompt.url, {
      waitUntil: "domcontentloaded", // Faster than networkidle
      timeout: 30000,
    });
    // Wait for page to be interactive (faster than fixed timeout)
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500); // Minimal wait for JS initialization

    callback({
      type: "log",
      data: { message: "🔍 Inspecting page elements..." },
    });

    const pageData = await inspectPage(page);
    const pageElements = {
      buttons: pageData.buttons.map((b) => b.text),
      links: pageData.links.map((l) => l.text),
      inputs: pageData.inputs.map(
        (i) => i.label || i.placeholder || i.type || i.id || "input"
      ),
      context: pageData.pageContext, // Include full page context for AI
    };

    // Step 3: Generate test steps from AI WITH page elements knowledge
    callback({
      type: "log",
      data: { message: "🤖 Generating optimized test steps from AI..." },
    });

    let steps = await generateTestSteps(
      testPrompt.prompt,
      testPrompt.url,
      pageElements
    );

    // Inject credentials into steps
    steps = injectCredentials(steps, testPrompt.credentials);

    callback({
      type: "log",
      data: {
        message: `✅ Generated ${steps.length} test steps based on page analysis`,
        steps: steps.map((s: any, i: any) => ({
          ...s,
          id: `step_${i}`,
          status: "pending",
        })),
      },
    });

    // Step 4: Execute each step
    // Track context for scoped clicking (e.g., which ebook card we're in)
    let currentContext: string | null = null;

    for (let i = 0; i < steps.length; i++) {
      // Check for cancellation before each step
      const execution = activeExecutions.get(testId);
      if (execution?.cancelled) {
        callback({
          type: "log",
          data: { message: "🛑 Test execution cancelled by user" },
        });
        throw new Error("Test execution was cancelled");
      }

      const stepDef = steps[i];
      const stepId = `step_${i}`;

      const testStep: TestStep = {
        id: stepId,
        action: stepDef.action,
        target: stepDef.target,
        value: stepDef.value,
        assertion: stepDef.assertion,
        timestamp: Date.now(),
        status: "running",
      };

      // Update context if this step mentions a specific item (e.g., ebook title)
      if (
        stepDef.description &&
        (stepDef.description.includes("ebook") ||
          stepDef.description.includes("card"))
      ) {
        // Try to extract context from description
        const contextMatch =
          stepDef.description.match(
            /(?:ebook|card|item).*?["']([^"']+)["']/i
          ) || stepDef.description.match(/titled\s+([^,.]+)/i);
        if (contextMatch) {
          currentContext = contextMatch[1].trim();
        }
      }

      callback({
        type: "step_started",
        data: { step: testStep },
      });

      try {
        // Execute the step (pass context for scoped operations)
        await executeStep(page, stepDef, testStep, currentContext || undefined);

        testStep.status = "completed";

        // Take screenshot after step
        const screenshot = await page.screenshot({ type: "png" });
        const screenshotBase64 = screenshot.toString("base64");

        callback({
          type: "screenshot",
          data: { stepId, screenshot: screenshotBase64 },
        });

        callback({
          type: "step_completed",
          data: { step: testStep },
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        testStep.status = "failed";
        testStep.error = errorMessage;

        callback({
          type: "step_failed",
          data: { step: testStep, error: errorMessage },
        });

        // Take screenshot on error
        const screenshot = await page.screenshot({ type: "png" });
        const screenshotBase64 = screenshot.toString("base64");

        callback({
          type: "screenshot",
          data: { stepId, screenshot: screenshotBase64 },
        });

        throw error; // Stop execution on failure
      }
    }

    callback({
      type: "log",
      data: { message: "✅ All test steps completed successfully" },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Check if it was a cancellation
    if (errorMessage.includes("cancelled")) {
      callback({
        type: "test_failed",
        data: {
          error: "Test execution was cancelled",
          timestamp: Date.now(),
        },
      });
    } else {
      callback({
        type: "error",
        data: { message: errorMessage, stack: errorStack },
      });
    }
    throw error;
  } finally {
    // Cleanup - only close if not using session
    if (!usingSession) {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }

    // Remove from active executions
    activeExecutions.delete(testId);
  }
}

/**
 * Execute a single test step
 */
async function executeStep(
  page: Page,
  stepDef: StructuredStep,
  testStep: TestStep,
  context?: string | null
): Promise<void> {
  const { action, target, value, assertion } = stepDef;

  switch (action) {
    case "navigate": {
      if (!target) throw new Error("Navigate action requires target URL");
      
      // Sanitize and validate URL
      let sanitizedUrl = target.trim();
      
      // Fix common typos
      sanitizedUrl = sanitizedUrl.replace(/^shttps:\/\//i, "https://");
      sanitizedUrl = sanitizedUrl.replace(/^shttp:\/\//i, "http://");
      sanitizedUrl = sanitizedUrl.replace(/^htps:\/\//i, "https://");
      sanitizedUrl = sanitizedUrl.replace(/^htp:\/\//i, "http://");
      
      // If it's a relative path, ensure it starts with /
      if (!sanitizedUrl.match(/^https?:\/\//i) && !sanitizedUrl.startsWith("/")) {
        sanitizedUrl = "/" + sanitizedUrl;
      }
      
      // If it's a relative path, resolve it against the current page
      if (sanitizedUrl.startsWith("/")) {
        const currentUrl = new URL(page.url());
        sanitizedUrl = `${currentUrl.protocol}//${currentUrl.host}${sanitizedUrl}`;
      }
      
      console.log(`🔗 Navigating to: ${sanitizedUrl}${sanitizedUrl !== target ? ` (sanitized from: ${target})` : ""}`);
      
      await page.goto(sanitizedUrl, {
        waitUntil: "domcontentloaded", // Faster than networkidle
        timeout: 30000,
      });
      // Wait for page to be interactive
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(300); // Minimal wait for JS initialization
      break;
    }

    case "click": {
      if (!target) throw new Error("Click action requires target");

      // Clean the target - remove leading/trailing whitespace and normalize
      const cleanTarget = target.trim();

      // Reject invalid selectors that AI might generate
      if (
        cleanTarget.includes(":contains") ||
        cleanTarget.includes(":has-text") ||
        (cleanTarget.includes("href") &&
          cleanTarget.includes('"') &&
          cleanTarget.match(/href.*["'][^"']* [^"']*["']/))
      ) {
        throw new Error(
          `Invalid selector generated: "${target}". Use plain text instead (e.g., "Download Now")`
        );
      }

      // Wait for page to be ready (use domcontentloaded for speed)
      await page
        .waitForLoadState("domcontentloaded", { timeout: 5000 })
        .catch(() => {
          // Ignore timeout, continue anyway
        });

      // Minimal wait for dynamic content
      await page.waitForTimeout(500);

      // Debug: Get all available clickable elements on the page
      const availableElements: Array<{
        text: string;
        tag: string;
        visible: boolean;
      }> = [];
      try {
        const allClickable = await page
          .locator(
            'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], [class*="button"], [class*="btn"]'
          )
          .all();
        for (const elem of allClickable.slice(0, 100)) {
          // Increased to detect more buttons
          try {
            const text = await elem.textContent().catch(() => null);
            const tagName = await elem
              .evaluate((el) => el.tagName.toLowerCase())
              .catch(() => "unknown");
            const isVisible = await elem.isVisible().catch(() => false);
            if (text && text.trim()) {
              availableElements.push({
                text: text.trim(),
                tag: tagName,
                visible: isVisible,
              });
            }
          } catch (e) {
            // Skip this element
          }
        }
        console.log(
          `🔍 Found ${availableElements.length} clickable elements on page`
        );
        if (availableElements.length > 0) {
          console.log(
            `📋 Available elements:`,
            availableElements
              .map(
                (e: { text: string; tag: string; visible: boolean }) =>
                  `[${e.tag}] "${e.text}" (visible: ${e.visible})`
              )
              .join(", ")
          );
        }
      } catch (e) {
        console.log("⚠️ Could not inspect page elements:", e);
      }

      // Try multiple selector strategies with increased timeout
      const strategies = [
        // Strategy 1: getByRole with name (most reliable for buttons/links)
        // For footer buttons, scroll to bottom first
        async () => {
          // If target contains "footer" keywords or is likely a footer button, scroll to bottom
          const isFooterButton =
            cleanTarget.toLowerCase().includes("save") ||
            cleanTarget.toLowerCase().includes("submit") ||
            cleanTarget.toLowerCase().includes("cancel") ||
            cleanTarget.toLowerCase().includes("notify");

          if (isFooterButton) {
            // Scroll to bottom to ensure footer is visible
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(300); // Wait for scroll
          }

          const locator = page
            .getByRole("button", { name: cleanTarget, exact: false })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 2: getByRole for link
        async () => {
          const locator = page
            .getByRole("link", { name: cleanTarget, exact: false })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 3: getByText with exact match (most reliable for visible text)
        async () => {
          const locator = page.getByText(cleanTarget, { exact: true }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 4: getByText with case-insensitive exact match
        async () => {
          const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const locator = page
            .getByText(new RegExp(`^${escaped}$`, "i"))
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 5: getByText with partial match (if exact doesn't work)
        async () => {
          const locator = page.getByText(cleanTarget, { exact: false }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 6: Find by text content that contains target (more flexible)
        async () => {
          const allElements = await page
            .locator('button, a, [role="button"], [onclick]')
            .all();
          for (const elem of allElements) {
            const text = await elem.textContent().catch(() => null);
            if (
              text &&
              text.trim().toLowerCase().includes(cleanTarget.toLowerCase())
            ) {
              await elem
                .scrollIntoViewIfNeeded({ timeout: 5000 })
                .catch(() => {});
              await elem.click({ timeout: 30000 });
              return;
            }
          }
          throw new Error("Element not found by text content");
        },
        // Strategy 7: Scoped clicking - if context is available, scope to parent container
        async () => {
          if (context) {
            // Find the parent element (e.g., ebook card) that contains the context text
            const contextLocator = page
              .getByText(context, { exact: false })
              .first();
            const isContextVisible = await contextLocator
              .isVisible()
              .catch(() => false);

            if (isContextVisible) {
              // Find the nearest common ancestor (card/container)
              // Then find the target button/link within that container
              const parentContainer = contextLocator
                .locator("..")
                .locator("..")
                .first();
              const scopedTarget = parentContainer
                .getByText(cleanTarget, { exact: false })
                .first();

              await scopedTarget
                .scrollIntoViewIfNeeded({ timeout: 5000 })
                .catch(() => {});
              await scopedTarget.click({ timeout: 30000 });
              return;
            }
          }
          throw new Error("Context not available");
        },
        // Strategy 8: Exact text match with locator
        async () => {
          const locator = page.locator(`text="${cleanTarget}"`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 6: Text with leading/trailing whitespace tolerance
        async () => {
          const locator = page
            .locator(
              `text=/^\\s*${cleanTarget.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              )}\\s*$/i`
            )
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 4: Contains text (partial match)
        async () => {
          const locator = page.locator(`text=${cleanTarget}`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 5: getByText (Playwright's recommended method) - handles whitespace better
        async () => {
          const locator = page.getByText(cleanTarget, { exact: false }).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 6: Button with text (has-text)
        async () => {
          const locator = page
            .locator(`button:has-text("${cleanTarget}")`)
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 7: Link with text (has-text)
        async () => {
          const locator = page.locator(`a:has-text("${cleanTarget}")`).first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 8: Role-based button with regex (case-insensitive)
        async () => {
          const locator = page
            .getByRole("button", {
              name: new RegExp(
                cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 9: Role-based link with regex (case-insensitive)
        async () => {
          const locator = page
            .getByRole("link", {
              name: new RegExp(
                cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "i"
              ),
            })
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 10: CSS selector if target looks like one (but not pseudo-selectors)
        async () => {
          // Only try if it looks like a valid CSS selector (not containing :contains, :has-text, etc.)
          if (
            !target.includes(":contains") &&
            !target.includes(":has-text") &&
            (target.startsWith(".") ||
              target.startsWith("#") ||
              target.startsWith("[") ||
              target.includes(" ") ||
              target.includes(">") ||
              target.includes("+") ||
              target.includes("~"))
          ) {
            const locator = page.locator(target).first();
            await locator
              .scrollIntoViewIfNeeded({ timeout: 5000 })
              .catch(() => {});
            await locator.click({ timeout: 30000 });
          } else {
            throw new Error("Invalid selector");
          }
        },
        // Strategy 11: Find by class containing target text
        async () => {
          const locator = page
            .locator(`[class*="${cleanTarget.toLowerCase()}"]`)
            .first();
          await locator
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await locator.click({ timeout: 10000 });
        },
        // Strategy 12: Find by href containing target text (only if no spaces in target)
        async () => {
          // Only try href matching if target has no spaces (URLs don't have spaces)
          if (!cleanTarget.includes(" ")) {
            const locator = page
              .locator(`a[href*="${cleanTarget.toLowerCase()}"]`)
              .first();
            await locator
              .scrollIntoViewIfNeeded({ timeout: 5000 })
              .catch(() => {});
            await locator.click({ timeout: 30000 });
          } else {
            throw new Error("Skipping href strategy - target contains spaces");
          }
        },
        // Strategy 13: Footer buttons - scroll to bottom and find by exact text
        async () => {
          // Check if this looks like a footer button
          const isFooterButton =
            cleanTarget.toLowerCase().includes("save") ||
            cleanTarget.toLowerCase().includes("submit") ||
            cleanTarget.toLowerCase().includes("cancel") ||
            cleanTarget.toLowerCase().includes("notify");

          if (isFooterButton) {
            // Scroll to bottom to ensure footer is visible
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(500); // Wait for scroll

            // Try to find in footer element first
            const footerLocator = page
              .locator("footer, [class*='footer'], [id*='footer']")
              .first();
            const footerExists = await footerLocator.count().catch(() => 0);

            if (footerExists > 0) {
              // Look for button within footer
              const buttonInFooter = footerLocator
                .getByRole("button", { name: cleanTarget, exact: false })
                .first();
              await buttonInFooter
                .scrollIntoViewIfNeeded({ timeout: 3000 })
                .catch(() => {});
              await buttonInFooter.click({ timeout: 10000 });
            } else {
              // No footer element, just find button at bottom of page
              const locator = page
                .getByRole("button", { name: cleanTarget, exact: false })
                .last(); // Use last() to get the one at the bottom
              await locator
                .scrollIntoViewIfNeeded({ timeout: 3000 })
                .catch(() => {});
              await locator.click({ timeout: 10000 });
            }
          } else {
            throw new Error("Not a footer button");
          }
        },
      ];

      let lastError: Error | null = null;
      for (const strategy of strategies) {
        try {
          await strategy();
          // Wait for navigation or DOM update after click (faster than fixed timeout)
          await Promise.race([
            page
              .waitForLoadState("domcontentloaded", { timeout: 1000 })
              .catch(() => {}),
            page.waitForTimeout(200), // Fallback minimal delay
          ]);
          return; // Success, exit
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue; // Try next strategy
        }
      }

      // If all strategies failed, provide helpful error with available elements
      const visibleElements = availableElements.filter(
        (e: { text: string; tag: string; visible: boolean }) => e.visible
      );

      const availableTexts = visibleElements
        .map(
          (e: { text: string; tag: string; visible: boolean }) => `"${e.text}"`
        )
        .slice(0, 50) // Show many more elements to help debugging
        .join(", ");

      throw new Error(
        `Failed to click "${target}". Last error: ${
          lastError?.message || "Unknown error"
        }. Found ${
          visibleElements.length
        } visible clickable elements on page. Available buttons: ${
          availableTexts || "none found"
        }. TIP: The button text must match exactly - check if button is named differently (e.g., "Create" instead of "Create Job", or "+ Create")`
      );
    }

    case "fill": {
      if (!target || !value)
        throw new Error("Fill action requires target and value");

      // Debug: Get all available input fields
      const availableInputs: Array<{
        placeholder?: string;
        label?: string;
        type?: string;
        id?: string;
      }> = [];
      try {
        const allInputs = await page.locator("input, textarea").all();
        for (const inp of allInputs.slice(0, 20)) {
          try {
            const placeholder = await inp
              .getAttribute("placeholder")
              .catch(() => null);
            const inputType = await inp.getAttribute("type").catch(() => null);
            const inputId = await inp.getAttribute("id").catch(() => null);
            const label = inputId
              ? await page
                  .locator(`label[for="${inputId}"]`)
                  .textContent()
                  .catch(() => null)
              : null;
            availableInputs.push({
              placeholder: placeholder || undefined,
              label: label?.trim() || undefined,
              type: inputType || undefined,
              id: inputId || undefined,
            });
          } catch (e) {
            // Skip
          }
        }
        console.log(
          `🔍 Found ${availableInputs.length} input fields:`,
          availableInputs
        );
      } catch (e) {
        console.log("⚠️ Could not inspect input fields:", e);
      }

      // Try multiple strategies to find the input field
      const fillStrategies = [
        // Strategy 0: Special handling for password fields
        async () => {
          if (target.toLowerCase().includes("password")) {
            // Priority check for explicit type="password"
            const locator = page.locator('input[type="password"]').first();
            await locator.fill(value, { timeout: 30000 });
          } else {
            throw new Error("Not a password target");
          }
        },
        // Strategy 1: Find by placeholder text (exact match)
        async () => {
          const locator = page
            .getByPlaceholder(target, { exact: true })
            .first();
          await locator.fill(value, { timeout: 10000 });
        },
        // Strategy 2: Find by placeholder text (partial match)
        async () => {
          const locator = page
            .getByPlaceholder(target, { exact: false })
            .first();
          await locator.fill(value, { timeout: 10000 });
        },
        // Strategy 2b: Find by placeholder containing target words
        async () => {
          const targetWords = target
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 2);
          const allInputs = await page.locator("input, textarea").all();
          for (const inp of allInputs) {
            try {
              const placeholder = await inp
                .getAttribute("placeholder")
                .catch(() => null);
              if (
                placeholder &&
                targetWords.every((word) =>
                  placeholder.toLowerCase().includes(word)
                )
              ) {
                await inp.fill(value, { timeout: 30000 });
                return;
              }
            } catch (e) {
              continue;
            }
          }
          throw new Error("Input not found by placeholder words");
        },
        // Strategy 3: Find by label text, then find associated input
        async () => {
          const label = page.getByText(target, { exact: false }).first();
          const labelFor = await label.getAttribute("for").catch(() => null);
          if (labelFor) {
            await page.locator(`#${labelFor}`).fill(value, { timeout: 30000 });
          } else {
            // Find input next to label
            const input = label
              .locator("..")
              .locator("input, textarea")
              .first();
            await input.fill(value, { timeout: 30000 });
          }
        },
        // Strategy 4: Find by label text using getByLabel
        async () => {
          const locator = page.getByLabel(target, { exact: false }).first();
          await locator.fill(value, { timeout: 10000 });
        },
        // Strategy 5: Find by role and name
        async () => {
          const locator = page
            .getByRole("textbox", { name: new RegExp(target, "i") })
            .first();
          await locator.fill(value, { timeout: 10000 });
        },
        // Strategy 6: Generic input selector with placeholder
        async () => {
          const locator = page
            .locator(
              `input[placeholder*="${target}"], textarea[placeholder*="${target}"]`
            )
            .first();
          await locator.fill(value, { timeout: 10000 });
        },
        // Strategy 7: Fallback to any visible input
        async () => {
          const locator = page
            .locator(
              'input[type="text"], input[type="email"], input[type="password"], textarea'
            )
            .first();
          await locator.fill(value, { timeout: 10000 });
        },
      ];

      let lastError: Error | null = null;
      for (const strategy of fillStrategies) {
        try {
          await strategy();
          return; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
      }

      // Provide helpful error with available inputs
      const availableInfo = availableInputs
        .slice(0, 5)
        .map(
          (inp: {
            placeholder?: string;
            label?: string;
            type?: string;
            id?: string;
          }) => {
            const parts: string[] = [];
            if (inp.placeholder)
              parts.push(`placeholder: "${inp.placeholder}"`);
            if (inp.label) parts.push(`label: "${inp.label}"`);
            if (inp.type) parts.push(`type: ${inp.type}`);
            return parts.join(", ");
          }
        )
        .join("; ");

      throw new Error(
        `Failed to fill "${target}" after trying multiple strategies: ${
          lastError?.message || "Unknown error"
        }. Available inputs: ${availableInfo || "none found"}`
      );
    }

    case "select": {
      if (!target || !value)
        throw new Error("Select action requires target and value");

      // Try multiple strategies to find and select from dropdown
      const selectStrategies = [
        // Strategy 1: Find by label text, then find associated select element
        async () => {
          const label = page.getByText(target, { exact: false }).first();
          const labelFor = await label.getAttribute("for").catch(() => null);
          if (labelFor) {
            // Label has "for" attribute pointing to select ID
            await page
              .locator(`#${labelFor}`)
              .selectOption(value, { timeout: 10000 });
          } else {
            // Find select element near the label
            const select = label.locator("..").locator("select").first();
            await select.selectOption(value, { timeout: 10000 });
          }
        },
        // Strategy 2: Find select by label using getByLabel
        async () => {
          const locator = page.getByLabel(target, { exact: false }).first();
          await locator.selectOption(value, { timeout: 10000 });
        },
        // Strategy 3: Find select by role and name
        async () => {
          const locator = page
            .getByRole("combobox", { name: new RegExp(target, "i") })
            .first();
          await locator.selectOption(value, { timeout: 10000 });
        },
        // Strategy 4: If target looks like a CSS selector, use it directly
        async () => {
          if (
            target.startsWith("#") ||
            target.startsWith(".") ||
            target.startsWith("[")
          ) {
            await page.locator(target).selectOption(value, { timeout: 10000 });
          } else {
            throw new Error("Not a valid selector");
          }
        },
        // Strategy 5: Find select by placeholder or name attribute
        async () => {
          const locator = page
            .locator(
              `select[name*="${target}"], select[placeholder*="${target}"]`
            )
            .first();
          await locator.selectOption(value, { timeout: 10000 });
        },
        // Strategy 6: Find all selects and match by nearby label text
        async () => {
          const allSelects = await page.locator("select").all();
          for (const select of allSelects) {
            try {
              // Check if there's a label nearby
              const parent = select.locator("..");
              const labelText = await parent
                .locator("label")
                .textContent()
                .catch(() => null);
              if (
                labelText &&
                labelText.toLowerCase().includes(target.toLowerCase())
              ) {
                await select.selectOption(value, { timeout: 10000 });
                return;
              }
            } catch (e) {
              continue;
            }
          }
          throw new Error("Select not found by label text");
        },
        // Strategy 7: Handle searchable dropdowns (custom dropdowns with input fields)
        async () => {
          // Find the label first
          const label = page.getByText(target, { exact: false }).first();
          await label.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

          // Look for input field near the label (searchable dropdowns use inputs, not selects)
          // Try multiple approaches to find the input
          let inputField = null;

          // Approach 1: Input with id matching label's "for" attribute
          const labelFor = await label.getAttribute("for").catch(() => null);
          if (labelFor) {
            inputField = page.locator(`#${labelFor}`).first();
            const exists = await inputField.count().catch(() => 0);
            if (exists === 0) inputField = null;
          }

          // Approach 2: Input near the label (sibling or in parent container)
          if (!inputField) {
            const parent = label.locator("..");
            inputField = parent
              .locator(
                "input[type='text'], input:not([type]), [role='combobox']"
              )
              .first();
            const exists = await inputField.count().catch(() => 0);
            if (exists === 0) {
              // Try finding input in a wider parent scope
              const grandParent = label.locator("../..");
              inputField = grandParent
                .locator(
                  "input[type='text'], input:not([type]), [role='combobox']"
                )
                .first();
            }
          }

          if (!inputField) {
            throw new Error("Input field not found near label");
          }

          // Click on the input to open the dropdown
          await inputField
            .scrollIntoViewIfNeeded({ timeout: 3000 })
            .catch(() => {});
          await inputField.click({ timeout: 10000 });
          await page.waitForTimeout(500); // Wait for dropdown to open

          // Type the search value
          await inputField.fill(value, { timeout: 10000 });
          await page.waitForTimeout(800); // Wait for search results to appear

          // Now find and click the option that matches the value
          // Try multiple strategies to find the option
          const optionStrategies = [
            // Strategy 1: Find by exact text in dropdown options
            async () => {
              const option = page.getByText(value, { exact: true }).first();
              await option
                .scrollIntoViewIfNeeded({ timeout: 3000 })
                .catch(() => {});
              await option.click({ timeout: 10000 });
            },
            // Strategy 2: Find by partial text match
            async () => {
              const option = page.getByText(value, { exact: false }).first();
              await option
                .scrollIntoViewIfNeeded({ timeout: 3000 })
                .catch(() => {});
              await option.click({ timeout: 10000 });
            },
            // Strategy 3: Find in dropdown menu/list items
            async () => {
              const option = page
                .locator(
                  `[role='option'], [role='listbox'] [role='option'], .dropdown-item, [class*='option'], li`
                )
                .filter({ hasText: value })
                .first();
              await option
                .scrollIntoViewIfNeeded({ timeout: 3000 })
                .catch(() => {});
              await option.click({ timeout: 10000 });
            },
            // Strategy 4: Press Enter to select first result (common in autocomplete)
            async () => {
              await page.keyboard.press("Enter");
              await page.waitForTimeout(300);
            },
          ];

          let optionError: Error | null = null;
          for (const strategy of optionStrategies) {
            try {
              await strategy();
              await page.waitForTimeout(300); // Wait for selection to complete
              return; // Success
            } catch (error) {
              optionError =
                error instanceof Error ? error : new Error(String(error));
              continue;
            }
          }

          throw new Error(
            `Could not select option "${value}" from dropdown: ${
              optionError?.message || "Unknown error"
            }`
          );
        },
      ];

      let lastError: Error | null = null;
      for (const strategy of selectStrategies) {
        try {
          await strategy();
          // Wait a bit for dropdown to update
          await page.waitForTimeout(300);
          return; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
      }

      throw new Error(
        `Failed to select "${value}" from dropdown "${target}": ${
          lastError?.message || "Unknown error"
        }`
      );
    }

    case "wait": {
      const waitTime = Number.parseInt(value || "1000", 10);
      await page.waitForTimeout(waitTime);
      break;
    }

    case "assert":
      if (!assertion) throw new Error("Assert action requires assertion");
      await performAssertion(page, assertion, testStep);
      break;

    case "screenshot":
      // Screenshot is taken automatically after each step
      break;

    case "scroll": {
      // Scroll down by viewport height, or scroll to specific element if target provided
      if (target) {
        try {
          const element = await page.locator(target).first();
          await element.scrollIntoViewIfNeeded({ timeout: 3000 });
        } catch {
          // If element not found, just scroll down
          await page.evaluate(() => {
            globalThis.scrollBy(0, globalThis.innerHeight);
          });
        }
      } else {
        await page.evaluate(() => {
          globalThis.scrollBy(0, globalThis.innerHeight);
        });
      }
      await page.waitForTimeout(200); // Minimal wait for scroll animation
      break;
    }

    case "hover":
      if (!target) throw new Error("Hover action requires target");
      await page.hover(`text="${target}"`).catch(() => page.hover(target));
      break;

    case "keyboard":
      if (!value) throw new Error("Keyboard action requires value");
      await page.keyboard.press(value);
      break;

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Perform an assertion
 */
async function performAssertion(
  page: Page,
  assertion: StructuredStep["assertion"],
  testStep: TestStep
): Promise<void> {
  if (!assertion) {
    throw new Error("Assertion is required");
  }

  const { type, expected } = assertion;

  switch (type) {
    case "text": {
      const textContent = await page.textContent("body");
      const expectedText = String(expected);
      
      // Support multiple options separated by | (OR logic)
      const options = expectedText.split("|").map((opt) => opt.trim());
      
      // Check if any of the options are found (case-insensitive)
      let found = false;
      let foundOption = "";
      
      for (const option of options) {
        if (
          textContent &&
          textContent.toLowerCase().includes(option.toLowerCase())
        ) {
          found = true;
          foundOption = option;
          break;
        }
      }
      
      testStep.assertion = {
        ...assertion,
        actual: found ? `Found: "${foundOption}"` : `Text not found. Page has: ${textContent?.substring(0, 200)}...`,
        passed: found,
      };
      
      if (!found) {
        // Get page title and headings for better error context
        const title = await page.title().catch(() => "");
        const headings = await page
          .locator("h1, h2, h3")
          .allTextContents()
          .catch(() => []);
        
        throw new Error(
          `Expected text not found. Looking for any of: "${options.join('", "')}".\n` +
          `Current page: "${title}"\n` +
          `Main headings: ${headings.slice(0, 5).join(", ") || "none"}\n` +
          `Page content preview: ${textContent?.substring(0, 300)}...`
        );
      }
      break;
    }

    case "url": {
      const url = page.url();
      const expectedUrl = String(expected);
      
      // Support multiple options separated by | (OR logic)
      const options = expectedUrl.split("|").map((opt) => opt.trim());
      
      // Check if any of the options match (case-insensitive)
      let found = false;
      
      for (const option of options) {
        if (url.toLowerCase().includes(option.toLowerCase())) {
          found = true;
          break;
        }
      }
      
      testStep.assertion = {
        ...assertion,
        actual: url,
        passed: found,
      };
      
      if (!found) {
        throw new Error(
          `Expected URL to contain any of: "${options.join('", "')}"\nActual URL: "${url}"`
        );
      }
      break;
    }

    case "title": {
      const title = await page.title();
      const expectedTitle = String(expected);
      
      // Support multiple options separated by | (OR logic)
      const options = expectedTitle.split("|").map((opt) => opt.trim());
      
      // Check if any of the options match (case-insensitive)
      let found = false;
      
      for (const option of options) {
        if (title.toLowerCase().includes(option.toLowerCase())) {
          found = true;
          break;
        }
      }
      
      testStep.assertion = {
        ...assertion,
        actual: title,
        passed: found,
      };
      
      if (!found) {
        throw new Error(
          `Expected title to contain any of: "${options.join('", "')}"\nActual title: "${title}"`
        );
      }
      break;
    }

    case "element": {
      const expectedSelector = String(expected);
      const element = await page.locator(expectedSelector).first();
      // Playwright's isVisible() returns a Promise
      // eslint-disable-next-line @typescript-eslint/await-thenable
      const isVisible = await element.isVisible();
      testStep.assertion = {
        ...assertion,
        actual: isVisible ? "visible" : "not visible",
        passed: isVisible,
      };
      if (!isVisible) {
        throw new Error(
          `Expected element "${expectedSelector}" not found or not visible`
        );
      }
      break;
    }

    case "count": {
      const expectedSelector = String(expected);
      const expectedCount =
        typeof expected === "number"
          ? expected
          : Number.parseInt(String(expected), 10);
      const count = await page.locator(expectedSelector).count();
      testStep.assertion = {
        ...assertion,
        actual: count,
        passed: count === expectedCount,
      };
      if (count !== expectedCount) {
        throw new Error(`Expected ${expectedCount} elements, found ${count}`);
      }
      break;
    }
  }
}

/**
 * Get the appropriate browser engine
 */
function getBrowserEngine(browserType: "chromium" | "firefox" | "webkit") {
  switch (browserType) {
    case "chromium":
      return chromium;
    case "firefox":
      return firefox;
    case "webkit":
      return webkit;
    default:
      return chromium;
  }
}
