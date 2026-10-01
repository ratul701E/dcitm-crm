import { Injectable } from '@nestjs/common';

@Injectable()
export class SpintaxService {
  /**
   * Recursively parses nested Spintax structures: {Hi|Hello|Hey {there|}}
   */
  parseSpintax(text: string): string {
    if (!text) return '';
    const spintaxRegex = /\{([^{}]+)\}/g;

    let parsed = text;
    while (spintaxRegex.test(parsed)) {
      parsed = parsed.replace(spintaxRegex, (_, choices) => {
        const options = choices.split('|');
        const randomIndex = Math.floor(Math.random() * options.length);
        return options[randomIndex];
      });
    }

    return parsed;
  }

  /**
   * Builds a normalized variable context map from a lead, rotated mailbox, and campaign.
   */
  buildVariableContext(
    lead: any,
    mailbox?: any,
    campaign?: any,
  ): Record<string, any> {
    const firstName = lead?.firstName || '';
    const lastName = lead?.lastName || '';
    const fullName =
      [firstName, lastName].filter(Boolean).join(' ') ||
      firstName ||
      lastName ||
      '';
    const senderName =
      (mailbox?.senderName && String(mailbox.senderName).trim()) ||
      (mailbox?.displayName && String(mailbox.displayName).trim()) ||
      (campaign?.senderName && String(campaign.senderName).trim()) ||
      '';
    const senderEmail = (mailbox?.email && String(mailbox.email).trim()) || '';

    let customVars: Record<string, any> = {};
    if (lead?.customVariables) {
      if (typeof lead.customVariables === 'object' && lead.customVariables !== null) {
        customVars = lead.customVariables;
      } else if (typeof lead.customVariables === 'string') {
        try {
          customVars = JSON.parse(lead.customVariables);
        } catch {
          customVars = {};
        }
      }
    }

    return {
      // Recipient details
      firstName,
      first_name: firstName,
      lastName,
      last_name: lastName,
      fullName,
      full_name: fullName,
      name: fullName,
      email: lead?.email || '',
      company: lead?.company || '',
      companyName: lead?.company || '',
      company_name: lead?.company || '',
      jobTitle: lead?.jobTitle || '',
      job_title: lead?.jobTitle || '',
      role: lead?.jobTitle || '',
      title: lead?.jobTitle || '',
      country: lead?.country || '',
      city: lead?.city || '',
      website: lead?.website || '',
      linkedIn: lead?.linkedIn || '',
      linkedin: lead?.linkedIn || '',
      leadScore: lead?.leadScore != null ? String(lead.leadScore) : '',

      // Sender details
      senderName,
      sender_name: senderName,
      fromName: senderName,
      from_name: senderName,
      sender: senderName,
      senderEmail,
      sender_email: senderEmail,
      fromEmail: senderEmail,
      from_email: senderEmail,

      // Campaign details
      campaignTitle: campaign?.title || '',
      campaignName: campaign?.title || '',

      // Custom attributes
      customVariables: customVars,
      ...customVars,
    };
  }

  /**
   * Interpolates standard variables and custom nested variables with fallback support.
   * Syntax examples:
   *  {{firstName}}
   *  {{companyName | your company}}
   *  {{customVariables.techStack | your platform}}
   *  {{role | decision maker}}
   */
  interpolateVariables(
    template: string,
    variables: Record<string, any>,
  ): string {
    if (!template) return '';

    // Matches {{ key }} or {{ key | fallback }} or malformed {{ }}
    return template.replace(
      /\{\{\s*([\w.-]*)(?:\s*\|\s*([^}]*))?\s*\}\}/g,
      (_match, rawKey, rawFallback) => {
        const key = (rawKey || '').trim();
        const fallback = rawFallback !== undefined ? rawFallback.trim() : undefined;

        if (!key) {
          return fallback ?? '';
        }

        const val = this.resolveValue(variables, key);
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return String(val);
        }

        return fallback ?? '';
      },
    );
  }

  /**
   * Resolves property path case-insensitively, supporting nested paths and aliases.
   */
  private resolveValue(obj: Record<string, any>, path: string): any {
    if (!obj || typeof obj !== 'object') return undefined;

    // Direct path lookup (e.g. "customVariables.techStack")
    const parts = path.split('.');
    let current: any = obj;
    let found = true;

    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== 'object') {
        found = false;
        break;
      }

      if (part in current) {
        current = current[part];
      } else {
        // Case-insensitive & normalized search for this segment
        const normalizedTarget = part.toLowerCase().replace(/[-_]/g, '');
        const matchedKey = Object.keys(current).find(
          (k) => k.toLowerCase().replace(/[-_]/g, '') === normalizedTarget,
        );

        if (matchedKey && matchedKey in current) {
          current = current[matchedKey];
        } else {
          found = false;
          break;
        }
      }
    }

    if (found && current !== undefined && current !== null) {
      return current;
    }

    // If a non-nested key wasn't found at top level, check in customVariables
    if (parts.length === 1) {
      const topKey = parts[0];
      const customVars = obj.customVariables || obj.custom_variables;
      if (customVars && typeof customVars === 'object') {
        if (topKey in customVars) {
          return customVars[topKey];
        }
        const normalizedTarget = topKey.toLowerCase().replace(/[-_]/g, '');
        const matchedCustomKey = Object.keys(customVars).find(
          (k) => k.toLowerCase().replace(/[-_]/g, '') === normalizedTarget,
        );
        if (matchedCustomKey) {
          return customVars[matchedCustomKey];
        }
      }
    }

    return undefined;
  }

  /**
   * Complete render pipeline: interpolates dynamic variables first, then resolves Spintax variations
   */
  render(template: string, variables: Record<string, any>): string {
    const interpolated = this.interpolateVariables(template, variables);
    return this.parseSpintax(interpolated);
  }
}
