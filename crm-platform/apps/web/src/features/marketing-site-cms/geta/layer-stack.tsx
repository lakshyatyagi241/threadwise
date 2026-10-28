import { CountUp } from './count-up';
import { PLATFORM_LAYERS } from './data/site';
import { Icon } from './icons';
import { Portrait } from './portrait';
import './layer-stack.css';

/** What each layer is doing, in a few words, and the small live detail shown at the end of its row. */
const SUB = [
  'Answers, qualifies, hands over',
  'Inbox, channels and campaigns',
  'Contacts, deals and tasks',
  'API, webhooks and stores',
  'Mini apps and add-ons',
];
const HUES = ['#4338ca', '#0284c7', '#0f9488', '#d97706', '#7c3aed'];

function Live({ i }: { i: number }) {
  switch (i) {
    case 0:
      return (
        <span className="ls-typing">
          <u />
          <u />
          <u />
        </span>
      );
    case 1:
      return (
        <span className="ls-ch">
          <Icon name="whatsapp" />
          <Icon name="instagram" />
          <Icon name="mail" />
        </span>
      );
    case 2:
      return (
        <span className="ls-faces">
          <Portrait look="sweep" />
          <Portrait look="bun" />
          <Portrait look="curl" />
        </span>
      );
    case 3:
      return (
        <span className="ls-pill ok">
          <Icon name="check" />
          Synced
        </span>
      );
    default:
      return (
        <span className="ls-pill">
          <Icon name="plus" />
          Install
        </span>
      );
  }
}

/**
 * The five layers as one picture: five rows that light up in the order a message travels through them, all resting on a
 * single contact record, with the product counts underneath. Colour is limited to a soft tint on each row's icon.
 */
export function LayerStack({
  products,
  capabilities,
  channels,
}: {
  products: number;
  capabilities: number;
  channels: number;
}) {
  return (
    <div className="ls">
      <ol className="ls-rows" aria-hidden>
        {PLATFORM_LAYERS.map((l, i) => (
          <li key={l.n} className="ls-row" style={{ ['--i' as string]: i, ['--h' as string]: HUES[i] }}>
            <span className="ls-ic">
              <Icon name={l.icon} />
            </span>
            <span className="ls-t">
              <b>{l.title}</b>
              <i>{SUB[i]}</i>
            </span>
            <span className="ls-live">
              <Live i={i} />
            </span>
            <em>{l.n}</em>
          </li>
        ))}
      </ol>
      <div className="ls-base" aria-hidden>
        <Portrait look="crop" className="ls-base-face" />
        <span>
          <b>One contact record</b>
          <i>One login and one set of permissions for every layer</i>
        </span>
      </div>
      <dl className="ls-stats">
        <div>
          <dt>products working as one platform</dt>
          <dd>
            <CountUp to={products} />
          </dd>
        </div>
        <div>
          <dt>capabilities</dt>
          <dd>
            <CountUp to={capabilities} suffix="+" />
          </dd>
        </div>
        <div>
          <dt>channels</dt>
          <dd>
            <CountUp to={channels} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
