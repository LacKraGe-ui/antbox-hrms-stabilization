import type { DB } from '../db/client.js';
import type { Employee, LeaveRequest } from './types.js';

/**
 * Thin data-access layer over the system of record. Keeps SQL in one place
 * and exposes typed reads/writes. `deleted_at` implements soft deletes: even
 * an explicitly-authorised removal is reversible, so a bad sync can never be
 * a permanent data-loss event.
 */

interface EmployeeRow {
  id: string;
  full_name: string;
  email: string;
  department: string;
  status: Employee['status'];
  updated_at: string;
  deleted_at: string | null;
}

interface LeaveRow {
  id: string;
  employee_id: string;
  type: LeaveRequest['type'];
  start_date: string;
  end_date: string;
  status: LeaveRequest['status'];
  updated_at: string;
  deleted_at: string | null;
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    department: row.department,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function toLeave(row: LeaveRow): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
  };
}

export class Repository {
  constructor(private readonly db: DB) {}

  // ---- Employees ----

  listEmployees(includeDeleted = false): Employee[] {
    const sql = includeDeleted
      ? 'SELECT * FROM employees ORDER BY full_name'
      : 'SELECT * FROM employees WHERE deleted_at IS NULL ORDER BY full_name';
    return (this.db.prepare(sql).all() as EmployeeRow[]).map(toEmployee);
  }

  countEmployees(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM employees WHERE deleted_at IS NULL')
      .get() as { n: number };
    return row.n;
  }

  upsertEmployee(e: Employee): void {
    this.db
      .prepare(
        `INSERT INTO employees (id, full_name, email, department, status, updated_at, deleted_at)
         VALUES (@id, @fullName, @email, @department, @status, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           full_name = excluded.full_name,
           email = excluded.email,
           department = excluded.department,
           status = excluded.status,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      )
      .run(e);
  }

  softDeleteEmployee(id: string, at: string): void {
    this.db
      .prepare('UPDATE employees SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(at, id);
  }

  // ---- Leave requests ----

  listLeaveRequests(includeDeleted = false): LeaveRequest[] {
    const sql = includeDeleted
      ? 'SELECT * FROM leave_requests ORDER BY start_date DESC'
      : 'SELECT * FROM leave_requests WHERE deleted_at IS NULL ORDER BY start_date DESC';
    return (this.db.prepare(sql).all() as LeaveRow[]).map(toLeave);
  }

  countLeaveRequests(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM leave_requests WHERE deleted_at IS NULL')
      .get() as { n: number };
    return row.n;
  }

  upsertLeaveRequest(l: LeaveRequest): void {
    this.db
      .prepare(
        `INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, status, updated_at, deleted_at)
         VALUES (@id, @employeeId, @type, @startDate, @endDate, @status, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           employee_id = excluded.employee_id,
           type = excluded.type,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           status = excluded.status,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      )
      .run({ ...l, updatedAt: new Date().toISOString() });
  }

  softDeleteLeaveRequest(id: string, at: string): void {
    this.db
      .prepare('UPDATE leave_requests SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(at, id);
  }
}
