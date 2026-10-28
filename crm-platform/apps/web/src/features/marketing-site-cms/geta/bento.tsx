import { Icon, type IconName } from './icons';
import { Portrait } from './portrait';
import './bento.css';

/**
 * A grid of small animated interfaces that show what the platform does, in the style of a product bento: a bold first
 * word, a grey sentence, and a looping mini-UI underneath. Everything is CSS animation on made-up content, so it costs no
 * images and stops for visitors who prefer reduced motion.
 */

const H = ({ w, children }: { w: string; children: string }) => (
  <h3 className="bt-h">
    <b>{w}</b> {children}
  </h3>
);

function Flows() {
  return (
    <div className="bt-vis">
      <div className="bt-chips">
        {['Qualify a lead', 'Book a site visit', 'Send a reminder'].map((c, i) => (
          <span
            key={c}
            className="bt-chip"
            style={{ animationDelay: `${i * 3}s`, ['--h' as string]: ['#4f46e5', '#0d9488', '#d97706'][i] }}
          >
            <Icon name={(['target', 'calendar', 'bell'] as IconName[])[i]!} />
            {c}
          </span>
        ))}
      </div>
      <ol className="bt-steps">
        {[
          'Ask budget and move-in date',
          'Save the answers to the contact',
          'Assign to Riya and set a task',
        ].map((s, i) => (
          <li
            key={s}
            style={{ animationDelay: `${i * 0.9}s`, ['--h' as string]: ['#4f46e5', '#0d9488', '#d97706'][i] }}
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Replies() {
  return (
    <div className="bt-vis bt-center">
      <div className="bt-phone">
        <p className="bt-in">Pick a time for your site visit</p>
        <div className="bt-btns">
          <span>Sat · 11 AM</span>
          <span className="bt-press">Sun · 4 PM</span>
        </div>
        <p className="bt-out">
          <Icon name="check" /> Booked: Sunday, 4 PM
        </p>
      </div>
    </div>
  );
}

function Inbox() {
  const rows: Array<[string, string, string, string]> = [
    ['AI handled', 'Aarav Mehta', 'Is the 3 BHK still available?', 'ai'],
    ['Needs a person', 'Priya Nair', 'Can my parents come along?', 'human'],
    ['Resolved', 'Vikram Singh', 'Thanks, payment done.', 'done'],
    ['AI handled', 'Sneha Reddy', 'Any 1BHK under 60L?', 'ai'],
  ];
  return (
    <div className="bt-vis">
      <div className="bt-table">
        <div className="bt-th">
          <span>Status</span>
          <span>Contact</span>
          <span>Last message</span>
        </div>
        {rows.map(([s, n, m, k], i) => (
          <div key={n} className="bt-tr" style={{ animationDelay: `${i * 0.8}s` }}>
            <span className={`bt-pill ${k}`}>{s}</span>
            <b>{n}</b>
            <span className="bt-mute">{m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Crm() {
  const fields: Array<[string, string]> = [
    ['Stage', 'Qualified'],
    ['Source', 'Instagram ad'],
    ['Budget', '₹1.2 crore'],
    ['Next task', 'Call tomorrow, 10 am'],
  ];
  return (
    <div className="bt-vis bt-center">
      <div className="bt-card">
        <div className="bt-who">
          <Portrait look="crop" className="bt-av" />
          <span>
            <b>Aarav Mehta</b>
            <i>New · WhatsApp</i>
          </span>
        </div>
        {fields.map(([k, v], i) => (
          <div key={k} className="bt-field" style={{ animationDelay: `${0.7 + i * 0.9}s` }}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Analytics() {
  return (
    <div className="bt-vis">
      <div className="bt-chart">
        <div className="bt-kpi">
          <span className="bt-mute">Read rate</span>
          <b>61.2%</b>
        </div>
        <svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="btg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#16a34a" stopOpacity="0.22" />
              <stop offset="1" stopColor="#16a34a" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            className="bt-base"
            d="M0 112 L30 106 L60 109 L90 100 L120 103 L150 94 L180 98 L210 88 L240 92 L270 82 L300 86"
            fill="none"
            stroke="#b8bcc8"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            className="bt-area"
            d="M0 100 L30 84 L60 90 L90 62 L120 70 L150 46 L180 54 L210 30 L240 38 L270 18 L300 24 L300 120 L0 120Z"
            fill="url(#btg)"
          />
          <path
            className="bt-line"
            d="M0 100 L30 84 L60 90 L90 62 L120 70 L150 46 L180 54 L210 30 L240 38 L270 18 L300 24"
            fill="none"
            stroke="#16a34a"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength="1"
          />
        </svg>
        <span className="bt-tip">Delivered 98%</span>
      </div>
    </div>
  );
}

function Integrations() {
  const tiles: Array<[IconName, string]> = [
    ['whatsapp', '#16a34a'],
    ['instagram', '#db2777'],
    ['facebook', '#2563eb'],
    ['telegram', '#0284c7'],
    ['bag', '#ea580c'],
    ['store', '#0d9488'],
    ['sheet', '#15803d'],
    ['webhook', '#7c3aed'],
    ['code', '#334155'],
    ['puzzle', '#d97706'],
  ];
  return (
    <div className="bt-vis bt-center">
      <div className="bt-tiles">
        {tiles.map(([n, h], i) => (
          <span
            key={n}
            className="bt-tile"
            style={{ animationDelay: `${(i % 5) * 0.35}s`, ['--h' as string]: h }}
          >
            <Icon name={n} />
          </span>
        ))}
      </div>
    </div>
  );
}

function Market() {
  const apps: Array<[string, string, string]> = [
    ['Website form', 'Lead sources', '#4f46e5'],
    ['Google Sheets', 'Productivity', '#15803d'],
    ['Shopify', 'E-commerce', '#0d9488'],
  ];
  return (
    <div className="bt-vis">
      <div className="bt-apps">
        {apps.map(([n, c, h], i) => (
          <div key={n} className="bt-app">
            <span className="bt-ic" style={{ ['--h' as string]: h }}>
              <Icon name="puzzle" />
            </span>
            <span>
              <b>{n}</b>
              <i>{c}</i>
            </span>
            <span className="bt-install" style={{ animationDelay: `${1 + i * 1.6}s` }}>
              <u>Install</u>
              <s>Installed ✓</s>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Bento() {
  return (
    <div className="bt">
      <div className="bt-c bt-3">
        <H w="Flows">run your playbook step by step, with actions built in.</H>
        <Flows />
      </div>
      <div className="bt-c bt-3">
        <H w="Smart replies">let customers tap an answer instead of typing one.</H>
        <Replies />
      </div>
      <div className="bt-c bt-3">
        <H w="One inbox">built for AI and your team in the same conversation.</H>
        <Inbox />
      </div>
      <div className="bt-c bt-3">
        <H w="The CRM">fills itself in from every chat, so nobody re-types.</H>
        <Crm />
      </div>
      <div className="bt-c bt-2">
        <H w="Analytics">on delivery, reads and replies over time.</H>
        <Analytics />
      </div>
      <div className="bt-c bt-2">
        <H w="Integrations">with your channels, stores and sheets.</H>
        <Integrations />
      </div>
      <div className="bt-c bt-2">
        <H w="The Marketplace">adds mini apps without any custom code.</H>
        <Market />
      </div>
    </div>
  );
}
