import { CountUp } from './count-up';
import { Icon, type IconName } from './icons';
import { Portrait } from './portrait';
import './adaptive.css';
import './one-tool.css';

/** The separate tools a small team usually stitches together; on the card they are all attached to one record. */
const TOOLS: Array<{ t: string; icon: IconName }> = [
  { t: 'Chatbot', icon: 'chat' },
  { t: 'CRM', icon: 'contact' },
  { t: 'WhatsApp', icon: 'whatsapp' },
  { t: 'Forms', icon: 'form' },
  { t: 'Sheets', icon: 'sheet' },
  { t: 'Email', icon: 'mail' },
];

const BARS = [46, 30, 74, 38, 58, 88, 22];
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ONE = [
  'Nothing to connect: your bots, leads and messages already share one record',
  'One thing to learn instead of five, for you and for your team',
  'Start with only what you need, and switch on more later',
];

/**
 * "One platform instead of five tools": a product illustration, a customer record with the chatbot, CRM, WhatsApp, forms,
 * sheets and email all attached to it, with a weekly chart and a response-time gauge floating beside it. The figures are
 * sample data. Everything animates when the section is reached and settles on its final state without motion.
 */
export function OneTool() {
  return (
    <div className="ot">
      <div
        className="ot-vis"
        role="img"
        aria-label="A customer record with the chatbot, CRM, WhatsApp, forms, sheets and email attached to it, beside a weekly message chart"
      >
        <div className="ov" aria-hidden>
          <div className="ov-a ov-rec-a">
            <div className="ov-card ov-rec">
              <div className="ov-title">Customer record</div>
              <div className="ov-who">
                <Portrait look="bun" className="ov-face" />
                <div>
                  <b>Aarav Mehta</b>
                  <i>Admissions enquiry</i>
                </div>
              </div>
              <div className="ov-rule" />
              <div className="ov-k">All in one place</div>
              <div className="ov-chips">
                {TOOLS.map((x, i) => (
                  <span key={x.t} className="ov-chip" style={{ ['--i' as string]: i }}>
                    <Icon name={x.icon} />
                    {x.t}
                    <em>
                      <Icon name="check" />
                    </em>
                  </span>
                ))}
              </div>
              <div className="ov-btn">
                <Icon name="chat" />
                Reply from one inbox
              </div>
            </div>
          </div>

          <div className="ov-a ov-stat-a">
            <div className="ov-card ov-stat">
              <div className="ov-sk">Messages this week</div>
              <div className="ov-sn">
                <CountUp to={1284} />
              </div>
              <div className="ov-bars">
                {BARS.map((h, i) => (
                  <span key={DAYS[i]! + i} style={{ ['--h' as string]: `${h}%`, ['--i' as string]: i }}>
                    <u />
                    <i>{DAYS[i]}</i>
                  </span>
                ))}
              </div>
              <span className="ov-tag">+24%</span>
            </div>
          </div>

          <div className="ov-a ov-gauge-a">
            <div className="ov-card ov-gauge">
              <svg viewBox="0 0 100 56" className="ov-arc" focusable="false">
                <defs>
                  <linearGradient id="ov-g" x1="0" x2="1">
                    <stop offset="0" stopColor="#8b8ff5" />
                    <stop offset="1" stopColor="#3b2fe0" />
                  </linearGradient>
                </defs>
                <path d="M10 50A40 40 0 0 1 90 50" className="ov-arc-t" />
                <path d="M10 50A40 40 0 0 1 90 50" className="ov-arc-p" />
              </svg>
              <span className="ov-bolt">
                <Icon name="bolt" />
              </span>
              <div className="ov-strip">
                <span>Replied in time</span>
                <b>92%</b>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="ot-copy">
        <div className="gx-eyebrow">Why one platform</div>
        <h2 className="gx-h2">Stop juggling five tools to answer one customer.</h2>
        <p className="gx-lead">
          Most small teams stitch a chatbot, a CRM, a WhatsApp sender, forms and a spreadsheet
          together, then spend their time keeping them in step. Geta keeps all of it in one place.
        </p>
        <ul className="gx-list">
          {ONE.map((t) => (
            <li key={t}>
              <Icon name="check" />
              {t}
            </li>
          ))}
        </ul>
        <p className="ot-note">
          We left out the hundred-feature maze of the big CRMs on purpose. You get the features
          people use every day.
        </p>
      </div>
    </div>
  );
}
