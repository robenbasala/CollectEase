/** Default app logo — `frontend/public/Logo.png` (served at site root). */
const base = import.meta.env.BASE_URL || "/";
export const APP_LOGO_URL = `${base}Logo.png`.replace(/([^:])\/{2,}/g, "$1/");
