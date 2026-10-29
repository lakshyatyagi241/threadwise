import { Card, Cta, CtaBand, FaqJsonLd, FaqList, Hero, SecHead, Section, Steps } from '../ui';

const STEPS = [
  {
    title: 'Sign in',
    text: 'Sign in with the account you want to remove. If you have forgotten the password, reset it from the sign-in page first: deleting needs your current password.',
  },
  {
    title: 'Open Account, then Delete account',
    text: 'Open Account in the app and choose the Delete account tab. After you sign in, the direct address is /account/delete.',
  },
  {
    title: 'Confirm it is you',
    text: 'Type DELETE my account exactly as shown, capital letters included, and enter your current password. Saying why you are leaving is optional and stays in the form.',
  },
  {
    title: 'Delete',
    text: 'Choose Permanently delete account. You are signed out everywhere and cannot sign in with this account again.',
  },
];

const FAQ = [
  {
    q: 'Can I undo it?',
    a: 'No. Deleting your account is permanent. If you only want a break or a smaller bill, downgrade to the free plan under Account, Plans, or contact us instead.',
  },
  {
    q: 'I cannot sign in. How do I delete my account?',
    a: 'Use “Forgot password” on the sign-in page to get back in, then follow the steps above. If you no longer have access to your email address, contact us from the same address you registered with and we will help.',
  },
  {
    q: 'Does deleting my account delete the workspace?',
    a: 'No. Your sign-in, profile, photo and devices are removed. The workspace and its other members stay, and the work you did remains with the workspace.',
  },
  {
    q: 'I am the only administrator. What now?',
    a: 'Make another member an administrator first, then come back and delete your account. The delete screen tells you if this is what is blocking you.',
  },
  {
    q: 'I am the only member of my workspace.',
    a: 'An account cannot be deleted on its own when it is the only member. Contact us and ask for the workspace to be closed.',
  },
  {
    q: 'Do you keep anything after I delete my account?',
    a: 'A record that the account was deleted is kept in the audit trail. Nothing else is needed to sign in, because your sign-in is gone.',
  },
];

/** "How to delete your account": what the Delete account screen in the app does, in plain words. */
export function DeleteAccountPage() {
  return (
    <>
      <Hero
        eyebrow="Account help"
        title="How to delete your Geta account"
        sub="You can delete your own account from the app in about a minute. Here is how, what is removed, and what stays."
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Delete account' }]}
        primary={{ href: '/login', label: 'Sign in to delete' }}
        secondary={{ href: '/contact', label: 'Ask us for help' }}
      />

      <Section label="Steps">
        <SecHead eyebrow="Steps" title="Four steps, no email to send" />
        <Steps items={STEPS} />
      </Section>

      <Section soft label="What is removed and what stays">
        <SecHead
          eyebrow="Before you delete"
          title="What is removed and what stays"
          lead="Deleting an account removes you, not the business you worked for."
        />
        <div className="gx-grid gx-grid-3">
          <Card
            icon="close"
            title="Removed"
            text="Your sign-in, profile, photo and devices. You are signed out everywhere."
          />
          <Card
            icon="users"
            title="Stays with the workspace"
            text="The workspace, its other members and the work you did there."
          />
          <Card
            icon="doc"
            title="Kept for audit"
            text="A record that the account was deleted."
            green
          />
        </div>
      </Section>

      <Section label="Closing a whole workspace">
        <div className="gx-split">
          <div>
            <div className="gx-eyebrow">Closing a workspace</div>
            <h2 className="gx-h2">Want the whole workspace closed instead?</h2>
            <p className="gx-lead">
              Deleting your account does not close the workspace it belongs to. If you are the only
              member, or the owner and want everything closed, contact us from your account email
              and we will take care of it.
            </p>
            <div className="gx-cta-row">
              <Cta href="/contact" arrow>
                Contact us
              </Cta>
            </div>
          </div>
          <div className="gx-grid gx-grid-2">
            <Card
              icon="lock"
              title="Needs your password"
              text="Only you can delete your account."
            />
            <Card
              icon="shield"
              title="Checked for you"
              text="The screen warns you if you are the last admin."
            />
          </div>
        </div>
      </Section>

      <Section soft label="Questions">
        <SecHead center eyebrow="FAQ" title="Questions about deleting an account" />
        <FaqList items={FAQ} />
        <FaqJsonLd items={FAQ} />
      </Section>

      <CtaBand
        title="Not sure you want to leave?"
        text="Tell us what is not working. We may be able to fix it."
      />
    </>
  );
}
