// A "company" (tenant) is modelled as a Traccar user tagged with Carva
// attributes. The super-admin (a Traccar administrator) creates these, assigns
// GPS devices to them, and each company user then sees only its own cars.
//
// We don't have the Carva backend yet, so this leans on Traccar's native
// users + permissions. When the NestJS API lands, companies move into Postgres.

import type { AccountType } from '@carva/shared';

/** Marker attribute so we can tell company users apart from plain users/admins. */
export const CARVA_KIND = 'carvaKind';
export const CARVA_ACCOUNT_TYPE = 'carvaAccountType';

/** A Traccar user record (subset we care about). */
export interface TraccarUserRecord {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  disabled: boolean;
  deviceLimit: number;
  userLimit: number;
  attributes: Record<string, unknown>;
}

export interface Company {
  id: number;
  name: string;
  email: string;
  accountType: AccountType;
  disabled: boolean;
  deviceLimit: number;
}

export function isCompany(u: TraccarUserRecord): boolean {
  return u.attributes?.[CARVA_KIND] === 'company';
}

export function toCompany(u: TraccarUserRecord): Company {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    accountType: (u.attributes?.[CARVA_ACCOUNT_TYPE] as AccountType) ?? 'personal',
    disabled: u.disabled,
    deviceLimit: u.deviceLimit,
  };
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  personal: 'Personal',
  car_rental: 'Car Rental',
  school_bus: 'School Bus',
  logistics: 'Logistics',
};

/** Build the POST body for creating a company user in Traccar. */
export function newCompanyPayload(input: {
  name: string;
  email: string;
  password: string;
  accountType: AccountType;
  deviceLimit: number;
}) {
  return {
    name: input.name,
    email: input.email,
    password: input.password,
    // A company manages its own devices and sub-users.
    deviceLimit: input.deviceLimit,
    userLimit: -1,
    attributes: {
      [CARVA_KIND]: 'company',
      [CARVA_ACCOUNT_TYPE]: input.accountType,
    },
  };
}
