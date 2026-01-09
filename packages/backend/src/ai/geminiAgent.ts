import { GoogleGenerativeAI } from "@google/generative-ai";
import { TestAction } from "@quality-pilot/shared";
import "dotenv/config";

const apiKey = process.env.GEMINI_API_KEY;
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
  pageElements?: { buttons: string[]; links: string[]; inputs: string[] }
  // credentials?: Record<string, string>
): Promise<StructuredStep[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Build the prompt for Gemini
  const systemPrompt = `You are a test automation expert. Convert the user's natural language test description into structured test steps.

Rules:
1. Output ONLY valid JSON array of steps
2. Each step must have: action, description, and optionally target, value, assertion
3. Available actions: navigate, click, fill, select, wait, assert, screenshot, scroll, hover, keyboard
4. For credentials, use placeholders like {{email}}, {{password}} - DO NOT use actual values
5. Be specific with targets (use text content, labels, or common selectors)
6. Include assertions to verify expected outcomes
7. CRITICAL: For dynamic content or elements that may take time to load:
   - ALWAYS add a "wait" step (2-3 seconds) after navigation before interacting with elements
   - If clicking buttons/links, add a "wait" step before the click to ensure element is loaded
   - Use "scroll" action before clicking if element might be below the fold
   - For download buttons, forms, or interactive elements, add wait steps before and after
8. Element detection strategy - CRITICAL RULES (VERY IMPORTANT):
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
9. For forms or downloads that require details:
   - Add "wait" step after page loads
   - Use "scroll" to ensure form is visible
   - Fill all required fields before submitting
   - Add "wait" after filling to allow validation
10. Always include "assert" steps to verify actions completed successfully

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

  let userPrompt = `URL: ${url}\n\nTest Description: ${prompt}\n\nGenerate test steps:`;

  // If page elements are provided, include them in the prompt for better accuracy
  if (pageElements) {
    userPrompt += `\n\nCURRENTLY VISIBLE ELEMENTS ON THE PAGE (${url}):\n`;
    if (pageElements.buttons.length > 0) {
      userPrompt += `Buttons: ${pageElements.buttons
        .slice(0, 30)
        .join(", ")}\n`;
    }
    if (pageElements.links.length > 0) {
      userPrompt += `Links: ${pageElements.links.slice(0, 30).join(", ")}\n`;
    }
    if (pageElements.inputs.length > 0) {
      userPrompt += `Input fields: ${pageElements.inputs
        .slice(0, 30)
        .join(", ")}\n`;
    }
    userPrompt += `\nCRITICAL: You MUST use the EXACT text from the "Currently visible elements" list above for any interaction steps on this page. If you need to click a button, use its exact text. If you need to fill a form, use the label or placeholder exactly as provided.`;
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
  credentials?: Record<string, string>
): StructuredStep[] {
  if (!credentials) return steps;

  return steps.map((step) => {
    const newStep = { ...step };

    // Replace placeholders in value field
    if (newStep.value) {
      Object.entries(credentials).forEach(([key, value]) => {
        newStep.value = newStep.value!.replace(
          new RegExp(`\\{\\{${key}\\}\\}`, "g"),
          value
        );
      });
    }

    return newStep;
  });
}
