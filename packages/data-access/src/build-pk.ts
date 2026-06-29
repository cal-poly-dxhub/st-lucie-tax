/**
 * Tenant-prefixed partition key construction.
 *
 * Key structure:
 *   PK: TENANT#stlucie#ENTITY_TYPE#entity_id
 *   SK: METADATA | RELATED_ENTITY#entity_id | timestamp
 *
 * Global config uses GLOBAL# prefix:
 *   PK: GLOBAL#ENTITY_TYPE#entity_id
 */

export function buildPk(tenantId: string, entityType: string, entityId: string): string {
  return `TENANT#${tenantId}#${entityType}#${entityId}`;
}

export function buildGlobalPk(entityType: string, entityId: string): string {
  return `GLOBAL#${entityType}#${entityId}`;
}

export function buildConfigPk(tenantId: string): string {
  return `TENANT#${tenantId}#CONFIG`;
}

export function buildGsi1Pk(tenantId: string, locationId: string, date: string): string {
  return `TENANT#${tenantId}#LOCATION#${locationId}#DATE#${date}`;
}

export function buildGsi1Sk(appointmentId: string): string {
  return `APPT#${appointmentId}`;
}
