import { addSavedNeighborhood, deleteSavedNeighborhood, listSavedNeighborhoods } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      return Response.json({ views: await listSavedNeighborhoods() });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load saved views." }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as { name?: unknown; search?: unknown; statusFilter?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return Response.json({ error: "A name is required." }, { status: 400 });
      const view = await addSavedNeighborhood({
        name,
        search: typeof body.search === "string" ? body.search : "",
        statusFilter: typeof body.statusFilter === "string" ? body.statusFilter : "all",
      });
      return Response.json({ view }, { status: 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not save the view." }, { status: 500 });
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth(request, async () => {
    try {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return Response.json({ error: "id is required." }, { status: 400 });
      return Response.json(await deleteSavedNeighborhood(id));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not delete the view." }, { status: 500 });
    }
  });
}
