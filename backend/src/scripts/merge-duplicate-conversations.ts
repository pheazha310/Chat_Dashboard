/**
 * One-off clean-up: one support conversation per customer.
 *
 * Older data has several conversations for the same customer (one per application, or one per archive). For each
 * customer with more than one, the conversation with the latest activity is kept and the others are merged into it:
 * messages (renumbered in time order), attachments, pins, notes, escalations, calls, callbacks, spam reports,
 * activities, assignments and notifications move over, then the emptied conversations are deleted. Per-conversation
 * state that cannot be merged (read positions of the removed ones, drafts, open tabs, tags, participants) is dropped
 * with them. The kept conversation is un-archived.
 *
 *   pnpm --filter @chat-dashboard/backend tsx src/scripts/merge-duplicate-conversations.ts           # dry run
 *   pnpm --filter @chat-dashboard/backend tsx src/scripts/merge-duplicate-conversations.ts --apply   # for real
 *
 * Everything runs in ONE transaction. Without `--apply` it is rolled back at the end, so the dry run exercises every
 * constraint and prints the counts without changing anything. Run it with the API stopped or idle. Reads DATABASE_URL.
 */
import { prisma } from "@config/database.js";

const APPLY = process.argv.includes("--apply");
const BIG = 1_000_000_000_000n;

/** Tables whose rows point at a conversation and must follow it (the rest cascade or are dropped with it). */
const MOVED_TABLES = [
  "attachments",
  "message_pins",
  "internal_notes",
  "conversation_escalations",
  "conversation_activities",
  "conversation_assignments",
  "automation_logs",
  "callback_requests",
  "calls",
  "spam_reports",
  "notifications",
] as const;

interface Group {
  customerId: string;
  keep: string;
  merge: string[];
}

class DryRunDone extends Error {}

async function main() {
  const rows = await prisma.$queryRaw<{ customerId: string; ids: string[] }[]>`
    SELECT customer_id AS "customerId",
           array_agg(id::text ORDER BY last_message_at DESC, id DESC) AS ids
      FROM conversations
     WHERE conversation_type = 'CUSTOMER_SUPPORT' AND customer_id IS NOT NULL
     GROUP BY customer_id HAVING count(*) > 1`;
  const groups: Group[] = rows.map((row) => ({
    customerId: row.customerId,
    keep: row.ids[0]!,
    merge: row.ids.slice(1),
  }));
  if (groups.length === 0) return console.log("Nothing to merge: every customer has one conversation.");
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}: ${groups.length} customer(s) with duplicate conversations.`);

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const { customerId, keep, merge } of groups) {
          console.log(`\ncustomer ${customerId}: keep ${keep}, merge ${merge.length} into it`);
          const sources = merge;

          // Lock them all, in a stable order.
          await tx.$queryRaw`SELECT id FROM conversations WHERE id = ANY(${[keep, ...sources]}::uuid[]) ORDER BY id FOR UPDATE`;

          // 1. Only one open OWNER and one pending escalation per conversation: close the old ones first.
          await tx.$executeRaw`
            UPDATE conversation_assignments SET ended_at = GREATEST(now(), assigned_at)
             WHERE conversation_id = ANY(${sources}::uuid[]) AND ended_at IS NULL`;
          await tx.$executeRaw`
            UPDATE conversation_escalations SET status = 'CANCELLED'
             WHERE conversation_id = ANY(${sources}::uuid[]) AND status = 'PENDING'`;
          await tx.$executeRaw`
            UPDATE calls SET status = 'ENDED'
             WHERE conversation_id = ANY(${sources}::uuid[]) AND status IN ('INITIATING','RINGING','ACTIVE')`;

          // 2. Messages: push every sequence out of the way, move them, then number all of them in time order.
          // Each conversation gets its own offset, so no two messages share a number while they are being moved.
          for (const [index, id] of [keep, ...sources].entries()) {
            await tx.$executeRaw`UPDATE messages SET sequence_number = sequence_number + ${BIG * BigInt(index + 1)}
                                  WHERE conversation_id = ${id}::uuid`;
          }
          // A message-attachment link points at both its message and its attachment in the same conversation, and the
          // two cannot move in one step: lift the links out and put them back once both have moved.
          await tx.$executeRaw`CREATE TEMP TABLE merge_links AS
                                SELECT * FROM message_attachments WHERE conversation_id = ANY(${sources}::uuid[])`;
          await tx.$executeRaw`DELETE FROM message_attachments WHERE conversation_id = ANY(${sources}::uuid[])`;
          // Read positions point at messages, so they would follow them and clash with the kept ones: drop them first.
          await tx.$executeRaw`DELETE FROM conversation_reads WHERE conversation_id = ANY(${sources}::uuid[])`;
          // A client id is unique per conversation only; tag the moved ones with their old conversation so none clash.
          await tx.$executeRaw`UPDATE messages SET client_id = left(client_id, 90) || '~' || left(conversation_id::text, 8)
                                WHERE conversation_id = ANY(${sources}::uuid[]) AND client_id IS NOT NULL`;
          const moved = await tx.$executeRaw`UPDATE messages SET conversation_id = ${keep}::uuid
                                              WHERE conversation_id = ANY(${sources}::uuid[])`;
          await tx.$executeRaw`
            UPDATE messages m SET sequence_number = r.rn
              FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
                      FROM messages WHERE conversation_id = ${keep}::uuid) r
             WHERE m.id = r.id`;
          console.log(`  messages moved: ${moved}`);

          // 3. Everything else that points at the conversation.
          for (const table of MOVED_TABLES) {
            const count = await tx.$executeRawUnsafe(
              `UPDATE ${table} SET conversation_id = $1::uuid WHERE conversation_id = ANY($2::uuid[])`,
              keep,
              sources,
            );
            if (count > 0) console.log(`  ${table} moved: ${count}`);
          }

          await tx.$executeRaw`UPDATE merge_links SET conversation_id = ${keep}::uuid`;
          await tx.$executeRaw`INSERT INTO message_attachments SELECT * FROM merge_links`;
          await tx.$executeRaw`DROP TABLE merge_links`;

          // 4. Read positions of the kept conversation follow the renumbered messages.
          await tx.$executeRaw`
            UPDATE conversation_reads r SET last_read_sequence_number = m.sequence_number
              FROM messages m
             WHERE r.conversation_id = ${keep}::uuid AND r.last_read_message_id = m.id`;

          // 5. Bring the kept conversation up to date, then drop the emptied ones.
          // The kept conversation has the latest activity, so its preview and time stay as they are.
          await tx.$executeRaw`
            UPDATE conversations SET is_archived = false, archived_at = NULL,
                   last_sequence_number = (SELECT max(sequence_number) FROM messages WHERE conversation_id = ${keep}::uuid)
             WHERE id = ${keep}::uuid`;
          const removed = await tx.$executeRaw`DELETE FROM conversations WHERE id = ANY(${sources}::uuid[])`;
          console.log(`  conversations removed: ${removed}`);
        }
        if (!APPLY) throw new DryRunDone();
      },
      { timeout: 120_000 },
    );
    console.log("\nApplied.");
  } catch (error) {
    if (error instanceof DryRunDone)
      return console.log("\nDry run complete: the constraints held. Nothing was changed.");
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
