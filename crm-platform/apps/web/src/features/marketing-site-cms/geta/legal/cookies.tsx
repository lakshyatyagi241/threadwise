import type { ReactNode } from 'react';

/** Carried over word for word from the existing geta.ai site. */
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="lg-sec">
    <h2>{title}</h2>
    {children}
  </section>
);

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;

export function CookiesBody() {
  return (
    <>
      <Section title="What Are Cookies">
        <P>
          As is common practice with almost all professional websites, this site uses cookies, which
          are tiny files that are downloaded to your computer, to improve your experience. This page
          describes what information they gather, how we use it, and why we sometimes need to store
          these cookies. We will also share how you can prevent these cookies from being stored,
          however, this may downgrade or &apos;break&apos; certain elements of the site&apos;s
          functionality.
        </P>
      </Section>

      <Section title="How We Use Cookies">
        <P>
          We use cookies for a variety of reasons detailed below. Unfortunately in most cases there
          are no industry standard options for disabling cookies without completely disabling the
          functionality and features they add to this site. It is recommended that you leave on all
          cookies if you are not sure whether you need them or not in case they are used to provide
          a service that you use.
        </P>
      </Section>

      <Section title="Account related cookies">
        <P>
          If you create an account with us then we will use cookies for the management of the signup
          process and general administration. These cookies will usually be deleted when you log out
          however in some cases they may remain afterwards to remember your site preferences when
          logged out.
        </P>
      </Section>

      <Section title="Login related cookies">
        <P>
          We use cookies when you are logged in so that we can remember this fact. This prevents you
          from having to log in every single time you visit a new page. These cookies are typically
          removed or cleared when you log out to ensure that you can only access restricted features
          and areas when logged in.
        </P>
      </Section>

      <Section title="Email newsletters related cookies">
        <P>
          This site offers newsletter or email subscription services and cookies may be used to
          remember if you are already registered and whether to show certain notifications which
          might only be valid to subscribed/unsubscribed users.
        </P>
      </Section>

      <Section title="Orders processing related cookies">
        <P>
          This site offers e-commerce or payment facilities and some cookies are essential to ensure
          that your order is remembered between pages so that we can process it properly.
        </P>
      </Section>

      <Section title="Surveys related cookies">
        <P>
          From time to time we offer user surveys and questionnaires to provide you with interesting
          insights, helpful tools, or to understand our user base more accurately. These surveys may
          use cookies to remember who has already taken part in a survey or to provide you with
          accurate results after you change pages.
        </P>
      </Section>

      <Section title="Forms related cookies">
        <P>
          When you submit data to through a form such as those found on contact pages or comment
          forms cookies may be set to remember your user details for future correspondence.
        </P>
      </Section>

      <Section title="Site preferences cookies">
        <P>
          In order to provide you with a great experience on this site, we provide the functionality
          to set your preferences for how this site runs when you use it. In order to remember your
          preferences, we need to set cookies so that this information can be recalled whenever you
          interact with a page affected by your preferences.
        </P>
      </Section>

      <Section title="Third Party Cookies">
        <div className="space-y-4">
          <P>
            In some special cases we also use cookies provided by trusted third parties. The
            following section details which third party cookies you might encounter through this
            site.
          </P>
          <P>
            This site uses Google Analytics which is one of the most widespread and trusted
            analytics solution on the web for helping us to understand how you use the site and ways
            that we can improve your experience. These cookies may track things such as how long you
            spend on the site and the pages that you visit so we can continue to produce engaging
            content. For more information on Google Analytics cookies, see the official Google
            Analytics page.
          </P>
          <P>
            Third party analytics are used to track and measure usage of this site so that we can
            continue to produce engaging content. These cookies may track things such as how long
            you spend on the site or pages you visit which helps us to understand how we can improve
            the site for you.
          </P>
          <P>
            From time to time we test new features and make subtle changes to the way that the site
            is delivered. When we are still testing new features these cookies may be used to ensure
            that you receive a consistent experience whilst on the site whilst ensuring we
            understand which optimisations our users appreciate the most.
          </P>
          <P>
            As we sell products it&apos;s important for us to understand statistics about how many
            of the visitors to our site actually make a purchase and as such this is the kind of
            data that these cookies will track. This is important to you as it means that we can
            accurately make business predictions that allow us to monitor our advertising and
            product costs to ensure the best possible price.
          </P>
          <P>
            We use adverts to offset the costs of running this site and provide funding for further
            development. The behavioural advertising cookies used by this site are designed to
            ensure that we provide you with the most relevant adverts where possible by anonymously
            tracking your interests and presenting similar things that may be of interest.
          </P>
          <P>
            Several partners advertise on our behalf and affiliate tracking cookies simply allow us
            to see if our customers have come to the site through one of our partner sites so that
            we can credit them appropriately and where applicable allow our affiliate partners to
            provide any bonus that they may provide you for making a purchase.
          </P>
          <P>
            We also use social media buttons and/or plugins on this site that allow you to connect
            with your social network in various ways. For these to work, social media sites such as
            LinkedIn, Twitter, and YouTube will set cookies through our site which may be used to
            enhance your profile on their site or contribute to the data they hold for various
            purposes outlined in their respective privacy policies.
          </P>
        </div>
      </Section>

      <Section title="More Information">
        <div className="space-y-4">
          <P>
            Hopefully that has clarified things for you and as was previously mentioned if there is
            something that you aren&apos;t sure whether you need or not it&apos;s usually safer to
            leave cookies enabled in case it does interact with one of the features you use on our
            site.
          </P>
          <P>
            However if you are still looking for more information then you can contact us through
            one of our preferred contact methods:
          </P>
          <P>Email: info@geta.ai</P>
        </div>
      </Section>
    </>
  );
}
