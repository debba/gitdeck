interface AvatarProps {
  login?: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ login, avatarUrl, size = 36, className }: AvatarProps) {
  // Prefer the provider-supplied avatar URL: reconstructing `https://github.com/<login>.png`
  // does not resolve for GitHub App / bot accounts (their avatars live at
  // avatars.githubusercontent.com/in/<app_id>). Fall back to the login-derived URL.
  const url = avatarUrl || (login ? `https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}` : null);
  const initials = (login || "?").slice(0, 1).toUpperCase();
  return (
    <span
      className={`avatar${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
    </span>
  );
}
