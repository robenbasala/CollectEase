/** Registered by AuthContext — avoids circular imports with apiClient. */
let tokenGetter = () => Promise.resolve(null);
let companyIdGetter = () => null;

export function registerAuthSession({ getIdToken, getApiCompanyId }) {
  if (typeof getIdToken === "function") tokenGetter = getIdToken;
  if (typeof getApiCompanyId === "function") companyIdGetter = getApiCompanyId;
}

export async function getFirebaseIdToken() {
  try {
    return await tokenGetter();
  } catch {
    return null;
  }
}

export function getApiCompanyId() {
  try {
    return companyIdGetter();
  } catch {
    return null;
  }
}
