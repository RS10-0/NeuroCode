import { Link } from "react-router-dom";

import { Callout } from "../../components/ui";

/*
 * What an under-13 account sees instead of a screen it cannot
 * use — Publish and Deploy — rather than a form whose every
 * button the server refuses (account/rules.ts mayPublish).
 *
 * Says what still works, because "you can't do this" on its own
 * reads as a dead end, and most of the product is still open.
 */
export default function UnderThirteenNotice({
  what,
  backTo,
}: {
  what: string;
  backTo: string;
}) {
  return (
    <div className="page">
      <Callout tone="info" title={`Accounts for under-13s can't ${what}`}>
        <p>
          Your parent or guardian agreed to an account where nothing you make
          can be seen by people outside BuildGentic, so sharing agents publicly
          is switched off. You can still build your agents, test them, and use
          them yourself — that all works as normal.
        </p>
        <p>
          <Link to={backTo}>Back to your agent</Link>
        </p>
      </Callout>
    </div>
  );
}
