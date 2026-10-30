import { Icon } from './icons';
import { Cta } from './ui';
import './palette.css';

const POINTS = [
  'One inbox for every channel, with the right person assigned',
  'Reminders and follow-ups that go out on their own',
  'Every conversation saved to the customer’s record',
];

/**
 * "For the people doing the work": one composed illustration, two photographs with the shared inbox and small status cards
 * laid over them, showing what the platform does in the background while the person works.
 */
export function TeamSection() {
  return (
    <div className="tm">
      <div className="tm-copy">
        <div className="gx-eyebrow">For your team</div>
        <h2 className="gx-h2">Less switching between tools. More time with customers.</h2>
        <p className="gx-lead">
          Your team replies, books and follows up from one screen, while assignments, reminders and
          follow-ups run quietly in the background.
        </p>
        <ul className="gx-list">
          {POINTS.map((t) => (
            <li key={t}>
              <Icon name="check" />
              {t}
            </li>
          ))}
        </ul>
        <div className="gx-cta-row">
          <Cta href="/register" arrow>
            Start free trial
          </Cta>
          <Cta href="/platform" variant="ghost">
            Explore the platform
          </Cta>
        </div>
      </div>
      <figure className="tm-art">
        <img
          src="/geta/photos/team-inbox.webp"
          alt="A shared inbox with three conversations, an assignment to Riya, a reply sent and a follow-up scheduled for tomorrow"
          width={1386}
          height={869}
          loading="lazy"
          decoding="async"
        />
      </figure>
    </div>
  );
}
