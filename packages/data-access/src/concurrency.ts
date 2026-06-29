/**
 * Optimistic concurrency helpers for DynamoDB conditional writes.
 */

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoItem } from "@st-lucie/shared-types";
import { getDocClient, getTableName } from "./client.js";

export class OptimisticLockError extends Error {
  constructor(message: string = "Item was modified by another request") {
    super(message);
    this.name = "OptimisticLockError";
  }
}

export async function putItemIfNotExists(item: DynamoItem): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new OptimisticLockError("Item already exists");
    }
    throw err;
  }
}

export async function putItemWithVersion(item: DynamoItem & { version: number }): Promise<void> {
  const client = getDocClient();
  const tableName = getTableName();

  const expectedVersion = item.version - 1;

  try {
    if (expectedVersion === 0) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)",
        }),
      );
    } else {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: "version = :expected",
          ExpressionAttributeValues: { ":expected": expectedVersion },
        }),
      );
    }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new OptimisticLockError();
    }
    throw err;
  }
}
