import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SettingsToggles } from "@/components/dashboard/settings-toggles";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your workspace, team, and notification preferences."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Company name</label>
                <Input defaultValue="Carva Logistics — Erbil, Iraq" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fleet size</label>
                <Input defaultValue="8 vehicles" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Billing email</label>
                <Input defaultValue="ops@carva.example" type="email" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Timezone</label>
                <Input defaultValue="Asia/Baghdad" />
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline">Cancel</Button>
              <Button>Save changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsToggles />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
