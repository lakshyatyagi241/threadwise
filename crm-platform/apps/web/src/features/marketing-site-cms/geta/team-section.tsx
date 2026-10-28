import { Icon } from './icons';
import { Cta } from './ui';
import './palette.css';

const POINTS = [
  'One inbox for every channel, with the right person assigned',
  'Reminders and follow-ups that go out on their own',
  'Every conversation saved to the customer’s record',
];

/**
 * "For the people doing the work": two photographs with small cards drifting over them that show what the platform is doing
 * in the background while the person works. The photos are shown as shot.
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
      <div className="tm-photos">
        <figure className="tm-ph tm-a">
          <img
            src="/geta/photos/team-desk.webp"
            alt=""
            width={900}
            height={990}
            loading="lazy"
            decoding="async"
          />
          <span className="tm-chip tm-c1" aria-hidden>
            <span className="tm-dot" />
            <span>
              <b>New enquiry</b>
              <i>WhatsApp · just now</i>
            </span>
          </span>
          <span className="tm-chip tm-c2" aria-hidden>
            <Icon name="users" />
            <span>
              <b>Assigned to Riya</b>
              <i>Replies within 5 min</i>
            </span>
          </span>
        </figure>
        <figure className="tm-ph tm-b">
          <img
            src="/geta/photos/team-keys.webp"
            alt=""
            width={995}
            height={900}
            loading="lazy"
            decoding="async"
          />
          <span className="tm-chip tm-c3" aria-hidden>
            <Icon name="bell" />
            <span>
              <b>Reminder sent</b>
              <i>Tomorrow, 9:00 AM</i>
            </span>
          </span>
          <span className="tm-chip tm-c4" aria-hidden>
            <Icon name="check" />
            <span>
              <b>Follow-up set</b>
              <i>Check in after 3 days</i>
            </span>
          </span>
        </figure>
      </div>
    </div>
  );
}
