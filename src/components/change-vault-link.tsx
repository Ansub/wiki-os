import { Link } from "react-router-dom";

export function ChangeVaultLink({ className = "" }: { className?: string }) {
  return (
    <Link
      to="/setup?change=1"
      className={`surface inline-flex items-center rounded-full px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4 sm:text-sm ${className}`.trim()}
    >
      <span className="sm:hidden">Vault</span>
      <span className="hidden sm:inline">Change vault</span>
    </Link>
  );
}
