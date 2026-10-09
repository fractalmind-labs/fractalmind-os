// App v2 (#75) shared view helpers, ported from the prototype's core.js:
// icons, the logo, translation, time formatting, buttons and the dialog.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { ICONS } from "./icons";

export type Translate = (zh: string, en: string) => string;
export type Lang = "zh" | "en";
const LangContext = createContext<Lang>("zh");
export const LangProvider = LangContext.Provider;
export function useT(): Translate {
  const lang = useContext(LangContext);
  return (zh, en) => (lang === "zh" ? zh : en);
}
export function useLang() {
  return useContext(LangContext);
}

export function Icon({ name, size, className }: { name: string; size?: "xs" | "sm" | "lg"; className?: string }) {
  return (
    <svg
      className={["i", size, className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      aria-hidden="true"
      // Static markup from the prototype's icon table, never user data.
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
    />
  );
}

/** The recursive-square mark; its gradient is defined once by <LogoDefs>. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="url(#fm-g24)" strokeWidth="1.8" />
      <rect x="6" y="6" width="6.2" height="6.2" rx="1.4" fill="url(#fm-g24)" />
      <rect x="13.2" y="13.2" width="3.3" height="3.3" rx=".8" fill="url(#fm-g24)" />
      <rect x="17" y="17" width="1.7" height="1.7" rx=".4" fill="url(#fm-g24)" />
    </svg>
  );
}
export function LogoDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="fm-g24" gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0" stopColor="#06b6d4" />
          <stop offset=".52" stopColor="#5b5bd6" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const locale = (lang: Lang) => (lang === "en" ? "en" : "zh-CN");
export function ago(ts: number | null | undefined, t: Translate, lang: Lang, now = Date.now()) {
  if (!ts) return t("从未", "never");
  const s = Math.round((now - ts) / 1000);
  if (s < 0) return until(ts, t, now);
  if (s < 45) return t("刚刚", "just now");
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
export function until(ts: number, t: Translate, now = Date.now()) {
  const s = Math.round((ts - now) / 1000);
  if (s <= 0) return t("已到期", "expired");
  if (s < 3600) {
    const m = Math.max(1, Math.round(s / 60));
    return t(`剩 ${m} 分钟`, `${m} min left`);
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return t(`剩 ${h} 小时`, `${h} h left`);
  }
  const d = Math.round(s / 86400);
  return t(`剩 ${d} 天`, `${d} day${d === 1 ? "" : "s"} left`);
}
export const date = (ts: number | null | undefined, lang: Lang) =>
  ts ? new Intl.DateTimeFormat(locale(lang), { month: "short", day: "numeric" }).format(ts) : "—";
export const dateTime = (ts: number | null | undefined, lang: Lang) =>
  ts
    ? new Intl.DateTimeFormat(locale(lang), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ts)
    : "—";
export const shortId = (id?: string | null, head = 6) =>
  id && id.length > head + 6 ? `${id.slice(0, head)}…${id.slice(-4)}` : id || "";
export const sui = (mist: bigint | string | number) => {
  const n = BigInt(mist);
  return `${n / 1_000_000_000n}.${(n % 1_000_000_000n).toString().padStart(9, "0").slice(0, 4)} SUI`;
};

/** A prototype button. `why` explains a disabled action on hover. */
export function Btn({
  label,
  icon,
  kind,
  size,
  disabled,
  why,
  onClick,
  type = "button",
  className,
  aria,
  iconEnd,
}: {
  label?: string;
  icon?: string;
  /** An icon after the label, as the prototype's “Next →”. */
  iconEnd?: string;
  kind?: "primary" | "ghost" | "danger" | "";
  size?: "sm" | "lg" | "icon" | "icon sm" | "";
  disabled?: boolean;
  why?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
  aria?: string;
}) {
  return (
    <button
      type={type}
      className={["btn", kind, size, className].filter(Boolean).join(" ")}
      disabled={disabled}
      title={disabled ? why : undefined}
      aria-label={label ? undefined : aria}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {label && <span>{label}</span>}
      {iconEnd && <Icon name={iconEnd} size="sm" />}
    </button>
  );
}

/** The prototype's modal: scrim, header with close, body, optional footer. */
export function Dialog({
  title,
  sub,
  size,
  onClose,
  footer,
  children,
}: {
  title: string;
  sub?: string;
  size?: "sm" | "lg";
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={["dialog", size].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-h">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="btn ghost icon sm" aria-label={t("关闭", "Close")} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-b">{children}</div>
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Placeholder for prototype features without a backend yet. */
export function ComingSoon({ title, children }: { title: string; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="card">
      <div className="empty">
        <div className="ico">
          <Icon name="clock" size="lg" />
        </div>
        <h3>{title}</h3>
        <p className="small">{children}</p>
        <span className="chip outline mt-8">{t("即将推出", "Coming soon")}</span>
      </div>
    </div>
  );
}

export function Empty({ icon = "layers", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="card">
      <div className="empty">
        <div className="ico">
          <Icon name={icon} size="lg" />
        </div>
        <h3>{title}</h3>
        {children && <div className="small">{children}</div>}
      </div>
    </div>
  );
}
