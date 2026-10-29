import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import './mocks.css';

/**
 * Drawn illustrations of the app's screens, used on the public site. They follow the real layout (icon rail, top bar,
 * cards, indigo accent) but every name, number and message is made up for "Northwind Realty", so no customer data is
 * ever shown. All sizes are in em and the root font-size follows the container width, so a mock scales to any frame.
 *
 * Screens take an optional `state` so the walkthrough can play a story through them (a new chat arrives, a deal moves,
 * a broadcast sends). With no state a screen shows its finished, static look. Elements the walkthrough's cursor aims at
 * carry a `data-t` name.
 */

export interface MockState {
  /** Inbox: show the new conversation in the list (0 or 1). */
  newConv?: number;
  /** Inbox: the new conversation is open (0 or 1). */
  open?: number;
  /** Inbox: how many thread messages are visible (0 to 6). */
  msgs?: number;
  /** Inbox: show the typing indicator after the visible messages. */
  typing?: number;
  /** Inbox: owner of the chat (0 unassigned, 1 Riya Kapoor). */
  owner?: number;
  /** Inbox: the qualification answers are saved to the side panel. */
  qual?: number;
  /** Contacts: show the new contact row. */
  row?: number;
  /** Contacts: show the contact detail panel. */
  detail?: number;
  /** Contacts: how many detail fields are filled in (0 to 4). */
  fields?: number;
  /** Deals: 0 in Qualified, 1 lifted, 2 in Proposal. */
  moved?: number;
  /** Broadcasts: 0 draft with a send button, 1 sending, 2 sent. */
  send?: number;
}

const RAIL: IconName[] = ['grid', 'inbox', 'contact', 'kanban', 'flow', 'megaphone', 'puzzle'];
const ACTIVE: Record<string, number> = {
  dashboard: 0,
  inbox: 1,
  contacts: 2,
  deals: 3,
  'flow-builder': 4,
  broadcasts: 5,
  'ai-agents': 4,
  marketplace: 6,
};

