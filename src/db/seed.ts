import type { DB } from './client.js';
import { openDb } from './client.js';
import { runMigrations } from './migrate.js';
import { Repository } from '../domain/repository.js';
import type { Employee, LeaveRequest } from '../domain/types.js';
import { loadEnv } from '../config/env.js';
import { loadDotenv } from '../config/loadDotenv.js';

const now = () => new Date().toISOString();

export const SEED_EMPLOYEES: Employee[] = [
  { id: 'emp_001', fullName: 'Aarav Mehta',   email: 'aarav.mehta@antbox.test',   department: 'Engineering', status: 'active',     updatedAt: now() },
  { id: 'emp_002', fullName: 'Priya Sharma',   email: 'priya.sharma@antbox.test',  department: 'Product',     status: 'active',     updatedAt: now() },
  { id: 'emp_003', fullName: 'Rohan Verma',    email: 'rohan.verma@antbox.test',   department: 'Sales',       status: 'on_leave',   updatedAt: now() },
  { id: 'emp_004', fullName: 'Ananya Nair',    email: 'ananya.nair@antbox.test',   department: 'Design',      status: 'active',     updatedAt: now() },
  { id: 'emp_005', fullName: 'Karan Gupta',    email: 'karan.gupta@antbox.test',   department: 'Engineering', status: 'terminated', updatedAt: now() },
  { id: 'emp_006', fullName: 'Sneha Reddy',    email: 'sneha.reddy@antbox.test',   department: 'HR',          status: 'active',     updatedAt: now() },
];

export const SEED_LEAVE: LeaveRequest[] = [
  { id: 'lv_001', employeeId: 'emp_001', type: 'annual', startDate: '2026-09-10', endDate: '2026-09-14', status: 'approved' },
  { id: 'lv_002', employeeId: 'emp_003', type: 'sick',   startDate: '2026-08-28', endDate: '2026-09-05', status: 'approved' },
  { id: 'lv_003', employeeId: 'emp_002', type: 'unpaid', startDate: '2026-10-01', endDate: '2026-10-03', status: 'pending' },
  { id: 'lv_004', employeeId: 'emp_004', type: 'annual', startDate: '2026-09-20', endDate: '2026-09-22', status: 'rejected' },
];

export function seed(db: DB): { employees: number; leave: number } {
  runMigrations(db);
  const repo = new Repository(db);
  for (const e of SEED_EMPLOYEES) repo.upsertEmployee(e);
  for (const l of SEED_LEAVE) repo.upsertLeaveRequest(l);
  return { employees: SEED_EMPLOYEES.length, leave: SEED_LEAVE.length };
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  loadDotenv();
  const env = loadEnv();
  const db = openDb(env.DATABASE_URL);
  const counts = seed(db);
  console.log(
    `✓ Seeded ${counts.employees} employees and ${counts.leave} leave requests.`,
  );
  db.close();
}
