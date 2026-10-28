import Link from 'next/link';
import { Icon } from './icons';
import './adaptive.css';

/**
 * The optional assistant layer, shown as "coming soon": an assistant inside Geta that takes a spoken or typed request, drafts
 * the work and waits for approval. It is not built yet, is billed for AI usage, and must never be presented as live.
 */
export function CopilotLayer() {
  return (
    <div className="cp">
      <div>
        <span className="cp-soon">Coming soon · optional add-on</span>
        <h2 className="gx-h2">Want Geta to run it for you?</h2>
        <p className="gx-lead">
          An assistant inside Geta that you can speak to or type to. It suggests when to send a
          broadcast, drafts the flows you need, reads your results and makes the changes you allow.
          It is optional, so the everyday features stay simple.
        </p>
        <ul className="gx-list">
          {[
            'Say or type what you want, in your own words',
            'It drafts the work, and you decide what it may do',
            'It watches your results and suggests what to change',
            'Billed for AI usage, and only if you turn it on',
          ].map((t) => (
            <li key={t}>
              <Icon name="check" />
              {t}
            </li>
          ))}
        </ul>
        <div className="gx-cta-row">
          <Link href="/contact" className="gx-btn gx-btn-primary">
            Get early access
          </Link>
        </div>
      </div>
      <div
        className="cp-panel"
        role="img"
        aria-label="An illustration of asking the assistant to send reminders and approving its draft"
      >
        <div className="cp-bar" aria-hidden>
          <Icon name="sparkle" />
          <span className="cp-type">Remind everyone with a visit tomorrow</span>
        </div>
        <div className="cp-steps" aria-hidden>
          <div className="cp-step" style={{ animationDelay: '3.6s' }}>
            <Icon name="contact" /> Found 14 contacts with a visit tomorrow
          </div>
          <div className="cp-step" style={{ animationDelay: '4.4s' }}>
            <Icon name="whatsapp" /> Drafted a WhatsApp reminder from your template
          </div>
          <div className="cp-step" style={{ animationDelay: '5.2s' }}>
            <Icon name="check" /> Ready to send at 6 pm <em>Approve</em>
          </div>
        </div>
        <span className="cp-ill">Illustrative · coming soon</span>
      </div>
    </div>
  );
}
