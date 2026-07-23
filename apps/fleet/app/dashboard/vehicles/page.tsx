import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { VehicleTable } from "@/components/dashboard/vehicle-table";
import { vehicles } from "@/mock/vehicles";
import { drivers } from "@/mock/drivers";

export default function VehiclesPage() {
  return (
    <>
      <PageHeader
        title="Vehicles"
        description="Every unit in your fleet, searchable and filterable by status."
        action={
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Add vehicle
          </Button>
        }
      />
      <VehicleTable vehicles={vehicles} drivers={drivers} />
    </>
  );
}
