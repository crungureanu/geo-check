// Serve the static index.html for share-link URLs (/r/<id>).
// app.js detects the /r/<id> path in the browser and fetches /api/r/<id>
// to render the saved scan. This Function exists purely to make /r/<id>
// resolve to the SPA shell instead of returning a 404.
export const onRequestGet: PagesFunction = async ({ next }) => {
  return next("/index.html");
};
