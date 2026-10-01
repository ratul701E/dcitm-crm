import { SpintaxService } from './spintax.service';

describe('SpintaxService Personalization Engine', () => {
  let service: SpintaxService;

  beforeEach(() => {
    service = new SpintaxService();
  });

  describe('Standard Placeholders & Aliases', () => {
    const lead = {
      id: 'lead-1',
      email: 'sarah@stripe.com',
      firstName: 'Sarah',
      lastName: 'Connor',
      company: 'Stripe',
      jobTitle: 'VP of Engineering',
      country: 'United States',
      city: 'San Francisco',
      website: 'https://stripe.com',
      linkedIn: 'https://linkedin.com/in/sarahconnor',
      leadScore: 92,
      customVariables: {
        techStack: 'Ruby on Rails',
        teamSize: '500+',
      },
    };

    const mailbox = {
      email: 'alex@outreach.internal',
      senderName: 'Alex Vance',
      displayName: 'Alex',
    };

    const campaign = {
      title: 'Q4 Outbound Campaign',
    };

    it('should interpolate all standard recipient fields correctly', () => {
      const context = service.buildVariableContext(lead, mailbox, campaign);

      const template =
        'Hello {{firstName}} {{lastName}} ({{fullName}}). Email: {{email}}. Company: {{company}}. Role: {{role}}. Job: {{jobTitle}}. Title: {{title}}. Country: {{country}}. City: {{city}}. Website: {{website}}. LinkedIn: {{linkedIn}}. Score: {{leadScore}}.';

      const rendered = service.interpolateVariables(template, context);

      expect(rendered).toBe(
        'Hello Sarah Connor (Sarah Connor). Email: sarah@stripe.com. Company: Stripe. Role: VP of Engineering. Job: VP of Engineering. Title: VP of Engineering. Country: United States. City: San Francisco. Website: https://stripe.com. LinkedIn: https://linkedin.com/in/sarahconnor. Score: 92.',
      );
    });

    it('should interpolate sender and campaign information', () => {
      const context = service.buildVariableContext(lead, mailbox, campaign);

      const template =
        'From {{senderName}} ({{senderEmail}} / {{fromEmail}} / {{fromName}}) for {{campaignTitle}}';

      const rendered = service.interpolateVariables(template, context);

      expect(rendered).toBe(
        'From Alex Vance (alex@outreach.internal / alex@outreach.internal / Alex Vance) for Q4 Outbound Campaign',
      );
    });

    it('should support case-insensitive and snake_case variable tags', () => {
      const context = service.buildVariableContext(lead, mailbox, campaign);

      const template =
        'Hi {{FIRSTNAME}}, {{first_name}}, {{company_name}}, {{COMPANY}}, {{job_title}}, {{SENDER_NAME}}!';

      const rendered = service.interpolateVariables(template, context);

      expect(rendered).toBe(
        'Hi Sarah, Sarah, Stripe, Stripe, VP of Engineering, Alex Vance!',
      );
    });

    it('should dynamically switch sender name and email when rotating between multiple mailboxes', () => {
      const mailboxA = {
        email: 'alice@domain-alpha.com',
        senderName: 'Alice Alpha',
      };
      const mailboxB = {
        email: 'bob@domain-beta.com',
        senderName: 'Bob Beta',
      };

      const template = 'Best regards,\n{{senderName}}\nContact me at {{senderEmail}} or {{sender}}';

      // Dispatched using Mailbox A
      const contextA = service.buildVariableContext(lead, mailboxA, campaign);
      const renderedA = service.interpolateVariables(template, contextA);
      expect(renderedA).toBe('Best regards,\nAlice Alpha\nContact me at alice@domain-alpha.com or Alice Alpha');

      // Dispatched using Mailbox B
      const contextB = service.buildVariableContext(lead, mailboxB, campaign);
      const renderedB = service.interpolateVariables(template, contextB);
      expect(renderedB).toBe('Best regards,\nBob Beta\nContact me at bob@domain-beta.com or Bob Beta');
    });
  });

  describe('Fallback Resolution', () => {
    it('should use recipient value when present and ignore fallback', () => {
      const context = { firstName: 'Jordan', company: 'Acme Corp' };
      const template = 'Hi {{firstName | there}} from {{company | your team}}';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hi Jordan from Acme Corp',
      );
    });

    it('should use fallback text when value is null, undefined, or empty string', () => {
      const context = {
        firstName: null,
        company: '',
        role: undefined,
      };

      const template =
        'Hi {{firstName | friend}}, wanted to reach out to {{company | your company}} regarding your work as {{role | a leader}}.';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hi friend, wanted to reach out to your company regarding your work as a leader.',
      );
    });

    it('should trim surrounding whitespace in fallback definitions', () => {
      const context = { firstName: '' };
      const template = 'Hello {{ firstName |    valued colleague   }}!';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hello valued colleague!',
      );
    });
  });

  describe('Missing & Unsupported Placeholders', () => {
    it('should resolve missing values to empty string when no fallback is provided (prevent raw syntax leak)', () => {
      const context = { firstName: null, company: undefined };
      const template = 'Hi {{firstName}}, checking in on {{company}}!';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hi , checking in on !',
      );
    });

    it('should safely resolve unsupported tags without fallback to empty string', () => {
      const context = { firstName: 'Alex' };
      const template = 'Hello {{firstName}}, your {{nonExistentAttribute}} is ready.';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hello Alex, your  is ready.',
      );
    });

    it('should use fallback for unsupported tags when fallback is specified', () => {
      const context = { firstName: 'Alex' };
      const template = 'Hello {{firstName}}, {{unsupportedField | default value}}';

      expect(service.interpolateVariables(template, context)).toBe(
        'Hello Alex, default value',
      );
    });

    it('should handle malformed tags without crashing', () => {
      const context = { firstName: 'Alex' };
      const template = 'Hello {{}} {{   }} {{firstName}}!';

      expect(service.interpolateVariables(template, context)).toBe('Hello   Alex!');
    });
  });

  describe('Custom Variables & Nested Paths', () => {
    it('should resolve nested custom variables and direct custom variable keys', () => {
      const lead = {
        email: 'dev@tech.io',
        customVariables: {
          techStack: 'NestJS & PostgreSQL',
          funding: 'Series B',
        },
      };

      const context = service.buildVariableContext(lead);

      const template =
        'Built with {{customVariables.techStack}} (or direct {{techStack}}). Funding: {{funding | Unknown}}. Stage: {{customVariables.stage | Seed}}.';

      const rendered = service.interpolateVariables(template, context);

      expect(rendered).toBe(
        'Built with NestJS & PostgreSQL (or direct NestJS & PostgreSQL). Funding: Series B. Stage: Seed.',
      );
    });

    it('should parse JSON string customVariables if lead stored it as string', () => {
      const lead = {
        email: 'user@json.com',
        customVariables: JSON.stringify({ tier: 'Enterprise' }),
      };

      const context = service.buildVariableContext(lead);
      const template = 'Tier: {{tier}} / {{customVariables.tier}}';

      expect(service.interpolateVariables(template, context)).toBe(
        'Tier: Enterprise / Enterprise',
      );
    });
  });

  describe('Spintax Evaluation', () => {
    it('should parse single and nested Spintax variations', () => {
      const text = '{Hi|Hello|Hey} there!';
      const rendered = service.parseSpintax(text);

      expect(['Hi there!', 'Hello there!', 'Hey there!']).toContain(rendered);
    });

    it('should execute complete render pipeline (variables first, then Spintax)', () => {
      const context = { firstName: 'Taylor' };
      const template = '{Hi|Hello} {{firstName}}, {hope you are doing well|quick note for you}.';

      const rendered = service.render(template, context);

      expect(rendered).toMatch(/^(Hi|Hello) Taylor, (hope you are doing well|quick note for you)\.$/);
    });
  });

  describe('Multi-Recipient Personalization Independence', () => {
    it('should render distinct, correct messages for different recipients from a single template without altering the original template', () => {
      const originalSubject =
        'Quick note for {{firstName | there}} at {{company | your company}}';
      const originalBody =
        '<p>{Hi|Hello} {{firstName | there}},</p><p>As {{role | leader}} at {{company | your company}}, wanted to check your team in {{country | your region}}. Custom: {{techStack | standard}}.</p><p>Best, {{senderName}}</p>';

      const mailbox = {
        email: 'growth@omnisend.io',
        senderName: 'Elena Rostova',
      };

      // Recipient A: Full Data
      const leadA = {
        email: 'john@acme.corp',
        firstName: 'John',
        lastName: 'Doe',
        company: 'Acme Corp',
        jobTitle: 'VP Product',
        country: 'Canada',
        customVariables: { techStack: 'Kubernetes' },
      };

      // Recipient B: Partial/Empty Data
      const leadB = {
        email: 'anonymous@stealth.com',
        firstName: null,
        lastName: null,
        company: '',
        jobTitle: null,
        country: null,
        customVariables: {},
      };

      const contextA = service.buildVariableContext(leadA, mailbox);
      const contextB = service.buildVariableContext(leadB, mailbox);

      const subjectA = service.render(originalSubject, contextA);
      const bodyA = service.render(originalBody, contextA);

      const subjectB = service.render(originalSubject, contextB);
      const bodyB = service.render(originalBody, contextB);

      // Verify Recipient A
      expect(subjectA).toBe('Quick note for John at Acme Corp');
      expect(bodyA).toContain('John');
      expect(bodyA).toContain('VP Product at Acme Corp');
      expect(bodyA).toContain('team in Canada');
      expect(bodyA).toContain('Custom: Kubernetes');
      expect(bodyA).toContain('Best, Elena Rostova');

      // Verify Recipient B (Fallbacks correctly utilized)
      expect(subjectB).toBe('Quick note for there at your company');
      expect(bodyB).toContain('there');
      expect(bodyB).toContain('leader at your company');
      expect(bodyB).toContain('team in your region');
      expect(bodyB).toContain('Custom: standard');
      expect(bodyB).toContain('Best, Elena Rostova');

      // Verify original templates were not mutated
      expect(originalSubject).toBe(
        'Quick note for {{firstName | there}} at {{company | your company}}',
      );
      expect(originalBody).toContain('{{firstName | there}}');
      expect(originalBody).toContain('{{role | leader}}');
    });
  });
});
