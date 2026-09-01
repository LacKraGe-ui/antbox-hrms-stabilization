import { z } from 'zod';

/**
 * Canonical record shapes. The brief provides the interfaces; here they are
 * expressed as zod schemas so the SAME definition validates:
 *   - data read out of our DB, and
 *   - data coming back from the external sync target.
 *
 * Strict validation of external responses is the first line of defence
 * against a malformed payload being interpreted as "delete everything".
 */

export const EmployeeStatus = z.enum(['active', 'terminated', 'on_leave']);
export type EmployeeStatus = z.infer<typeof EmployeeStatus>;

export const EmployeeSchema = z
  .object({
    id: z.string().min(1),
    fullName: z.string().min(1),
    email: z.string().email(),
    department: z.string().min(1),
    status: EmployeeStatus,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict(); // reject unknown keys — an unexpected shape is a red flag

export type Employee = z.infer<typeof EmployeeSchema>;

export const LeaveType = z.enum(['annual', 'sick', 'unpaid']);
export type LeaveType = z.infer<typeof LeaveType>;

export const LeaveStatus = z.enum(['pending', 'approved', 'rejected']);
export type LeaveStatus = z.infer<typeof LeaveStatus>;

export const LeaveRequestSchema = z
  .object({
    id: z.string().min(1),
    employeeId: z.string().min(1),
    type: LeaveType,
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    status: LeaveStatus,
  })
  .strict();

export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

/**
 * The shape the external target is expected to return. Note `employees` and
 * `leaveRequests` are REQUIRED arrays: an empty object, `null`, or a missing
 * key is a validation failure, not "the source is now empty, delete our
 * rows". That distinction is the whole ballgame.
 */
export const ExternalSyncPayloadSchema = z
  .object({
    employees: z.array(EmployeeSchema),
    leaveRequests: z.array(LeaveRequestSchema),
  })
  .strict();

export type ExternalSyncPayload = z.infer<typeof ExternalSyncPayloadSchema>;
