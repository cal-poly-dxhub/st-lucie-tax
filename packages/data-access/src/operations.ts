/**
 * Tenant-scoped DynamoDB operations.
 */

import { PutCommand, GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoItem } from "@st-lucie/shared-types";
import { getDocClient, getTableName } from "./client.js";
import { buildPk, buildGlobalPk, buildConfigPk } from "./build-pk.js";

export async function putItem(
  tenantId: string,
  item: DynamoItem,
  condition?: string,
  expressionValues?: Record<string, unknown>,
): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ...(condition && {
        ConditionExpression: condition,
        ...(expressionValues && { ExpressionAttributeValues: expressionValues }),
      }),
    }),
  );
}

export async function getItem(
  tenantId: string,
  entityType: string,
  entityId: string,
  sk: string,
): Promise<DynamoItem | undefined> {
  const client = getDocClient();
  const tableName = getTableName();

  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: buildPk(tenantId, entityType, entityId),
        SK: sk,
      },
    }),
  );

  return result.Item as DynamoItem | undefined;
}

export async function query(
  tenantId: string,
  entityType: string,
  entityId: string,
  skPrefix?: string,
): Promise<DynamoItem[]> {
  const client = getDocClient();
  const tableName = getTableName();

  const pk = buildPk(tenantId, entityType, entityId);

  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :skPrefix)" : "PK = :pk",
      ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":skPrefix": skPrefix } : { ":pk": pk },
    }),
  );
  return (result.Items || []) as DynamoItem[];
}

export async function queryGsi(
  indexName: string,
  pk: string,
  skPrefix?: string,
): Promise<DynamoItem[]> {
  const client = getDocClient();
  const tableName = getTableName();

  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: skPrefix
        ? "GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)"
        : "GSI1PK = :pk",
      ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":skPrefix": skPrefix } : { ":pk": pk },
    }),
  );
  return (result.Items || []) as DynamoItem[];
}

export async function getGlobalConfig(
  entityType: string,
  entityId: string,
): Promise<DynamoItem | undefined> {
  const client = getDocClient();
  const tableName = getTableName();

  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: buildGlobalPk(entityType, entityId),
        SK: "METADATA",
      },
    }),
  );

  return result.Item as DynamoItem | undefined;
}

export async function resolveConfig(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<DynamoItem | undefined> {
  // Check tenant-specific override first
  const tenantItem = await getItem(tenantId, entityType, entityId, "METADATA");
  if (tenantItem) return tenantItem;

  // Fall back to global default
  return getGlobalConfig(entityType, entityId);
}

export async function getConfigValue(
  tenantId: string,
  configKey: string,
): Promise<unknown | undefined> {
  const client = getDocClient();
  const tableName = getTableName();

  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: buildConfigPk(tenantId),
        SK: configKey,
      },
    }),
  );

  return result.Item?.value;
}

export async function putConfigValue(
  tenantId: string,
  configKey: string,
  value: unknown,
): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();

  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: buildConfigPk(tenantId),
        SK: configKey,
        entityType: "CONFIG",
        configType: configKey,
        value,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

export async function queryGlobalByPrefix(
  entityType: string,
  entityId: string,
  skPrefix: string,
): Promise<DynamoItem[]> {
  const client = getDocClient();
  const tableName = getTableName();

  const pk = buildGlobalPk(entityType, entityId);
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: { ":pk": pk, ":skPrefix": skPrefix },
    }),
  );

  return (result.Items || []) as DynamoItem[];
}

export async function deleteItem(
  tenantId: string,
  entityType: string,
  entityId: string,
  sk: string,
): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();

  await client.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        PK: buildPk(tenantId, entityType, entityId),
        SK: sk,
      },
    }),
  );
}
