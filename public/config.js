// Address of the Prayer Wall API (the Cloudflare Worker in worker/).
// On your own computer (npm start) it uses the local Worker from `npm run dev` in worker/.
window.PRAYER_WALL_CONFIG = {
  apiUrl: location.hostname === 'localhost'
    ? 'http://localhost:8787'
    : '', // set after deploying, e.g. https://prayer-request-api.<subdomain>.workers.dev
};
