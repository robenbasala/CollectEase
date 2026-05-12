import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

export default function PageHeader({
  title,
  subtitle,
  icon = null,
  showBack = true,
  backLabel = "Back",
  backTo = "/",
  onBack,
  actions = null
}) {
  const navigate = useNavigate();

  const backContent = (
    <>
      <ArrowLeft size={18} strokeWidth={2.25} aria-hidden />
      {backLabel}
    </>
  );

  const backControl = !showBack ? (
    <span aria-hidden />
  ) : onBack ? (
    <button type="button" className="page-header__back" onClick={onBack}>
      {backContent}
    </button>
  ) : backTo === -1 ? (
    <button type="button" className="page-header__back" onClick={() => navigate(-1)}>
      {backContent}
    </button>
  ) : (
    <Link to={backTo} className="page-header__back">
      {backContent}
    </Link>
  );

  return (
    <header className="page-header">
      <div className="page-header__side page-header__side--left">{backControl}</div>
      <div className="page-header__main">
        <h1 className="page-header__title">
          {icon ? (
            <span className="page-header__icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          {title}
        </h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      <div className="page-header__side page-header__side--right">{actions}</div>
    </header>
  );
}
