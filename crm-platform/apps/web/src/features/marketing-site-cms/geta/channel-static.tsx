import type { CSSProperties } from 'react';
import type { ChannelExtra } from './data/channel-extras';
import { Icon, type IconName } from './icons';
import { Portrait } from './portrait';
import './channel.css';

/**
 * One message, followed from the customer to your team's record: it arrives, an agent or a flow answers, and the contact is
 * saved with where it came from. Three cards joined by a small signal that travels along the line.
 */
export function ChannelFlow({
  extra,
  icon,
  channel,
}: {
  extra: ChannelExtra;
  icon: IconName;
  channel: string;
}) {
  const first = extra.chat.findIndex((l) => l.from === 'customer');
  const ask = extra.chat[first] ?? extra.chat[0]!;
  const reply = extra.chat.slice(first + 1).find((l) => l.from === 'business') ?? extra.chat[0]!;
  return (
    <div className="cf" style={{ ['--h' as string]: extra.hue } as CSSProperties}>
      <div className="cf-c">
        <span className="cf-n">1</span>
        <h3>It arrives</h3>
        <p className="cf-bub in">{ask.text}</p>
        <span className="cf-chip">
          <Icon name={icon} />
          {channel}
        </span>
      </div>
      <span className="cf-ln" aria-hidden>
        <u />
      </span>
      <div className="cf-c">
        <span className="cf-n">2</span>
        <h3>An agent or flow answers</h3>
        <p className="cf-bub out">{reply.text}</p>
        <span className="cf-chip">
          <Icon name="sparkle" />
          Answered in seconds
        </span>
      </div>
      <span className="cf-ln" aria-hidden>
        <u />
      </span>
      <div className="cf-c">
        <span className="cf-n">3</span>
        <h3>Your team has the record</h3>
        <div className="cf-rec">
          <Portrait look={extra.contact.look} className="cf-face" />
          <span>
            <b>{extra.contact.name}</b>
            <i>New contact</i>
          </span>
        </div>
        <div className="cf-tags">
          <span>Source · {channel}</span>
          <span>Stage · Qualified</span>
          <span>Owner · Riya</span>
        </div>
      </div>
    </div>
  );
}
