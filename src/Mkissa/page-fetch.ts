// @ts-nocheck
//
// This function does not run here. `WebViewPage.evaluate` serialises it and runs it inside
// the loaded page, where `fetch` and the site's own cookies exist and a source tsconfig's
// types do not.

/** POSTs a GraphQL body from the loaded page's origin and returns the raw reply. */
export async function postGraphql(url: string, body: string): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "*/*" },
    credentials: "include",
    body,
  });
  return await response.text();
}
