import { describe, it, expect } from 'vitest';
import {
  ExternalSyncPayloadSchema,
  EmployeeSchema,
} from '../src/domain/types.js';

describe('Strict external-payload validation', () => {
  const validEmployee = {
    id: 'emp_1',
    fullName: 'Test User',
    email: 'test@antbox.test',
    department: 'Eng',
    status: 'active',
    updatedAt: new Date().toISOString(),
  };

  it('accepts a well-formed payload', () => {
    const r = ExternalSyncPayloadSchema.safeParse({
      employees: [validEmployee],
      leaveRequests: [],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a structurally-empty payload (arrays present but empty)', () => {
    // Note: shape is valid — it is the SyncService, not the schema, that
    // decides an empty set must not cause deletions.
    const r = ExternalSyncPayloadSchema.safeParse({ employees: [], leaveRequests: [] });
    expect(r.success).toBe(true);
  });

  it('rejects a missing top-level key', () => {
    const r = ExternalSyncPayloadSchema.safeParse({ employees: [validEmployee] });
    expect(r.success).toBe(false);
  });

  it('rejects wrong field types', () => {
    const r = EmployeeSchema.safeParse({ ...validEmployee, id: 42, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown status enum value', () => {
    const r = EmployeeSchema.safeParse({ ...validEmployee, status: 'deleted' });
    expect(r.success).toBe(false);
  });

  it('rejects unexpected extra keys (strict mode)', () => {
    const r = EmployeeSchema.safeParse({ ...validEmployee, isAdmin: true });
    expect(r.success).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(ExternalSyncPayloadSchema.safeParse('Service Unavailable').success).toBe(false);
    expect(ExternalSyncPayloadSchema.safeParse(null).success).toBe(false);
  });
});
