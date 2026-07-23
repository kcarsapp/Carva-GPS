import Link from "next/link";
import { Truck } from "lucide-react";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Live demo", href: "/#demo" },
      { label: "Pricing", href: "/pricing" },
      { label: "Dashboard", href: "/fleet" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/" },
      { label: "Customers", href: "/" },
      { label: "Careers", href: "/" },
      { label: "Contact", href: "/" },
    ],
  },
  {
    title: "Carva GPS",
    links: [
      { label: "Live dashboard", href: "/fleet" },
      { label: "Sign in", href: "/login" },
      { label: "Status", href: "/" },
      { label: "Security", href: "/" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container grid grid-cols-2 gap-8 py-12 md:grid-cols-5">
        <div className="col-span-2">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Truck className="h-[18px] w-[18px]" />
            </span>
            <span className="text-lg font-bold tracking-tight">Carva Fleet</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Real-time, AI-powered fleet management for modern operations teams.
          </p>
        </div>

        {columns.map((c) => (
          <div key={c.title}>
            <h3 className="text-sm font-semibold">{c.title}</h3>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-sm text-muted-foreground sm:flex-row">
          <p>© 2026 Carva GPS. All rights reserved.</p>
          <p>Demo dashboard runs on mock data.</p>
        </div>
      </div>
    </footer>
  );
}