function Shell({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="gx-mockwrap">
      <div className="mk">
        <aside className="mk-rail">
          <span className="mk-logo">
            <Icon name="chat" />
          </span>
          {RAIL.map((n, i) => (
            <span key={n} className={`mk-rail-i${ACTIVE[id] === i ? ' on' : ''}`}>
              <Icon name={n} />
            </span>
          ))}
          <span className="mk-rail-sp" />
          <span className="mk-rail-i">
            <Icon name="cog" />
          </span>
          <span className="mk-chip">NR</span>
        </aside>
        <div className="mk-main">
          <div className="mk-top">
            <span className="mk-pill">Balance ₹4,820.00</span>
            <span className="mk-av">R</span>
          </div>
          <div className="mk-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

const Kpi = ({
  label,
  value,
  delta,
  bars,
}: {
  label: string;
  value: string;
  delta: string;
  bars?: number[];
}) => (
  <div className="mk-card">
    <div className="mk-row">
      <span className="mk-mute">{label}</span>
      <span className="mk-up">▲ {delta}</span>
    </div>
    <div className="mk-big">{value}</div>
    {bars && (
      <div className="mk-bars" aria-hidden>
        {bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    )}
  </div>
);

const Av = ({ t, c = '' }: { t: string; c?: string }) => <span className={`mk-av2 ${c}`}>{t}</span>;

function Dashboard() {
  return (
    <>
      <div className="mk-head">
        <div>
          <div className="mk-eyebrow">OPERATOR DASHBOARD · LIVE</div>
          <h4 className="mk-h">
            Good morning, Riya. <b>Workspace is calm.</b>
          </h4>
        </div>
        <span className="mk-btn">+ New campaign</span>
      </div>
      <div className="mk-grid4">
        <Kpi
          label="Messages sent · 7d"
          value="1,284"
          delta="22.4%"
          bars={[30, 55, 40, 80, 62, 90, 70]}
        />
        <Kpi label="Read rate" value="61.2%" delta="4.1pp" bars={[50, 60, 55, 70, 66, 74, 72]} />
        <Kpi
          label="Active contacts"
          value="342"
          delta="18.0%"
          bars={[35, 42, 48, 55, 60, 72, 80]}
        />
        <Kpi label="Wallet balance" value="₹4,820" delta="Top up" />
      </div>
      <div className="mk-card mk-pipe">
        <div>
          <b>₹3,60,00,000</b>
          <span className="mk-mute">OPEN PIPELINE</span>
        </div>
        <div>
          <b>16</b>
          <span className="mk-mute">OPEN DEALS</span>
        </div>
        <div>
          <b>₹82,00,000</b>
          <span className="mk-mute">WON THIS MONTH</span>
        </div>
        <div>
          <b>34%</b>
          <span className="mk-mute">WIN RATE</span>
        </div>
      </div>
      <div className="mk-cols">
        <div className="mk-card">
          <div className="mk-row">
            <b>Message throughput</b>
            <span className="mk-mute">last 7 days</span>
          </div>
          <div className="mk-chart" aria-hidden>
            {[40, 62, 55, 78, 70, 92, 66].map((h, i) => (
              <span key={i}>
                <i style={{ height: `${h}%` }} />
                <i className="b" style={{ height: `${h - 8}%` }} />
              </span>
            ))}
          </div>
        </div>
        <div className="mk-card">
          <div className="mk-row">
            <b>Live inbox</b>
            <span className="mk-link">Open inbox</span>
          </div>
          {[
            ['AM', 'Aarav Mehta', 'Is the 3 BHK in Baner still available?'],
            ['PN', 'Priya Nair', 'Can we visit on Saturday at 11?'],
            ['VS', 'Vikram Singh', 'Please share the payment plan.'],
          ].map(([a, n, m]) => (
            <div key={n} className="mk-li">
              <Av t={a!} />
              <span>
                <b>{n}</b>
                <i>{m}</i>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mk-cols">
        <div className="mk-card">
          <div className="mk-row">
            <b>Top templates</b>
            <span className="mk-mute">by send volume</span>
          </div>
          {[
            ['festive_offer_2026', '1,204', '62%'],
            ['site_visit_reminder', '186', '81%'],
            ['payment_reminder', '312', '58%'],
          ].map(([n, sent, read]) => (
            <div key={n} className="mk-trow">
              <span>{n}</span>
              <span className="mk-mute">{sent} sent</span>
              <span className="mk-stage Qualified">{read} read</span>
            </div>
          ))}
        </div>
        <div className="mk-card">
          <b>Engagement funnel</b>
          {[
            ['Messaged', 100],
            ['Delivered', 98],
            ['Replied', 41],
            ['Goal done', 17],
          ].map(([l, v]) => (
            <div key={l} className="mk-fun">
              <span>{l}</span>
              <u>
                <s style={{ width: `${v}%` }} />
              </u>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const CONVS = [
  ['AI', 'Ananya Iyer', 'Do you handle commercial leasing?', 'Unassigned'],
  ['PN', 'Priya Nair', 'Can my parents come along as well?', 'Arjun Shah'],
  ['VS', 'Vikram Singh', 'Is there a discount if we close this month?', 'Riya Kapoor'],
  ['SR', 'Sneha Reddy', 'Any ready-to-move 1BHK under 60L?', 'Unassigned'],
];

const THREAD: Array<{ from: 'in' | 'out'; by?: string; t: string }> = [
  { from: 'in', t: 'Hi! Is the 3 BHK in Baner still available?' },
  { from: 'out', by: 'AI agent', t: 'Yes! What budget and move-in date should I note?' },
  { from: 'in', t: 'Around ₹1.2 crore, next month.' },
  {
    from: 'out',
    by: 'AI agent',
    t: 'Thanks, noted. I have asked Riya from our team to confirm a visit.',
  },
  { from: 'out', by: 'Riya Kapoor', t: 'Hi Aarav, Saturday 11:00 AM works. Booked!' },
  { from: 'in', t: 'Perfect, thank you!' },
];

function Inbox({ s }: { s: MockState }) {
  const newConv = s.newConv ?? 1;
  const open = s.open ?? 1;
  const msgs = s.msgs ?? 6;
  const owner = s.owner ?? 1;
  const qual = s.qual ?? 1;
  const visible = THREAD.slice(0, msgs);
  const last = visible[visible.length - 1] ?? THREAD[0]!;
  return (
    <div className="mk-inbox">
      <div className="mk-card mk-list">
        <b>Inbox</b>
        <div className="mk-tabs">
          <span className="on">All {newConv ? 22 : 21}</span>
          <span>Mine 10</span>
          <span>Unassigned {newConv && !owner ? 3 : 2}</span>
        </div>
        {newConv ? (
          <div key="new" className={`mk-conv ${open ? 'on' : 'fresh'}`} data-t="conv-new">
            <Av t="AM" c="c0" />
            <span>
              <b>Aarav Mehta</b>
              <i>{last.t}</i>
              <em>{owner ? 'Riya Kapoor' : 'Unassigned'}</em>
            </span>
            {!open && <u className="mk-dot" />}
          </div>
        ) : null}
        {CONVS.map(([a, n, m, o], i) => (
          <div key={n} className="mk-conv">
            <Av t={a!} c={`c${i + 1}`} />
            <span>
              <b>{n}</b>
              <i>{m}</i>
              <em>{o}</em>
            </span>
          </div>
        ))}
      </div>
      <div className="mk-card mk-thread" data-t="thread">
        <div className="mk-row">
          <b>{open ? 'Aarav Mehta' : 'Conversation'}</b>
          {open ? <span className="mk-ok">Closes in 23h</span> : null}
        </div>
        {open ? (
          <div className="mk-msgs">
            {visible.map((m, i) => (
              <p key={i} className={`${m.from} mk-pop`}>
                {m.by && <small>{m.by}</small>}
                {m.t}
              </p>
            ))}
            {s.typing ? (
              <span className="mk-typing mk-pop" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mk-empty">Select a conversation</div>
        )}
        <div className="mk-compose">Type a message</div>
      </div>
      <div className="mk-card mk-side">
        <Av t={open ? 'AM' : '··'} c="big" />
        <b>{open ? 'Aarav Mehta' : 'No chat open'}</b>
        <span className="mk-mute">{open ? 'WhatsApp' : ' '}</span>
        <dl>
          <dt>Owner</dt>
          <dd data-t="owner" className={owner ? 'mk-flash' : ''}>
            {owner ? 'Riya Kapoor' : 'Unassigned'}
          </dd>
          <dt>Source</dt>
          <dd>{open ? 'Instagram ad' : '—'}</dd>
          <dt>Budget</dt>
          <dd className={qual ? 'mk-flash' : ''}>{qual ? '₹1.2 crore' : '—'}</dd>
          <dt>Stage</dt>
          <dd className={qual ? 'mk-flash' : ''}>{qual ? 'Qualified' : '—'}</dd>
        </dl>
        <span className="mk-btn sm">Resolve</span>
      </div>
    </div>
  );
}

const ROWS = [
  ['Simran Kaur', '+91 98000 01275', 'Site visit booked', 'Qualified'],
  ['Neha Banerjee', '+91 98000 01261', 'Rental', 'Contacted'],
  ['Karan Thakur', '+91 98000 01268', 'Hot lead', 'New'],
  ['Divya Pillai', '+91 98000 01247', 'First-time buyer', 'New'],
  ['Harsh Vora', '+91 98000 01254', 'NRI', 'Qualified'],
  ['Riya Sethi', '+91 98000 01233', 'Site visit booked', 'Qualified'],
  ['Omkar Patil', '+91 98000 01240', 'Investor', 'Contacted'],
];

function Contacts({ s }: { s: MockState }) {
  const row = s.row ?? 0;
  const detail = s.detail ?? 0;
  const fields = s.fields ?? 4;
  const rows = row ? [['Aarav Mehta', '+91 98000 01100', 'Hot lead', 'Qualified'], ...ROWS] : ROWS;
  const shown = detail ? rows.slice(0, 7) : rows;
  const detailRows: Array<[string, string]> = [
    ['Stage', 'Qualified'],
    ['Tag', 'Hot lead'],
    ['Budget', '₹1.2 crore'],
    ['Task', 'Call tomorrow, 10 am'],
  ];
  return (
    <>
      <div className="mk-head">
        <div>
          <h4 className="mk-h">
            <b>Contact Hub</b>
          </h4>
          <span className="mk-mute">Manage all your contacts in one place</span>
        </div>
        <span className="mk-btn">+ Create contacts</span>
      </div>
      <div className={detail ? 'mk-split' : ''}>
        <div className="mk-card">
          <div className="mk-filters">
            <span>Search by name or number</span>
            <span>Select segment</span>
            <span>Select tag</span>
            <span>Filters</span>
          </div>
          <table className="mk-table">
            <thead>
              <tr>
                <th>CONTACT NAME</th>
                <th>PHONE NUMBER</th>
                <th>TAGS</th>
                <th>STAGE</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([n, p, t, st], i) => (
                <tr
                  key={n}
                  className={row && i === 0 ? 'mk-newrow' : ''}
                  data-t={row && i === 0 ? 'row-new' : undefined}
                >
                  <td>
                    <Av
                      t={n!
                        .split(' ')
                        .map((x) => x[0])
                        .join('')}
                      c={`c${i % 5}`}
                    />{' '}
                    {n}
                  </td>
                  <td>{p}</td>
                  <td>
                    <span className="mk-tag">{t}</span>
                  </td>
                  <td>
                    <span className={`mk-stage ${st}`}>{st}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail ? (
          <div className="mk-card mk-detail mk-pop" data-t="detail">
            <Av t="AM" c="big" />
            <b>Aarav Mehta</b>
            <span className="mk-mute">WhatsApp · Instagram ad</span>
            <dl>
              {detailRows.slice(0, fields).map(([k, v]) => (
                <div key={k} className="mk-pop">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Deals({ s }: { s: MockState }) {
  const moved = s.moved ?? 2;
  const penthouse = (cls: string, t?: string) => (
    <div key="p" className={`mk-card mk-deal ${cls}`} data-t={t}>
      <b>Penthouse</b>
      <span className="mk-mute">Aarav Mehta</span>
      <em>₹1.9 cr</em>
    </div>
  );
  const cols: Array<[string, string, ReactNode[], string?]> = [
    [
      'New',
      '₹3.2 cr',
      [
        <Deal key="a" d="3 BHK, Baner" c="Karan Thakur" v="₹1.2 cr" />,
        <Deal key="b" d="Retail unit" c="Ananya Iyer" v="₹2.1 cr" />,
      ],
    ],
    [
      'Qualified',
      moved < 2 ? '₹4.5 cr' : '₹2.6 cr',
      [
        <Deal key="a" d="2 BHK, Wakad" c="Simran Kaur" v="₹82 L" />,
        <Deal key="b" d="Villa plot" c="Harsh Vora" v="₹1.8 cr" />,
        ...(moved < 2 ? [penthouse(moved === 1 ? 'lifted' : '', 'deal-card')] : []),
      ],
    ],
    [
      'Proposal',
      moved >= 2 ? '₹3.1 cr' : '₹1.2 cr',
      [
        <Deal key="a" d="Duplex, Kothrud" c="Vikram Singh" v="₹1.2 cr" />,
        ...(moved >= 2 ? [penthouse('landed mk-pop')] : []),
      ],
      'col-proposal',
    ],
    ['Won', '₹82 L', [<Deal key="a" d="1 BHK, Hinjewadi" c="Neha Banerjee" v="₹82 L" />]],
  ];
  return (
    <>
      <div className="mk-head">
        <h4 className="mk-h">
          <b>Sales pipeline</b>
        </h4>
        <span className="mk-btn">+ New deal</span>
      </div>
      <div className="mk-kanban">
        {cols.map(([t, sum, cards, dt]) => (
          <div key={t} className="mk-kcol" data-t={dt}>
            <div className="mk-row">
              <b>{t}</b>
              <span className="mk-mute">{sum}</span>
            </div>
            {cards}
          </div>
        ))}
      </div>
    </>
  );
}

const Deal = ({ d, c, v }: { d: string; c: string; v: string }) => (
  <div className="mk-card mk-deal">
    <b>{d}</b>
    <span className="mk-mute">{c}</span>
    <em>{v}</em>
  </div>
);

function FlowBuilder() {
  const nodes: Array<[number, number, string, string]> = [
    [4, 36, 'Trigger', 'Keyword: “price”'],
    [26, 14, 'Message', 'Share the brochure'],
    [26, 58, 'Question', 'Budget range?'],
    [50, 36, 'Condition', 'Budget above ₹1 cr?'],
    [74, 14, 'Action', 'Assign to Sales'],
    [74, 58, 'Action', 'Add to nurture campaign'],
  ];
  return (
    <div className="mk-canvas">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <g fill="none" stroke="#9a8cf0" strokeWidth="0.4">
          <path d="M20 45 C 24 45, 22 23, 26 23" />
          <path d="M20 45 C 24 45, 22 67, 26 67" />
          <path d="M42 23 C 46 23, 46 45, 50 45" />
          <path d="M42 67 C 46 67, 46 45, 50 45" />
          <path d="M66 45 C 70 45, 70 23, 74 23" />
          <path d="M66 45 C 70 45, 70 67, 74 67" />
        </g>
      </svg>
      {nodes.map(([x, y, t, d]) => (
        <div key={`${x}-${y}`} className="mk-node" style={{ left: `${x}%`, top: `${y}%` }}>
          <em>{t}</em>
          <b>{d}</b>
        </div>
      ))}
      <span className="mk-badge">Published</span>
    </div>
  );
}

function AiAgents() {
  return (
    <>
      <div className="mk-head">
        <h4 className="mk-h">
          <b>AI agents</b>
        </h4>
        <span className="mk-btn">+ New agent</span>
      </div>
      <div className="mk-cols">
        <div>
          {[
            ['Sales assistant', 'WhatsApp · Website chat', 'Live'],
            ['Support helper', 'Website chat', 'Live'],
            ['Site-visit booker', 'WhatsApp', 'Draft'],
          ].map(([n, c, st]) => (
            <div key={n} className="mk-card mk-agent">
              <span className="mk-ic">
                <Icon name="sparkle" />
              </span>
              <span>
                <b>{n}</b>
                <i>{c}</i>
              </span>
              <span className={`mk-stage ${st === 'Live' ? 'Qualified' : 'New'}`}>{st}</span>
            </div>
          ))}
          <div className="mk-card">
            <b>Knowledge</b>
            <ul className="mk-kn">
              <li>Project brochure.pdf</li>
              <li>Price list 2026.pdf</li>
              <li>northwind-realty.example/faq</li>
            </ul>
          </div>
        </div>
        <div className="mk-card mk-thread">
          <b>Test the agent</b>
          <div className="mk-msgs">
            <p className="in">Do you have a 2 BHK under 80 lakh?</p>
            <p className="out">Yes, in Wakad from ₹78 lakh. What move-in date should I note?</p>
            <p className="in">Next month.</p>
            <p className="out">Noted. Priya will confirm a site visit shortly.</p>
          </div>
          <span className="mk-ok">Handover rule: asks for a person</span>
        </div>
      </div>
    </>
  );
}

function Broadcasts({ s }: { s: MockState }) {
  const send = s.send ?? 2;
  const rows = [
    ['Festive offer', 'Hot leads', '1,204', '98%', '62%', 'Sent'],
    ['Site visit reminder', 'Booked visits', '186', '99%', '81%', 'visit'],
    ['New launch: Lakeview', 'Investors', '2,040', '—', '—', 'Scheduled'],
    ['Payment reminder', 'Overdue', '312', '97%', '58%', 'Sent'],
    ['Weekend open house', 'Past visitors', '540', '98%', '66%', 'Sent'],
    ['Referral thank-you', 'Won deals', '64', '100%', '88%', 'Sent'],
  ];
  return (
    <>
      <div className="mk-head">
        <h4 className="mk-h">
          <b>Broadcasts</b>
        </h4>
        <span className="mk-btn">+ New broadcast</span>
      </div>
      <div className="mk-grid4 mk-grid3">
        <Kpi
          label="Broadcasts this week"
          value="6"
          delta="2 more"
          bars={[30, 45, 40, 70, 55, 80, 75]}
        />
        <Kpi
          label="Delivery rate"
          value="98.4%"
          delta="0.6pp"
          bars={[70, 72, 71, 75, 74, 78, 77]}
        />
        <Kpi label="Read rate" value="64.1%" delta="3.2pp" bars={[40, 50, 46, 58, 55, 64, 62]} />
      </div>
      <div className="mk-card">
        <table className="mk-table">
          <thead>
            <tr>
              <th>NAME</th>
              <th>SEGMENT</th>
              <th>RECIPIENTS</th>
              <th>DELIVERED</th>
              <th>READ</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const visit = r[5] === 'visit';
              const done = !visit || send === 2;
              return (
                <tr key={r[0]} className={visit && send > 0 ? 'mk-newrow' : ''}>
                  <td>
                    <b>{r[0]}</b>
                  </td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td>{done ? r[3] : '—'}</td>
                  <td>{done ? r[4] : '—'}</td>
                  <td>
                    {!visit ? (
                      <span className={`mk-stage ${r[5] === 'Sent' ? 'Qualified' : 'Contacted'}`}>
                        {r[5]}
                      </span>
                    ) : send === 0 ? (
                      <span className="mk-btn sm" data-t="send-btn">
                        Send now
                      </span>
                    ) : send === 1 ? (
                      <span className="mk-stage Contacted mk-pop">Sending…</span>
                    ) : (
                      <span className="mk-stage Qualified mk-pop">Sent</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Marketplace() {
  const apps = [
    ['Website form', 'Lead sources', 'sheet'],
    ['Webhook', 'Lead sources', 'webhook'],
    ['Google Sheets', 'Productivity', 'sheet'],
    ['Chrome extension', 'Productivity', 'globe'],
    ['Shopify', 'E-commerce', 'bag'],
    ['WooCommerce', 'E-commerce', 'store'],
  ] as const;
  return (
    <>
      <div className="mk-head">
        <div>
          <h4 className="mk-h">
            <b>Marketplace</b>
          </h4>
          <span className="mk-mute">Add mini apps and connect outside services</span>
        </div>
        <span className="mk-link">Request an integration</span>
      </div>
      <div className="mk-tabs big">
        <span>Mini apps</span>
        <span className="on">Integrations</span>
      </div>
      <div className="mk-cols mk-market">
        <ul className="mk-cats">
          {[
            'All',
            'Lead sources',
            'Messaging',
            'Payments',
            'E-commerce',
            'Productivity',
            'Support',
          ].map((c, i) => (
            <li key={c} className={i === 0 ? 'on' : ''}>
              {c}
            </li>
          ))}
        </ul>
        <div className="mk-apps">
          {apps.map(([n, c, ic]) => (
            <div key={n} className="mk-card mk-app">
              <span className="mk-ic">
                <Icon name={ic} />
              </span>
              <b>{n}</b>
              <i>{c}</i>
              <span className="mk-btn sm">Install</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const SCREENS: Record<string, (p: { s: MockState }) => ReactNode> = {
  dashboard: Dashboard,
  inbox: Inbox,
  contacts: Contacts,
  deals: Deals,
  'flow-builder': FlowBuilder,
  'ai-agents': AiAgents,
  broadcasts: Broadcasts,
  marketplace: Marketplace,
};

/** One drawn app screen by id, in the given walkthrough state. Unknown ids render nothing. */
export function AppMock({ id, state = {} }: { id: string; state?: MockState }) {
  const Screen = SCREENS[id];
  return Screen ? (
    <Shell id={id}>
      <Screen s={state} />
    </Shell>
  ) : null;
}

const Chrome = () => (
  <div className="gx-shotbar" aria-hidden>
    <i style={{ background: '#ff5f57' }} />
    <i style={{ background: '#febc2e' }} />
    <i style={{ background: '#28c840' }} />
  </div>
);

/** A glass browser frame around a drawn screen. */
export function MockFrame({ id, alt }: { id: string; alt: string }) {
  return (
    <div className="gx-shotframe" role="img" aria-label={alt}>
      <Chrome />
      <div aria-hidden>
        <AppMock id={id} />
      </div>
    </div>
  );
}
