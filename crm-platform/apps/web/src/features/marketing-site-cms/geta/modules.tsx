'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { useInView } from './use-in-view';
import './modules.css';

interface Mod {
  id: string;
  label: string;
  icon: IconName;
  text: string;
  href: string;
  title: string;
  body: ReactNode;
}

const D = (n: number) => ({ animationDelay: `${n}s` });

const MODULES: Mod[] = [
  {
    id: 'inbox',
    label: 'Team inbox',
    icon: 'inbox',
    text: 'Every customer message in one shared inbox, assigned to the right person and tracked against your reply targets.',
    href: '/products/team-inbox',
    title: 'Team inbox',
    body: (
      <div className="md-list">
        {[
          ['AM', 'Aarav Mehta', 'Is the 3 BHK still available?', 'Unassigned'],
          ['PN', 'Priya Nair', 'Can we visit on Saturday?', 'Arjun Shah'],
          ['VS', 'Vikram Singh', 'Please share the payment plan.', 'Riya Kapoor'],
        ].map(([a, n, m, o], i) => (
          <div key={n} className="md-row md-in" style={D(0.2 + i * 0.5)}>
            <span className="md-av">{a}</span>
            <span>
              <b>{n}</b>
              <i>{m}</i>
            </span>
            <em className={i === 0 ? 'md-assign' : ''}>{o}</em>
          </div>
        ))}
        <p className="md-note md-in" style={D(2.2)}>
          <Icon name="check" /> Assigned to Riya Kapoor · first reply in 2 min
        </p>
      </div>
    ),
  },
  {
    id: 'appointments',
    label: 'Appointments',
    icon: 'calendar',
    text: 'Offer slots, confirm bookings and send reminders on WhatsApp so people show up.',
    href: '/products/crm',
    title: 'Appointments',
    body: (
      <div>
        <div className="md-week">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
            <div key={d} className="md-day">
              <span>{d}</span>
              {i === 2 ? (
                <b className="md-slot md-in" style={D(0.6)}>
                  11:00 · Priya Nair
                </b>
              ) : (
                <u />
              )}
              {i === 3 && (
                <b className="md-slot soft md-in" style={D(1.2)}>
                  4:30 · Aarav Mehta
                </b>
              )}
            </div>
          ))}
        </div>
        <p className="md-bub md-in" style={D(2)}>
          Reminder: your visit is tomorrow at 11 AM. Reply 1 to confirm.
        </p>
        <p className="md-bub out md-in" style={D(3)}>
          <Icon name="check" /> Confirmed
        </p>
      </div>
    ),
  },
  {
    id: 'broadcasts',
    label: 'Broadcasts',
    icon: 'megaphone',
    text: 'Send an offer or a reminder to a saved segment and see who received, read and replied.',
    href: '/products/broadcasts-campaigns',
    title: 'New broadcast',
    body: (
      <div className="md-bc">
        <div className="md-chips">
          <span>Segment: Booked visits</span>
          <span>186 contacts</span>
        </div>
        <p className="md-tpl md-in" style={D(0.4)}>
          Hi {'{{name}}'}, a reminder about your site visit tomorrow. Reply YES to confirm.
        </p>
        {[
          ['Delivered', '99%'],
          ['Read', '81%'],
          ['Replied', '46%'],
        ].map(([l, v], i) => (
          <div key={l} className="md-meter">
            <span>{l}</span>
            <u>
              <s style={{ ['--to' as string]: v, animationDelay: `${1.2 + i * 0.5}s` }} />
            </u>
            <b>{v}</b>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'forms',
    label: 'Forms and leads',
    icon: 'form',
    text: 'Web forms, links and QR codes that create a contact and start a WhatsApp chat in one step.',
    href: '/products/forms-lead-capture',
    title: 'Enquiry form',
    body: (
      <div className="md-form">
        {[
          ['Name', 'Neha Banerjee'],
          ['Phone', '+91 98000 01261'],
          ['Interested in', '2 BHK, Wakad'],
        ].map(([k, v], i) => (
          <div key={k} className="md-field md-in" style={D(0.3 + i * 0.8)}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
        <span className="md-btn md-in" style={D(2.8)}>
          Submit
        </span>
        <p className="md-toast md-in" style={D(3.6)}>
          <Icon name="check" /> Lead created · welcome message sent on WhatsApp
        </p>
      </div>
    ),
  },
  {
    id: 'agents',
    label: 'AI agents',
    icon: 'sparkle',
    text: 'An agent trained on your own content answers and qualifies, and hands over when a person is needed.',
    href: '/products/ai-agents',
    title: 'AI agent',
    body: (
      <div>
        <div className="md-chips">
          <span>Brochure.pdf</span>
          <span>Price list</span>
          <span>FAQ page</span>
        </div>
        <p className="md-bub md-in" style={D(0.4)}>
          Do you have a 2 BHK under 80 lakh?
        </p>
        <p className="md-bub out md-in" style={D(1.4)}>
          <small>AI agent</small>Yes, in Wakad from ₹78 lakh. What move-in date should I note?
        </p>
        <p className="md-note md-in" style={D(2.6)}>
          <Icon name="check" /> Budget and timeline saved to the contact
        </p>
      </div>
    ),
  },
  {
    id: 'crm',
    label: 'CRM and deals',
    icon: 'kanban',
    text: 'Contacts, deals, tasks and notes that update from the conversation, so nothing is re-typed.',
    href: '/products/crm',
    title: 'Sales pipeline',
    body: (
      <div className="md-board">
        {['New', 'Qualified', 'Proposal'].map((c, i) => (
          <div key={c} className="md-col">
            <span>{c}</span>
            {i === 0 && <b className="md-card">3 BHK, Baner</b>}
            {i === 1 && <b className="md-card">2 BHK, Wakad</b>}
            {i === 1 && <b className="md-card md-move">Penthouse · Aarav</b>}
            {i === 2 && <b className="md-card">Duplex, Kothrud</b>}
          </div>
        ))}
      </div>
    ),
  },
];

const REDUCED = '(prefers-reduced-motion: reduce)';

/** "Start with what you need": the modules as tabs, each with a looping animated window. */
export function Modules() {
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  // The tabs rotate only while the section is in view, and start from the first one each time it comes into view.
  useEffect(() => {
    if (inView && !manual) setI(0);
  }, [inView, manual]);
  useEffect(() => {
    if (!inView || manual || window.matchMedia(REDUCED).matches) return;
    const t = setTimeout(() => setI((n) => (n + 1) % MODULES.length), 7500);
    return () => clearTimeout(t);
  }, [inView, manual, i]);
  const m = MODULES[i]!;
  return (
    <div ref={root} className="md">
      <ul className="md-tabs" role="tablist" aria-label="Modules">
        {MODULES.map((x, n) => (
          <li key={x.id}>
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
              <Icon name={x.icon} />
              {x.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="md-stage">
        <div className="md-copy gx-fade" key={`${m.id}-t`}>
          <h3>{m.label}</h3>
          <p>{m.text}</p>
          <Link href={m.href} className="gx-more">
            Learn more <Icon name="arrow" />
          </Link>
        </div>
        <div className="md-win" key={m.id}>
          <div className="md-bar" aria-hidden>
            <i style={{ background: '#ff5f57' }} />
            <i style={{ background: '#febc2e' }} />
            <i style={{ background: '#28c840' }} />
            <span>{m.title}</span>
          </div>
          <div className="md-body" aria-hidden>
            {/* Every module's window is laid out invisibly behind the live one, so the box keeps the height of the tallest and the page below never moves when the tab changes. */}
            <div className="md-sizer">
              {MODULES.map((x) => (
                <div key={x.id}>{x.body}</div>
              ))}
            </div>
            <div className="md-live" key={m.id}>
              {m.body}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
