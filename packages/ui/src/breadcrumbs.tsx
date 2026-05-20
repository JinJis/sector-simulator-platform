import Link from "next/link";
import type { ReactNode } from "react";

export interface BreadcrumbItem {
  label: ReactNode;
  /** Omit on the trailing/current item — that item renders as plain text. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Override the separator. Default is `/`. */
  separator?: ReactNode;
  /** Add a custom class to the outer container. */
  className?: string;
}

/**
 * Server-friendly breadcrumb trail. Every item except the last gets a
 * `<Link>`; the last item is the current page and renders as plain text
 * so screen readers don't announce a self-link.
 *
 * Designed to replace the ad-hoc `← back` links scattered across detail
 * pages — those give one step of context; this gives the full path and
 * makes mid-tree jumps possible.
 */
export function Breadcrumbs({
  items,
  separator = "/",
  className,
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={
        "flex items-center gap-1.5 text-[11px] text-neutral-500 " +
        (className ?? "")
      }
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-neutral-400 hover:text-neutral-200 hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-medium text-neutral-200" : ""}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden="true" className="text-neutral-700">
                  {separator}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
