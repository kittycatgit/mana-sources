// @ts-nocheck
//
// This function does not run here. `WebViewPage.evaluate` serialises it and runs it inside
// the loaded page, where `document` exists and a source tsconfig's types do not.

/** The loaded document, as markup. */
export function outerHtml(): string {
  return document.documentElement.outerHTML;
}
