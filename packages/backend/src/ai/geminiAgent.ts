import { GoogleGenerativeAI } from "@google/generative-ai";
import { TestAction } from "@quality-pilot/shared";
import "dotenv/config";

const apiKey =
  process.env.GEMINI_API_KEY || "AIzaSyD8DjdEzXOZizCf6uHIj0FT7QChMniqRTU";
console.log("apiKey", apiKey);
if (!apiKey) {
  console.error("⚠️  GEMINI_API_KEY is not set in environment variables!");
  console.error("   Please set it in your .env file or environment");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

export interface StructuredStep {
  action: TestAction;
  target?: string;
  value?: string;
  assertion?: {
    type: "text" | "element" | "url" | "title" | "count";
    expected: string | number;
  };
  description: string;
}

/**
 * Converts a natural language prompt into structured test steps
 * using Google Gemini AI
 */
export async function generateTestSteps(
  prompt: string,
  url: string,
  pageElements?: {
    buttons: string[];
    links: string[];
    inputs: string[];
    context?: {
      url: string;
      title: string;
      headings: string[];
      visibleText: string;
      forms: Array<{ labels: string[]; fields: string[] }>;
      messages: string[];
    };
  },
): Promise<StructuredStep[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Build the prompt for Gemini
  const systemPrompt = `You are an intelligent manual tester who understands user intent and automatically breaks down complex tasks into ALL necessary steps. Think like a human tester who figures out every action needed to complete a task.

CRITICAL: You must be AUTONOMOUS and COMPREHENSIVE:
- Understand the FULL user intent, not just explicit instructions
- Break down complex tasks into ALL intermediate steps automatically
- Infer navigation steps (e.g., "go to jobs tab" = click "Jobs" tab/button)
- Infer waiting steps for page loads and dynamic content
- Infer scrolling when elements might be below the fold
- Infer form filling when credentials are mentioned
- Generate COMPLETE workflows, not just the main actions

Rules:
1. Output ONLY valid JSON array of steps
2. Each step must have: action, description, and optionally target, value, assertion
3. Available actions: navigate, click, fill, select, wait, assert, screenshot, scroll, hover, keyboard
4. For credentials, use placeholders like {{email}}, {{password}} - DO NOT use actual values
5. Be specific with targets (use text content, labels, or common selectors)
6. CRITICAL - URL FORMAT for navigate actions:
   - NEVER generate malformed URLs like "shttps://" or "htps://" or "shttp://"
   - ALWAYS use proper format: "https://domain.com/path" or relative path "/path"
   - Use FULL URLs or relative paths like "/login", "/dashboard"
   - Double-check URLs before outputting - must be "https://" not "shttps://"
7. Include assertions to verify expected outcomes
8. AUTOMATICALLY add intermediate steps:
   - After navigation: add "wait" step (500-1000ms) for page to load
   - Before clicking buttons: add "wait" step if page just loaded
   - Before interacting with elements below fold: add "scroll" step
   - After form submissions: add "wait" step for response
   - After dropdown selections: add brief "wait" step
9. DROPDOWN/SELECT HANDLING:
   - For dropdowns, use "select" action with target as the LABEL text (e.g., "Product/Service", "Category")
   - The value should be the option text to select (e.g., "Product A", "Service B", "Hours")
   - Works for both standard <select> elements AND searchable/custom dropdowns
   - For searchable dropdowns: The system will automatically click the input, type the search value, and select the matching option
   - Example: {"action": "select", "target": "Product/Service", "value": "Hours", "description": "Select Hours from Product/Service searchable dropdown"}
10. FOOTER BUTTONS:
   - Footer buttons like "Save", "Save & Notify Client", "Cancel" are often at the bottom of the page
   - Use the EXACT button text including all words and special characters (e.g., "Save & Notify Client" not "Save")
   - The click action will automatically scroll to find footer buttons
   - Example: {"action": "click", "target": "Save & Notify Client", "description": "Click Save & Notify Client button in footer"}
11. TASK BREAKDOWN - Think like a manual tester:
   - "Login using credentials" = fill email, fill password, click login button, wait for redirect, verify dashboard
   - "Go to jobs tab" = click on "Jobs" tab/button/link, wait for tab content to load
   - "Click create button" = find and click "Create" button (may need to scroll or wait)
   - "Select from dropdown" = find label, click/open dropdown, search/select option
   - "Click footer button" = scroll to footer (if needed), find exact button text, click
   - "Scroll down and find X" = scroll action, then locate X element
   - Break EVERY user instruction into multiple atomic steps
   - Don't skip steps - if user says "then", generate ALL steps in sequence
12. Element detection strategy - CRITICAL RULES (VERY IMPORTANT):
   - NEVER use href selectors with spaces (e.g., a[href*="download now"] ❌) - URLs never contain spaces
   - NEVER use CSS pseudo-selectors like :contains(), :has-text() - they don't work in Playwright
   - ALWAYS use the EXACT visible text that appears on the page (case-sensitive if possible)
   - For buttons/links: Copy the EXACT text as it appears (including spaces, capitalization, punctuation)
   - For forms: Use the label text or placeholder text EXACTLY as shown
   - For inputs: Use placeholder text, label text, or aria-label EXACTLY
   - DO NOT abbreviate or modify text - use it EXACTLY as displayed
   - If element has multiple words, include ALL words in the exact order
   - IMPORTANT: If you see text like " Download" (with leading space) or "Download " (with trailing space), include the space
   - For buttons inside cards/containers: Use the full button text, not just a keyword
   - Examples:
     * If button says "Download Now" → use "Download Now" (not "Download", not "download now")
     * If button says " Sign Up" (with space) → use " Sign Up" (include the space)
     * If button says "Get Started" → use "Get Started" (not "Get", not "Started")
     * If input placeholder is "Enter your email" → use "Enter your email"
     * If label says "Password" → use "Password"
   - BAD examples:
     * "a[href*='download now']", "button:contains('Download')", ":has-text('text')"
     * "download" when button says "Download Now"
     * "email" when placeholder says "Enter your email address"
     * "Sign Up" when button actually says " Sign Up" (missing leading space)
13. SMART ASSERTIONS - How to verify actions:
   - PREFER URL or title assertions over text assertions (much more reliable)
   - Use flexible assertions with OR conditions using | separator
   - After form saves/submissions: PREFER URL assertions to verify page changed
     * Good: {"type": "url", "expected": "/job"} - verifies we left the create page
     * Bad: {"type": "text", "expected": "Job created successfully"} - toast may not appear
   - After navigation: use SHORT, FLEXIBLE URL patterns
     * Good: "/job|/jobs" (matches both singular and plural)
     * Good: "/create|/add|/new" (matches common action paths)
     * Bad: "/jobs/create/new-form" (too specific)
   - For titles: use key words only: "Create|Add|New" not full sentences
   - For text assertions after saves: check for data that was entered, not generic messages
     * Good: {"type": "text", "expected": "Client Name"} - verifies data from form
     * Bad: {"type": "text", "expected": "Saved successfully"} - may not exist
   - SKIP assertions if action is self-evident (e.g., filling a field, waiting)
   - Examples:
     * After save: {"type": "url", "expected": "/job"} ✅ Best option
     * After navigation: {"type": "title", "expected": "Dashboard|Home"} ✅ Good
     * After form fill: No assertion needed ✅ Skip it
   
14. COMPREHENSIVE STEP GENERATION - Examples of breaking down user intent:

Example 1: User says "Login and go to dashboard"
You generate:
- fill email field with {{email}}
- fill password field with {{password}}
- click "Login" button
- wait for navigation (1000ms)
- assert dashboard is visible (check for "Dashboard" text or URL)

Example 2: User says "Go to jobs tab and click create"
You generate:
- click "Jobs" tab/button (use exact text from page elements)
- wait for tab content to load (500ms)
- scroll if needed to find "Create" button
- click "Create" button
- wait for create form/page to load (500ms)

Example 3: User says "Select Hours from Product/Service dropdown and save"
You generate:
- scroll to find "Product/Service" label (if needed)
- select "Hours" from "Product/Service" dropdown
- wait for selection to complete (300ms)
- scroll to footer (if needed)
- click "Save" button in footer
- wait for page transition (1000ms)
- assert URL changed (check if URL no longer contains "/add" or "/create")

15. CRITICAL - Minimal and Smart Assertions:
   - ⚠️ AVOID text-based assertions for save confirmations (toasts/alerts may not exist)
   - ✅ PREFER URL assertions after saves: {"type": "url", "expected": "/job|/details"}
   - ✅ PREFER title assertions for page changes: {"type": "title", "expected": "Dashboard"}
   - ❌ SKIP assertions for: filling fields, waiting, scrolling, hovering
   - ✅ USE assertions for: major page transitions, after form submissions
   - When using text assertions: provide multiple flexible options with |
   - Example GOOD assertion after save: {"type": "url", "expected": "/job|/details|view"}
   - Example BAD assertion after save: {"type": "text", "expected": "Successfully saved"}
   - Rule of thumb: If you're not sure, SKIP the assertion - errors are worse than no verification

16. Use page elements provided to match EXACT text - don't guess button/link names

Example output:
[
  {
    "action": "navigate",
    "description": "Navigate to login page",
    "target": "/login"
  },
  {
    "action": "fill",
    "description": "Enter email address",
    "target": "email input",
    "value": "{{email}}"
  },
  {
    "action": "fill",
    "description": "Enter password",
    "target": "password input",
    "value": "{{password}}"
  },
  {
    "action": "click",
    "description": "Click login button",
    "target": "Login"
  },
  {
    "action": "assert",
    "description": "Verify successful login",
    "assertion": {
      "type": "text",
      "expected": "Dashboard"
    }
  }
]`;

  let userPrompt = `URL: ${url}\n\nTest Description: ${prompt}\n\nIMPORTANT INSTRUCTIONS:
1. Break down this task into ALL necessary steps automatically - think like a manual tester
2. Include ALL intermediate steps (waits, scrolls, navigation)
3. Use the exact element text from the page elements list below
4. Generate a COMPLETE workflow, not just the main actions
5. If the user mentions "then", generate ALL steps in the correct sequence
6. Infer what needs to happen between steps (e.g., after login, wait for redirect)
7. Don't skip steps - break down every user instruction into atomic actions
8. CRITICAL - INTELLIGENTLY READ THE SCREEN CONTEXT:
   - Look at the PAGE CONTEXT section below: title, headings, visible text, forms, messages
   - Use screen context to understand what page you're on and what state the application is in
   - If page title/headings show "Dashboard", "Jobs", "Clients" → USER IS LOGGED IN
   - If page shows "Login", "Sign In" in title/headings → USER NEEDS TO LOGIN
   - If you see success/error messages, factor them into your strategy
   - If forms are present, use the form labels to understand what fields are available
   - Make intelligent decisions based on what's actually visible on screen

Generate ALL test steps needed to complete this task:`;

  // If page elements are provided, include them in the prompt for better accuracy
  if (pageElements) {
    // Add page context (what's actually on screen)
    if (pageElements.context) {
      const ctx = pageElements.context;
      userPrompt += `\n\n=== CURRENT PAGE CONTEXT (What you see on screen) ===\n`;
      userPrompt += `URL: ${ctx.url}\n`;
      userPrompt += `Page Title: ${ctx.title}\n`;

      if (ctx.headings.length > 0) {
        userPrompt += `Headings on page: ${ctx.headings.slice(0, 10).join(" | ")}\n`;
      }

      if (ctx.messages.length > 0) {
        userPrompt += `\nMessages/Alerts: ${ctx.messages.join(" | ")}\n`;
      }

      if (ctx.visibleText) {
        userPrompt += `\nVisible page text (first 500 chars): ${ctx.visibleText.substring(0, 500)}...\n`;
      }

      if (ctx.forms.length > 0) {
        userPrompt += `\nForms detected: ${ctx.forms.length} form(s)\n`;
        ctx.forms.forEach((form, i) => {
          if (form.labels.length > 0) {
            userPrompt += `  Form ${i + 1} labels: ${form.labels.join(", ")}\n`;
          }
        });
      }
    }

    userPrompt += `\n=== INTERACTIVE ELEMENTS ===\n`;
    if (pageElements.buttons.length > 0) {
      userPrompt += `Buttons: ${pageElements.buttons
        .slice(0, 50)
        .join(", ")}\n`;
    }
    if (pageElements.links.length > 0) {
      userPrompt += `Links: ${pageElements.links.slice(0, 50).join(", ")}\n`;
    }
    if (pageElements.inputs.length > 0) {
      userPrompt += `Input fields: ${pageElements.inputs
        .slice(0, 50)
        .join(", ")}\n`;
    }
    userPrompt += `\n\nIMPORTANT NOTE: After clicking tabs/links, NEW elements may appear on the page that aren't in the list above.
For buttons that appear after navigation (like "Create" buttons after clicking tabs):
- Use simple button names: "Create", "New", "Add" (without + or other symbols)
- DO NOT invent combined names like "Create Job" - just use "Create"
- Visual buttons like "+ Create" usually have text "Create" (the + is an icon, not text)
- The system will find these buttons when they appear

CRITICAL - INTELLIGENT SCREEN READING & CONTEXT AWARENESS:
1. READ THE PAGE CONTEXT ABOVE:
   - Page title tells you what page you're on
   - Headings show the main sections/content
   - Visible text gives you the full context of what's on screen
   - Messages/alerts show system feedback (errors, success, etc.)
   - Forms show what data can be entered

2. MAKE INTELLIGENT DECISIONS BASED ON SCREEN:
   - If page title is "Dashboard" or "Jobs" → Already logged in, skip login
   - If you see "Login" or "Sign In" in title → Generate login steps
   - If you see error message "Invalid credentials" → Include retry logic
   - If you see success message → Verify and proceed
   - If form labels show "Product/Service" → Use "select" action for that dropdown
   - If headings show "Create Job" → You're on create job page

3. ADAPT TO WHAT'S ON SCREEN:
   - Don't follow prompt blindly - adapt based on actual page state
   - If prompt says "login" but screen shows dashboard → Skip login
   - If prompt says "go to X" but screen already shows X → Skip navigation
   - Use screen context to be smarter than just following instructions

4. POST-SAVE VERIFICATION STRATEGY (VERY IMPORTANT):
   - After clicking Save/Submit buttons, pages typically redirect to detail/list views
   - DON'T look for success toast messages - they may not exist or may disappear quickly
   - INSTEAD, verify the URL changed away from create/add/edit pages:
     * Good: {"type": "url", "expected": "/job|/details|/view"} - verifies navigation happened
     * Bad: {"type": "text", "expected": "Successfully created"} - may not exist
   - The absence of error messages + successful navigation = success
   - If the page shows the data that was entered (e.g., client name), that's confirmation

CRITICAL: 
- You MUST use the EXACT text from the elements list above
- Match button/link names exactly as they appear
- If user says "Jobs tab", look for "Jobs" in buttons/links list - use exact text like "Jobs"
- If user says "Create button" or "+ Create button", use just "Create" (the + is often visual/icon, not in the actual button text)
- If you see "Create" in the buttons list, use "Create" (NOT "+ Create" or "Create Job")
- If user says "Save button", look for "Save" or "Save & Notify Client" in buttons list
- CRITICAL: Use the EXACT button text from the visible elements list
- DO NOT add symbols like +, -, icons to button names - use the plain text
- Look at the buttons list carefully and match the EXACT text as it appears in the list
- Common pattern: Visual "+ Create" button → actual text is just "Create"
- Use the exact text, including spaces, capitalization, and special characters
- Break down complex instructions: "go to jobs tab" = click "Jobs" button/link + wait for content`;
  }

  try {
    const result = await model.generateContent([systemPrompt, userPrompt]);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
    }

    const steps: StructuredStep[] = JSON.parse(jsonText);

    // Validate and return
    if (!Array.isArray(steps)) {
      throw new Error("AI response is not an array");
    }

    return steps;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error generating test steps:", error);
    throw new Error(`Failed to generate test steps: ${errorMessage}`);
  }
}

/**
 * Replaces credential placeholders with actual values
 */
export function injectCredentials(
  steps: StructuredStep[],
  credentials?: Record<string, string>,
): StructuredStep[] {
  if (!credentials) return steps;

  return steps.map((step) => {
    const newStep = { ...step };

    // Replace placeholders in value field
    // Ensure value is a string before calling replace
    if (newStep.value && typeof newStep.value === "string") {
      Object.entries(credentials).forEach(([key, value]) => {
        newStep.value = newStep.value!.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, "g"),
          value,
        );
      });
    }

    return newStep;
  });
}
