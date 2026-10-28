import { cn } from "@/lib/utils";

/** Shimmering placeholder used while live data loads. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-md", className)}
      {...props}
    />
  );
}
