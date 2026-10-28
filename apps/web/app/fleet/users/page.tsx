"use client";

import { ShieldCheck as PageIcon } from "lucide-react";
import * as React from "react";
import { ShieldCheck } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { useI18n } from "@/lib/i18n-provider";
import { useSession } from "@/lib/live-data";

interface TraccarUserRow {
  id: number;
  name: string;
  email: string;
  administrator?: boolean;
  disabled?: boolean;
  attributes?: { accountType?: string; companyName?: string };
}

type Role = "general_admin" | "company" | "personal";

function roleOf(u: TraccarUserRow): Role {
  if (u.administrator) return "general_admin";
  return u.attributes?.accountType === "personal" ? "personal" : "company";
}

const ROLE_BADGE: Record<Role, { label: string; variant: "default" | "info" | "secondary" }> = {
  general_admin: { label: "Admin", variant: "default" },
  company: { label: "Company", variant: "info" },
  personal: { label: "Personal", variant: "secondary" },
};

export default function UsersPage() {
  const { t } = useI18n();
  const session = useSession();
  const [users, setUsers] = React.useState<TraccarUserRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const isAdmin = session.user?.role === "general_admin";

  React.useEffect(() => {
    if (session.loading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetch("/api/traccar/users", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as TraccarUserRow[];
        if (alive) {
          setUsers(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setError("Could not load users.");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [session.loading, isAdmin]);

  if (!session.loading && !isAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">Administrators only</p>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have permission to view this page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("fleet.nav.group.manage")}
        icon={PageIcon}
        title={t("fleet.nav.users")}
        description={t("users.desc")}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Loading users…
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              users.map((u) => {
                const role = roleOf(u);
                const badge = ROLE_BADGE[role];
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.attributes?.companyName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.disabled ? (
                        <Badge variant="muted">Disabled</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            {!loading && users.length === 0 && !error && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {!loading && users.length > 0 && (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            {users.length} user{users.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </>
  );
}
