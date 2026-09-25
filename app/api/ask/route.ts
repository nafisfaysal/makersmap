import { z } from "zod";
import { listPublicMakers } from "@/app/makers-lookup";
import { askAtlas, directAsk, rulesAsk } from "@/lib/ask";

const input = z.object({ query: z.string().trim().min(2).max(300), fast: z.boolean().optional() });

export async function POST(request: Request) {
  try {
    const { query, fast } = input.parse(await request.json());
    const pool = await listPublicMakers();
    // "fast" answers from keywords in milliseconds; the page shows it while the model ranks.
    const answer = fast ? (directAsk(query, pool) ?? rulesAsk(query, pool)) : await askAtlas(query, pool);
    const byHandle = new Map(pool.map((m) => [m.handle, m]));
    return Response.json({
      ...answer,
      results: answer.results.map((r) => {
        const m = byHandle.get(r.handle);
        return m ? { ...r, name: m.name, role: m.role, city: m.city, flag: m.flag, avatar: m.avatar, initials: m.initials, color: m.color, project: m.project } : r;
      }),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ask something between 2 and 300 characters." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Could not search." }, { status: 500 });
  }
}
