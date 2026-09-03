import { useEffect, useState } from "react";
import { Plug, Trash2, TriangleAlert } from "lucide-react";

import {
  Button,
  Callout,
  Field,
  IconButton,
  Input,
  Select,
} from "../../components/ui";
import {
  createConnection,
  deleteConnection,
  fetchConnections,
  type Connection,
  type ConnectionAuth,
} from "./connectionsApi";
import type { CapabilityId } from "./vocab";

/*
 * Where a learner gives their agent a key.
 *
 * The whole section exists for one sentence, and every choice
 * below is in service of it: the agent is told the NAME of a
 * connection and never its key. It cannot read one back, cannot
 * be talked into repeating one, and the prompt it runs on has
 * never contained one — the server attaches the credential on
 * the way out, after the address has been checked.
 *
 * That sentence is on the screen rather than in documentation,
 * because "could someone trick my agent into leaking my API
 * key" is the right question for a fifteen-year-old to ask at
 * exactly the moment they are typing one in, and the answer
 * should be where the question occurs.
 *
 * There is no edit. A connection is small enough that changing
 * one is deleting it and making another, and leaving that path
 * out removes a question the form would otherwise have to
 * answer on every save: does an empty key field mean "leave it
 * alone" or "there is no key now"? Two reasonable readings, one
 * of which silently strips a credential.
 */

const AUTH_LABELS: Record<ConnectionAuth, string> = {
  none: "No key needed (public API)",
  bearer: "Bearer token (Authorization header)",
  header: "Custom header",
  query: "Query parameter",
};

const AUTH_ORDER: ConnectionAuth[] = ["none", "bearer", "header", "query"];

interface ActionsSectionProps {
  agentId: string | null;
  capabilities: CapabilityId[];
}

interface FormState {
  label: string;
  description: string;
  baseUrl: string;
  authKind: ConnectionAuth;
  authName: string;
  secret: string;
  methods: string[];
}

const EMPTY_FORM: FormState = {
  label: "",
  description: "",
  baseUrl: "",
  authKind: "none",
  authName: "",
  secret: "",
  methods: ["GET"],
};

