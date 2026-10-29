'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { useChatPlayback } from './chat-play';
import type { ChannelExtra, ChatLine } from './data/channel-extras';
import { Icon, type IconName } from './icons';
import { Portrait } from './portrait';
import { useInView } from './use-in-view';
import './channel.css';

const tint = (hue: string): CSSProperties => ({ ['--h' as string]: hue });

/** The messages of a chat so far, newest at the bottom, with the typing dots while the business is "writing". */
function ChatBody({ lines, count, typing }: { lines: ChatLine[]; count: number; typing: boolean }) {
  return (
    <div className="ch-body" aria-hidden>
      {lines.slice(0, count).map((l, i) =>
        l.from === 'event' ? (
          <p key={i} className="ch-ev">
            {l.text}
          </p>
        ) : (
          <p key={i} className={`ch-m ${l.from}`}>
            {l.text}
          </p>
        ),
      )}
      {typing && (
        <p className="ch-m business ch-typing">
          <u />
          <u />
          <u />
        </p>
      )}
    </div>
  );
}

function PhoneBar({
  extra,
  icon,
  channel,
}: {
  extra: ChannelExtra;
  icon: IconName;
  channel: string;
}) {
  return (
    <div className="ch-bar">
      <Portrait look={extra.contact.look} className="ch-face" />
      <span>
        <b>{extra.contact.name}</b>
        <i>{extra.contact.status}</i>
      </span>
      <em title={channel}>
        <Icon name={icon} />
      </em>
    </div>
  );
}

/**
 * The picture at the top of a channel page: a phone where a short conversation plays on its own, with small cards that
 * appear around it as it goes (an approved template, a read receipt, an assignment). It plays while it is on screen,
 * loops, and shows the finished chat at once for visitors who prefer reduced motion.
 */
export function ChannelHero({
  extra,
  icon,
  channel,
}: {
  extra: ChannelExtra;
  icon: IconName;
  channel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  const [loop, setLoop] = useState(0);
  const { count, typing } = useChatPlayback(
    extra.chat,
    inView,
    loop,
    () => setLoop((l) => l + 1),
    4200,
    !extra.sendOnly,
  );
  return (
    <div
      ref={root}
      className="ch"
      style={tint(extra.hue)}
      role="img"
      aria-label={`A sample ${channel} conversation, drawn with made-up messages`}
    >
      <div className="ch-glow" aria-hidden />
      <div className="ch-phone" aria-hidden>
        <PhoneBar extra={extra} icon={icon} channel={channel} />
        <ChatBody lines={extra.chat} count={count} typing={typing} />
        <div className="ch-input">
          <span>Type a message</span>
          <Icon name="arrow" />
        </div>
      </div>
      {extra.floats.map((f, n) => (
        <div
          key={f.t}
          aria-hidden
          className={`ch-fl ch-f${n}${count >= Math.min(extra.chat.length, n + 2) ? ' on' : ''}`}
        >
          <span>
            <Icon name={f.icon} />
          </span>
          <b>{f.t}</b>
          <i>{f.d}</i>
        </div>
      ))}
    </div>
  );
}

/**
 * "In practice": one tab for each kind of business, and a phone that plays that business's conversation with a short list
 * of what happened behind it. The tabs advance on their own while the section is on screen, until the visitor picks one.
 */
export function PracticeTabs({
  extra,
  icon,
  channel,
}: {
  extra: ChannelExtra;
  icon: IconName;
  channel: string;
}) {
  const scenes = extra.practice;
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  const scene = scenes[i]!;
  const { count, typing, done } = useChatPlayback(
    scene.lines,
    inView,
    i,
    () => {
      if (!manual) setI((n) => (n + 1) % scenes.length);
    },
    4600,
    !extra.sendOnly,
  );
  return (
    <div ref={root} className="pr" style={tint(extra.hue)}>
      <ul className="pr-tabs" role="tablist" aria-label={`${channel} in practice`}>
        {scenes.map((s, n) => (
          <li key={s.title}>
            <button
              type="button"
              role="tab"
              aria-selected={n === i}
              className={n === i ? 'on' : ''}
              onClick={() => {
                setI(n);
                setManual(true);
              }}
            >
              <span className="pr-ic">
                <Icon name={s.icon} />
              </span>
              <span className="pr-tx">
                <i>{s.tag}</i>
                <b>{s.title}</b>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="pr-stage" role="tabpanel" aria-label={scene.title}>
        <div className="pr-phone">
          <PhoneBar extra={extra} icon={icon} channel={channel} />
          <ChatBody lines={scene.lines} count={count} typing={typing} />
        </div>
        <div className="pr-side">
          <span className="pr-tag">{scene.tag}</span>
          <h3>{scene.title}</h3>
          <p>{scene.summary}</p>
          <ul className="pr-out">
            {scene.outcomes.map((o, n) => (
              <li
                key={o}
                className={done ? 'on' : ''}
                style={{ ['--d' as string]: `${n * 0.18}s` }}
              >
                <Icon name="check" />
                {o}
              </li>
            ))}
          </ul>
        </div>
        <ol className="pr-sr">
          {scene.lines.map((l, n) => (
            <li key={n}>{l.text}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
