import { getListingConnection } from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import { createListingProvider, isListingBoard } from "../../../../lib/listings/provider.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const connection = await getListingConnection();
      if (
        !connection
        || !isListingBoard(connection.board)
        || !connection.memberConfirmed
        || !connection.agreementConfirmed
      ) {
        return Response.json(
          { error: "Licensed listing access is not authorized for this workspace." },
          { status: 403 },
        );
      }

      const provider = createListingProvider(connection.board);
      if (!provider.isConfigured()) {
        return Response.json(
          {
            error: `${provider.label} authorization is saved, but the server-side RESO endpoint and access token still need to be configured.`,
            code: "credentials_required",
          },
          { status: 503 },
        );
      }

      const url = new URL(request.url);
      const query = (url.searchParams.get("query") ?? "").trim().slice(0, 120);
      const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
      return Response.json(await provider.search({ query, limit }));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Could not search active listings." },
        { status: 502 },
      );
    }
  });
}