/*
 * Mirrors normalizeSlug on the server.
 *
 * Duplicated rather than shared because the server's copy sits
 * behind a Supabase client this bundle has no business
 * importing. The cost of the duplication is bounded: the server
 * runs its own copy on the way in, so a drift here shows the
 * learner a slightly wrong preview rather than storing a
 * slightly wrong name.
 */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export default function ActionsSection({
  agentId,
  capabilities,
}: ActionsSectionProps) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [methods, setMethods] = useState<string[]>(["GET", "POST"]);
  const [secretsAvailable, setSecretsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const enabled = capabilities.includes("http_actions");

  /*
   * The first read, on mount and whenever the agent or the
   * capability changes — including null becoming an id, which
   * is what saving a draft looks like.
   *
   * Written as an async body rather than a promise chain that
   * sets a loading flag on the way in, and the difference is
   * not cosmetic: a synchronous setState inside an effect is
   * the cascading render the lint rule is right to object to.
   * The same shape useAgentMemory and useKnowledgeIndex both
   * use, for the same reason. `loading` therefore starts true
   * and is only ever turned off.
   */
  useEffect(() => {
    if (!agentId || !enabled) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const state = await fetchConnections(agentId);

        if (!active) {
          return;
        }

        setConnections(state.connections);
        setSecretsAvailable(state.secretsAvailable);

        if (state.methods.length > 0) {
          setMethods(state.methods);
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load connections."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId, enabled]);

  async function save() {
    if (!agentId) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await createConnection(agentId, {
        slug: slugify(form.label),
        label: form.label,
        description: form.description || undefined,
        baseUrl: form.baseUrl,
        authKind: form.authKind,
        authName: form.authName || undefined,
        allowedMethods: form.methods,
        secret: form.authKind === "none" ? undefined : form.secret,
      });

      setConnections((current) => [...current, created.connection]);
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save that connection."
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(connection: Connection) {
    if (!agentId) {
      return;
    }

    setError(null);

    try {
      await deleteConnection(agentId, connection.id);

      setConnections((current) =>
        current.filter((entry) => entry.id !== connection.id)
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not remove that connection."
      );
    }
  }

  const canSave =
    !saving &&
    form.label.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    form.methods.length > 0 &&
    (form.authKind === "none" || form.secret.length > 0);

  return (
    <section className="agentsec" aria-labelledby="agentsec-actions">
      <div className="agentsec__head">
        <h2 className="agentsec__title" id="agentsec-actions">
          Connections
        </h2>

        <p className="agentsec__lede">
          Services your agent is allowed to use. You give the address and the
          key; your agent is told only the name. It never sees the key, cannot
          read it back, and cannot repeat it to anyone who asks — BuildGentic
          attaches the key on the way out, after checking the address.
        </p>
      </div>

      <div className="agentsec__body">
        {!enabled ? (
          /*
           * The capability is off, so a connection would do
           * nothing. Said plainly with the fix in it rather than
           * hiding the section: somebody who came here looking
           * for this should find out why it is empty.
           */
          <Callout tone="info" title="Switch on Call APIs first">
            Connections are how your agent reaches a service that needs a key.
            Turn on <strong>Call APIs</strong> in Capabilities, and set them up
            here.
          </Callout>
        ) : !agentId ? (
          /*
           * The same empty state the Memory section has, for the
           * same reason: connections hang off a saved agent, so
           * a draft has nothing to attach them to. "Save this
           * first" beats a form that fails on submit.
           */
          <Callout tone="info" title="Save this agent first">
            Connections are stored against a saved agent. Save, and you can add
            one here. Your agent can already read public addresses without any
            setup.
          </Callout>
        ) : (
          <>
            {!secretsAvailable ? (
              <Callout tone="caution" title="This server cannot store keys yet">
                <code>NEUROLINK_SECRET_KEY</code> is not set, so a connection
                with a key cannot be saved. Your agent can still read public
                addresses. Whoever runs this server needs to set it.
              </Callout>
            ) : null}

            {error ? (
              <Callout tone="error" title="That did not work">
                {error}
              </Callout>
            ) : null}

            {connections.length > 0 ? (
              <ul className="conns">
                {connections.map((connection) => (
                  <li className="conn" key={connection.id}>
                    <div className="conn__main">
                      <p className="conn__head">
                        <Plug size={13} aria-hidden="true" />
                        <span className="conn__label">{connection.label}</span>
                        <code className="conn__slug">{connection.slug}</code>
                      </p>

                      <p className="conn__meta">
                        {connection.baseUrl} ·{" "}
                        {connection.allowedMethods.join(", ")} ·{" "}
                        {connection.authKind === "none"
                          ? "no key"
                          : "key stored"}
                      </p>

                      {connection.description ? (
                        <p className="conn__desc">{connection.description}</p>
                      ) : null}
                    </div>

                    <IconButton
                      label={`Remove ${connection.label}`}
                      icon={<Trash2 size={15} />}
                      onClick={() => void remove(connection)}
                    />
                  </li>
                ))}
              </ul>
            ) : loading ? (
              <p className="agentsec__note">Loading connections…</p>
            ) : (
              <p className="agentsec__note">
                No connections yet. Your agent can still read public addresses —
                an open JSON feed, a public API — without one.
              </p>
            )}

            {adding ? (
              <div className="conn__form">
                <Field
                  label="Name"
                  hint={
                    form.label.trim()
                      ? `Your agent will refer to this as "${slugify(
                          form.label
                        )}".`
                      : "What this service is, in a word or two."
                  }
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={form.label}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      placeholder="Weather API"
                    />
                  )}
                </Field>

                <Field
                  label="What it is for"
                  hint="Your agent reads this to decide when to use it."
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Current weather and forecasts by city"
                    />
                  )}
                </Field>

                <Field
                  label="Address"
                  hint="Your agent can only reach addresses under this one. Private and internal addresses are always refused."
                >
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={form.baseUrl}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          baseUrl: event.target.value,
                        }))
                      }
                      placeholder="https://api.example.com/v1"
                    />
                  )}
                </Field>

                <Field label="How it authenticates">
                  {({ id, describedBy }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      value={form.authKind}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          authKind: event.target.value as ConnectionAuth,
                        }))
                      }
                    >
                      {AUTH_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {AUTH_LABELS[kind]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                {form.authKind === "header" || form.authKind === "query" ? (
                  <Field
                    label={
                      form.authKind === "header"
                        ? "Header name"
                        : "Parameter name"
                    }
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        value={form.authName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authName: event.target.value,
                          }))
                        }
                        placeholder={
                          form.authKind === "header" ? "X-API-Key" : "api_key"
                        }
                      />
                    )}
                  </Field>
                ) : null}

                {form.authKind !== "none" ? (
                  <Field
                    label="Key"
                    hint="Stored encrypted. It is never shown again, and never shown to your agent."
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        type="password"
                        value={form.secret}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            secret: event.target.value,
                          }))
                        }
                        autoComplete="off"
                      />
                    )}
                  </Field>
                ) : null}

                {/*
                  A fieldset rather than a Field: these are
                  several controls answering one question, and a
                  single label cannot point at all of them.
                */}
                <fieldset className="conn__methods">
                  <legend>What it may do</legend>

                  <div className="conn__methods-row">
                    {methods.map((method) => (
                      <label className="conn__method" key={method}>
                        <input
                          type="checkbox"
                          checked={form.methods.includes(method)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              methods: current.methods.includes(method)
                                ? current.methods.filter(
                                    (entry) => entry !== method
                                  )
                                : [...current.methods, method],
                            }))
                          }
                        />
                        {method}
                      </label>
                    ))}
                  </div>

                  <p className="conn__methods-hint">
                    Start with GET only. Add the others when your agent actually
                    needs to change something.
                  </p>
                </fieldset>

                <p className="conn__warn">
                  <TriangleAlert size={13} aria-hidden="true" />
                  Anything your agent does here happens for real, on your
                  account. Give it the narrowest key the job needs.
                </p>

                <div className="row gap-2">
                  <Button onClick={() => void save()} disabled={!canSave}>
                    {saving ? "Saving…" : "Save connection"}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setForm(EMPTY_FORM);
                      setAdding(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add a connection
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
