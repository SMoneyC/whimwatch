import { Fragment, type ReactNode } from 'react';

/**
 * A message with `{name}` placeholders, with each placeholder replaced by a piece of interface: rich(
 * m.app.hidesInstantly, { keys: <Kbd>…</Kbd> }). The text stays text (React escapes it); nothing in
 * a message is ever read as markup.
 */
export function rich(message: string, parts: Record<string, ReactNode>): ReactNode {
  return message.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    // Own properties only: `{constructor}` in a message must stay text, not become an object.
    return <Fragment key={i}>{name !== undefined && Object.hasOwn(parts, name) ? parts[name] : piece}</Fragment>;
  });
}
