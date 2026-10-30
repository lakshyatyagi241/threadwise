import { CountUp } from './count-up';
import { Icon, type IconName } from './icons';
import { Portrait } from './portrait';
import './adaptive.css';
import './one-tool.css';

/** The separate tools a small team usually stitches together; on the card they are all attached to one record. */
const TOOLS: Array<{ t: string; icon: IconName; c: string }> = [
  { t: 'Chatbot', c: '#3214db', icon: 'chat' },
  { t: 'CRM', c: '#3214db', icon: 'contact' },
  { t: 'WhatsApp', c: '#3214db', icon: 'whatsapp' },
  { t: 'Forms', c: '#3214db', icon: 'form' },
  { t: 'Sheets', c: '#3214db', icon: 'sheet' },
  { t: 'Email', c: '#3214db', icon: 'mail' },
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
 * sheets and email all connected into it, with this week's numbers on the record. The figures are sample data. Everything animates when the section is reached and settles on its final state without motion.
 */
export function OneTool() {
  return (
    <div className="ot">
      <div
        className="ot-vis"
        role="img"
        aria-label="A customer record with the chatbot, CRM, WhatsApp, forms, sheets and email attached to it, beside a weekly message chart"
      >
        <div className="ox" aria-hidden>
          <svg
            className="ox-lines"
            viewBox="0 0 100 80"
            preserveAspectRatio="none"
            focusable="false"
          >
            {TOOLS.map((x, i) => {
              const left = i < 3;
              const y = [18, 40, 62][i % 3]!;
              return (
                <path
                  key={x.t}
                  d={left ? `M24 ${y} C27 ${y} 27 40 30 40` : `M76 ${y} C73 ${y} 73 40 70 40`}
                  style={{ ['--i' as string]: i, ['--c' as string]: x.c }}
                />
              );
            })}
          </svg>
          {TOOLS.map((x, i) => (
            <div
              key={x.t}
              className={`ox-tool ${i < 3 ? 'l' : 'r'} p${i % 3}`}
              style={{ ['--i' as string]: i, ['--c' as string]: x.c }}
            >
              <span className="ox-ic">
                <Icon name={x.icon} />
              </span>
              {x.t}
              <em />
            </div>
          ))}
          <div className="ox-card">
            <div className="ox-k">Customer record</div>
            <div className="ox-who">
              <Portrait look="bun" className="ox-face" />
              <div>
                <b>Aarav Mehta</b>
                <i>Admissions enquiry</i>
              </div>
            </div>
            <div className="ox-stats">
              <div>
                <b>
                  <CountUp to={1284} />
                </b>
                <i>messages this week</i>
              </div>
              <div>
                <b>92%</b>
                <i>replied in time</i>
              </div>
            </div>
            <div className="ox-bars">
              {BARS.map((h, i) => (
                <u
                  key={DAYS[i]! + i}
                  style={{ ['--h' as string]: `${h}%`, ['--i' as string]: i }}
                />
              ))}
            </div>
            <div className="ox-btn">
              <Icon name="chat" />
              Reply from one inbox
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
