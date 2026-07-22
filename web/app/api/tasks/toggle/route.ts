import { toggleTask } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { id?: unknown };
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return Response.json({ error: "id is required." }, { status: 400 });
      const task = await toggleTask(id);
      if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
      return Response.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update the task.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
