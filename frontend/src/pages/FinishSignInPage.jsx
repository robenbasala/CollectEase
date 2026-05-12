import { Navigate } from "react-router-dom";

/** Legacy route; app uses email + password on /login only. */
export default function FinishSignInPage() {
  return <Navigate to="/login" replace />;
}
