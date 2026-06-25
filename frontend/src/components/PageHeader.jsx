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
  actions = null,
  children = null,
  className = ""
}) {
  const navigate = useNavigate();
  const isToolbar = Boolean(children);

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

  const headerClass = ["page-header", isToolbar ? "page-header--toolbar" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={headerClass}>
      {isToolbar ? (
        <div className="page-header__toolbar">
          {showBack ? (
            <>
              <div className="page-header__toolbar-back">{backControl}</div>
              <div className="page-header__toolbar-divider" aria-hidden />
            </>
          ) : null}
          <div className="page-header__main page-header__main--toolbar">{children}</div>
        </div>
      ) : (
        <>
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
        </>
      )}
    </header>
  );
}
