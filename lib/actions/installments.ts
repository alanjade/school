"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCanManageFees } from "@/lib/actions/fees";
import { writeAuditLog } from "@/lib/audit";
import { throwDbError } from "@/lib/errors/db";
import { runAction } from "@/lib/actionResult";

export type InstallmentInput = {
  dueDate: string;
  amountKobo: number;
};

const PATHS_TO_REVALIDATE = [
  "/dashboard/admin/fees/invoices",
  "/dashboard/student/fees",
  "/dashboard/parent/fees",
];

/**
 * Creates a plan, or wholesale replaces an existing one -- there's no
 * incremental "edit installment #2" operation. A schedule is small (a
 * handful of rows) and changing one due date or amount usually means
 * rethinking the whole plan anyway, so replace-the-set is simpler and
 * safer than reconciling a partial edit against whatever's already
 * been (or hasn't been) paid against the old rows.
 */
export async function createOrReplaceInstallmentPlan(
  invoiceId: string,
  installments: InstallmentInput[]
) {
  return runAction(async () => {
    const { id: actorId } = await assertCanManageFees(
      "Only an admin or the bursar can manage installment plans."
    );
    const admin = createAdminClient();

    if (installments.length < 2) {
      throw new Error(
        "An installment plan needs at least 2 installments -- for a single due date, just use the invoice's own due date instead."
      );
    }

    for (const inst of installments) {
      if (!inst.dueDate) throw new Error("Every installment needs a due date.");
      if (!Number.isInteger(inst.amountKobo) || inst.amountKobo <= 0) {
        throw new Error("Every installment amount must be a positive whole number of kobo.");
      }
    }

    // Sequence order comes from the due-date sort, not submission order --
    // "installment 1" should always mean "the one due soonest", regardless
    // of what order rows were added in the form.
    const sorted = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const scheduleTotalKobo = sorted.reduce((sum, i) => sum + i.amountKobo, 0);

    // One RPC call = one Postgres transaction (see
    // 20260807170000_atomic_installment_plan_replace.sql) -- delete-then-insert
    // used to be two separate Supabase calls here; if the insert failed
    // after the delete had already succeeded, the invoice was left with
    // an empty plan and no way back. The RPC re-validates the amount-sum
    // check itself against a fresh read of the invoice (never trusting a
    // client-computed total for something this consequential), so a
    // mismatch there also just rolls back cleanly instead of leaving a
    // partial write.
    const { error } = await admin.rpc("replace_invoice_installments", {
      p_invoice_id: invoiceId,
      p_created_by: actorId,
      p_installments: sorted.map((inst) => ({
        due_date: inst.dueDate,
        amount_kobo: inst.amountKobo,
      })),
    });
    if (error) throwDbError(error);

    await writeAuditLog({
      entityType: "invoice",
      entityId: invoiceId,
      action: "installment_plan_created",
      actorId,
      metadata: {
        installment_count: sorted.length,
        total_kobo: scheduleTotalKobo,
        due_dates: sorted.map((i) => i.dueDate),
      },
    });

    for (const path of PATHS_TO_REVALIDATE) revalidatePath(path);
  });
}

export async function deleteInstallmentPlan(invoiceId: string) {
  return runAction(async () => {
    const { id: actorId } = await assertCanManageFees(
      "Only an admin or the bursar can manage installment plans."
    );
    const admin = createAdminClient();

    const { error } = await admin.from("invoice_installments").delete().eq("invoice_id", invoiceId);
    if (error) throwDbError(error);

    await writeAuditLog({
      entityType: "invoice",
      entityId: invoiceId,
      action: "installment_plan_removed",
      actorId,
      metadata: {},
    });

    for (const path of PATHS_TO_REVALIDATE) revalidatePath(path);
  });
}
