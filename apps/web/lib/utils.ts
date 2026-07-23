import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names, resolving conflicts (shadcn standard helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as a compact, locale-aware string. */
export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
