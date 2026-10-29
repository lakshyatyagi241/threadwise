import type { ReactNode } from 'react';
import Link from 'next/link';

/** Carried over word for word from the existing geta.ai site. */
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="lg-sec">
    <h2>{title}</h2>
    {children}
  </section>
);

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;

const UL = ({ items }: { items: ReactNode[] }) => (
  <ul>
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

export function TermsBody() {
  return (
    <>
      <Section title="Welcome to Geta.ai!">
        <P>
          These terms and conditions outline the rules and regulations for the use of Geta Website
          and APP, located at{' '}
          <a href="https://geta.ai/" style={{ color: '#3D52D5', fontWeight: 600 }}>
            https://geta.ai/
          </a>
        </P>
        <div className="mt-3">
          <P>
            By accessing this website we assume you accept these terms and conditions. Do not
            continue to use Geta.ai if you do not agree to take all of the terms and conditions
            stated on this page.
          </P>
        </div>
        <div className="mt-3">
          <P>
            The following terminology applies to these Terms and Conditions, Privacy Statement and
            Disclaimer Notice and all Agreements: &ldquo;Client&rdquo;, &ldquo;You&rdquo; and
            &ldquo;Your&rdquo; refers to you, the person log on this website and compliant to the
            Company&rsquo;s terms and conditions. &ldquo;The Company&rdquo;,
            &ldquo;Ourselves&rdquo;, &ldquo;We&rdquo;, &ldquo;Our&rdquo; and &ldquo;Us&rdquo;,
            refers to our Company. &ldquo;Party&rdquo;, &ldquo;Parties&rdquo;, or &ldquo;Us&rdquo;,
            refers to both the Client and ourselves. All terms refer to the offer, acceptance and
            consideration of payment necessary to undertake the process of our assistance to the
            Client in the most appropriate manner for the express purpose of meeting the
            Client&rsquo;s needs in respect of provision of the Company&rsquo;s stated services, in
            accordance with and subject to, prevailing law of Netherlands. Any use of the above
            terminology or other words in the singular, plural, capitalization and/or he/she or
            they, are taken as interchangeable and therefore as referring to same.
          </P>
        </div>
        <div className="mt-3">
          <P>
            You may not use our products for any unauthorized or illegal purpose, and you may not
            break any laws in your area (including, but not limited to, copyright laws) by using the
            Service.
          </P>
        </div>
        <div className="mt-3">
          <P>
            Any violation of the Terms will result in the immediate termination of your Services.
          </P>
        </div>
      </Section>

      <Section title="Information Accuracy, Completeness And Timeliness">
        <P>
          We are not liable if the information on this site is not accurate, complete, or up to
          date. The content on this website is for general information purposes only and should not
          be relied on or used as the sole basis for making decisions without accessing primary,
          more accurate, more complete, or more timely sources of information. Any reliance on the
          information on this website is entirely at your own risk.
        </P>
        <div className="mt-3">
          <P>
            This website may contain historical information. Historical information is, by
            definition, out of date and is given solely for your convenience. We reserve the right
            to change the contents of this site at any time, but we are under no duty to keep any
            information on our site up to date. You acknowledge that it is your obligation to keep
            track of changes to our website.
          </P>
        </div>
      </Section>

      <Section title="Modifications To The Service And Prices">
        <P>
          Our product prices are subject to change without prior notice. We retain the right to
          change or discontinue the Service (or any portion or content thereof) at any time and
          without prior notice.
        </P>
        <div className="mt-3">
          <P>
            We will not be accountable to you or any third person if the service or product is
            modified, suspended, price changes or discontinued.
          </P>
        </div>
        <div className="mt-3">
          <P>
            We undertake no obligation to update, amend or clarify information in the Service or on
            any related website, including without limitation, pricing information, except as
            required by law. No specified update or refresh date applied in the Service or on any
            related website, should be taken to indicate that all information in the Service or on
            any related website has been modified or updated.
          </P>
        </div>
      </Section>

      <Section title="Products Or Services">
        <P>
          We reserve the right, but are not bound, to restrict the sale of our products or Services
          to any individual, geographic location, or governing body. We may exercise this privilege
          on an individual basis. We have the right to place limits on the quantity of any items or
          services we provide. All product descriptions and prices are subject to change at any time
          without notice, at our sole discretion. We have the right to discontinue any product
          without prior notice. Any offer on this website for a product or service is void where
          prohibited. We make no guarantee that the quality of any items, services, information, or
          other material purchased or accessed by you will match your expectations, nor that any
          faults in the Service will be fixed.
        </P>
      </Section>

      <Section title="Cookies">
        <P>
          We employ the use of cookies. By accessing Geta.ai, you agreed to use cookies in agreement
          with the Geta Website And APP&rsquo;s{' '}
          <Link href="/legal/privacy" style={{ color: '#3D52D5', fontWeight: 600 }}>
            Privacy Policy
          </Link>
          .
        </P>
        <div className="mt-3">
          <P>
            Most interactive websites use cookies to let us retrieve the user&rsquo;s details for
            each visit. Cookies are used by our website to enable the functionality of certain areas
            to make it easier for people visiting our website. Some of our affiliate/advertising
            partners may also use cookies.
          </P>
        </div>
      </Section>

      <Section title="Disclaimer of Warranties / Limitation of Liability">
        <P>
          We make no assurance, representation, or warranty that your use of our service will be
          uninterrupted, timely, secure, or free of errors.
        </P>
        <div className="mt-3">
          <P>
            You accept that we may suspend the service for indeterminate lengths of time or
            terminate the service at any moment without prior notice.
          </P>
        </div>
        <div className="mt-3">
          <P>
            You agree expressly that your use of or inability to use the service is at your sole
            risk. The service and all products and services delivered to you through the service are
            provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; for your use, without any
            representation, warranties or conditions of any kind, either express or implied,
            including all conditions and warranties or conditions of merchantability, merchantable
            quality, fitness for a particular purpose, durability, title, and non-infringement.
          </P>
        </div>
        <div className="mt-3">
          <P>
            In no event shall Concorde Business, our directors, officers, employees, affiliates,
            agents, contractors, interns, suppliers, service providers or partner companies be
            liable for any injury, loss, claim, or any direct, indirect, incidental, punitive,
            special, or consequential damages of any kind, including, but not limited to lost
            profits, lost revenue, lost savings, loss of data, replacement costs, or any similar
            damages, whether based in contract, tort (including negligence), strict liability, or
            otherwise. Because some states or jurisdictions may not enable the exclusion or
            limitation of responsibility for consequential or incidental damages, in such states or
            jurisdictions, our liability is limited to the greatest extent permissible by law.
          </P>
        </div>
      </Section>

      <Section title="License">
        <P>
          Unless otherwise stated, Geta Website And APP and/or its licensors own the intellectual
          property rights for all material on Geta.ai. All intellectual property rights are
          reserved. You may access this from Geta.ai for your own personal use subjected to
          restrictions set in these terms and conditions.
        </P>
        <div className="mt-3">
          <P>You must not:</P>
          <UL
            items={[
              'Republish material from Geta.ai',
              'Sell, rent or sub-license material from Geta.ai',
              'Reproduce, duplicate or copy material from Geta.ai',
              'Redistribute content from Geta.ai',
            ]}
          />
        </div>
        <div className="mt-3">
          <P>
            Parts of this website offer an opportunity for users to post and exchange opinions and
            information in certain areas of the website. Geta Website And APP does not filter, edit,
            publish or review Comments prior to their presence on the website. Comments do not
            reflect the views and opinions of Geta Website And APP, its agents and/or affiliates.
            Comments reflect the views and opinions of the person who post their views and opinions.
            To the extent permitted by applicable laws, Geta Website And APP shall not be liable for
            the Comments or for any liability, damages or expenses caused and/or suffered as a
            result of any use of and/or posting of and/or appearance of the Comments on this
            website.
          </P>
        </div>
        <div className="mt-3">
          <P>
            Geta Website And APP reserves the right to monitor all Comments and to remove any
            Comments which can be considered inappropriate, offensive or causes breach of these
            Terms and Conditions.
          </P>
        </div>
        <div className="mt-3">
          <P>You warrant and represent that:</P>
          <UL
            items={[
              'You are entitled to post the Comments on our website and have all necessary licenses and consents to do so;',
              'The Comments do not invade any intellectual property right, including without limitation copyright, patent or trademark of any third party;',
              'The Comments do not contain any defamatory, libelous, offensive, indecent or otherwise unlawful material which is an invasion of privacy',
              'The Comments will not be used to solicit or promote business or custom or present commercial activities or unlawful activity.',
            ]}
          />
        </div>
        <div className="mt-3">
          <P>
            You hereby grant Geta Website And APP a non-exclusive license to use, reproduce, edit
            and authorize others to use, reproduce and edit any of your Comments in any and all
            forms, formats or media.
          </P>
        </div>
      </Section>

      <Section title="Hyperlinking To Our Content">
        <P>The following organizations may link to our Website without prior written approval:</P>
        <UL
          items={[
            'Government agencies;',
            'Search engines;',
            'News organizations;',
            'Online directory distributors may link to our Website in the same manner as they hyperlink to the Websites of other listed businesses; and',
            'System wide Accredited Businesses except soliciting non-profit organizations, charity shopping malls, and charity fundraising groups which may not hyperlink to our Web site.',
          ]}
        />
        <div className="mt-3">
          <P>
            These organizations may link to our home page, to publications or to other Website
            information so long as the link: (a) is not in any way deceptive; (b) does not falsely
            imply sponsorship, endorsement or approval of the linking party and its products and/or
            services; and (c) fits within the context of the linking party&rsquo;s site.
          </P>
        </div>
        <div className="mt-3">
          <P>
            We may consider and approve other link requests from the following types of
            organizations:
          </P>
          <UL
            items={[
              'commonly-known consumer and/or business information sources',
              'dot.com community sites',
              'associations or other groups representing charities',
              'online directory distributors',
              'internet portals',
              'accounting, law and consulting firms and educational institutions and trade associations.',
            ]}
          />
        </div>
        <div className="mt-3">
          <P>
            We will approve link requests from these organizations if we decide that: (a) the link
            would not make us look unfavorably to ourselves or to our accredited businesses; (b) the
            organization does not have any negative records with us; (c) the benefit to us from the
            visibility of the hyperlink compensates the absence of Geta Website And APP; and (d) the
            link is in the context of general resource information.
          </P>
        </div>
        <div className="mt-3">
          <P>
            These organizations may link to our home page so long as the link: (a) is not in any way
            deceptive; (b) does not falsely imply sponsorship, endorsement or approval of the
            linking party and its products or services; and (c) fits within the context of the
            linking party&rsquo;s site.
          </P>
        </div>
        <div className="mt-3">
          <P>
            If you are one of the organizations listed in paragraph 2 above and are interested in
            linking to our website, you must inform us by sending an e-mail to Geta Website And APP.
            Please include your name, your organization name, contact information as well as the URL
            of your site, a list of any URLs from which you intend to link to our Website, and a
            list of the URLs on our site to which you would like to link. Wait 2-3 weeks for a
            response.
          </P>
        </div>
        <div className="mt-3">
          <P>Approved organizations may hyperlink to our Website as follows:</P>
          <UL
            items={[
              'By use of our corporate name; or',
              'By use of the uniform resource locator being linked to; or',
              "By use of any other description of our Website being linked to that makes sense within the context and format of content on the linking party's site.",
            ]}
          />
        </div>
        <div className="mt-3">
          <P>
            No use of Geta Website And APP&rsquo;s logo or other artwork will be allowed for linking
            absent a trademark license agreement.
          </P>
        </div>
      </Section>

      <Section title="iFrames">
        <P>
          Without prior approval and written permission, you may not create frames around our
          Webpages that alter in any way the visual presentation or appearance of our Website.
        </P>
      </Section>

      <Section title="Content Liability">
        <P>
          We shall not be hold responsible for any content that appears on your Website. You agree
          to protect and defend us against all claims that is rising on your Website. No link(s)
          should appear on any Website that may be interpreted as libelous, obscene or criminal, or
          which infringes, otherwise violates, or advocates the infringement or other violation of,
          any third party rights.
        </P>
      </Section>

      <Section title="Your Privacy">
        <P>
          Please read our{' '}
          <Link href="/legal/privacy" style={{ color: '#3D52D5', fontWeight: 600 }}>
            Privacy Policy
          </Link>
          .
        </P>
      </Section>

      <Section title="Reservation Of Rights">
        <P>
          We reserve the right to request that you remove all links or any particular link to our
          Website. You approve to immediately remove all links to our Website upon request. We also
          reserve the right to amen these terms and conditions and it&rsquo;s linking policy at any
          time. By continuously linking to our Website, you agree to be bound to and follow these
          linking terms and conditions.
        </P>
      </Section>

      <Section title="Removal Of Links From Our Website">
        <P>
          If you find any link on our Website that is offensive for any reason, you are free to
          contact and inform us any moment. We will consider requests to remove links but we are not
          obligated to or so or to respond to you directly.
        </P>
        <div className="mt-3">
          <P>
            We do not ensure that the information on this website is correct, we do not warrant its
            completeness or accuracy; nor do we promise to ensure that the website remains available
            or that the material on the website is kept up to date.
          </P>
        </div>
      </Section>

      <Section title="Disclaimer">
        <P>
          To the maximum extent permitted by applicable law, we exclude all representations,
          warranties and conditions relating to our website and the use of this website. Nothing in
          this disclaimer will:
        </P>
        <UL
          items={[
            'limit or exclude our or your liability for death or personal injury',
            'limit or exclude our or your liability for fraud or fraudulent misrepresentation',
            'limit any of our or your liabilities in any way that is not permitted under applicable law or exclude any of our or your liabilities that may not be excluded under applicable law.',
          ]}
        />
        <div className="mt-3">
          <P>
            The limitations and prohibitions of liability set in this Section and elsewhere in this
            disclaimer: (a) are subject to the preceding paragraph; and (b) govern all liabilities
            arising under the disclaimer, including liabilities arising in contract, in tort and for
            breach of statutory duty.
          </P>
        </div>
        <div className="mt-3">
          <P>
            As long as the website and the information and services on the website are provided free
            of charge, we will not be liable for any loss or damage of any nature.
          </P>
        </div>
      </Section>

      <Section title="Contact Information">
        <P>
          Questions about the Terms of Service should be sent to us at{' '}
          <a href="mailto:info@geta.ai" style={{ color: '#3D52D5', fontWeight: 600 }}>
            info@geta.ai
          </a>
        </P>
      </Section>
    </>
  );
}
