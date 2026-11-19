import { flagValue } from "../args.ts";
import { getClient, type Flags } from "../context.ts";
import { out, printJson, table } from "../output.ts";
import { usageError } from "../usage.ts";
import { escapeFreeText } from "../../shared/terminal-text.ts";
import type { TaskUsageSummary, UsageQuery } from "../../shared/types.ts";

export async function cmdUsage(args: string[], flags: Flags): Promise<void> {
  const query: Omit<UsageQuery, "since"> & { since?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    switch (flag) {
      case "--since": query.since = flagValue(args, ++i, flag); break;
      case "--pipeline": query.pipeline = flagValue(args, ++i, flag); break;
      case "--profile": query.profile = flagValue(args, ++i, flag); break;
      case "--by": {
        const by = flagValue(args, ++i, flag);
        if (by !== "pipeline" && by !== "profile" && by !== "harness" && by !== "model") throw usageError("usage");
        query.by = by;
        break;
      }
      default: throw usageError("usage");
    }
  }
  const report = await (await getClient(flags)).getRunUsage(query);
  if (flags.json) return printJson(report);

  const counts = (row: Omit<TaskUsageSummary, "total">) =>
    [row.input, row.cacheWrite, row.cacheRead, row.output, row.reasoning].map((n) => String(n ?? "—"));
  if (report.groups?.length) {
    out(table(["Group", "Rows", "Input", "Cache write", "Cache read", "Output", "Reasoning", "Total"],
      report.groups.map((row) => [escapeFreeText(row.key ?? "—"), String(row.count), ...counts(row), String(row.total ?? "—")])));
  } else if (report.items?.length) {
    out(table(["Run", "Harness", "Model", "Persona", "Input", "Cache write", "Cache read", "Output", "Reasoning"],
      report.items.map((row) => [row.runId.slice(0, 8), escapeFreeText(row.harness),
        escapeFreeText(row.model ?? "—"), escapeFreeText(row.subagentPersona ?? "—"), ...counts(row)])));
  }
  out(`Total tokens ${report.total.total ?? "—"}`);
}
