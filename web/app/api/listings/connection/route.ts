import {
  deleteListingConnection,
  getListingConnection,
  setListingConnection,
} from "../../../../db/repo";
import { withAuth } from "../../../../lib/auth/server.ts";
import {
  isListingBoard,
  listingBoardCapabilities,
} from "../../../../lib/listings/provider.ts";

function connectionResponse(connection: Awaited<ReturnType<typeof getListingConnection>>) {
  const boards = listingBoardCapabilities();
  const selected = connection ? boards.find((board) => board.board === connection.board) : undefined;
  const authorized = Boolean(connection?.memberConfirmed && connection?.agreementConfirmed);
  return {
    connection,
    boards,
    authorized,
    ready: Boolean(authorized && selected?.configured),
    status: !connection
      ? "not_connected"
      : !authorized
        ? "authorization_required"
        : selected?.configured
          ? "ready"
          : "credentials_required",
  };
}

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      return Response.json(connectionResponse(await getListingConnection()));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Could not load licensed-listing access." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as {
        board?: unknown;
        memberConfirmed?: unknown;
        agreementConfirmed?: unknown;
      };
      if (!isListingBoard(body.board)) {
        return Response.json({ error: "Choose REBNY RLS or TRREB." }, { status: 400 });
      }
      if (body.memberConfirmed !== true || body.agreementConfirmed !== true) {
        return Response.json(
          { error: "Both membership/authorization and data-agreement confirmations are required." },
          { status: 400 },
        );
      }

      const connection = await setListingConnection({
        board: body.board,
        memberConfirmed: true,
        agreementConfirmed: true,
      });
      return Response.json(connectionResponse(connection));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Could not save licensed-listing access." },
        { status: 500 },
      );
    }
  });
}

export async function DELETE(request: Request) {
  return withAuth(request, async () => {
    try {
      await deleteListingConnection();
      return Response.json(connectionResponse(null));
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Could not disconnect the listing board." },
        { status: 500 },
      );
    }
  });
}

