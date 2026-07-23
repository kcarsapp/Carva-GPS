"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Truck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AccountType = "company" | "personal";

const ERRORS: Record<string, string> = {
  missing_fields: "Please fill in all required fields.",
  weak_password: "Password must be at least 6 characters.",
  missing_company: "Please enter your company name.",
  email_taken: "An account with that email already exists.",
  signup_unavailable: "Signup is temporarily unavailable. Please try again later.",
  create_failed: "Could not create your account. Please try again.",
  traccar_unreachable: "Can't reach the server right now. Please try again.",
};

export default function SignupPage() {
  const router = useRouter();
  const [accountType, setAccountType] = React.useState<AccountType>("personal");
  const [name, setName] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, accountType, companyName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.autoLogin === false) {
          router.replace("/login");
        } else {
          router.replace("/fleet");
        }
        return;
      }
      setError(ERRORS[data.error] ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-fleet grid min-h-screen place-items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Truck className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">Carva Fleet</span>
        </Link>

        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start tracking in minutes. Your data stays private to your account.
          </p>

          {/* Account type */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {(
              [
                { value: "personal", label: "Personal", icon: User, hint: "Track my own vehicle" },
                { value: "company", label: "Company", icon: Building2, hint: "Manage a fleet" },
              ] as const
            ).map((opt) => {
              const active = accountType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccountType(opt.value)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-accent",
                  )}
                >
                  <opt.icon
                    className={cn(
                      "h-5 w-5",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.hint}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Full name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                autoComplete="name"
                required
              />
            </div>

            {accountType === "company" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Company name</label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Logistics"
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                required
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
