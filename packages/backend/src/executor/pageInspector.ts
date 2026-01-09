import { Page } from "playwright";

/**
 * Inspect page and return all available interactive elements
 * This helps with debugging and can be used to improve AI prompts
 */
export async function inspectPage(page: Page): Promise<{
  buttons: Array<{ text: string; visible: boolean; tag: string }>;
  links: Array<{ text: string; visible: boolean; href?: string }>;
  inputs: Array<{
    placeholder?: string;
    label?: string;
    type?: string;
    id?: string;
    visible: boolean;
  }>;
}> {
  const result = {
    buttons: [] as Array<{ text: string; visible: boolean; tag: string }>,
    links: [] as Array<{ text: string; visible: boolean; href?: string }>,
    inputs: [] as Array<{
      placeholder?: string;
      label?: string;
      type?: string;
      id?: string;
      visible: boolean;
    }>,
  };

  try {
    // Get all buttons
    const buttons = await page
      .locator(
        'button, [role="button"], input[type="button"], input[type="submit"], [class*="button"], [class*="btn"]'
      )
      .all();
    for (const btn of buttons.slice(0, 50)) {
      try {
        const text = await btn.textContent().catch(() => null);
        const tagName = await btn
          .evaluate((el) => el.tagName.toLowerCase())
          .catch(() => "unknown");
        const isVisible = await btn.isVisible().catch(() => false);
        if (text && text.trim()) {
          result.buttons.push({
            text: text.trim(),
            visible: isVisible,
            tag: tagName,
          });
        }
      } catch (e) {
        // Skip
      }
    }

    // Get all links
    const links = await page.locator("a").all();
    for (const link of links.slice(0, 50)) {
      try {
        const text = await link.textContent().catch(() => null);
        const href = await link.getAttribute("href").catch(() => null);
        const isVisible = await link.isVisible().catch(() => false);
        if (text && text.trim()) {
          result.links.push({
            text: text.trim(),
            visible: isVisible,
            href: href || undefined,
          });
        }
      } catch (e) {
        // Skip
      }
    }

    // Get all inputs
    const inputs = await page.locator("input, textarea").all();
    for (const inp of inputs.slice(0, 50)) {
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
        const isVisible = await inp.isVisible().catch(() => false);
        result.inputs.push({
          placeholder: placeholder || undefined,
          label: label?.trim() || undefined,
          type: inputType || undefined,
          id: inputId || undefined,
          visible: isVisible,
        });
      } catch (e) {
        // Skip
      }
    }
  } catch (error) {
    console.error("Error inspecting page:", error);
  }

  return result;
}
