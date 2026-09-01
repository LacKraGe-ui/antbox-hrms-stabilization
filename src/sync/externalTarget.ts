import type { Employee, LeaveRequest } from '../domain/types.js';

/**
 * Mock of the external sync target (in production this would be a Google
 * Sheets service account or an outbound webhook). It intentionally can
 * return *bad* data on demand, because the point of this trial is proving
 * the DB survives bad data — not proving the happy path works.
 *
 * `pull()` returns `unknown` on purpose: the sync service must not assume
 * anything about the shape until it has validated it. This mirrors reality —
 * a third-party API can return an HTML error page, `null`, or a truncated
 * body at any time.
 */

export type SyncScenario =
  | 'healthy' // normal round-trip: minor updates + one insert
  | 'empty' // the incident: source returns zero rows
  | 'malformed' // wrong shape / types — an API error page, etc.
  | 'null' // body is null/undefined
  | 'mass_delete' // valid shape but almost everything vanished upstream
  | 'partial_update'; // valid: a couple of updates + exactly one legit removal

export interface CurrentData {
  employees: Employee[];
  leaveRequests: LeaveRequest[];
}

export interface ExternalTarget {
  /** Simulate exporting our data to the target (push). Always safe. */
  push(data: CurrentData): Promise<{ rowsWritten: number }>;
  /** Simulate reading data back from the target (pull). May be hostile. */
  pull(scenario: SyncScenario, current: CurrentData): Promise<unknown>;
}

export class MockExternalTarget implements ExternalTarget {
  async push(data: CurrentData): Promise<{ rowsWritten: number }> {
    // A push is a pure export; it can never delete our records.
    return { rowsWritten: data.employees.length + data.leaveRequests.length };
  }

  async pull(scenario: SyncScenario, current: CurrentData): Promise<unknown> {
    switch (scenario) {
      case 'healthy': {
        const employees = current.employees.map((e, i) =>
          i === 0 ? { ...e, department: 'Platform', updatedAt: new Date().toISOString() } : e,
        );
        // one legitimate new hire coming back from the source
        employees.push({
          id: 'emp_100',
          fullName: 'Ishaan Bose',
          email: 'ishaan.bose@antbox.test',
          department: 'Engineering',
          status: 'active',
          updatedAt: new Date().toISOString(),
        });
        return { employees, leaveRequests: current.leaveRequests };
      }

      case 'partial_update': {
        // Drop exactly one employee (a genuine offboarding) + tweak one.
        const employees = current.employees
          .slice(1)
          .map((e, i) => (i === 0 ? { ...e, status: 'on_leave', updatedAt: new Date().toISOString() } : e));
        return { employees, leaveRequests: current.leaveRequests };
      }

      case 'empty':
        // The exact failure from the incident: source hands back nothing.
        return { employees: [], leaveRequests: [] };

      case 'mass_delete': {
        // Structurally valid, but 5 of 6 employees have "disappeared".
        return {
          employees: current.employees.slice(0, 1),
          leaveRequests: [],
        };
      }

      case 'malformed':
        // An API error rendered as JSON, or a schema drift. Wrong types,
        // missing required keys, unexpected top-level shape.
        return {
          data: 'Service Unavailable',
          employees: [{ id: 42, name: null }],
        };

      case 'null':
        return null;

      default:
        return null;
    }
  }
}
